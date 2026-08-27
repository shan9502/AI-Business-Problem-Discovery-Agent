/**
 * lib/agent/agents/reader/data_validator.ts
 *
 * Validates SQL result sets before handing them to the Data Analyst.
 * Detects empty results, structural issues, null-heavy data, etc.
 */

import { agentLog } from "@/lib/agent/logger";

export type DataValidationStatus =
  | "valid"
  | "empty"
  | "invalid_structure"
  | "null_heavy"
  | "too_large";

export interface DataValidationResult {
  status: DataValidationStatus;
  rowCount: number;
  message?: string;
}

const MAX_SAFE_ROWS = 500;
const NULL_HEAVY_THRESHOLD = 0.7; // 70% null values → warn

export function validateSqlResult(
  result: unknown,
  userMessage: string
): DataValidationResult {
  // Not an array
  if (!Array.isArray(result)) {
    agentLog({ agent: "Reader", tool: "validateData", note: "result is not an array" });
    return { status: "invalid_structure", rowCount: 0, message: "Unexpected result format." };
  }

  const rows = result as Record<string, unknown>[];

  // Empty result
  if (rows.length === 0) {
    agentLog({ agent: "Reader", tool: "validateData", note: "empty result set", rows: 0 });
    return {
      status: "empty",
      rowCount: 0,
      message: `No matching records found for: "${userMessage}"`,
    };
  }

  // Too large
  if (rows.length > MAX_SAFE_ROWS) {
    agentLog({ agent: "Reader", tool: "validateData", note: `result too large: ${rows.length} rows` });
    return {
      status: "too_large",
      rowCount: rows.length,
      message: `Result set is very large (${rows.length} rows). Consider filtering more specifically.`,
    };
  }

  // Null-heavy check
  const sample = rows.slice(0, Math.min(rows.length, 20));
  const totalValues = sample.reduce((sum, row) => sum + Object.keys(row).length, 0);
  const nullValues = sample.reduce(
    (sum, row) => sum + Object.values(row).filter((v) => v === null || v === undefined || v === "").length,
    0
  );
  const nullRatio = totalValues > 0 ? nullValues / totalValues : 0;

  if (nullRatio > NULL_HEAVY_THRESHOLD) {
    agentLog({
      agent: "Reader",
      tool: "validateData",
      note: `null-heavy result: ${Math.round(nullRatio * 100)}% nulls`,
      rows: rows.length,
    });
    return {
      status: "null_heavy",
      rowCount: rows.length,
      message: `Most fields in the result are empty (${Math.round(nullRatio * 100)}% null). Results may be incomplete.`,
    };
  }

  agentLog({ agent: "Reader", tool: "validateData", note: "valid", rows: rows.length });
  return { status: "valid", rowCount: rows.length };
}
