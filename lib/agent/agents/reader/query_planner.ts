/**
 * lib/agent/agents/reader/query_planner.ts
 *
 * Builds a structured QuerySpec from a natural-language user question.
 * Uses Gemini — the Router already ensured this is a read/analysis request.
 */

import { callGeminiStructured } from "@/lib/ai/gemini";
import { agentLog } from "@/lib/agent/logger";
import {
  READER_SCHEMA_CONTEXT,
  SEARCHABLE_FIELDS_FOR_READER,
  ANALYSABLE_FIELDS_FOR_ANALYST,
} from "@/lib/db/metadata";
import { QuerySpecSchema, type BusinessObserverState, type QuerySpec } from "../../state";

export async function buildQuerySpec(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const start = Date.now();
  const isAnalysis = state.route === "read" && state.userMessage.toLowerCase().match(
    /common|most|least|compare|distribution|trend|pattern|across|average|frequency|analysis|breakdown/
  );

  const prompt = `You are a query planner for a business intelligence database.

Database schema:
${READER_SCHEMA_CONTEXT}

Searchable fields (for WHERE filters): ${SEARCHABLE_FIELDS_FOR_READER}
Analysis fields (for GROUP BY / aggregations): ${ANALYSABLE_FIELDS_FOR_ANALYST}

User's question: "${state.userMessage}"

${isAnalysis ? `This appears to be an ANALYSIS question — use "aggregate" intent with groupBy fields where appropriate.` : ""}

Create a structured query specification. Token efficiency rules:
- Select ONLY the columns the user needs to answer their question.
- For a simple list, set "fields": ["company_name"] — nothing else.
- For LIKE searches, use operator "LIKE" with % wildcards in the value.
- For aggregation/counting, groupBy is optional but powerful.
- filters and sort are optional — only include if needed.

Return ONLY a valid JSON object:
{
  "intent": "search" | "aggregate" | "filter" | "sort" | "count" | "comparison",
  "filters": [{ "field": "industry", "operator": "=", "value": "Distribution" }],
  "fields": ["company_name", "industry"],
  "groupBy": ["industry"],
  "sort": { "field": "company_name", "direction": "asc" },
  "limit": 20
}`;

  const spec = await callGeminiStructured(prompt, QuerySpecSchema, "query_spec");

  agentLog({
    agent: "Reader",
    tool: "buildQuerySpec",
    note: `intent=${spec.intent} fields=${(spec.fields ?? []).join(",")}`,
    latency: Date.now() - start,
    conversationId: state.conversationId,
  });

  return { querySpecification: spec };
}
