/**
 * lib/agent/agents/writer/extractor.ts
 *
 * Writer extraction — converts natural-language user messages into
 * clean, structured, normalized business field values.
 *
 * Rules:
 * - Only extract fields explicitly or clearly stated.
 * - Normalize values (headcount, frequency, time, software names).
 * - Track certainty: explicit / estimated / inferred / uncertain.
 * - Handle update semantics: new / correction / approximation / range / conflict.
 * - Never manufacture precision (e.g., "half a day" ≠ "4 hrs/day").
 */

import { callGemini } from "@/lib/ai/gemini";
import { agentLog } from "@/lib/agent/logger";
import { FIELD_DESCRIPTIONS_FOR_WRITER } from "@/lib/db/metadata";
import type { ExtractedFieldMeta, BusinessObserverState } from "../../state";

const SYSTEM_PROMPT = `You are a precise information extractor for a Business Problem Discovery Engine.

## Core rules

ONLY extract fields that are **directly and explicitly stated** by the user.
Do NOT infer, guess, or assume any field not clearly mentioned.
If the user provides multiple facts at once, extract ALL of them.

The database must store **clean, structured, business-oriented values** — never raw user sentences.

## Normalization rules (strict)

**People / headcount**
- "They have around 50 people" → "~50 employees"
- "About 200 staff" → "~200 employees"
- "A team of 5" → "5 people"

**Frequency**
- "Around 200 orders every day" → "~200 orders/day"
- "Maybe 40 to 50 quotations per day" → "~40–50 quotations/day"
- "Three times a week" → "3×/week"
- "Once a month" → "1×/month"

**Time**
- "About 2 hours per order" → "~2 hrs/order"
- "Takes half the day" → "~half a working day" (do NOT convert to specific hours)
- "Maybe 30 minutes" → "~30 min"
- NEVER convert vague time expressions to specific hours

**Software / tools**
- Preserve product names as-is: "Excel", "SAP", "WhatsApp", "QuickBooks"
- Multiple tools: "Excel, WhatsApp"

**Approximate values**
- Preserve approximation markers: ~, "approx.", "around", range notation (e.g., "~$5k–10k/month")
- NEVER present estimated values as confirmed precise figures

**Ranges**
- "100–150/day depending on season" → "100–150/day (seasonal)"
- "Usually 40, sometimes 200" → "40–200/day (variable)" — do NOT pick one number

**General normalization**
- Normalize units: "fifty" → "50", "per diem" → "/day"
- Strip filler phrases: "I think they have", "probably around" → just the value with ~ prefix

## Certainty classification

For each extracted field, classify certainty:
- "explicit": user stated a precise, confirmed fact ("We have exactly 53 employees")
- "estimated": user gave an approximation ("about 50", "around 40")
- "inferred": logically implied but not directly stated
- "uncertain": user expressed uncertainty ("maybe", "I think", "possibly")

## Available fields

${FIELD_DESCRIPTIONS_FOR_WRITER}

## Response format

Respond ONLY with a valid JSON object (no markdown, no explanation):
{
  "extractedFields": [
    {
      "field": "field_name",
      "value": "normalized value",
      "confidence": 0.95,
      "certainty": "explicit",
      "updateType": "new" | "correction" | "approximation" | "range" | "conflict"
    }
  ],
  "signals": {
    "problemSignals": ["signal 1"],
    "automationSignals": [],
    "integrationSignals": [],
    "aiSignals": [],
    "evidence": ["evidence 1"],
    "opportunityAssessment": "brief assessment based on current evidence"
  }
}

updateType meanings:
- "new": no previous value, this is the first time this field is filled
- "correction": user explicitly corrects a previous value ("Actually it's 200, not 100")
- "approximation": user gives an approximate value
- "range": user gives a range ("100–150 orders")
- "conflict": user's statement contradicts what is known without explicitly correcting it

Return an empty array if no fields can be extracted.`;

export interface ExtractionResult {
  extractedFieldsWithMeta: ExtractedFieldMeta[];
  extractedFields: Record<string, string | null>;
  problemSignals: string[];
  automationSignals: string[];
  integrationSignals: string[];
  aiSignals: string[];
  evidence: string[];
  opportunityAssessment?: string;
}

export async function extractFields(
  state: BusinessObserverState
): Promise<ExtractionResult> {
  const start = Date.now();

  const businessContext = state.businessContext
    ? `\nCurrent known business data:\n${JSON.stringify(
        Object.fromEntries(
          Object.entries(state.businessContext).filter(([, v]) => v !== null && v !== "")
        ),
        null,
        2
      )}`
    : "";

  const recentContext = (state.recentMessages ?? [])
    .slice(-3)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const prompt = `${SYSTEM_PROMPT}
${businessContext}

Recent conversation context:
${recentContext || "(none)"}

User message to extract from:
"${state.userMessage}"

CRITICAL: Return ONLY the JSON object.
If the user mentions workflow inefficiencies, manual work, bugs, or time-consuming tasks, extract them into problemSignals and evidence.`;

  const result: ExtractionResult = {
    extractedFieldsWithMeta: [],
    extractedFields: {},
    problemSignals: [],
    automationSignals: [],
    integrationSignals: [],
    aiSignals: [],
    evidence: [],
    opportunityAssessment: undefined,
  };

  try {
    const rawResponse = await callGemini(prompt);
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return result;

    const parsed = JSON.parse(jsonMatch[0]);

    if (Array.isArray(parsed.extractedFields)) {
      for (const item of parsed.extractedFields) {
        if (!item.field || !item.value) continue;
        const meta: ExtractedFieldMeta = {
          field: item.field,
          value: String(item.value),
          confidence: typeof item.confidence === "number" ? item.confidence : 0.7,
          certainty: ["explicit", "estimated", "inferred", "uncertain"].includes(item.certainty)
            ? item.certainty
            : "uncertain",
        };
        result.extractedFieldsWithMeta.push(meta);
        result.extractedFields[item.field] = meta.value;
      }
    }

    if (parsed.signals) {
      result.problemSignals = Array.isArray(parsed.signals.problemSignals) ? parsed.signals.problemSignals : [];
      result.automationSignals = Array.isArray(parsed.signals.automationSignals) ? parsed.signals.automationSignals : [];
      result.integrationSignals = Array.isArray(parsed.signals.integrationSignals) ? parsed.signals.integrationSignals : [];
      result.aiSignals = Array.isArray(parsed.signals.aiSignals) ? parsed.signals.aiSignals : [];
      result.evidence = Array.isArray(parsed.signals.evidence) ? parsed.signals.evidence : [];
      if (typeof parsed.signals.opportunityAssessment === "string") {
        result.opportunityAssessment = parsed.signals.opportunityAssessment;
      }
    }
  } catch (e) {
    console.error("[extractFields] Parse error:", e);
  }

  agentLog({
    agent: "Writer",
    tool: "extractFields",
    note: `extracted ${result.extractedFieldsWithMeta.length} fields`,
    latency: Date.now() - start,
  });

  return result;
}
