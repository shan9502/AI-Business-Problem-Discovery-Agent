import { callGeminiStructured, callGemini } from "@/lib/ai/gemini";
import { callGroqStructured } from "@/lib/ai/groq";
import { BUSINESSES_SCHEMA_SQL } from "@/lib/config/fields";
import { executeRawQuery, isPostgres } from "@/lib/db/queries";
import {
  QuerySpecSchema,
  SqlOutputSchema,
  type BusinessObserverState,
  type QuerySpec,
} from "../state";
import { z } from "zod";

// ─── Dangerous SQL keywords ───────────────────────────────────────────────────
const DANGEROUS_KEYWORDS = /\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|REPLACE)\b/i;
const VALID_TABLES = new Set(["businesses", "conversations", "messages"]);
const VALID_COLUMNS = new Set([
  "id","company_name","industry","company_size","department","workflow",
  "current_process","people_involved","frequency","time_consumed","main_pain",
  "error_rate","existing_software","why_existing_software_fails","ai_opportunity",
  "automation_opportunity","estimated_value","buyer","decision_maker","competition",
  "integration_difficulty","created_at","updated_at",
]);

// ─── Infrastructure vs logic error classification (#4) ────────────────────────
function isInfrastructureError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return (
    msg.includes("database is not open") ||
    msg.includes("cannot open") ||
    msg.includes("disk i/o error") ||
    msg.includes("sqlite_busy") ||
    msg.includes("connection") ||
    msg.includes("enoent")
  );
}

// ─── SQL Validator ────────────────────────────────────────────────────────────
function validateSql(sql: string): { valid: boolean; error?: string } {
  if (DANGEROUS_KEYWORDS.test(sql)) {
    return { valid: false, error: "SQL contains forbidden write/destructive operations." };
  }
  const hasValidTable = [...VALID_TABLES].some((t) =>
    sql.toLowerCase().includes(t)
  );
  if (!hasValidTable) {
    return { valid: false, error: "SQL does not reference any known table." };
  }
  return { valid: true };
}

// ─── Step 1: Build structured QuerySpec (Gemini) ─────────────────────────────
export async function buildQuerySpec(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const fieldList = [...VALID_COLUMNS].filter((c) => c !== "id" && !c.includes("_at")).join(", ");

  const prompt = `You are a query planner for a business intelligence database.

Database schema:
${BUSINESSES_SCHEMA_SQL}

Available business fields: ${fieldList}

User's natural language query: "${state.userMessage}"

Create a structured query specification. Return ONLY a valid JSON object:
{
  "intent": "search" | "aggregate" | "filter" | "sort" | "count",
  "filters": [
    { "field": "industry", "operator": "=", "value": "Distribution" }
  ],
  "fields": ["company_name", "industry", "automation_opportunity"],
  "sort": { "field": "company_name", "direction": "asc" },
  "limit": 20
}

CRITICAL — Token efficiency rules (MUST follow):
- Select ONLY the columns the user actually needs to answer their question.
- If the user just wants a list of companies/businesses, set "fields": ["company_name"] — nothing else.
- If the user asks for companies in a specific industry, set "fields": ["company_name", "industry"].
- NEVER select all columns unless the user explicitly asks for full details of a record.
- For LIKE searches, use the "LIKE" operator and include % wildcards in the value.
- filters and sort are optional.
- Return empty array [] for filters if no filtering is needed.`;

  const spec = await callGeminiStructured(prompt, QuerySpecSchema, "query_spec");
  return { querySpecification: spec };
}

// ─── Step 2+3: Generate SQL (Groq) + execute with retry ──────────────────────
export async function generateAndExecuteSql(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const spec = state.querySpecification as QuerySpec;
  const MAX_RETRIES = 3;
  let retryCount = state.retryCount ?? 0;
  let lastError = "";
  let lastSql = "";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const correctionContext =
      attempt > 0
        ? `\n\nPrevious attempt failed:\nSQL: ${lastSql}\nSQLite error: ${lastError}\nPlease fix the SQL error above.`
        : "";

    const dialect = isPostgres() ? "PostgreSQL" : "SQLite";
    const parameterFormat = isPostgres() ? "$1, $2, $3" : "? placeholders";

    const prompt = `You are a ${dialect} SQL generator.

Database schema:
${BUSINESSES_SCHEMA_SQL}

SQL dialect: ${dialect} — use ${dialect}-compatible syntax only.

Structured query specification:
${JSON.stringify(spec, null, 2)}
${correctionContext}

Generate a read-only SELECT query. Return ONLY valid JSON:
{
  "sql": "SELECT ...",
  "parameters": []
}

Rules:
- Use only columns and tables that exist in the schema above
- Forbidden keywords: INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, REPLACE
- Use ${parameterFormat} for user-supplied filter values in the parameters array
- Keep it simple and safe`;

    let sqlOutput: { sql: string; parameters: unknown[] };

    try {
      sqlOutput = await callGroqStructured(prompt, SqlOutputSchema, "sql_output");
    } catch (e) {
      // #4: Infrastructure error? Don't retry with more LLM calls
      if (isInfrastructureError(e)) {
        return {
          sqlError: `Database infrastructure error: ${e}`,
          sqlResult: null,
          retryCount,
        };
      }
      lastError = String(e);
      retryCount++;
      continue;
    }

    lastSql = sqlOutput.sql;

    // Validate
    const validation = validateSql(sqlOutput.sql);
    if (!validation.valid) {
      lastError = validation.error ?? "Validation failed";
      retryCount++;
      continue;
    }

    // Execute
    try {
      const rows = await executeRawQuery(sqlOutput.sql, sqlOutput.parameters as unknown[]);
      return {
        generatedSql: sqlOutput.sql,
        sqlResult: rows,
        sqlError: undefined,
        retryCount,
      };
    } catch (e) {
      // #4: Distinguish infrastructure vs SQL logic error
      if (isInfrastructureError(e)) {
        return {
          sqlError: `Database infrastructure error. Please try again later.`,
          sqlResult: null,
          retryCount,
        };
      }
      lastError = String(e);
      retryCount++;

      // On final normal retry, try Gemini query simplification
      if (attempt === MAX_RETRIES - 2) {
        const simplified = await simplifyQuery(state, lastError);
        if (simplified.querySpecification) {
          Object.assign(spec as object, simplified.querySpecification);
        }
      }
    }
  }

  return {
    sqlError: `Query could not be completed after ${MAX_RETRIES} attempts. Last error: ${lastError}`,
    generatedSql: lastSql,
    sqlResult: null,
    retryCount,
  };
}

// ─── Fallback: Gemini query simplifier ────────────────────────────────────────
async function simplifyQuery(state: BusinessObserverState, lastError: string) {
  const SimplifiedSchema = z.object({
    intent: z.enum(["search", "filter", "count"]),
    filters: z
      .array(
        z.object({
          field: z.string(),
          operator: z.enum(["=", "!=", "LIKE", ">", "<", ">=", "<="]),
          value: z.string(),
        })
      )
      .optional(),
    fields: z.array(z.string()).optional(),
    limit: z.number().optional(),
  });

  const prompt = `A SQL query could not be generated successfully.

Original user question: "${state.userMessage}"
Last SQL error: ${lastError}

Available columns in the businesses table:
company_name, industry, company_size, department, workflow, current_process, people_involved, frequency, time_consumed, main_pain, error_rate, existing_software, why_existing_software_fails, ai_opportunity, automation_opportunity, estimated_value, buyer, decision_maker, competition, integration_difficulty

Simplify the query to something that can definitely be expressed as a basic SELECT statement.
Return ONLY a JSON object like this — no z.record, no whereClause, no complex expressions:
{
  "intent": "filter",
  "filters": [{"field": "industry", "operator": "=", "value": "Distribution"}],
  "fields": ["company_name", "industry"],
  "limit": 10
}`;

  try {
    const result = await callGeminiStructured(prompt, SimplifiedSchema, "simplified_query");
    return { querySpecification: result };
  } catch {
    return {};
  }
}
