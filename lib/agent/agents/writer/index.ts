/**
 * lib/agent/agents/writer/index.ts
 *
 * Writer Agent — Orchestrates all write operations.
 *
 * Responsibility:
 *   Convert natural-language research evidence into clean, structured DB records.
 *   Track progress. Generate the next most valuable question.
 *
 * Flow:
 *   extract → persist → calculate progress → prioritize next field → generate question
 *
 * Returns: WriterResult with explicit status
 */

import { callGemini } from "@/lib/ai/gemini";
import { agentLog } from "@/lib/agent/logger";
import { addMessage, updateConversationSummary } from "@/lib/db/queries";
import type { BusinessObserverState, WriterResult } from "../../state";
import { extractFields } from "./extractor";
import { persistExtraction } from "./persist";
import { prioritizeNextField, hasMinimumOpportunityContext } from "./progress";
import { generateNextQuestion } from "./question";

export async function writerAgent(
  state: BusinessObserverState
): Promise<{ writerResult: WriterResult; stateUpdates: Partial<BusinessObserverState> }> {
  const start = Date.now();

  agentLog({
    agent: "Writer",
    tool: "writerAgent",
    conversationId: state.conversationId,
    businessId: state.businessId,
    intent: state.intent,
  });

  // ── Handle skip intent ─────────────────────────────────────────────────────
  if (state.intent === "skip") {
    return handleSkip(state);
  }

  // ── Handle pending confirmation (deduplication yes/no) ────────────────────
  if (state.pendingBusinessMatch && (state.intent === "confirm_yes" || state.intent === "confirm_no")) {
    return handleConfirmation(state);
  }

  // ── Handle general clarification response ─────────────────────────────────
  if (state.intent === "general" || state.intent === "clarification") {
    const response = await callGemini(
      `You are a friendly business research assistant.\nUser said: "${state.userMessage}"\n\nRespond helpfully and briefly. Do not mention database fields or internal terms.`
    );
    const result: WriterResult = { status: "complete", response };
    return { writerResult: result, stateUpdates: { writerResult: result } };
  }

  // ── 1. Extract structured fields ──────────────────────────────────────────
  const extraction = await extractFields(state);

  // Filter to non-null updates only
  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(extraction.extractedFields)) {
    if (v !== null && v !== undefined && v !== "") updates[k] = v;
  }

  // ── 2. Persist to DB ──────────────────────────────────────────────────────
  const persistResult = await persistExtraction(state, updates);

  // If ambiguous (pending confirmation or selection), return immediately
  if (persistResult.status === "ambiguous") {
    await saveMessages(state, persistResult.response);
    const result: WriterResult = persistResult;
    return { writerResult: result, stateUpdates: { writerResult: result } };
  }

  // Merge updated state
  const updatedState: BusinessObserverState = {
    ...state,
    businessId: persistResult.businessId,
    businessContext: persistResult.businessContext,
    missingFields: persistResult.missingFields,
    problemSignals: [
      ...new Set([...(state.problemSignals ?? []), ...extraction.problemSignals]),
    ],
    automationSignals: [
      ...new Set([...(state.automationSignals ?? []), ...extraction.automationSignals]),
    ],
    integrationSignals: [
      ...new Set([...(state.integrationSignals ?? []), ...extraction.integrationSignals]),
    ],
    aiSignals: [...new Set([...(state.aiSignals ?? []), ...extraction.aiSignals])],
    evidence: [...new Set([...(state.evidence ?? []), ...extraction.evidence])],
    opportunityAssessment: extraction.opportunityAssessment ?? state.opportunityAssessment,
    extractedFieldsWithMeta: extraction.extractedFieldsWithMeta,
    extractedFields: extraction.extractedFields,
  };

  // ── 3. Prioritize next field (opportunity-driven) ─────────────────────────
  const progressResult = await prioritizeNextField(updatedState);

  // ── 4. Generate question or wrap up ───────────────────────────────────────
  let response: string;
  let nextField: string | undefined;
  let suggestedOptions: string[] = [];
  let status: WriterResult["status"];

  if (progressResult.shouldStopAsking || !progressResult.nextField) {
    // Enough information — wrap up
    const wrapUpPrompt = `You are a business research assistant.

We have gathered sufficient information about this business (${progressResult.progressPercent}% complete).

Known business information:
${Object.entries(updatedState.businessContext ?? {})
  .filter(([k, v]) => v && k !== "id" && !k.includes("_at"))
  .map(([k, v]) => `  ${k}: ${v}`)
  .join("\n")}

Write a brief, positive wrap-up message (2–3 sentences):
- Acknowledge what we've captured
- Note the research is now well-documented
- Offer to search for more businesses or ask specific analysis questions
Do NOT use database terminology.`;

    response = await callGemini(wrapUpPrompt);
    status = "complete";
    nextField = undefined;
  } else {
    // Continue research
    nextField = progressResult.nextField;
    const questionResult = await generateNextQuestion(updatedState, nextField);
    response = questionResult.question;
    suggestedOptions = questionResult.suggestedOptions;

    // Track asked fields
    const askedFields = [...(state.askedFields ?? [])];
    if (nextField && !askedFields.includes(nextField)) askedFields.push(nextField);
    updatedState.askedFields = askedFields;

    status = "needs_input";
  }

  // ── 5. Save messages + maybe summarize ───────────────────────────────────
  await saveMessages(state, response);
  await maybeSummarize(updatedState);

  agentLog({
    agent: "Writer",
    tool: "writerAgent",
    businessId: persistResult.businessId,
    dbOp: persistResult.status === "created" ? "INSERT" : "UPDATE",
    note: `status=${status} nextField=${nextField ?? "none"} progress=${progressResult.progressPercent}%`,
    latency: Date.now() - start,
  });

  const writerResult: WriterResult = {
    status,
    response,
    businessId: persistResult.businessId,
    businessContext: persistResult.businessContext,
    missingFields: persistResult.missingFields,
    nextField,
    suggestedOptions,
  };

  const stateUpdates: Partial<BusinessObserverState> = {
    writerResult,
    businessId: persistResult.businessId,
    businessContext: persistResult.businessContext,
    missingFields: persistResult.missingFields,
    prioritizedFields: progressResult.prioritizedFields,
    nextField,
    nextQuestion: response,
    askedFields: updatedState.askedFields,
    problemSignals: updatedState.problemSignals,
    automationSignals: updatedState.automationSignals,
    integrationSignals: updatedState.integrationSignals,
    aiSignals: updatedState.aiSignals,
    evidence: updatedState.evidence,
    opportunityAssessment: updatedState.opportunityAssessment,
    extractedFieldsWithMeta: extraction.extractedFieldsWithMeta,
    extractedFields: extraction.extractedFields,
  };

  return { writerResult, stateUpdates };
}

// ─── Skip handler ─────────────────────────────────────────────────────────────

async function handleSkip(
  state: BusinessObserverState
): Promise<{ writerResult: WriterResult; stateUpdates: Partial<BusinessObserverState> }> {
  const skippedFields = [...(state.skippedFields ?? [])];
  if (state.nextField && !skippedFields.includes(state.nextField)) {
    skippedFields.push(state.nextField);
  }

  const prompt = `You are a friendly business research assistant.
The user is skipping the current question: "${state.userMessage}"
Respond in 1–2 short sentences: acknowledge naturally ("No problem", "Got it"), then move on.
Do NOT say "I'll come back to it". Do NOT mention field names.`;

  const response = await callGemini(prompt);
  await saveMessages(state, response);

  const result: WriterResult = {
    status: "needs_input",
    response,
    suggestedOptions: [],
  };

  return {
    writerResult: result,
    stateUpdates: { writerResult: result, skippedFields },
  };
}

// ─── Confirmation handler (deduplication yes/no) ──────────────────────────────

async function handleConfirmation(
  state: BusinessObserverState
): Promise<{ writerResult: WriterResult; stateUpdates: Partial<BusinessObserverState> }> {
  const persistResult = await persistExtraction(state, {});
  await saveMessages(state, persistResult.response);

  const result: WriterResult = persistResult;
  return { writerResult: result, stateUpdates: { writerResult: result } };
}

// ─── Message persistence helpers ─────────────────────────────────────────────

async function saveMessages(state: BusinessObserverState, assistantResponse: string) {
  if (!state.conversationId) return;
  try {
    await addMessage(state.conversationId, "user", state.userMessage);
    await addMessage(state.conversationId, "assistant", assistantResponse);
  } catch {
    // Non-fatal
  }
}

async function maybeSummarize(state: BusinessObserverState) {
  if (!state.conversationId) return;
  const messages = state.recentMessages ?? [];
  if (messages.length < 8) return;

  const transcript = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  const knownFields = Object.entries(state.businessContext ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  const skipped = (state.skippedFields ?? []).join(", ");

  const summaryPrompt = `Summarize this business discovery conversation in 3–5 sentences.
Focus on: business, core problem/workflow, key findings (time, frequency, pain points), pending information, automation opportunity.
${skipped ? `Fields skipped by user: ${skipped}.` : ""}
Known fields: ${knownFields}
Conversation:
${transcript}`;

  try {
    const { callGemini } = await import("@/lib/ai/gemini");
    const summary = await callGemini(summaryPrompt);
    await updateConversationSummary(state.conversationId, summary);
  } catch {
    // Non-fatal
  }
}
