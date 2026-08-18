import { ChatGroq } from "@langchain/groq";
import type { ZodSchema } from "zod";

let _groq: ChatGroq | null = null;

function getGroq() {
  if (!_groq) {
    const apiKey = process.env.GROQ_API_KEY;
    const model = process.env.GROQ_AI_MODEL ?? "openai/gpt-oss-120b";
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    _groq = new ChatGroq({ apiKey, model, temperature: 0 });
  }
  return _groq;
}

/** Call Groq with a plain text prompt */
export async function callGroq(prompt: string): Promise<string> {
  const llm = getGroq();
  const res = await llm.invoke(prompt);
  return typeof res.content === "string"
    ? res.content
    : JSON.stringify(res.content);
}

/** Call Groq with structured output enforced by a Zod schema */
export async function callGroqStructured<T>(
  prompt: string,
  schema: ZodSchema<T>,
  schemaName = "output"
): Promise<T> {
  const llm = getGroq();
  const structured = llm.withStructuredOutput(schema, { name: schemaName, includeRaw: false });
  return structured.invoke(prompt) as Promise<T>;
}
