import type { BusinessObserverState } from "../state";
import {
  getBusinessById,
  getConversation,
  getRecentMessages,
} from "@/lib/db/queries";

/**
 * loadContext — first node in the graph.
 * Hydrates recentMessages, conversationSummary, and businessContext
 * from SQLite into graph state.
 */
export async function loadContext(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const updates: Partial<BusinessObserverState> = {};

  // Load conversation context
  if (state.conversationId) {
    const conv = await getConversation(state.conversationId);
    if (conv) {
      updates.conversationSummary = conv.summary ?? undefined;
      updates.recentMessages = await getRecentMessages(state.conversationId, 10);

      // Load associated business if conversation references one
      if (conv.business_id && !state.businessId) {
        updates.businessId = conv.business_id;
      }
    }
  }

  // Load business context
  const bizId = state.businessId ?? updates.businessId;
  if (bizId) {
    const biz = await getBusinessById(bizId);
    if (biz) {
      updates.businessContext = biz as unknown as Record<string, unknown>;
    }
  }

  return updates;
}
