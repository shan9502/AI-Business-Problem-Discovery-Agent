import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// ─── businesses ──────────────────────────────────────────────────────────────
export const businesses = sqliteTable("businesses", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  company_name: text("company_name"),
  industry: text("industry"),
  company_size: text("company_size"),
  department: text("department"),
  workflow: text("workflow"),
  current_process: text("current_process"),
  people_involved: text("people_involved"),
  frequency: text("frequency"),
  time_consumed: text("time_consumed"),
  main_pain: text("main_pain"),
  error_rate: text("error_rate"),
  existing_software: text("existing_software"),
  why_existing_software_fails: text("why_existing_software_fails"),
  ai_opportunity: text("ai_opportunity"),
  automation_opportunity: text("automation_opportunity"),
  estimated_value: text("estimated_value"),
  buyer: text("buyer"),
  decision_maker: text("decision_maker"),
  competition: text("competition"),
  integration_difficulty: text("integration_difficulty"),

  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updated_at: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;

// ─── conversations ────────────────────────────────────────────────────────────
export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  business_id: integer("business_id").references(() => businesses.id),
  summary: text("summary"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updated_at: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export type Conversation = typeof conversations.$inferSelect;

// ─── messages ─────────────────────────────────────────────────────────────────
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversation_id: integer("conversation_id").references(() => conversations.id),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export type Message = typeof messages.$inferSelect;
