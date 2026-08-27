/**
 * lib/agent/agents/reader/classify.ts
 *
 * Classifies whether the Reader needs to use:
 *   - simple: typed tool (getBusiness, searchBusinesses, getMissingFields)
 *   - sql: QuerySpec → Groq SQL → execute
 *   - analysis: SQL + Data Analyst (aggregation, patterns, comparisons)
 *   - resume: retrieve business state and generate progress summary
 */

import { callGeminiStructured } from "@/lib/ai/gemini";
import { agentLog } from "@/lib/agent/logger";
import { ReadTypeSchema, type BusinessObserverState, type ReadType } from "../../state";

export async function classifyReadType(
  state: BusinessObserverState
): Promise<ReadType> {
  const start = Date.now();

  const prompt = `You are a query classifier for a business intelligence database system.

Classify the user's read request into one of these types:
- "simple"   → Lookup a specific business by name/description, or get what fields are missing for one business. Use typed tools.
- "sql"      → Flexible search, filter, sort across multiple businesses. Needs SQL generation.
- "analysis" → Aggregation, comparison, pattern detection, frequency analysis, cross-industry insights. Needs SQL + analysis.
- "resume"   → User wants to know where we left off with a specific business and continue research.

User message: "${state.userMessage}"
${state.route === "continue_research" ? 'Context: Router classified this as "continue_research" — prefer "resume".' : ""}
${state.businessId ? `Active business ID: ${state.businessId}` : "No active business."}

Examples:
- "Show me ABC Distribution" → simple
- "What do we know about ABC?" → simple
- "Which companies use Excel?" → sql
- "How many businesses are in the construction industry?" → sql
- "What are the most common pain points?" → analysis
- "Compare distribution vs retail companies" → analysis
- "Where did we stop with ABC?" → resume
- "What's missing for this company?" → simple

Return ONLY valid JSON: { "readType": "simple" | "sql" | "analysis" | "resume", "reason": "..." }`;

  try {
    const result = await callGeminiStructured(prompt, ReadTypeSchema, "read_type");
    agentLog({
      agent: "Reader",
      tool: "classifyReadType",
      note: `readType=${result.readType} reason=${result.reason ?? ""}`,
      latency: Date.now() - start,
    });
    return result.readType;
  } catch {
    // Default to sql for safety
    return "sql";
  }
}
