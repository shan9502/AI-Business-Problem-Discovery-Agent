/**
 * lib/agent/agents/router.ts
 *
 * Router Agent — Entry point for every user message.
 *
 * Responsibility:
 *   Decide WHAT the user wants and WHICH agent(s) should handle it,
 *   and in WHAT ORDER. Produces a structured RoutePlan.
 *
 * Uses: GEMINI_MODEL (from .env)
 * Does NOT execute database operations.
 */

import { callGeminiStructured } from "@/lib/ai/gemini";
import { buildCapabilitySummary } from "@/lib/agent/capabilities";
import { agentLog } from "@/lib/agent/logger";
import { RoutePlanSchema, type BusinessObserverState, type RoutePlan } from "../state";

const CAPABILITIES_SUMMARY = buildCapabilitySummary();

function buildRouterPrompt(state: BusinessObserverState): string {
  const recentContext = (state.recentMessages ?? [])
    .slice(-5)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const businessContext = state.businessContext
    ? Object.entries(state.businessContext)
        .filter(([k, v]) => v && !["id", "created_at", "updated_at"].includes(k))
        .slice(0, 8)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n")
    : null;

  const pendingMatch = state.pendingBusinessMatch
    ? `\n⚠ PENDING CONFIRMATION: System asked whether to continue with "${state.pendingBusinessMatch.name}".`
    : "";

  const pendingSelection = state.pendingSelection
    ? `\n⚠ PENDING SELECTION: ${state.pendingSelection.question} — options: ${state.pendingSelection.options.map((o) => o.label).join(", ")}`
    : "";

  return `You are the Routing Agent for the Business Observer — an AI Business Problem Discovery Engine.

Your job: Classify the user's intent and produce a structured RoutePlan.

## Agent capabilities:

${CAPABILITIES_SUMMARY}

## RoutePlan schema you must produce:
{
  "intent": "read" | "write" | "read_write" | "continue_research" | "clarification" | "general",
  "agents": ["reader"] | ["writer"] | ["reader", "writer"],
  "executionOrder": ["reader"] | ["writer"] | ["reader", "writer"] | ["writer", "reader"],
  "reason": "brief explanation",
  "businessHint": "company name or description (if known)",
  "writerAfterReader": true | false
}

## Intent → RoutePlan mapping rules:
- "read"             → agents: ["reader"],  executionOrder: ["reader"]
- "write"            → agents: ["writer"],  executionOrder: ["writer"]
- "continue_research"→ agents: ["reader", "writer"], executionOrder: ["reader", "writer"]
- "read_write"       → depends on what user wants FIRST:
    "Show me X and update frequency" → executionOrder: ["reader", "writer"]
    "Update X and show me the updated record" → executionOrder: ["writer", "reader"]
- "clarification"    → agents: [], executionOrder: []
- "general"          → agents: [], executionOrder: []

## Current context:
${state.conversationSummary ? `Conversation summary: ${state.conversationSummary}\n` : ""}
${businessContext ? `Active business:\n${businessContext}\n` : "No business currently active.\n"}
Recent messages:
${recentContext || "(none)"}
${pendingMatch}
${pendingSelection}

Current user message: "${state.userMessage}"

## Routing examples:
- "Where did we stop with ABC?" → continue_research, ["reader", "writer"]
- "Show me ABC" → read, ["reader"]
- "Which companies use Excel?" → read, ["reader"]
- "I spoke with their manager, they have 70 employees..." → write, ["writer"]
- "Actually it's 200 orders/day" → write, ["writer"]
- "Show me ABC and update its frequency to 200/day" → read_write, executionOrder: ["reader", "writer"]
- "Update ABC's frequency to 200/day, then show me the updated record" → read_write, executionOrder: ["writer", "reader"]
- Pending yes/no confirmation → write, ["writer"]
- "Hello" or general question → general, []

Include businessHint if the user references a specific company or business.
Return ONLY valid JSON matching the RoutePlan schema.`;
}

export async function routerAgent(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const start = Date.now();

  let plan: RoutePlan;
  try {
    plan = await callGeminiStructured(
      buildRouterPrompt(state),
      RoutePlanSchema,
      "route_plan"
    );
  } catch (err) {
    // Router LLM failure → safe fallback: ask user to clarify
    agentLog({
      agent: "Router",
      tool: "routerAgent",
      note: `Router failed, falling back to clarification: ${String(err).slice(0, 80)}`,
    });
    plan = {
      intent: "clarification",
      agents: [],
      executionOrder: [],
      reason: "Router classification failed.",
    };
  }

  agentLog({
    agent: "Router",
    tool: "routerAgent",
    intent: plan.intent,
    route: plan.executionOrder.join("→"),
    conversationId: state.conversationId,
    businessId: state.businessId,
    sessionId: state.sessionId,
    latency: Date.now() - start,
    note: plan.reason,
  });

  return {
    routePlan: plan,
    intent: plan.intent as BusinessObserverState["intent"],
    route: plan.intent as BusinessObserverState["route"],
    routeReason: plan.reason,
  };
}
