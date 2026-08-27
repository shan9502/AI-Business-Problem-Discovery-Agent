/**
 * lib/agent/agents/reader/index.ts
 *
 * Reader Agent — Orchestrates all read operations.
 *
 * Entry point: receives state from the Router.
 * Returns a structured ReaderResult.
 *
 * Flow:
 *   classify read type
 *   ├── simple → typed tools (getBusiness / searchBusinesses)
 *   ├── sql    → QuerySpec → SQL → validate → execute → format
 *   ├── analysis → QuerySpec → SQL → validate → execute → data_validator → data_analyst
 *   └── resume → resume.ts (intent-aware)
 */

import { agentLog } from "@/lib/agent/logger";
import { getBusinessById } from "@/lib/db/queries";
import type { BusinessObserverState, ReaderResult } from "../../state";
import { classifyReadType } from "./classify";
import {
  resolveBusinessReference,
  getBusinessSummaryMarkdown,
  getMissingFieldsSummaryMarkdown,
} from "./simple_tools";
import { buildQuerySpec } from "./query_planner";
import { executeWithRetry } from "./sql_executor";
import { validateSqlResult } from "./data_validator";
import { analyzeData } from "./data_analyst";
import { resumeResearch } from "./resume";
import { callGemini } from "@/lib/ai/gemini";

export interface ReaderAgentOutput {
  readerResult: ReaderResult;
  /** Set to true when resume detected that Writer should continue */
  needsWriter?: boolean;
  /** Updated state fields to merge back */
  stateUpdates: Partial<BusinessObserverState>;
}

export async function readerAgent(
  state: BusinessObserverState
): Promise<ReaderAgentOutput> {
  const start = Date.now();

  // ── 1. Classify what kind of read this is ──────────────────────────────────
  const readType = await classifyReadType(state);

  agentLog({
    agent: "Reader",
    tool: "readerAgent",
    note: `readType=${readType}`,
    conversationId: state.conversationId,
  });

  // ── 2. Handle by read type ────────────────────────────────────────────────

  // RESUME
  if (readType === "resume" || state.routePlan?.intent === "continue_research") {
    const { readerResult, needsWriter } = await resumeResearch(state);

    const stateUpdates: Partial<BusinessObserverState> = {
      readerResult,
      responseMarkdown: readerResult.markdown,
    };
    if (readerResult.resolvedBusinessId) {
      stateUpdates.businessId = readerResult.resolvedBusinessId;
      stateUpdates.businessContext = readerResult.businessContext;
      stateUpdates.missingFields = readerResult.missingFields;
    }
    if (readerResult.pendingSelection ?? readerResult.candidates) {
      stateUpdates.pendingSelection = readerResult.candidates
        ? {
            type: "business",
            question: readerResult.markdown ?? "Which business?",
            options: readerResult.candidates.map((c) => ({
              id: String(c.id),
              label: c.label,
              description: c.description,
            })),
          }
        : undefined;
    }

    agentLog({ agent: "Reader", tool: "readerAgent", note: `resume complete, needsWriter=${needsWriter}`, latency: Date.now() - start });
    return { readerResult, needsWriter, stateUpdates };
  }

  // SIMPLE READ
  if (readType === "simple") {
    return handleSimpleRead(state, start);
  }

  // SQL or ANALYSIS
  return handleSqlRead(state, readType, start);
}

// ─── Simple read handler ──────────────────────────────────────────────────────

async function handleSimpleRead(
  state: BusinessObserverState,
  start: number
): Promise<ReaderAgentOutput> {
  // Check for missing-fields request
  const askingMissing = /missing|what.*left|not.*know|incomplete|gaps/i.test(state.userMessage);
  if (askingMissing && state.businessContext) {
    const markdown = getMissingFieldsSummaryMarkdown(state);
    const result: ReaderResult = { status: "success", markdown };
    agentLog({ agent: "Reader", tool: "simple:getMissingFields", latency: Date.now() - start });
    return { readerResult: result, stateUpdates: { readerResult: result, responseMarkdown: markdown } };
  }

  // Resolve business
  const resolved = await resolveBusinessReference(state);

  if (resolved.noMatch) {
    const result: ReaderResult = {
      status: "empty",
      markdown: `I couldn't find a business matching: "${state.userMessage}". Try providing more details or the company name.`,
    };
    return { readerResult: result, stateUpdates: { readerResult: result, responseMarkdown: result.markdown } };
  }

  if (resolved.candidates && resolved.candidates.length > 0) {
    const result: ReaderResult = {
      status: "ambiguous",
      markdown: "I found multiple businesses that could match. Which one did you mean?",
      candidates: resolved.candidates.map((c) => ({ id: c.id, label: c.company_name })),
    };
    const stateUpdates: Partial<BusinessObserverState> = {
      readerResult: result,
      pendingSelection: {
        type: "business",
        question: "Which business did you mean?",
        options: resolved.candidates.map((c) => ({ id: String(c.id), label: c.company_name })),
      },
    };
    agentLog({ agent: "Reader", tool: "simple:ambiguous", note: `${resolved.candidates.length} candidates` });
    return { readerResult: result, stateUpdates };
  }

  // Single resolved business
  const businessId = resolved.resolvedId!;
  const markdown = await getBusinessSummaryMarkdown(businessId, state.userMessage);
  const biz = await getBusinessById(businessId);

  const result: ReaderResult = {
    status: "success",
    markdown,
    resolvedBusinessId: businessId,
    businessContext: biz as unknown as Record<string, unknown>,
  };

  agentLog({ agent: "Reader", tool: "simple:getBusiness", dbOp: "SELECT", businessId, latency: Date.now() - start });
  return {
    readerResult: result,
    stateUpdates: {
      readerResult: result,
      responseMarkdown: markdown,
      businessId,
      businessContext: biz as unknown as Record<string, unknown>,
    },
  };
}

// ─── SQL + Analysis handler ───────────────────────────────────────────────────

async function handleSqlRead(
  state: BusinessObserverState,
  readType: "sql" | "analysis",
  start: number
): Promise<ReaderAgentOutput> {

  // 1. Build QuerySpec
  const planUpdates = await buildQuerySpec(state);
  const stateWithSpec = { ...state, ...planUpdates };

  // 2. Execute SQL with retry
  const execUpdates = await executeWithRetry(stateWithSpec);

  if (execUpdates.sqlError) {
    const errorMsg = execUpdates.sqlError.startsWith("Database infrastructure")
      ? "The database is temporarily unavailable. Please try again later."
      : "I wasn't able to complete that query. Please try rephrasing your question.";

    const result: ReaderResult = { status: "error", errorMessage: errorMsg, markdown: errorMsg };
    return {
      readerResult: result,
      stateUpdates: { ...planUpdates, ...execUpdates, readerResult: result, responseMarkdown: errorMsg },
    };
  }

  const rawResult = execUpdates.sqlResult;
  const rows = Array.isArray(rawResult) ? rawResult : [];

  // 3. Validate data
  const validation = validateSqlResult(rawResult, state.userMessage);

  if (validation.status === "empty") {
    const markdown = `No matching records found for your query. ${validation.message ?? ""}`;
    const result: ReaderResult = { status: "empty", markdown };
    return {
      readerResult: result,
      stateUpdates: { ...planUpdates, ...execUpdates, readerResult: result, responseMarkdown: markdown },
    };
  }

  // 4. Analysis vs simple SQL response
  let markdown: string;

  if (readType === "analysis" || validation.status === "null_heavy") {
    // Data Analyst path
    markdown = await analyzeData({
      userMessage: state.userMessage,
      validatedRows: rows,
      rowCount: validation.rowCount,
      isNullHeavy: validation.status === "null_heavy",
    });
  } else {
    // Simple SQL response — format with Gemini but without full analysis overhead
    const rowCount = validation.rowCount;
    const prompt = `You are a business intelligence assistant answering a research question.

User asked: "${state.userMessage}"

Database returned ${rowCount} result(s):
${JSON.stringify(rows.slice(0, 100), null, 2)}

Format your response in Markdown:
- Use a numbered list for a list of companies.
- Use a Markdown table if results have multiple meaningful columns.
- Use ## headings to organize longer responses.
- If empty, clearly state no records matched.
- NEVER mention SQL, column names, or database internals.
- Be concise and analytical.`;

    markdown = await callGemini(prompt);
  }

  agentLog({ agent: "Reader", tool: "readerAgent", note: `${readType} done`, rows: validation.rowCount, latency: Date.now() - start });

  const result: ReaderResult = { status: "success", markdown };
  return {
    readerResult: result,
    stateUpdates: { ...planUpdates, ...execUpdates, readerResult: result, responseMarkdown: markdown },
  };
}
