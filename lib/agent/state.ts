import { z } from "zod";
import type { Message } from "@/lib/db/schema";

// ─── RoutePlan (Router output contract) ──────────────────────────────────────
/**
 * Structured plan produced by the Router.
 * Tells the graph exactly which agents to invoke and in what order.
 */
export type RouteIntent =
  | "read"             // Reader only
  | "write"            // Writer only
  | "read_write"       // Both — order determined by executionOrder
  | "continue_research"// Resume a session: Reader to summarize, Writer to continue
  | "clarification"    // Ask user to clarify
  | "general";         // Conversational response, no DB

export interface RoutePlan {
  intent: RouteIntent;
  agents: Array<"reader" | "writer">;
  executionOrder: Array<"reader" | "writer">;
  reason: string;
  /** Optional hint for Reader (company name/description to look up) */
  businessHint?: string;
  /** True when this is a write-after-read (e.g., show then update) */
  writerAfterReader?: boolean;
}

// ─── Reader contract ──────────────────────────────────────────────────────────
export type ReaderStatus = "success" | "empty" | "ambiguous" | "error";

export interface ReaderResult {
  status: ReaderStatus;
  /** Markdown-formatted answer for the user */
  markdown?: string;
  /** Business data for Writer to continue with */
  resolvedBusinessId?: number;
  /** Multiple candidates found — needs user selection */
  candidates?: Array<{ id: number; label: string; description?: string }>;
  /** Structured selection UI (when candidates need to be presented) */
  pendingSelection?: PendingSelection;
  /** Error message (user-friendly, no stack traces) */
  errorMessage?: string;
  /** Updated business context after read */
  businessContext?: Record<string, unknown>;
  /** Missing fields (used when Writer follows Reader) */
  missingFields?: string[];
}


// ─── Writer contract ─────────────────────────────────────────────────────────
export type WriterStatus = "created" | "updated" | "needs_input" | "ambiguous" | "complete" | "error";

export interface WriterResult {
  status: WriterStatus;
  /** The response/question to show the user */
  response: string;
  /** Updated business ID */
  businessId?: number;
  /** Updated business context */
  businessContext?: Record<string, unknown>;
  /** Updated missing fields */
  missingFields?: string[];
  /** Next field to ask about */
  nextField?: string;
  /** Suggested answer options for the UI */
  suggestedOptions?: string[];
  /** Pending selection UI (ambiguous business match) */
  pendingSelection?: PendingSelection;
  /** Legacy: single pending match for yes/no */
  pendingBusinessMatch?: { id: number; name: string };
  /** Error message */
  errorMessage?: string;
}

// ─── Resume intent classification ────────────────────────────────────────────
export type ResumeIntent =
  | "what_did_we_learn"   // Reader only — summarize what is known
  | "what_is_missing"     // Reader only — list gaps
  | "continue_research"   // Reader + Writer — summarize then continue asking
  | "identify_problem"    // Reader only — surface the main problem
  | "assess_opportunity"; // Reader only — evaluate opportunity

// ─── Route ────────────────────────────────────────────────────────────────────
/**
 * The route the Router assigns after classifying intent.
 * Determines which agent subgraph(s) are invoked.
 */
export type Route =
  | "read"             // Reader only
  | "write"            // Writer only
  | "read_write"       // Reader then Writer (e.g., resume → continue research)
  | "continue_research"// Synonym for read_write when resuming a session
  | "clarification"    // Neither — ask user to clarify
  | "general";         // General LLM response, no DB access

// ─── Intent ───────────────────────────────────────────────────────────────────
export const IntentEnum = z.enum([
  // New 3-agent intents
  "read",
  "write",
  "read_write",
  "continue_research",
  "clarification",
  "general",
  // Legacy intents (kept for backward compat during transition)
  "discover",
  "update",
  "query",
  "resume",
  "skip",
  "confirm_yes",
  "confirm_no",
]);
export type Intent = z.infer<typeof IntentEnum>;

// ─── Extracted field with confidence metadata ─────────────────────────────────
export interface ExtractedFieldMeta {
  field: string;
  value: string;
  confidence: number;          // 0.0 – 1.0
  certainty: "explicit" | "estimated" | "inferred" | "uncertain";
}

// ─── Pending selection (disambiguation UI) ────────────────────────────────────
export interface SelectionOption {
  id: string;
  label: string;
  description?: string;
}

export interface PendingSelection {
  type: "business" | "confirmation";
  question: string;
  options: SelectionOption[];
}

// ─── Graph State ──────────────────────────────────────────────────────────────
export interface BusinessObserverState {
  // ── Session / Identity ─────────────────────────────────────────────────────
  sessionId?: string;           // browser-generated, persisted in localStorage
  userMessage: string;
  inputMode?: "text" | "voice"; // analytics/debugging only
  conversationId?: number;
  businessId?: number;          // activeBusinessId

  // ── Routing ─────────────────────────────────────────────────────────────────────
  intent?: Intent;
  route?: Route;
  routeReason?: string;         // Router's reasoning (for observability)
  /** Full structured route plan from Router */
  routePlan?: RoutePlan;


  // ── Business context ───────────────────────────────────────────────────────
  businessContext?: Record<string, unknown>;
  conversationSummary?: string;
  recentMessages?: Message[];

  // ── Writer state ───────────────────────────────────────────────────────────
  extractedFields?: Record<string, string | null>;
  extractedFieldsWithMeta?: ExtractedFieldMeta[];
  missingFields?: string[];
  prioritizedFields?: string[];
  askedFields?: string[];
  skippedFields?: string[];
  problemSignals?: string[];
  automationSignals?: string[];
  integrationSignals?: string[];
  aiSignals?: string[];
  evidence?: string[];
  opportunityAssessment?: string;
  nextField?: string;
  nextQuestion?: string;

  // ── Reader state ───────────────────────────────────────────────────────────
  querySpecification?: unknown;
  generatedSql?: string;
  sqlParameters?: unknown[];
  sqlResult?: unknown;
  sqlError?: string;
  retryCount: number;
  analysisResult?: unknown;     // post-SQL validated + analysed result
  responseMarkdown?: string;    // Reader's formatted Markdown output

  // ── Response ───────────────────────────────────────────────────────────────
  finalResponse?: string;
  suggestedOptions?: string[];

  // ── Agent results (structured output boundaries) ──────────────────────────────
  readerResult?: ReaderResult;
  writerResult?: WriterResult;

  // ── Disambiguation UI ────────────────────────────────────────────────────────────────
  pendingSelection?: PendingSelection;
  /** Legacy: single pending match for simple yes/no confirmation */
  pendingBusinessMatch?: { id: number; name: string };
}

// ─── Zod schema for RoutePlan (Router output) ──────────────────────────────────────────
export const RoutePlanSchema = z.object({
  intent: z.enum(["read", "write", "read_write", "continue_research", "clarification", "general"]),
  agents: z.array(z.enum(["reader", "writer"])),
  executionOrder: z.array(z.enum(["reader", "writer"])),
  reason: z.string(),
  businessHint: z.string().optional(),
  writerAfterReader: z.boolean().optional(),
});

/** @deprecated Use RoutePlanSchema instead */
export const RouterOutputSchema = RoutePlanSchema;
export type RouterOutput = RoutePlan;


// ─── Zod schema for intent output (legacy / fallback) ────────────────────────
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

// ─── Strongly-typed QuerySpec ─────────────────────────────────────────────────
export const QueryFilterSchema = z.object({
  field: z.string(),
  operator: z.enum(["=", "!=", "LIKE", ">", "<", ">=", "<="]),
  value: z.string(),
});

export const QuerySpecSchema = z.object({
  intent: z.enum(["search", "aggregate", "filter", "sort", "count", "comparison"]),
  filters: z.array(QueryFilterSchema).optional(),
  fields: z.array(z.string()).optional(),
  groupBy: z.array(z.string()).optional(),
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

// ─── Read type classifier ─────────────────────────────────────────────────────
export const ReadTypeSchema = z.object({
  readType: z.enum(["simple", "sql", "analysis", "resume"]),
  reason: z.string().optional(),
});
export type ReadType = z.infer<typeof ReadTypeSchema>["readType"];
