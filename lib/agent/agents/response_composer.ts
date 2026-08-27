/**
 * lib/agent/agents/response_composer.ts
 *
 * Response Composer — Deterministic final response assembly.
 *
 * Rules (in order — no LLM call unless genuinely needed):
 *
 * 1. Reader only          → return Reader markdown directly
 * 2. Writer only          → return Writer response/question directly
 * 3. Reader then Writer   → return Writer question (+ Reader context prepended if brief)
 * 4. Writer then Reader   → return Reader markdown
 * 5. Multi-agent synthesis → Gemini call only when responses need to be combined
 * 6. Clarification        → deterministic clarification message
 * 7. General              → deterministic general response (from Writer if it ran)
 *
 * This ensures the system remains efficient (no extra LLM call on most paths).
 */

import { callGemini } from "@/lib/ai/gemini";
import { agentLog } from "@/lib/agent/logger";
import type {
  BusinessObserverState,
  ReaderResult,
  WriterResult,
} from "../state";

const CLARIFICATION_RESPONSE =
  "I'm not sure I understood that. Could you clarify what you'd like to do? " +
  "For example: share new business information, ask a question about existing records, or continue a previous conversation.";

export async function responseComposer(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const plan = state.routePlan;
  const reader = state.readerResult;
  const writer = state.writerResult;
  const start = Date.now();

  agentLog({
    agent: "Composer",
    tool: "responseComposer",
    intent: plan?.intent,
    route: plan?.executionOrder?.join("→"),
    conversationId: state.conversationId,
  });

  // ── Pending selection (disambiguation UI) ────────────────────────────────
  if (state.pendingSelection || writer?.pendingSelection || reader?.candidates) {
    const selection =
      state.pendingSelection ?? writer?.pendingSelection;
    if (selection) {
      const finalResponse =
        reader?.markdown ??
        writer?.response ??
        selection.question ??
        "Which business did you mean?";
      agentLog({ agent: "Composer", tool: "responseComposer", note: "pendingSelection", latency: Date.now() - start });
      return {
        finalResponse,
        pendingSelection: selection,
        suggestedOptions: writer?.suggestedOptions ?? [],
      };
    }
  }

  // ── Clarification ─────────────────────────────────────────────────────────
  if (!plan || plan.intent === "clarification") {
    agentLog({ agent: "Composer", note: "clarification" });
    return { finalResponse: CLARIFICATION_RESPONSE, suggestedOptions: [] };
  }

  const order = plan.executionOrder;

  // ── Reader only ───────────────────────────────────────────────────────────
  if (order.length === 1 && order[0] === "reader") {
    const finalResponse = readerMarkdown(reader) ?? CLARIFICATION_RESPONSE;
    agentLog({ agent: "Composer", note: "reader-only", latency: Date.now() - start });
    return { finalResponse, suggestedOptions: [] };
  }

  // ── Writer only ───────────────────────────────────────────────────────────
  if (order.length === 1 && order[0] === "writer") {
    const finalResponse = writerResponse(writer) ?? CLARIFICATION_RESPONSE;
    agentLog({ agent: "Composer", note: "writer-only", latency: Date.now() - start });
    return {
      finalResponse,
      suggestedOptions: writer?.suggestedOptions ?? [],
      pendingBusinessMatch: writer?.pendingBusinessMatch,
    };
  }

  // ── Reader then Writer (e.g., resume/continue_research or show-then-update) ─
  if (order[0] === "reader" && order[1] === "writer") {
    // Reader provides progress context, Writer provides the next question
    const readerMd = readerMarkdown(reader);
    const writerQ = writerResponse(writer);

    if (readerMd && writerQ) {
      // Prepend brief Reader context only if it's short — no extra LLM call
      if (readerMd.length < 400) {
        const finalResponse = `${readerMd}\n\n---\n\n${writerQ}`;
        agentLog({ agent: "Composer", note: "reader+writer combined (no LLM)", latency: Date.now() - start });
        return { finalResponse, suggestedOptions: writer?.suggestedOptions ?? [] };
      }
      // Reader response is long — LLM synthesis needed
      return synthesize(state, readerMd, writerQ, start);
    }
    // Fallback: return whichever we have
    const finalResponse = readerMd ?? writerQ ?? CLARIFICATION_RESPONSE;
    return { finalResponse, suggestedOptions: writer?.suggestedOptions ?? [] };
  }

  // ── Writer then Reader (update-then-show) ─────────────────────────────────
  if (order[0] === "writer" && order[1] === "reader") {
    const writerStatus = writerResponse(writer);
    const readerMd = readerMarkdown(reader);

    if (writerStatus && readerMd) {
      // Brief write acknowledgment + full Reader result
      const writeAck = writerStatus.length < 200 ? `${writerStatus}\n\n---\n\n` : "";
      const finalResponse = `${writeAck}${readerMd}`;
      agentLog({ agent: "Composer", note: "writer+reader combined (no LLM)", latency: Date.now() - start });
      return { finalResponse, suggestedOptions: [] };
    }
    const finalResponse = readerMd ?? writerStatus ?? CLARIFICATION_RESPONSE;
    return { finalResponse, suggestedOptions: [] };
  }

  // ── General / fallback ────────────────────────────────────────────────────
  const finalResponse =
    writerResponse(writer) ??
    readerMarkdown(reader) ??
    CLARIFICATION_RESPONSE;

  agentLog({ agent: "Composer", note: "fallback", latency: Date.now() - start });
  return { finalResponse, suggestedOptions: writer?.suggestedOptions ?? [] };
}

// ─── Synthesis (only called when responses genuinely need merging) ─────────────

async function synthesize(
  state: BusinessObserverState,
  readerMd: string,
  writerQ: string,
  start: number
): Promise<Partial<BusinessObserverState>> {
  agentLog({ agent: "Composer", note: "LLM synthesis required (multi-agent results)" });

  const prompt = `You are a business research assistant combining two pieces of information.

Research summary:
${readerMd}

Next question to continue:
${writerQ}

Write a natural response that:
1. Presents the research summary first
2. Then smoothly transitions to the next question
3. Does NOT duplicate information
4. Keeps the total response concise (under 300 words)

Respond in Markdown.`;

  try {
    const finalResponse = await callGemini(prompt);
    agentLog({ agent: "Composer", tool: "synthesize", latency: Date.now() - start });
    return { finalResponse, suggestedOptions: state.writerResult?.suggestedOptions ?? [] };
  } catch {
    // Fallback to concatenation
    return { finalResponse: `${readerMd}\n\n---\n\n${writerQ}`, suggestedOptions: [] };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readerMarkdown(reader?: ReaderResult): string | undefined {
  if (!reader) return undefined;
  if (reader.status === "error") return reader.errorMessage ?? reader.markdown;
  if (reader.status === "empty") return reader.markdown;
  if (reader.status === "success") return reader.markdown;
  return reader.markdown;
}

function writerResponse(writer?: WriterResult): string | undefined {
  return writer?.response || undefined;
}
