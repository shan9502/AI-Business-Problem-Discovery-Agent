import {
  createBusiness,
  getMissingFields,
  getBusinessById,
  searchBusinesses,
  updateBusiness,
} from "@/lib/db/queries";
import type { Business } from "@/lib/db/schema";
import type { BusinessObserverState } from "../state";

/**
 * validateAndWrite
 *
 * 1. If pendingBusinessMatch exists + user said confirm_yes → use that business.
 * 2. If pendingBusinessMatch exists + user said confirm_no / discover → create new business.
 * 3. If no businessId and company_name is known → search for match.
 *    - If match found → set pendingBusinessMatch and return early (ask confirmation).
 * 4. Write extracted fields via parameterized Drizzle queries.
 */
export async function validateAndWrite(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const extracted = state.extractedFields ?? {};

  // Build updates from non-null extracted fields only
  const updates: Record<string, string> = {};
  for (const [k, v] of Object.entries(extracted)) {
    if (v !== null && v !== undefined && v !== "") {
      updates[k] = v;
    }
  }

  let businessId = state.businessId;
  let business: Business | undefined;

  // ── Resolve pending duplicate confirmation ────────────────────────────────
  if (state.pendingBusinessMatch) {
    if (state.intent === "confirm_yes") {
      // User confirmed — use matched business
      businessId = state.pendingBusinessMatch.id;
      business = await getBusinessById(businessId);
      if (Object.keys(updates).length > 0 && business) {
        business = await updateBusiness(businessId, updates);
      }
      const missing = business ? getMissingFields(business) : [];
      return {
        businessId,
        businessContext: business as unknown as Record<string, unknown>,
        missingFields: missing,
        pendingBusinessMatch: undefined,
      };
    } else {
      // confirm_no or new discover — create a new business
      business = await createBusiness(updates);
      businessId = business.id;
      const missing = getMissingFields(business);
      return {
        businessId,
        businessContext: business as unknown as Record<string, unknown>,
        missingFields: missing,
        pendingBusinessMatch: undefined,
      };
    }
  }

  // ── No existing businessId — try to resolve ───────────────────────────────
  if (!businessId) {
    const nameCandidate =
      (updates.company_name as string | undefined) ||
      (state.businessContext?.company_name as string | undefined);

    if (nameCandidate) {
      const results = await searchBusinesses(nameCandidate);

      if (results.length === 1) {
        // Found a single strong match — ask confirmation (#12)
        const match = results[0];
        const displayName = match.company_name ?? `Business #${match.id}`;
        return {
          pendingBusinessMatch: { id: match.id, name: displayName },
          finalResponse: `I found an existing record for **${displayName}**. Is this the company you want to continue with?\n\n- Reply **yes** to continue updating this record.\n- Reply **no** to create a new business entry.`,
        };
      } else if (results.length > 1) {
        // Multiple matches — ask user to clarify
        const list = results
          .map((r, i) => `  ${i + 1}. ${r.company_name ?? `Business #${r.id}`}`)
          .join("\n");
        return {
          finalResponse: `I found multiple businesses that could match. Which one do you mean?\n\n${list}\n\nOr reply **new** to create a new business.`,
        };
      }
    }

    // No match — create new business
    business = await createBusiness(updates);
    businessId = business.id;
  } else {
    // Update existing
    if (Object.keys(updates).length > 0) {
      business = await updateBusiness(businessId, updates);
    } else {
      business = await getBusinessById(businessId);
    }
  }

  const missing = business ? getMissingFields(business) : [];

  return {
    businessId,
    businessContext: business as unknown as Record<string, unknown>,
    missingFields: missing,
    pendingBusinessMatch: undefined,
  };
}
