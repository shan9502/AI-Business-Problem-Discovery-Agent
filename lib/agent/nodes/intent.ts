import { callGeminiStructured } from "@/lib/ai/gemini";
import { IntentOutputSchema, type BusinessObserverState } from "../state";

const SYSTEM_PROMPT = `You are an intent classifier for an AI Business Problem Discovery Engine application.

Classify the user's message into exactly one of these intents:

- discover: User is providing new business/process information for the first time
- update: User is correcting or updating previously provided information  
- query: User wants to search or query stored business records
- resume: User wants to continue a previous conversation or know what's pending
- skip: User is skipping a question or saying they don't know an answer
- general: General question or greeting unrelated to business discovery
- confirm_yes: User is confirming a match (e.g., "yes", "that's right", "correct", "continue with that")
- confirm_no: User is rejecting a match (e.g., "no", "different company", "create new", "that's not it")

Classification guidance:
- When uncertain between discover/update, prefer "discover" for new context
- "confirm_yes" and "confirm_no" apply ONLY when there is a pending confirmation question
- "skip" covers "I don't know", "not sure", "skip", "move on", "next question"
`;

export async function classifyIntent(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const recentContext = (state.recentMessages ?? [])
    .slice(-4)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const businessSummary = state.conversationSummary
    ? `\nConversation summary: ${state.conversationSummary}`
    : "";

  const pendingConfirmation = state.pendingBusinessMatch
    ? `\n⚠ There is a pending confirmation: the system asked whether to continue with "${state.pendingBusinessMatch.name}".`
    : "";

  const prompt = `${SYSTEM_PROMPT}

Recent conversation:
${recentContext || "(no prior messages)"}
${businessSummary}
${pendingConfirmation}

Current user message: "${state.userMessage}"

Classify the intent.`;

  const result = await callGeminiStructured(
    prompt,
    IntentOutputSchema,
    "intent_classification"
  );

  return { intent: result.intent };
}
