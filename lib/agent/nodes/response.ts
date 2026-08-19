import { callGemini } from "@/lib/ai/gemini";
import type { BusinessObserverState } from "../state";
import { updateConversationSummary, addMessage } from "@/lib/db/queries";

export async function generateResponse(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  // ── If validation.ts already set a finalResponse (pending confirmation) ──────
  if (state.pendingBusinessMatch && state.finalResponse) {
    if (state.conversationId) {
      await addMessage(state.conversationId, "user", state.userMessage);
      await addMessage(state.conversationId, "assistant", state.finalResponse);
    }
    return { finalResponse: state.finalResponse };
  }

  // ── Skip intent: mark field as skipped ────────────────────────────────────
  if (state.intent === "skip" && state.nextField) {
    const skippedFields = [...(state.skippedFields ?? [])];
    if (!skippedFields.includes(state.nextField)) {
      skippedFields.push(state.nextField);
    }

    const skipPrompt = `You are a friendly business research assistant.

The user just said: "${state.userMessage}"

They are skipping the current topic. Respond in 1-2 short sentences:
- Acknowledge naturally (e.g. "No problem", "Got it", "That's fine")
- Do NOT mention field names or database terms
- Do NOT say "I'll come back to it" — just move on naturally

Keep it very brief.`;

    const response = await callGemini(skipPrompt);
    if (state.conversationId) {
      await addMessage(state.conversationId, "user", state.userMessage);
      await addMessage(state.conversationId, "assistant", response);
    }
    return {
      finalResponse: response,
      skippedFields,
    };
  }

  // ── Discovery/update: use the generated next question ────────────────────
  if (
    state.nextQuestion &&
    state.intent !== "query" &&
    state.intent !== "resume"
  ) {
    // Track that we asked about this field (#10)
    const askedFields = [...(state.askedFields ?? [])];
    if (state.nextField && !askedFields.includes(state.nextField)) {
      askedFields.push(state.nextField);
    }

    if (state.conversationId) {
      await addMessage(state.conversationId, "user", state.userMessage);
      await addMessage(state.conversationId, "assistant", state.nextQuestion);
      await maybeSummarize(state);
    }
    return { finalResponse: state.nextQuestion, askedFields };
  }

  // ── SQL query response ─────────────────────────────────────────────────────
  if (state.intent === "query") {
    if (state.sqlError || !state.sqlResult) {
      const response =
        "I wasn't able to complete that database query. " +
        (state.sqlError ?? "Please try rephrasing your question.");
      if (state.conversationId) {
        await addMessage(state.conversationId, "user", state.userMessage);
        await addMessage(state.conversationId, "assistant", response);
      }
      return { finalResponse: response };
    }

    const rows = state.sqlResult as unknown[];
    const rowCount = Array.isArray(rows) ? rows.length : 0;

    const prompt = `You are a business intelligence assistant answering a research question.

User asked: "${state.userMessage}"

Database query returned ${rowCount} result(s):
${JSON.stringify(state.sqlResult, null, 2)}

**IMPORTANT — Format your response in Markdown:**
- If the results are a list of companies/businesses, render them as a **numbered list** (1. Company Name).
- Use **bold** for company names or key terms.
- Use a Markdown table if the results have multiple columns (e.g., company + industry).
- Use headings (##) to organize sections if the response is longer.
- If the result set is empty, say clearly that nothing matched and suggest rephrasing.
- Highlight patterns, counts, or notable findings where relevant.
- NEVER mention SQL, field names, column names, or database internals.
- Be analytical and useful — not just a data dump.`;

    const response = await callGemini(prompt);
    if (state.conversationId) {
      await addMessage(state.conversationId, "user", state.userMessage);
      await addMessage(state.conversationId, "assistant", response);
    }
    return { finalResponse: response };
  }

  // ── Resume / general / confirm responses ─────────────────────────────────
  const knownFields = Object.entries(state.businessContext ?? {})
    .filter(
      ([k, v]) =>
        v !== null &&
        v !== undefined &&
        v !== "" &&
        !["id", "created_at", "updated_at"].includes(k)
    )
    .map(([k, v]) => `  ✓ ${k}: ${v}`)
    .join("\n");

  const missingList = (state.prioritizedFields ?? state.missingFields ?? [])
    .slice(0, 5)
    .join(", ");

  const isResume = state.intent === "resume";
  const isGeneral = state.intent === "general";
  const isConfirmYes = state.intent === "confirm_yes";
  const isConfirmNo = state.intent === "confirm_no";

  const nextTopicHint = missingList
    ? `The most important remaining topic to explore: ${missingList.split(",")[0].trim()}`
    : "";

  const prompt = `You are a friendly business research assistant.

User message: "${state.userMessage}"

What we know about this business:
${knownFields || "  (nothing yet)"}

${state.conversationSummary ? `Conversation so far:\n${state.conversationSummary}` : ""}

${isResume ? `The user wants to know where we left off.

Write a SHORT, plain-language summary (2-3 sentences):
- What business or industry we are researching
- What we have already learned (process, workflow, problems discovered)
- What important aspect we still need to understand

Then ask exactly ONE short follow-up question to continue naturally.
Do NOT list field names. Do NOT use bullet lists for the summary. Write it as a researcher would speak.` : ""}

${isGeneral ? `Answer the user's question helpfully and briefly. Do not mention database fields or internal terms.` : ""}

${isConfirmYes ? `Acknowledge positively in one sentence and continue naturally.` : ""}

${isConfirmNo ? `Acknowledge in one sentence that you'll start fresh with a new business record.` : ""}

${!isResume && !isGeneral && !isConfirmYes && !isConfirmNo ? `Respond naturally and concisely to the user's message. ${nextTopicHint}` : ""}

Keep the response short and conversational. No bullet lists unless showing data.`;

  const response = await callGemini(prompt);
  if (state.conversationId) {
    await addMessage(state.conversationId, "user", state.userMessage);
    await addMessage(state.conversationId, "assistant", response);
    await maybeSummarize(state);
  }
  return { finalResponse: response };
}

// ─── Summarize every 8 messages ───────────────────────────────────────────────
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

  const summaryPrompt = `Summarize this business discovery conversation in 3-5 sentences.
Focus on: what business was discussed, the core problem or workflow identified, key findings (time, frequency, pain points), what information is still pending, and any potential automation opportunity.
${skipped ? `Fields explicitly skipped by user: ${skipped}.` : ""}

Known fields: ${knownFields}
Conversation:
${transcript}`;

  try {
    const summary = await callGemini(summaryPrompt);
    await updateConversationSummary(state.conversationId, summary);
  } catch {
    // Non-fatal
  }
}
