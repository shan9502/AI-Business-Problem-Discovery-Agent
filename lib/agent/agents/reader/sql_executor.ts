/**
 * lib/agent/agents/reader/sql_executor.ts
 *
 * SQL execution with retry/repair subgraph.
 *
 * Flow:
 *   generateSql → validateSql → execute
 *       ↑                           │ error
 *       └── (repair with error) ←───┘  max 3 attempts
 *       └── simplifyQuerySpec (Gemini) on final retry
 */

import { agentLog } from "@/lib/agent/logger";
import { executeRawQuery } from "@/lib/db/queries";
import { VALID_TABLES, VALID_COLUMNS } from "@/lib/db/metadata";
import { generateSql, simplifyQuerySpec } from "./sql_generator";
import type { BusinessObserverState, QuerySpec } from "../../state";

const DANGEROUS_KEYWORDS = /\b(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE|REPLACE)\b/i;
const MAX_RETRIES = 3;

// ─── SQL Validator ────────────────────────────────────────────────────────────

export function validateSql(sql: string): { valid: boolean; error?: string } {
  if (DANGEROUS_KEYWORDS.test(sql)) {
    return { valid: false, error: "SQL contains forbidden write/destructive operations." };
  }
  const hasValidTable = [...VALID_TABLES].some((t) => sql.toLowerCase().includes(t));
  if (!hasValidTable) {
    return { valid: false, error: "SQL does not reference any known table." };
  }
  // Column-level validation: check all word-like tokens that look like column references
  const tokens = sql.match(/\b([a-z_]+)\b/gi) ?? [];
  const unknownColumns = tokens.filter(
    (t) =>
      t.length > 1 &&
      !VALID_TABLES.has(t.toLowerCase()) &&
      !VALID_COLUMNS.has(t.toLowerCase()) &&
      !["select", "from", "where", "and", "or", "not", "like", "in", "is", "null",
        "order", "by", "group", "having", "limit", "offset", "asc", "desc",
        "count", "sum", "avg", "min", "max", "distinct", "as", "on", "join",
        "inner", "left", "right", "outer", "case", "when", "then", "else", "end",
        "coalesce", "isnull", "ifnull", "cast", "between", "exists"].includes(t.toLowerCase())
  );
  // Only warn — don't block (model might generate valid aliases)
  if (unknownColumns.length > 5) {
    return {
      valid: false,
      error: `SQL references too many unknown identifiers: ${unknownColumns.slice(0, 5).join(", ")}`,
    };
  }
  return { valid: true };
}

// ─── Infrastructure error classification ──────────────────────────────────────

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

// ─── Execute with retry ───────────────────────────────────────────────────────

export async function executeWithRetry(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const spec = state.querySpecification as QuerySpec;
  let retryCount = state.retryCount ?? 0;
  let lastSql = "";
  let lastError = "";
  let currentSpec = spec;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    agentLog({
      agent: "Reader",
      tool: "executeWithRetry",
      sqlAttempt: attempt + 1,
      conversationId: state.conversationId,
    });

    // Generate SQL
    const genResult = await generateSql(
      currentSpec,
      attempt > 0 ? { sql: lastSql, error: lastError } : undefined
    );

    if (genResult.error) {
      if (isInfrastructureError(genResult.error)) {
        return {
          sqlError: "Database infrastructure error. Please try again later.",
          sqlResult: null,
          retryCount,
        };
      }
      lastError = genResult.error;
      retryCount++;
      continue;
    }

    lastSql = genResult.sql;

    // Validate
    const validation = validateSql(genResult.sql);
    if (!validation.valid) {
      lastError = validation.error ?? "Validation failed";
      agentLog({ agent: "Reader", tool: "validateSql", sqlError: lastError, sqlAttempt: attempt + 1 });
      retryCount++;
      continue;
    }

    // Execute
    try {
      const rows = await executeRawQuery(genResult.sql, genResult.parameters as unknown[]);
      agentLog({
        agent: "Reader",
        tool: "executeReadOnlySql",
        sqlAttempt: attempt + 1,
        rows: Array.isArray(rows) ? rows.length : 0,
        dbOp: "SELECT",
        conversationId: state.conversationId,
      });
      return {
        generatedSql: genResult.sql,
        sqlParameters: genResult.parameters as unknown[],
        sqlResult: rows,
        sqlError: undefined,
        retryCount,
      };
    } catch (err) {
      if (isInfrastructureError(err)) {
        return {
          sqlError: "Database infrastructure error. Please try again later.",
          sqlResult: null,
          retryCount,
        };
      }
      lastError = String(err);
      retryCount++;

      // On penultimate retry, try to simplify the QuerySpec via Gemini
      if (attempt === MAX_RETRIES - 2) {
        agentLog({ agent: "Reader", tool: "simplifyQuerySpec", note: "Attempting query simplification" });
        const simplified = await simplifyQuerySpec(state.userMessage, lastError);
        if (simplified) currentSpec = simplified;
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
