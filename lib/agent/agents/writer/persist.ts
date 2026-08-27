/**
 * lib/agent/agents/writer/persist.ts
 *
 * Writer persistence — validates and writes extracted fields to the database.
 *
 * Handles:
 * - Deduplication / business resolution (fuzzy match → pendingSelection)
 * - Create new business
 * - Update existing business
 * - Pending confirmation (yes/no) flow
 *
 * Uses typed, parameterized Drizzle queries only.
 * Never executes raw SQL from the LLM.
 */

import { agentLog } from "@/lib/agent/logger";
import {
  createBusiness,
  getMissingFields,
  getBusinessById,
  getBusinessesWithNames,
  updateBusiness,
} from "@/lib/db/queries";
import { findDuplicateCandidates } from "@/lib/db/deduplication";
import { callGeminiStructured } from "@/lib/ai/gemini";
import { z } from "zod";
import type { Business } from "@/lib/db/schema";
import type { BusinessObserverState, WriterResult } from "../../state";

// ─── Semantic candidate ranking (Gemini) ─────────────────────────────────────

const RankSchema = z.object({
  bestMatchId: z.number().nullable(),
  reasoning: z.string().optional(),
});

async function rankCandidatesWithGemini(
  userMessage: string,
  candidates: Array<{ id: number; company_name: string }>
): Promise<number | null> {
  const prompt = `The user is talking about a business. 

User message context: "${userMessage}"

These businesses exist in the database:
${candidates.map((c, i) => `  ${i + 1}. ID=${c.id} — "${c.company_name}"`).join("\n")}

Which one best matches what the user is talking about?
If no single clear match, return null.

Return ONLY: { "bestMatchId": <number or null>, "reasoning": "..." }`;

  try {
    const result = await callGeminiStructured(prompt, RankSchema, "candidate_rank");
    return result.bestMatchId;
  } catch {
    return null;
  }
}

// ─── Main persist function ────────────────────────────────────────────────────

export async function persistExtraction(
  state: BusinessObserverState,
  updates: Record<string, string>
): Promise<WriterResult> {
  agentLog({
    agent: "Writer",
    tool: "persistExtraction",
    businessId: state.businessId,
    note: `updating ${Object.keys(updates).length} fields`,
  });

  let businessId = state.businessId;
  let business: Business | undefined;

  // ── Handle pending yes/no confirmation ───────────────────────────────────
  if (state.pendingBusinessMatch) {
    if (state.intent === "confirm_yes") {
      businessId = state.pendingBusinessMatch.id;
      business = await getBusinessById(businessId);
      if (Object.keys(updates).length > 0 && business) {
        business = await updateBusiness(businessId, updates);
      }
      const missing = business ? getMissingFields(business) : [];
      agentLog({ agent: "Writer", tool: "persist:confirm_yes", businessId, dbOp: "UPDATE" });
      return {
        status: "updated",
        response: "Got it — continuing with that business.",
        businessId,
        businessContext: business as unknown as Record<string, unknown>,
        missingFields: missing,
        pendingBusinessMatch: undefined,
      };
    } else {
      // confirm_no → create new
      business = await createBusiness(updates);
      businessId = business.id;
      const missing = getMissingFields(business);
      agentLog({ agent: "Writer", tool: "persist:confirm_no", businessId: business.id, dbOp: "INSERT" });
      return {
        status: "created",
        response: "Starting fresh with a new business record.",
        businessId: business.id,
        businessContext: business as unknown as Record<string, unknown>,
        missingFields: missing,
        pendingBusinessMatch: undefined,
      };
    }
  }

  // ── Handle pending selection (multi-match UI) ────────────────────────────
  if (state.pendingSelection && state.pendingSelection.type === "business") {
    // User's message should have selected one option
    // Router/Writer handles this via the intent flow — we just check if a selection was resolved
    // (In the full flow, the selection is resolved before reaching here via the Router)
  }

  // ── No existing businessId — try to resolve ──────────────────────────────
  if (!businessId) {
    const nameCandidate =
      (updates.company_name as string | undefined) ||
      (state.businessContext?.company_name as string | undefined);

    if (nameCandidate) {
      const allNamed = await getBusinessesWithNames();
      const duplicates = findDuplicateCandidates(nameCandidate, allNamed);

      if (duplicates.length === 1) {
        // Single strong match → confirm
        const match = duplicates[0];
        agentLog({ agent: "Writer", tool: "persist:dedup", note: `single match: ${match.company_name}` });
        return {
          status: "ambiguous",
          response: `I found an existing record for **${match.company_name}**. Is this the company you want to continue with?\n\n- Reply **yes** to continue updating this record.\n- Reply **no** to create a new business entry.`,
          pendingBusinessMatch: { id: match.id, name: match.company_name },
        };
      } else if (duplicates.length > 1) {
        // Multiple matches → semantic ranking
        const bestId = await rankCandidatesWithGemini(state.userMessage, duplicates);
        if (bestId && duplicates.find((d) => d.id === bestId)) {
          const match = duplicates.find((d) => d.id === bestId)!;
          return {
            status: "ambiguous",
            response: `I found an existing record for **${match.company_name}**. Is this the company you want to continue with?\n\n- Reply **yes** to continue.\n- Reply **no** to create a new entry.`,
            pendingBusinessMatch: { id: match.id, name: match.company_name },
          };
        }
        // Still ambiguous after ranking → show selection UI
        const options = duplicates.map((r) => ({
          id: String(r.id),
          label: r.company_name,
        }));
        return {
          status: "ambiguous",
          response: "I found multiple businesses that could match. Which one do you mean?",
          pendingSelection: {
            type: "business",
            question: "Which business did you mean?",
            options,
          },
        };
      }
    }

    // No match → create new business
    business = await createBusiness(updates);
    businessId = business.id;
    agentLog({ agent: "Writer", tool: "persist:create", businessId, dbOp: "INSERT" });
    const missing = getMissingFields(business);
    return {
      status: "created",
      response: "",
      businessId,
      businessContext: business as unknown as Record<string, unknown>,
      missingFields: missing,
    };
  }

  // ── Update existing business ─────────────────────────────────────────────
  if (Object.keys(updates).length > 0) {
    business = await updateBusiness(businessId, updates);
    agentLog({ agent: "Writer", tool: "persist:update", businessId, dbOp: "UPDATE" });
  } else {
    business = await getBusinessById(businessId);
  }

  const missing = business ? getMissingFields(business) : [];
  return {
    status: "updated",
    response: "",
    businessId,
    businessContext: business as unknown as Record<string, unknown>,
    missingFields: missing,
  };
}
