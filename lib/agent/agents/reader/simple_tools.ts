/**
 * lib/agent/agents/reader/simple_tools.ts
 *
 * Typed read tools for the Reader agent.
 * Used when the request is a simple lookup (no SQL needed).
 *
 * Tools:
 *   - resolveAndGetBusiness: semantic search → candidate ranking → get business
 *   - getBusinessSummary: returns a Markdown summary of a business record
 *   - getMissingFieldsSummary: lists what fields are still unknown
 */

import { callGemini, callGeminiStructured } from "@/lib/ai/gemini";
import { agentLog } from "@/lib/agent/logger";
import {
  searchBusinesses,
  getBusinessById,
  getMissingFields,
} from "@/lib/db/queries";
import { FIELD_META } from "@/lib/db/metadata";
import type { BusinessObserverState } from "../../state";
import { z } from "zod";

// ─── Business resolution ──────────────────────────────────────────────────────

const CandidateRankSchema = z.object({
  bestMatchId: z.number().nullable(),
  reasoning: z.string().optional(),
});

/**
 * Extract search concepts from a natural-language business description.
 * e.g., "that electrical distribution company" → ["electrical", "distribution"]
 */
async function extractSearchConcepts(userMessage: string): Promise<string[]> {
  const ConceptSchema = z.object({
    concepts: z.array(z.string()),
  });

  const prompt = `Extract 1–4 search keywords from this business description for a database search.
Return company name parts, industry words, product/service words, or process words.
Remove filler words ("the", "that", "we", "discussed", "company").

Description: "${userMessage}"

Return ONLY: { "concepts": ["word1", "word2"] }`;

  try {
    const result = await callGeminiStructured(prompt, ConceptSchema, "search_concepts");
    return result.concepts;
  } catch {
    // Fallback: split user message into words
    return userMessage.split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
  }
}

/**
 * Resolve a natural-language business reference to a specific DB record.
 * Returns { businessId, candidates } — candidates for selection UI if ambiguous.
 */
export async function resolveBusinessReference(
  state: BusinessObserverState
): Promise<{
  resolvedId?: number;
  candidates?: Array<{ id: number; company_name: string }>;
  noMatch?: boolean;
}> {
  agentLog({ agent: "Reader", tool: "resolveBusinessReference" });

  // If we already have a businessId, use it
  if (state.businessId) {
    return { resolvedId: state.businessId };
  }

  // Extract search concepts
  const concepts = await extractSearchConcepts(state.userMessage);

  // Search DB with multiple concepts
  const allCandidates: Map<number, { id: number; company_name: string }> = new Map();
  for (const concept of concepts) {
    const results = await searchBusinesses(concept);
    for (const r of results) {
      if (r.id && !allCandidates.has(r.id)) {
        allCandidates.set(r.id, { id: r.id, company_name: r.company_name ?? "(unnamed)" });
      }
    }
  }

  const candidates = Array.from(allCandidates.values());

  if (candidates.length === 0) {
    return { noMatch: true };
  }

  if (candidates.length === 1) {
    return { resolvedId: candidates[0].id };
  }

  // Multiple candidates — ask Gemini to rank
  const rankPrompt = `The user said: "${state.userMessage}"

These businesses were found in the database:
${candidates.map((c, i) => `  ${i + 1}. ID=${c.id} — "${c.company_name}"`).join("\n")}

Which one best matches what the user is looking for?
If you cannot determine a single clear best match, return null for bestMatchId.

Return ONLY: { "bestMatchId": <number or null>, "reasoning": "..." }`;

  try {
    const rank = await callGeminiStructured(rankPrompt, CandidateRankSchema, "candidate_rank");
    if (rank.bestMatchId !== null && candidates.find((c) => c.id === rank.bestMatchId)) {
      return { resolvedId: rank.bestMatchId };
    }
  } catch {
    // Fall through to ambiguous
  }

  // Ambiguous — return all candidates for selection UI
  return { candidates };
}

// ─── Get business summary (Markdown) ─────────────────────────────────────────

export async function getBusinessSummaryMarkdown(
  businessId: number,
  userMessage: string
): Promise<string> {
  const biz = await getBusinessById(businessId);
  if (!biz) return "I couldn't find that business record.";

  const knownFields = Object.entries(biz)
    .filter(([k, v]) => v && !["id", "created_at", "updated_at"].includes(k) && k in FIELD_META)
    .map(([k, v]) => {
      const meta = FIELD_META[k];
      return `- **${meta?.description ?? k}**: ${v}`;
    })
    .join("\n");

  const missingFields = getMissingFields(biz);
  const fillRate = Math.round(((Object.keys(FIELD_META).length - missingFields.length) / Object.keys(FIELD_META).length) * 100);

  const prompt = `You are a business intelligence assistant.

The user asked: "${userMessage}"

Here is what we know about this business:
${knownFields || "(nothing recorded yet)"}

Research completeness: ${fillRate}%

Respond in Markdown. Be concise and well-organized. Use a heading with the company name, then group what is known.
Never mention database fields or column names directly — use natural language.
Highlight the main problem/opportunity clearly if it is known.`;

  return callGemini(prompt);
}

// ─── Missing fields summary ───────────────────────────────────────────────────

export function getMissingFieldsSummaryMarkdown(
  state: BusinessObserverState
): string {
  const biz = state.businessContext;
  if (!biz) return "No business is currently active.";

  const missing = Object.keys(FIELD_META).filter((f) => {
    const val = biz[f];
    return val === null || val === undefined || val === "";
  });

  if (missing.length === 0) {
    return "All key fields are filled in for this business. 🎉";
  }

  const missingDescriptions = missing
    .map((f) => `- ${FIELD_META[f]?.description ?? f}`)
    .join("\n");

  const fillCount = Object.keys(FIELD_META).length - missing.length;
  const fillRate = Math.round((fillCount / Object.keys(FIELD_META).length) * 100);

  return `## Research Progress: ${fillRate}% complete\n\n**Still needed:**\n${missingDescriptions}`;
}
