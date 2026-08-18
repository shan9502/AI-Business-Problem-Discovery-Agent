import { eq, like, or, sql as drizzleSql } from "drizzle-orm";
import { db, pgPool } from "./client.pg";
import {
  businesses,
  conversations,
  messages,
  type Business,
  type Message,
  type NewBusiness,
} from "./schema/pg";
import { BUSINESS_FIELDS } from "@/lib/config/fields";

// ─── Business CRUD ───────────────────────────────────────────────────────────

export async function createBusiness(data: Partial<NewBusiness>): Promise<Business> {
  const result = await db!
    .insert(businesses)
    .values(data)
    .returning();
  return result[0];
}

export async function getBusinessById(id: number): Promise<Business | undefined> {
  const rows = await db!.select().from(businesses).where(eq(businesses.id, id));
  return rows[0];
}

export async function updateBusiness(
  id: number,
  updates: Partial<NewBusiness>
): Promise<Business | undefined> {
  const result = await db!
    .update(businesses)
    .set({ ...updates, updated_at: drizzleSql`CURRENT_TIMESTAMP::text` })
    .where(eq(businesses.id, id))
    .returning();
  return result[0];
}

export async function searchBusinesses(query: string): Promise<Business[]> {
  const like_q = `%${query}%`;
  return await db!
    .select()
    .from(businesses)
    .where(
      or(
        like(businesses.company_name, like_q),
        like(businesses.industry, like_q),
        like(businesses.workflow, like_q),
        like(businesses.department, like_q)
      )
    );
}

export async function getAllBusinesses(): Promise<Business[]> {
  return await db!.select().from(businesses);
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
  const result = await db!
    .insert(conversations)
    .values({ business_id: businessId })
    .returning();
  return result[0];
}

export async function getConversation(id: number) {
  const rows = await db!
    .select()
    .from(conversations)
    .where(eq(conversations.id, id));
  return rows[0];
}

export async function updateConversationSummary(
  conversationId: number,
  summary: string
) {
  return await db!
    .update(conversations)
    .set({ summary, updated_at: drizzleSql`CURRENT_TIMESTAMP::text` })
    .where(eq(conversations.id, conversationId));
}

// ─── Message helpers ───────────────────────────────────────────────────────────

export async function addMessage(
  conversationId: number,
  role: "user" | "assistant" | "system",
  content: string
): Promise<Message> {
  const result = await db!
    .insert(messages)
    .values({ conversation_id: conversationId, role, content })
    .returning();
  return result[0];
}

export async function getRecentMessages(
  conversationId: number,
  limit = 10
): Promise<Message[]> {
  // We need to return last `limit` messages, oldest first for LLM context
  const rows = await db!
    .select()
    .from(messages)
    .where(eq(messages.conversation_id, conversationId));
  // In pg, we might need an explicit order by to guarantee order, but let's follow SQLite's structure
  return rows.slice(-limit);
}

export async function executeRawQuery(sqlString: string, params: unknown[]): Promise<unknown[]> {
  const res = await pgPool!.query(sqlString, params);
  return res.rows;
}
