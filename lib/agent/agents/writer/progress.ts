/**
 * lib/agent/agents/writer/progress.ts
 *
 * Writer progress engine — opportunity-driven field prioritization.
 *
 * Objective: maximize USEFUL information, not raw field count.
 *
 * Priority hierarchy:
 *   Problem evidence > Workflow evidence > Frequency > Time/effort >
 *   People > Pain/impact > Existing systems > Solution limitations >
 *   Opportunity assessment > Buyer/decision-maker > Secondary metadata
 *
 * Stops asking low-value questions when the problem is sufficiently characterized.
 */

import { callGemini } from "@/lib/ai/gemini";
import { agentLog } from "@/lib/agent/logger";
import { FIELD_META } from "@/lib/db/metadata";
import type { BusinessObserverState } from "../../state";

// ─── Opportunity sufficiency check ───────────────────────────────────────────

/**
 * Core fields needed before we have a meaningful opportunity assessment.
 * Once these are filled, we don't endlessly ask low-priority questions.
 */
const CORE_OPPORTUNITY_FIELDS = new Set([
  "company_name",
  "industry",
  "workflow",
  "main_pain",
  "current_process",
  "frequency",
  "time_consumed",
  "existing_software",
]);

const MIN_CORE_FILLED = 5; // Minimum core fields to consider stopping low-value Qs

export function hasMinimumOpportunityContext(
  businessContext: Record<string, unknown> | undefined
): boolean {
  if (!businessContext) return false;
  const coreFilled = [...CORE_OPPORTUNITY_FIELDS].filter((f) => {
    const v = businessContext[f];
    return v !== null && v !== undefined && v !== "";
  }).length;
  return coreFilled >= MIN_CORE_FILLED;
}

// ─── Field prioritization ─────────────────────────────────────────────────────

export interface ProgressResult {
  prioritizedFields: string[];
  nextField?: string;
  shouldStopAsking: boolean;
  progressPercent: number;
}

export async function prioritizeNextField(
  state: BusinessObserverState
): Promise<ProgressResult> {
  const asked = new Set(state.askedFields ?? []);
  const skipped = new Set(state.skippedFields ?? []);
  const missing = state.missingFields ?? [];
  const context = state.businessContext;

  const progressPercent = context
    ? Math.round(
        ((Object.keys(FIELD_META).length - missing.length) / Object.keys(FIELD_META).length) * 100
      )
    : 0;

  // Filter: missing AND not skipped
  const candidates = missing
    .filter((f) => f in FIELD_META)
    .filter((f) => !skipped.has(f))
    .sort((a, b) => (FIELD_META[b]?.priority ?? 0) - (FIELD_META[a]?.priority ?? 0));

  if (candidates.length === 0) {
    agentLog({ agent: "Writer", tool: "prioritizeNextField", note: "no more candidates" });
    return { prioritizedFields: [], nextField: undefined, shouldStopAsking: true, progressPercent };
  }

  // If opportunity context is sufficient and only low-priority fields remain, stop
  const highPriorityCandidates = candidates.filter((f) => (FIELD_META[f]?.priority ?? 0) >= 60);
  const hasCore = hasMinimumOpportunityContext(context);

  if (hasCore && highPriorityCandidates.length === 0) {
    agentLog({ agent: "Writer", tool: "prioritizeNextField", note: "opportunity context sufficient, stopping" });
    return {
      prioritizedFields: candidates,
      nextField: undefined,
      shouldStopAsking: true,
      progressPercent,
    };
  }

  // Filter: not recently asked (avoid repetition)
  const notYetAsked = candidates.filter((f) => !asked.has(f));
  const pool = notYetAsked.length > 0 ? notYetAsked : candidates;

  // Only take top-N to Gemini for contextual reordering
  const TOP_N = Math.min(pool.length, 5);
  const topCandidates = pool.slice(0, TOP_N);

  const hasContext =
    context &&
    Object.values(context).some((v) => v !== null && v !== undefined && v !== "");

  let prioritized = pool;

  if (hasContext && topCandidates.length > 1) {
    const knownFields = Object.entries(context ?? {})
      .filter(([k, v]) => v !== null && v !== undefined && v !== "" && k in FIELD_META)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");

    const candidateList = topCandidates
      .map((f) => `  ${f} (priority: ${FIELD_META[f]?.priority}) — ${FIELD_META[f]?.description}`)
      .join("\n");

    const signals = [
      ...(state.problemSignals ?? []).map((s) => `  [problem] ${s}`),
      ...(state.automationSignals ?? []).map((s) => `  [automation] ${s}`),
      ...(state.integrationSignals ?? []).map((s) => `  [integration] ${s}`),
      ...(state.aiSignals ?? []).map((s) => `  [ai] ${s}`),
    ];
    const signalContext = signals.length > 0
      ? `\nDetected signals:\n${signals.slice(0, 6).join("\n")}`
      : "";

    const prompt = `You are a business intelligence assistant prioritizing which field to ask about next.

Known business information:
${knownFields}
${signalContext}

Candidate fields still missing:
${candidateList}

Field priority groups (soft guidelines):
1. Core context: company_name, industry, workflow, main_pain
2. Workflow detail: current_process, people_involved, frequency
3. Problem evidence: time_consumed, error_rate, existing_software, why_existing_software_fails
4. Opportunity: ai_opportunity, automation_opportunity, estimated_value, integration_difficulty
5. Secondary: buyer, decision_maker, competition, department, company_size

Rules:
- If manual data entry / WhatsApp-to-ERP type signals exist → prioritize error_rate, why_existing_software_fails
- If main problem is known → jump to opportunity assessment fields
- If out-of-order info was given → adapt, don't force sequential
- GOAL: maximize opportunity insight, not field count

Return ONLY a JSON array of field names in best order (best first):
["field_name_1", "field_name_2", ...]
Include only fields from the candidate list above.`;

    try {
      const rawResponse = await callGemini(prompt);
      const jsonMatch = rawResponse.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const geminiOrder: string[] = JSON.parse(jsonMatch[0]);
        const geminiSet = new Set(geminiOrder.filter((f) => pool.includes(f)));
        const reordered = [
          ...geminiOrder.filter((f) => pool.includes(f)),
          ...pool.filter((f) => !geminiSet.has(f)),
        ];
        if (reordered.length > 0) prioritized = reordered;
      }
    } catch (e) {
      console.error("[prioritizeNextField] Gemini reorder error:", e);
    }
  }

  agentLog({
    agent: "Writer",
    tool: "prioritizeNextField",
    note: `nextField=${prioritized[0]} progress=${progressPercent}%`,
  });

  return {
    prioritizedFields: prioritized,
    nextField: prioritized[0],
    shouldStopAsking: false,
    progressPercent,
  };
}
