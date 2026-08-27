/**
 * lib/agent/agents/reader/sql_generator.ts
 *
 * Generates safe, parameterized SQL from a QuerySpec.
 * Uses Groq (fast model for SQL generation).
 */

import { callGroqStructured } from "@/lib/ai/groq";
import { agentLog } from "@/lib/agent/logger";
import { BUSINESSES_SCHEMA_SQL } from "@/lib/db/metadata";
import { isPostgres } from "@/lib/db/queries";
import { SqlOutputSchema, type QuerySpec } from "../../state";

export interface SqlGenResult {
  sql: string;
  parameters: unknown[];
  error?: string;
}

export async function generateSql(
  spec: QuerySpec,
  previousAttempt?: { sql: string; error: string }
): Promise<SqlGenResult> {
  const start = Date.now();
  const dialect = isPostgres() ? "PostgreSQL" : "SQLite";
  const paramFmt = isPostgres() ? "$1, $2, $3" : "? placeholders";

  const correctionContext = previousAttempt
    ? `\n\nPrevious attempt failed:\nSQL: ${previousAttempt.sql}\nError: ${previousAttempt.error}\nPlease fix the SQL error.`
    : "";

  const prompt = `You are a ${dialect} SQL generator for a business intelligence system.

Database schema:
${BUSINESSES_SCHEMA_SQL}

SQL dialect: ${dialect} — use ${dialect}-compatible syntax only.

Structured query specification:
${JSON.stringify(spec, null, 2)}
${correctionContext}

Generate a read-only SELECT query. Rules:
- Use ONLY columns and tables that exist in the schema.
- Forbidden: INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, REPLACE.
- Use ${paramFmt} for all user-supplied filter values in the parameters array.
- For LIKE patterns, put the % in the parameter value, not in SQL.
- Keep it simple, safe, and correct for ${dialect}.

Return ONLY valid JSON:
{ "sql": "SELECT ...", "parameters": [] }`;

  try {
    const result = await callGroqStructured(prompt, SqlOutputSchema, "sql_output");
    agentLog({
      agent: "Reader",
      tool: "generateSql",
      model: process.env.GROQ_AI_MODEL,
      latency: Date.now() - start,
    });
    return { sql: result.sql, parameters: result.parameters };
  } catch (err) {
    return { sql: "", parameters: [], error: String(err) };
  }
}

/**
 * Simplify the QuerySpec when normal SQL generation repeatedly fails.
 * Gemini produces a simpler version of the query.
 */
export async function simplifyQuerySpec(
  userMessage: string,
  lastError: string
): Promise<QuerySpec | null> {
  const { callGeminiStructured } = await import("@/lib/ai/gemini");
  const { QuerySpecSchema } = await import("../../state");
  const { SEARCHABLE_FIELDS_FOR_READER } = await import("@/lib/db/metadata");

  const prompt = `A SQL query could not be generated successfully.

Original user question: "${userMessage}"
Last SQL error: ${lastError}

Available fields: ${SEARCHABLE_FIELDS_FOR_READER}

Simplify the query to something that can definitely be expressed as a basic SELECT statement.
Return ONLY a JSON object:
{
  "intent": "filter",
  "filters": [{"field": "industry", "operator": "=", "value": "Distribution"}],
  "fields": ["company_name", "industry"],
  "limit": 10
}`;

  try {
    return await callGeminiStructured(prompt, QuerySpecSchema, "simplified_query");
  } catch {
    return null;
  }
}
