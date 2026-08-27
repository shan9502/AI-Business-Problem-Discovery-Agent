/**
 * lib/agent/agents/writer/question.ts
 *
 * Writer question generator — produces a single natural follow-up question
 * tailored to the current business context and detected signals.
 */

import { callGeminiStructured } from "@/lib/ai/gemini";
import { agentLog } from "@/lib/agent/logger";
import { FIELD_META } from "@/lib/db/metadata";
import { z } from "zod";
import type { BusinessObserverState } from "../../state";

const QuestionSchema = z.object({
  question: z.string(),
  hint: z.string().optional(),
  suggestedOptions: z.array(z.string()).max(5).optional(),
});

export interface QuestionResult {
  question: string;
  suggestedOptions: string[];
}

export async function generateNextQuestion(
  state: BusinessObserverState,
  nextField: string
): Promise<QuestionResult> {
  const fieldConfig = FIELD_META[nextField];
  const start = Date.now();

  const knownEntries = Object.entries(state.businessContext ?? {}).filter(
    ([k, v]) => v !== null && v !== undefined && v !== "" && k in FIELD_META
  );
  const knownFields = knownEntries.map(([k, v]) => `  ${k}: ${v}`).join("\n");
  const knownCount = knownEntries.length;

  const recentExchange = (state.recentMessages ?? [])
    .slice(-4)
    .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
    .join("\n");

  const signals = [
    ...(state.problemSignals ?? []).map((s) => `[problem] ${s}`),
    ...(state.automationSignals ?? []).map((s) => `[automation] ${s}`),
    ...(state.integrationSignals ?? []).map((s) => `[integration] ${s}`),
    ...(state.aiSignals ?? []).map((s) => `[ai] ${s}`),
  ];
  const signalContext = signals.length > 0
    ? `\nDetected signals:\n${signals.slice(0, 6).map((s) => `  • ${s}`).join("\n")}`
    : "";

  const isOpportunityField = (fieldConfig?.priority ?? 0) < 60;
  const needsHint = knownCount < 3 || isOpportunityField;

  const prompt = `You are a business research assistant conducting a friendly discovery interview.

Your job: ask ONE short, natural follow-up question to uncover this information:
  Topic: ${fieldConfig?.description ?? nextField}

## Business context
${knownFields || "  (none yet — beginning of conversation)"}
${signalContext}

## Recent conversation
${recentExchange || "  (no prior messages)"}

## Rules
1. ONE question only — never combine two into one.
2. SHORT — ideally 5–12 words.
3. Natural follow-up to the conversation above — not a standalone form question.
4. Never mention database field names or technical terms.
5. Never ask "What is the main pain point?" — uncover problems indirectly (process steps, manual work, errors, delays).
6. Do not assume a specific industry.

## Good question examples
- "How do they manage that step?"
- "Who handles it?"
- "How often does this happen?"
- "What takes the most time?"
- "Do they use any software for it?"
- "What still needs to be done manually?"

${needsHint
  ? `Also generate a short hint (1–2 sentences max):
- Help if the user is unsure how to answer
- Reassure that approximations are fine
- Do NOT repeat the question
- If strong signals exist, note the potential opportunity briefly`
  : "Do NOT generate a hint — enough context exists."}

Optionally provide up to 5 short suggested answer options — only if highly relevant and specific.

Return ONLY valid JSON:
${needsHint
  ? '{ "question": "...", "hint": "...", "suggestedOptions": ["option1"] }'
  : '{ "question": "...", "suggestedOptions": ["option1"] }'}`;

  const result = await callGeminiStructured(prompt, QuestionSchema, "question");

  const fullQuestion =
    result.hint && needsHint
      ? `${result.question}\n\n*${result.hint}*`
      : result.question;

  agentLog({
    agent: "Writer",
    tool: "generateNextQuestion",
    note: `nextField=${nextField}`,
    latency: Date.now() - start,
  });

  return {
    question: fullQuestion,
    suggestedOptions: result.suggestedOptions ?? [],
  };
}
