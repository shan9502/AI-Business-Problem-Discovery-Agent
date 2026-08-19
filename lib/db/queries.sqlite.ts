import { eq, like, isNotNull, or, sql as drizzleSql } from "drizzle-orm";
import { db, sqlite } from "./client.sqlite";
import {
  businesses,
  conversations,
  messages,
  type Business,
  type Message,
  type NewBusiness,
} from "./schema/sqlite";
import { BUSINESS_FIELDS } from "@/lib/config/fields";

// ─── Business CRUD ───────────────────────────────────────────────────────────

export async function createBusiness(data: Partial<NewBusiness>): Promise<Business> {
  const result = db
    .insert(businesses)
    .values(data)
    .returning()
    .get();
  return result;
}

export async function getBusinessById(id: number): Promise<Business | undefined> {
  return db.select().from(businesses).where(eq(businesses.id, id)).get();
}

export async function updateBusiness(
  id: number,
  updates: Partial<NewBusiness>
): Promise<Business | undefined> {
  return db
    .update(businesses)
    .set({ ...updates, updated_at: new Date().toISOString() })
    .where(eq(businesses.id, id))
    .returning()
    .get();
}

export async function searchBusinesses(query: string): Promise<Business[]> {
  const like_q = `%${query}%`;
  return db
    .select()
    .from(businesses)
    .where(
      or(
        like(businesses.company_name, like_q),
        like(businesses.industry, like_q),
        like(businesses.workflow, like_q),
        like(businesses.department, like_q)
      )
    )
    .all();
}

export async function getAllBusinesses(): Promise<Business[]> {
  return db.select().from(businesses).all();
}

/**
 * Returns all businesses that have a company_name set.
 * Used as the candidate pool for fuzzy duplicate detection.
 */
export async function getBusinessesWithNames(): Promise<Array<{ id: number; company_name: string | null }>> {
  return db
    .select({ id: businesses.id, company_name: businesses.company_name })
    .from(businesses)
    .where(isNotNull(businesses.company_name))
    .all();
}

/** Returns field names that are null or empty in a given business record */
export function getMissingFields(business: Business): string[] {
  const FIELD_NAMES = Object.keys(BUSINESS_FIELDS) as Array<
    keyof typeof BUSINESS_FIELDS
  >;
  return FIELD_NAMES.filter((f) => {
    const val = business[f as keyof Business];
    return val === null || val === undefined || val === "";
  });
}

// ─── Conversation helpers ──────────────────────────────────────────────────────

export async function createConversation(businessId?: number): Promise<{
  id: number;
  business_id: number | null;
  summary: string | null;
  created_at: string | null;
  updated_at: string | null;
}> {
  return db
    .insert(conversations)
    .values({ business_id: businessId })
    .returning()
    .get();
}

export async function getConversation(id: number) {
  return db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .get();
}

export async function updateConversationSummary(
  conversationId: number,
  summary: string
) {
  return db
    .update(conversations)
    .set({ summary, updated_at: new Date().toISOString() })
    .where(eq(conversations.id, conversationId))
    .run();
}

// ─── Message helpers ───────────────────────────────────────────────────────────

export async function addMessage(
  conversationId: number,
  role: "user" | "assistant" | "system",
  content: string
): Promise<Message> {
  return db
    .insert(messages)
    .values({ conversation_id: conversationId, role, content })
    .returning()
    .get();
}

export async function getRecentMessages(
  conversationId: number,
  limit = 10
): Promise<Message[]> {
  // Return last `limit` messages, oldest first for LLM context
  const rows = db
    .select()
    .from(messages)
    .where(eq(messages.conversation_id, conversationId))
    .all();
  return rows.slice(-limit);
}

export async function executeRawQuery(sqlString: string, params: unknown[]): Promise<unknown[]> {
  const stmt = sqlite.prepare(sqlString);
  return stmt.all(...params);
}
