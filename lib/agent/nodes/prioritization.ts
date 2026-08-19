import { callGemini } from "@/lib/ai/gemini";
import { BUSINESS_FIELDS, SORTED_FIELD_NAMES } from "@/lib/config/fields";
import type { BusinessObserverState } from "../state";

/**
 * prioritizeFields — #9: context-aware prioritization
 *
 * 1. Start with deterministic baseline (field priority config).
 * 2. Remove already-known, asked, or skipped fields.
 * 3. Ask Gemini to reorder the top-N candidates based on business context.
 */
export async function prioritizeFields(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const asked = new Set(state.askedFields ?? []);
  const skipped = new Set(state.skippedFields ?? []);
  const missing = state.missingFields ?? [];

  // Filter: missing AND not skipped AND not recently asked
  const candidates = missing
    .filter((f) => f in BUSINESS_FIELDS)
    .filter((f) => !skipped.has(f))
    .filter((f) => !asked.has(f))   // avoid re-asking recently asked
    .sort(
      (a, b) =>
        (BUSINESS_FIELDS[b]?.priority ?? 0) -
        (BUSINESS_FIELDS[a]?.priority ?? 0)
    );

  if (candidates.length === 0) {
    // Fall back to missing (excluding only skipped) if all candidates were asked
    const fallback = missing
      .filter((f) => f in BUSINESS_FIELDS)
      .filter((f) => !skipped.has(f))
      .sort(
        (a, b) =>
          (BUSINESS_FIELDS[b]?.priority ?? 0) -
          (BUSINESS_FIELDS[a]?.priority ?? 0)
      );
    return { prioritizedFields: fallback, nextField: fallback[0] };
  }

  // Take top candidates for Gemini to contextually reorder
  const TOP_N = Math.min(candidates.length, 5);
  const topCandidates = candidates.slice(0, TOP_N);

  // Only call Gemini if there is meaningful business context to reason with
  const hasContext =
    state.businessContext &&
    Object.values(state.businessContext).some(
      (v) => v !== null && v !== undefined && v !== ""
    );

  let prioritized = candidates;

  if (hasContext && topCandidates.length > 1) {
    const knownFields = Object.entries(state.businessContext ?? {})
      .filter(
        ([k, v]) =>
          v !== null &&
          v !== undefined &&
          v !== "" &&
          k in BUSINESS_FIELDS
      )
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");

    const candidateList = topCandidates
      .map(
        (f) =>
          `  ${f} (priority: ${BUSINESS_FIELDS[f]?.priority}) — ${BUSINESS_FIELDS[f]?.description}`
      )
      .join("\n");

    // Include detected signals so the LLM can reason about what to investigate next
    const signals = [
      ...(state.problemSignals ?? []).map((s) => `  [problem] ${s}`),
      ...(state.automationSignals ?? []).map((s) => `  [automation] ${s}`),
      ...(state.integrationSignals ?? []).map((s) => `  [integration] ${s}`),
      ...(state.aiSignals ?? []).map((s) => `  [ai] ${s}`),
    ];
    const signalContext = signals.length > 0
      ? `\nDetected signals from conversation:\n${signals.slice(0, 8).join("\n")}`
      : "";

    const prompt = `You are a business intelligence assistant for a Business Problem Discovery Engine. Your goal is to prioritize which field to ask about next.

Known business information:
${knownFields}
${signalContext}

These are the top candidate fields still missing:
${candidateList}

We group fields into 4 priority categories (Stages). These are SOFT GUIDELINES, not mandatory sequential gates. Adapt to the natural flow of the conversation.
1. Context: company_name, industry, company_size, department
2. Workflow: workflow, current_process, people_involved, frequency
3. Problem Evidence: time_consumed, main_pain, error_rate, existing_software, why_existing_software_fails
4. Opportunity Assessment: ai_opportunity, automation_opportunity, estimated_value, integration_difficulty, buyer, decision_maker, competition

Given the current business context and detected signals, which field should be asked about FIRST to maximize opportunity-discovery value?
Consider:
- IMPORTANT: If the user provides out-of-order information (e.g., they jump straight to Problem Evidence), DO NOT force them back to Stage 1. Extract the facts and logically adapt your next question.
- Use detected signals to guide prioritization — e.g., if manual data entry is detected, prioritize error_rate and why_existing_software_fails.
- Prioritize finding the problem (Stage 3) OVER basic firmographics (Stage 1/4) if a workflow is already identified.
- Which field logically follows from what the user just said?
- Which field would best help establish if there is a real, recurring, expensive problem?
- Do we already have enough information to establish a strong opportunity? If yes, prioritize whatever fields help finalize the assessment rather than endlessly asking low-value questions.

Respond with ONLY a JSON array of field names in your recommended order (best first):
["field_name_1", "field_name_2", ...]

Include only fields from the candidate list above.`;

    try {
      const rawResponse = await callGemini(prompt);
      const jsonMatch = rawResponse.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const geminiOrder: string[] = JSON.parse(jsonMatch[0]);
        // Merge: Gemini's top picks first, then remaining candidates
        const geminiSet = new Set(geminiOrder.filter((f) => candidates.includes(f)));
        const reordered = [
          ...geminiOrder.filter((f) => candidates.includes(f)),
          ...candidates.filter((f) => !geminiSet.has(f)),
        ];
        if (reordered.length > 0) {
          prioritized = reordered;
        }
      }
    } catch (e) {
      // Non-fatal — fall back to deterministic order
      console.error("[prioritizeFields] Gemini reorder error:", e);
    }
  }

  return {
    prioritizedFields: prioritized,
    nextField: prioritized[0],
  };
}
