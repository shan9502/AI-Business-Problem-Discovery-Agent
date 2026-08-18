import { callGeminiStructured } from "@/lib/ai/gemini";
import { BUSINESS_FIELDS } from "@/lib/config/fields";
import { z } from "zod";
import type { BusinessObserverState } from "../state";

const QuestionSchema = z.object({
  question: z.string(),
  hint: z.string().optional(),
});

export async function generateQuestion(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const nextField = state.nextField;
  if (!nextField) return {};

  const fieldConfig = BUSINESS_FIELDS[nextField];
  const knownFields = Object.entries(state.businessContext ?? {})
    .filter(([k, v]) => v !== null && v !== undefined && v !== "" && k in BUSINESS_FIELDS)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");

  const alreadyAsked = (state.recentMessages ?? [])
    .filter((m) => m.role === "assistant")
    .map((m) => m.content)
    .slice(-3)
    .join("\n");

  const prompt = `You are an intelligent business analyst assistant for a Business Problem Discovery Engine. Your goal is to uncover and qualify valuable business problems.

Known business information:
${knownFields || "  (none yet)"}

You need to ask about: ${nextField}
Field description: ${fieldConfig?.description}
Field importance: priority ${fieldConfig?.priority}/100

Previous assistant messages (avoid repeating these):
${alreadyAsked || "  (none)"}

Generate a natural, conversational question to ask about "${nextField}".

Crucial Conversation Rules:
1. **Increase difficulty gradually:** If we are asking about basic company info, keep the question short and simple. If we are asking about workflows or problems, make the question more operational and investigative.
2. **Uncover problems indirectly:** DO NOT ask literal questionnaire questions like "What is the main pain?" or "What is the error rate?". Instead, ask investigative questions like "Where does the process slow down?", "Which step requires the most manual effort?", or "What happens when an error occurs?". Let the problem emerge naturally.
3. **Think like a software developer:** Mentally evaluate if the process can be automated, integrated, or digitized, but do NOT assume every problem requires AI. Find the right digital solution (e.g., traditional software, API integration, RPA).

Also generate a short helpful hint (1-3 sentences) that:
1. Suggests practical ways the user can discover or estimate this information if they don't know it (e.g., "You could estimate this by taking average time spent per task × frequency").
2. Reassures them that an approximate answer or estimate is perfectly acceptable.

If the "Known business information" clearly establishes a real, recurring, expensive problem (Problem + Frequency + Time + People + Pain), include a brief sentence in the hint expressing "Potential Solution / Opportunity Thinking" (e.g., "Based on what we know so far, this looks like a strong automation opportunity because...").

Keep the question concise. Make it feel natural, like a business discovery interview, not a form.`;

  const result = await callGeminiStructured(prompt, QuestionSchema, "question");
  const fullQuestion = result.hint
    ? `${result.question}\n\n*${result.hint}*`
    : result.question;

  return { nextQuestion: fullQuestion };
}
