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

    const skipPrompt = `You are a helpful business analyst assistant.

The user skipped the question about "${state.nextField}".
User message: "${state.userMessage}"

Acknowledge that you'll come back to it if needed, and briefly mention the next topic you'll ask about.
Known context: ${JSON.stringify(state.businessContext ?? {}, null, 2)}

Keep the response short and natural.`;

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

    const prompt = `You are a business intelligence assistant.

The user asked: "${state.userMessage}"

Database query returned ${rowCount} result(s):
${JSON.stringify(state.sqlResult, null, 2)}

Provide a clear, helpful summary of these results. 
- If results are empty, say clearly that no matching records were found.
- If there are results, summarize the key patterns or list key facts.
- Be concise and natural.`;

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

  const prompt = `You are a helpful AI Business Observer assistant.

User message: "${state.userMessage}"
Intent: ${state.intent}

Known business information:
${knownFields || "  (none yet)"}

${state.conversationSummary ? `Conversation summary:\n${state.conversationSummary}` : ""}

${missingList ? `Top fields still needed to qualify the opportunity: ${missingList}` : "All key fields are collected — great work! We've fully qualified this problem."}

${state.intent === "general" ? "Answer this general question helpfully and concisely." : ""}
${state.intent === "resume" ? "Provide a problem-oriented summary of what has been collected so far (e.g., 'We identified a recurring quotation-processing problem...'). Then clearly state what important information is still missing to properly assess the opportunity (time consumed, impact, etc.). Be friendly and specific." : ""}
${state.intent === "confirm_yes" ? "Acknowledge the confirmation positively and continue." : ""}
${state.intent === "confirm_no" ? "Acknowledge the user wants a new business entry. Confirm you'll start fresh." : ""}

Provide a natural, concise response.`;

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
