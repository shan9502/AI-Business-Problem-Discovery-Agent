import { callGeminiStructured } from "@/lib/ai/gemini";
import { BUSINESS_FIELDS } from "@/lib/config/fields";
import { z } from "zod";
import type { BusinessObserverState } from "../state";

const QuestionSchema = z.object({
  question: z.string(),
  hint: z.string().optional(),
  suggestedOptions: z.array(z.string()).max(5).optional(),
});

export async function generateQuestion(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const nextField = state.nextField;
  if (!nextField) return {};

  const fieldConfig = BUSINESS_FIELDS[nextField];

  // ── Build context for the LLM ─────────────────────────────────────────────
  const knownEntries = Object.entries(state.businessContext ?? {}).filter(
    ([k, v]) => v !== null && v !== undefined && v !== "" && k in BUSINESS_FIELDS
  );
  const knownFields = knownEntries.map(([k, v]) => `  ${k}: ${v}`).join("\n");
  const knownCount = knownEntries.length;

  // Recent conversation (last 4 exchanges)
  const recentExchange = (state.recentMessages ?? [])
    .slice(-4)
    .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
    .join("\n");

  // Detected signals so far
  const signals = [
    ...(state.problemSignals ?? []).map((s) => `[problem] ${s}`),
    ...(state.automationSignals ?? []).map((s) => `[automation] ${s}`),
    ...(state.integrationSignals ?? []).map((s) => `[integration] ${s}`),
    ...(state.aiSignals ?? []).map((s) => `[ai] ${s}`),
  ];
  const signalContext = signals.length > 0
    ? `\nDetected signals so far:\n${signals.slice(0, 6).map((s) => `  • ${s}`).join("\n")}`
    : "";

  // Determine if a hint is warranted:
  // - Very little context known (first 3 fields) — user may need guidance
  // - OR it's an opportunity-assessment field (complex, abstract)
  const isOpportunityField = (fieldConfig?.priority ?? 0) < 60;
  const needsHint = knownCount < 3 || isOpportunityField;

  const prompt = `You are a business research assistant conducting a friendly discovery interview.

Your job: ask ONE short, natural follow-up question to uncover the following information:
  Topic: ${fieldConfig?.description ?? nextField}

## Business context so far
${knownFields || "  (none yet — this is the beginning of the conversation)"}
${signalContext}

## Recent conversation
${recentExchange || "  (no prior messages)"}

## Rules for your question
1. Write ONE question only — never combine two questions into one.
2. Keep it SHORT — ideally 5–12 words. Only longer if absolutely necessary for clarity.
3. Write it as a natural follow-up to the conversation above — not as a standalone form question.
4. Never mention database field names, form labels, or technical terms.
5. Never ask "What is the main pain point?" or "What automation opportunities exist?" — uncover problems indirectly by asking about process steps, manual work, delays, errors, and frequency.
6. Do not assume a specific industry — the question must work for any business type.

## Examples of good questions
- "How do they manage projects?"
- "Who handles that step?"
- "How often does this happen?"
- "What takes the most time?"
- "Do they use any software for it?"
- "What still needs to be done manually?"

${needsHint ? `Also generate a short hint (1–2 sentences max). The hint should:
- Help the user if they're unsure how to find or estimate this
- Reassure them that approximations are fine
- NOT repeat the question
- If there are strong problem signals, you may add one sentence noting the potential opportunity (e.g. "This looks like a strong automation candidate...")` : "Do NOT generate a hint — the conversation has enough context."}

Also optionally provide up to 5 short suggested answer options for the user to choose from. Only provide options if you have a good understanding of the business and can offer highly relevant, specific suggestions. Keep them short.

Return ONLY valid JSON matching this structure:
${needsHint
    ? '{ "question": "...", "hint": "...", "suggestedOptions": ["option1", "option2"] }'
    : '{ "question": "...", "suggestedOptions": ["option1", "option2"] }'}`;

  const result = await callGeminiStructured(prompt, QuestionSchema, "question");
  const fullQuestion =
    result.hint && needsHint
      ? `${result.question}\n\n*${result.hint}*`
      : result.question;

  return { nextQuestion: fullQuestion, suggestedOptions: result.suggestedOptions };
}

