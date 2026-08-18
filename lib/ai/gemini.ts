import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { ZodSchema } from "zod";

let _gemini: ChatGoogleGenerativeAI | null = null;

function getGemini() {
  if (!_gemini) {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash-lite";
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    _gemini = new ChatGoogleGenerativeAI({ apiKey, model, temperature: 0.2 });
  }
  return _gemini;
}

/** Call Gemini with a plain text prompt and get a string back */
export async function callGemini(prompt: string): Promise<string> {
  const llm = getGemini();
  const res = await llm.invoke(prompt);
  return typeof res.content === "string"
    ? res.content
    : JSON.stringify(res.content);
}

/** Call Gemini with structured output enforced by a Zod schema */
export async function callGeminiStructured<T>(
  prompt: string,
  schema: ZodSchema<T>,
  schemaName = "output"
): Promise<T> {
  const llm = getGemini();
  const structured = llm.withStructuredOutput(schema, { name: schemaName, includeRaw: false });
  return structured.invoke(prompt) as Promise<T>;
}
