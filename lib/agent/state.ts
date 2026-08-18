import { z } from "zod";
import type { Message } from "@/lib/db/schema";

// ─── Intent ───────────────────────────────────────────────────────────────────
export const IntentEnum = z.enum([
  "discover",
  "update",
  "query",
  "resume",
  "skip",
  "general",
  "confirm_yes",    // user confirmed a duplicate match
  "confirm_no",     // user rejected a duplicate match
]);
export type Intent = z.infer<typeof IntentEnum>;

// ─── Extracted field with confidence metadata ─────────────────────────────────
export interface ExtractedFieldMeta {
  field: string;
  value: string;
  confidence: number;          // 0.0 – 1.0
  certainty: "explicit" | "estimated" | "inferred" | "uncertain";
}

// ─── Graph State ──────────────────────────────────────────────────────────────
export interface BusinessObserverState {
  userMessage: string;
  conversationId?: number;
  businessId?: number;
  intent?: Intent;
  businessContext?: Record<string, unknown>;
  extractedFields?: Record<string, string | null>;
  extractedFieldsWithMeta?: ExtractedFieldMeta[];   // #7: confidence tracking
  missingFields?: string[];
  prioritizedFields?: string[];
  askedFields?: string[];           // #10: track what has been asked
  skippedFields?: string[];         // #10: track what user skipped
  problemSignals?: string[];
  automationSignals?: string[];
  integrationSignals?: string[];
  aiSignals?: string[];
  evidence?: string[];
  opportunityAssessment?: string;
  conversationSummary?: string;
  recentMessages?: Message[];
  querySpecification?: unknown;
  generatedSql?: string;
  sqlParameters?: unknown[];
  sqlResult?: unknown;
  sqlError?: string;
  retryCount: number;
  nextField?: string;
  nextQuestion?: string;
  finalResponse?: string;
  pendingBusinessMatch?: { id: number; name: string };  // #12: duplicate confirmation
}

// ─── Zod schema for structured intent output ─────────────────────────────────
export const IntentOutputSchema = z.object({
  intent: IntentEnum,
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().optional(),
});

// ─── Zod schema for SQL generation output ────────────────────────────────────
export const SqlOutputSchema = z.object({
  sql: z.string(),
  parameters: z.array(z.any()).default([]),
});

// ─── Strongly-typed QuerySpec — #5 ───────────────────────────────────────────
// Uses z.array(z.object()) instead of z.record() to be Gemini-compatible
export const QueryFilterSchema = z.object({
  field: z.string(),
  operator: z.enum(["=", "!=", "LIKE", ">", "<", ">=", "<="]),
  value: z.string(),
});

export const QuerySpecSchema = z.object({
  intent: z.enum(["search", "aggregate", "filter", "sort", "count"]),
  filters: z.array(QueryFilterSchema).optional(),
  fields: z.array(z.string()).optional(),
  sort: z
    .object({
      field: z.string(),
      direction: z.enum(["asc", "desc"]),
    })
    .optional(),
  limit: z.number().optional(),
});
export type QuerySpec = z.infer<typeof QuerySpecSchema>;
export type QueryFilter = z.infer<typeof QueryFilterSchema>;
