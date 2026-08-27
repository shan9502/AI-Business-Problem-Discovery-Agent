/**
 * lib/agent/agents/reader/data_analyst.ts
 *
 * Data Analyst — Interprets validated SQL results and generates Markdown analysis.
 *
 * Responsibilities:
 *   - Descriptive statistics
 *   - Frequency analysis
 *   - Grouping and ranking
 *   - Cross-category comparisons
 *   - Pattern detection (recurring problems, common tools)
 *   - Opportunity signal analysis
 *   - Table/list/summary generation in Markdown
 *
 * IMPORTANT: Does NOT query the database directly.
 * Input must be pre-validated data from sql_executor + data_validator.
 */

import { callGemini } from "@/lib/ai/gemini";
import { agentLog } from "@/lib/agent/logger";
import { ANALYSABLE_FIELDS_FOR_ANALYST } from "@/lib/db/metadata";

export interface AnalystInput {
  userMessage: string;
  validatedRows: unknown[];
  rowCount: number;
  isNullHeavy?: boolean;
}

export async function analyzeData(input: AnalystInput): Promise<string> {
  const start = Date.now();
  const { userMessage, validatedRows, rowCount, isNullHeavy } = input;

  // Pre-compute basic stats to include in prompt (reduces LLM hallucination)
  const rows = validatedRows as Record<string, unknown>[];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  // Frequency counts for categorical columns
  const frequencyCounts: Record<string, Record<string, number>> = {};
  const categoricalCols = columns.filter((c) => ANALYSABLE_FIELDS_FOR_ANALYST.includes(c));

  for (const col of categoricalCols) {
    frequencyCounts[col] = {};
    for (const row of rows) {
      const val = String(row[col] ?? "").trim();
      if (val && val !== "null" && val !== "undefined") {
        frequencyCounts[col][val] = (frequencyCounts[col][val] ?? 0) + 1;
      }
    }
  }

  // Sort frequency counts descending
  const sortedFreqs = Object.entries(frequencyCounts)
    .filter(([, counts]) => Object.keys(counts).length > 0)
    .map(([col, counts]) => ({
      col,
      sorted: Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15),
    }));

  const frequencySummary = sortedFreqs
    .map(
      ({ col, sorted }) =>
        `${col}:\n${sorted.map(([val, cnt]) => `  ${val}: ${cnt}`).join("\n")}`
    )
    .join("\n\n");

  const dataPreview = rows.length <= 50
    ? JSON.stringify(validatedRows, null, 2)
    : JSON.stringify(rows.slice(0, 50), null, 2) + `\n... (${rowCount - 50} more rows)`;

  const prompt = `You are a business intelligence analyst. Analyze the following database query results and answer the user's question.

User's question: "${userMessage}"

Query returned ${rowCount} record(s).
${isNullHeavy ? "⚠ Note: Many fields are empty in the results — analysis may be incomplete.\n" : ""}
Data columns: ${columns.join(", ")}

Pre-computed frequency distributions (for categorical fields):
${frequencySummary || "(no categorical groupings available)"}

Full dataset (or sample):
${dataPreview}

## Your analysis should:
1. Directly answer the user's question.
2. Use Markdown formatting: headings (##), tables, bullet lists, bold for emphasis.
3. Include a Markdown table for any frequency/ranking data.
4. Highlight patterns, standout findings, and opportunity signals.
5. Add a "Key Observations" or "Opportunity Signal" section if relevant.
6. Be concise — avoid padding. If the data tells a clear story, state it directly.

## Rules:
- NEVER mention SQL, column names, database internals, or field names.
- NEVER invent data not present in the results.
- If results are null-heavy, note that data is incomplete and findings are limited.
- Use natural language throughout.

Format your entire response as Markdown.`;

  const markdown = await callGemini(prompt);

  agentLog({
    agent: "Reader",
    tool: "analyzeData",
    rows: rowCount,
    latency: Date.now() - start,
    note: `analysis complete (${columns.join(",")})`,
  });

  return markdown;
}
