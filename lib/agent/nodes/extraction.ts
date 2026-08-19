import { callGemini } from "@/lib/ai/gemini";
import { BUSINESS_FIELDS } from "@/lib/config/fields";
import type { BusinessObserverState, ExtractedFieldMeta } from "../state";

const FIELD_LIST = Object.entries(BUSINESS_FIELDS)
  .map(([k, v]) => `  ${k}: ${v.description}`)
  .join("\n");

const SYSTEM_PROMPT = `You are a precise information extractor for a Business Problem Discovery Engine.

## Core rules

ONLY extract fields that are **directly and explicitly stated** by the user.
Do NOT infer, guess, or assume any field not clearly mentioned.
However, if the user provides multiple pieces of information at once, follow the evidence and extract EVERYTHING they provided.

The database must store **clean, structured, business-oriented values** — never raw user sentences.

## Normalization rules (strict)

Transform raw user language into clean, concise business data:

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
- Preserve approximation markers: ~, "approx.", "around", range notation (e.g. "~$5k–10k/month")
- NEVER present estimated values as if they were confirmed precise figures

**General normalization**
- Normalize units and formats: "fifty" → "50", "per diem" → "/day"
- If information is a range, preserve it: "4 to 6 hours" → "4–6 hrs"
- Strip filler phrases: "I think they have", "probably around", "something like" → just the value with ~ prefix

## Certainty classification

For each extracted field, classify certainty:
- "explicit": user stated a precise, confirmed fact ("We have exactly 53 employees")
- "estimated": user gave an approximation ("about 50", "around 40")
- "inferred": logically implied but not directly stated
- "uncertain": user expressed uncertainty ("maybe", "I think", "possibly")

## Available fields

${FIELD_LIST}

## Response format

Respond ONLY with a valid JSON object matching this structure (no markdown, no explanation):
{
  "extractedFields": [
    {
      "field": "field_name",
      "value": "normalized value",
      "confidence": 0.95,
      "certainty": "explicit"
    }
  ],
  "signals": {
    "problemSignals": ["signal 1", "signal 2"],
    "automationSignals": ["signal 1"],
    "integrationSignals": [],
    "aiSignals": [],
    "evidence": ["evidence 1"],
    "opportunityAssessment": "brief paragraph assessing the opportunity based on current evidence"
  }
}

Return an empty array for extractedFields if no fields can be extracted. Return empty arrays for signals if no evidence is found.`;

export async function extractFields(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const businessContext = state.businessContext
    ? `\nCurrent known business data:\n${JSON.stringify(state.businessContext, null, 2)}`
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

CRITICAL: Return ONLY the JSON object matching the requested structure.
Always include the \`signals\` object. If the user mentions any workflow inefficiencies, bugs, time-consuming tasks, or manual work, you MUST extract them into problemSignals and evidence.`;

  let extractedFieldsWithMeta: ExtractedFieldMeta[] = [];
  const extractedFields: Record<string, string | null> = {};
  let problemSignals: string[] = [];
  let automationSignals: string[] = [];
  let integrationSignals: string[] = [];
  let aiSignals: string[] = [];
  let evidence: string[] = [];
  let opportunityAssessment: string | undefined = undefined;

  try {
    const rawResponse = await callGemini(prompt);
    console.log("[DEBUG] rawResponse from extraction:", rawResponse);

    // Extract JSON object from response (handle markdown code blocks)
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      if (Array.isArray(parsed.extractedFields)) {
        for (const item of parsed.extractedFields) {
          if (item.field && item.field in BUSINESS_FIELDS && item.value) {
            const meta: ExtractedFieldMeta = {
              field: item.field,
              value: String(item.value),
              confidence: typeof item.confidence === "number" ? item.confidence : 0.7,
              certainty: ["explicit", "estimated", "inferred", "uncertain"].includes(
                item.certainty
              )
                ? item.certainty
                : "uncertain",
            };
            extractedFieldsWithMeta.push(meta);
            extractedFields[item.field] = meta.value;
          }
        }
      }

      if (parsed.signals) {
        problemSignals = Array.isArray(parsed.signals.problemSignals) ? parsed.signals.problemSignals : [];
        automationSignals = Array.isArray(parsed.signals.automationSignals) ? parsed.signals.automationSignals : [];
        integrationSignals = Array.isArray(parsed.signals.integrationSignals) ? parsed.signals.integrationSignals : [];
        aiSignals = Array.isArray(parsed.signals.aiSignals) ? parsed.signals.aiSignals : [];
        evidence = Array.isArray(parsed.signals.evidence) ? parsed.signals.evidence : [];
        if (typeof parsed.signals.opportunityAssessment === "string") {
          opportunityAssessment = parsed.signals.opportunityAssessment;
        }
      }
    }
  } catch (e) {
    console.error("[extractFields] Parse error:", e);
    // Non-fatal — return empty extraction, don't break the graph
  }

  return {
    extractedFields,
    extractedFieldsWithMeta,
    problemSignals,
    automationSignals,
    integrationSignals,
    aiSignals,
    evidence,
    opportunityAssessment
  };
}
