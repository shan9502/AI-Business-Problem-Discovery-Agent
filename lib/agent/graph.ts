/**
 * lib/agent/graph.ts
 *
 * Top-Level LangGraph — 3-Agent Architecture
 *
 * Structure:
 *   START
 *    ↓
 *   loadContext      (load conversation + business from DB)
 *    ↓
 *   routerNode       (Router Agent → produces RoutePlan)
 *    ↓
 *   [conditional dispatch based on RoutePlan.executionOrder]
 *    ├── readerNode  (Reader Agent)
 *    ├── writerNode  (Writer Agent)
 *    ├── reader → writer (continue_research / read_write)
 *    ├── writer → reader (write-then-show)
 *    └── clarifyNode (deterministic — no agent)
 *    ↓
 *   composeResponse  (deterministic response composer)
 *    ↓
 *   END
 *
 * Persistence:
 *   SQLite via Drizzle = durable source of truth
 *   MemorySaver = within-session execution cache only
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import type {
  BusinessObserverState,
  Intent,
  ExtractedFieldMeta,
  RoutePlan,
  ReaderResult,
  WriterResult,
  PendingSelection,
} from "./state";
import type { Message } from "@/lib/db/schema";

// ── Node imports ──────────────────────────────────────────────────────────────
import { loadContext } from "./nodes/context";
import { routerAgent } from "./agents/router";
import { readerAgent } from "./agents/reader/index";
import { writerAgent } from "./agents/writer/index";
import { responseComposer } from "./agents/response_composer";
import { agentLog } from "./logger";
import { addMessage, getConversation } from "@/lib/db/queries";
import { callGemini } from "@/lib/ai/gemini";

// ─── Annotated State ──────────────────────────────────────────────────────────

const GraphState = Annotation.Root({
  // Identity
  sessionId:               Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  userMessage:             Annotation<string>({ reducer: (a, b) => b ?? a, default: () => "" }),
  inputMode:               Annotation<"text" | "voice" | undefined>({ reducer: (a, b) => b ?? a }),
  conversationId:          Annotation<number | undefined>({ reducer: (a, b) => b ?? a }),
  businessId:              Annotation<number | undefined>({ reducer: (a, b) => b ?? a }),

  // Routing
  intent:                  Annotation<Intent | undefined>({ reducer: (a, b) => b ?? a }),
  route:                   Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  routeReason:             Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  routePlan:               Annotation<RoutePlan | undefined>({ reducer: (a, b) => b ?? a }),

  // Business context
  businessContext:         Annotation<Record<string, unknown> | undefined>({ reducer: (a, b) => b ?? a }),
  conversationSummary:     Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  recentMessages:          Annotation<Message[] | undefined>({ reducer: (a, b) => b ?? a }),

  // Writer state
  extractedFields:         Annotation<Record<string, string | null> | undefined>({ reducer: (a, b) => b ?? a }),
  extractedFieldsWithMeta: Annotation<ExtractedFieldMeta[] | undefined>({ reducer: (a, b) => b ?? a }),
  missingFields:           Annotation<string[] | undefined>({ reducer: (a, b) => b ?? a }),
  prioritizedFields:       Annotation<string[] | undefined>({ reducer: (a, b) => b ?? a }),
  askedFields:             Annotation<string[] | undefined>({ reducer: (a, b) => b ?? a }),
  skippedFields:           Annotation<string[]>({ reducer: (a, b) => b ?? a ?? [] }),
  problemSignals:          Annotation<string[]>({ reducer: (a, b) => b ?? a ?? [] }),
  automationSignals:       Annotation<string[]>({ reducer: (a, b) => b ?? a ?? [] }),
  integrationSignals:      Annotation<string[]>({ reducer: (a, b) => b ?? a ?? [] }),
  aiSignals:               Annotation<string[]>({ reducer: (a, b) => b ?? a ?? [] }),
  evidence:                Annotation<string[]>({ reducer: (a, b) => b ?? a ?? [] }),
  opportunityAssessment:   Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  nextField:               Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  nextQuestion:            Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),

  // Reader state
  querySpecification:      Annotation<unknown>({ reducer: (a, b) => b ?? a }),
  generatedSql:            Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  sqlParameters:           Annotation<unknown[] | undefined>({ reducer: (a, b) => b ?? a }),
  sqlResult:               Annotation<unknown>({ reducer: (a, b) => b ?? a }),
  sqlError:                Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  retryCount:              Annotation<number>({ reducer: (a, b) => b ?? a, default: () => 0 }),
  analysisResult:          Annotation<unknown>({ reducer: (a, b) => b ?? a }),
  responseMarkdown:        Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),

  // Agent results (strict contracts)
  readerResult:            Annotation<ReaderResult | undefined>({ reducer: (a, b) => b ?? a }),
  writerResult:            Annotation<WriterResult | undefined>({ reducer: (a, b) => b ?? a }),

  // Response
  finalResponse:           Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  suggestedOptions:        Annotation<string[]>({ reducer: (a, b) => b ?? a ?? [] }),

  // Disambiguation
  pendingSelection:        Annotation<PendingSelection | undefined>({ reducer: (a, b) => b ?? a }),
  pendingBusinessMatch:    Annotation<{ id: number; name: string } | undefined>({ reducer: (a, b) => b ?? a }),
});

// ─── Node wrappers ────────────────────────────────────────────────────────────

async function routerNode(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  return routerAgent(state);
}

async function readerNode(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const { readerResult, needsWriter, stateUpdates } = await readerAgent(state);
  return {
    ...stateUpdates,
    // Signal that Writer should run after Reader (for resume/continue_research)
    // by updating the route if needed
    route: needsWriter ? "read_write" : state.route,
  };
}

async function writerNode(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const { writerResult, stateUpdates } = await writerAgent(state);
  return stateUpdates;
}

async function composeNode(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  return responseComposer(state);
}

async function clarifyNode(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  agentLog({ agent: "Router", tool: "clarifyNode", note: "generating clarification" });
  const prompt = `You are a friendly business research assistant.
The user said: "${state.userMessage}"
You are not sure what they want. Ask for clarification in 1–2 sentences.
Be helpful — give examples of what they could ask for.
Do NOT mention database fields or internal terms.`;
  const response = await callGemini(prompt);
  return { finalResponse: response };
}

async function generalNode(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  agentLog({ agent: "System", tool: "generalNode" });
  const prompt = `You are a helpful business research assistant.
User said: "${state.userMessage}"
Respond helpfully and briefly. Do not mention database fields or internal terms.`;
  const response = await callGemini(prompt);
  // Save to conversation if one exists
  if (state.conversationId) {
    await addMessage(state.conversationId, "user", state.userMessage).catch(() => {});
    await addMessage(state.conversationId, "assistant", response).catch(() => {});
  }
  return { finalResponse: response };
}

// ─── Routing functions ──────────────────────────────────────────────────────────────

type NextNode =
  | "readerNode"
  | "writerNode"
  | "clarifyNode"
  | "generalNode"
  | "composeNode";

// LangGraph passes its own StateType which differs from our BusinessObserverState interface.
// Using a looser type here avoids TS errors from the channel/annotation system.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function routeAfterRouter(state: any): NextNode {
  const plan = state.routePlan as RoutePlan | undefined;
  if (!plan || plan.intent === "clarification") return "clarifyNode";
  if (plan.intent === "general") return "generalNode";

  const first = plan.executionOrder[0];
  if (!first) return "clarifyNode";

  return first === "reader" ? "readerNode" : "writerNode";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function routeAfterReader(state: any): NextNode {
  const plan = state.routePlan as RoutePlan | undefined;
  if (!plan) return "composeNode";

  const order = plan.executionOrder;
  const readerIdx = order.indexOf("reader");
  const nextAgent = order[readerIdx + 1];

  // Resume: Reader set needsWriter via route="read_write"
  if (state.route === "read_write" && order.indexOf("writer") > readerIdx) {
    return "writerNode";
  }

  if (nextAgent === "writer") return "writerNode";
  return "composeNode";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function routeAfterWriter(state: any): NextNode {
  const plan = state.routePlan as RoutePlan | undefined;
  if (!plan) return "composeNode";

  const order = plan.executionOrder;
  const writerIdx = order.indexOf("writer");
  const nextAgent = order[writerIdx + 1];

  if (nextAgent === "reader") return "readerNode";
  return "composeNode";
}


// ─── Build graph ──────────────────────────────────────────────────────────────

const checkpointer = new MemorySaver();

const graph = new StateGraph(GraphState)
  .addNode("loadContext",  loadContext)
  .addNode("routerNode",   routerNode)
  .addNode("readerNode",   readerNode)
  .addNode("writerNode",   writerNode)
  .addNode("clarifyNode",  clarifyNode)
  .addNode("generalNode",  generalNode)
  .addNode("composeNode",  composeNode)

  .addEdge(START, "loadContext")
  .addEdge("loadContext", "routerNode")

  .addConditionalEdges("routerNode", routeAfterRouter, {
    readerNode:  "readerNode",
    writerNode:  "writerNode",
    clarifyNode: "clarifyNode",
    generalNode: "generalNode",
    composeNode: "composeNode",
  })

  .addConditionalEdges("readerNode", routeAfterReader, {
    writerNode:  "writerNode",
    composeNode: "composeNode",
  })

  .addConditionalEdges("writerNode", routeAfterWriter, {
    readerNode:  "readerNode",
    composeNode: "composeNode",
  })

  .addEdge("clarifyNode",  END)
  .addEdge("generalNode",  END)
  .addEdge("composeNode",  END);

export const compiledGraph = graph.compile({ checkpointer });

// ─── Public invoke helper ──────────────────────────────────────────────────────

export async function runAgent(
  userMessage: string,
  conversationId?: number,
  businessId?: number,
  askedFields?: string[],
  skippedFields?: string[],
  problemSignals?: string[],
  automationSignals?: string[],
  integrationSignals?: string[],
  aiSignals?: string[],
  evidence?: string[],
  opportunityAssessment?: string,
  inputMode?: "text" | "voice",
  sessionId?: string
): Promise<{
  finalResponse: string;
  conversationId?: number;
  businessId?: number;
  missingFields?: string[];
  askedFields?: string[];
  skippedFields?: string[];
  problemSignals?: string[];
  automationSignals?: string[];
  integrationSignals?: string[];
  aiSignals?: string[];
  evidence?: string[];
  opportunityAssessment?: string;
  inputMode?: "text" | "voice";
  suggestedOptions?: string[];
  pendingSelection?: PendingSelection;
  pendingBusinessMatch?: { id: number; name: string };
}> {
  const threadId = conversationId
    ? `conv-${conversationId}`
    : `new-${Date.now()}`;

  const initialState: BusinessObserverState = {
    userMessage,
    sessionId,
    conversationId,
    businessId,
    retryCount: 0,
    askedFields:          askedFields  ?? [],
    skippedFields:        skippedFields ?? [],
    problemSignals:       problemSignals ?? [],
    automationSignals:    automationSignals ?? [],
    integrationSignals:   integrationSignals ?? [],
    aiSignals:            aiSignals ?? [],
    evidence:             evidence ?? [],
    opportunityAssessment,
    inputMode,
  };

  const result = await compiledGraph.invoke(initialState, {
    configurable: { thread_id: threadId },
  });

  return {
    finalResponse:        result.finalResponse ?? "I'm sorry, something went wrong.",
    conversationId:       result.conversationId,
    businessId:           result.businessId,
    missingFields:        result.missingFields,
    askedFields:          result.askedFields,
    skippedFields:        result.skippedFields,
    problemSignals:       result.problemSignals,
    automationSignals:    result.automationSignals,
    integrationSignals:   result.integrationSignals,
    aiSignals:            result.aiSignals,
    evidence:             result.evidence,
    opportunityAssessment:result.opportunityAssessment,
    inputMode:            result.inputMode,
    suggestedOptions:     result.suggestedOptions,
    pendingSelection:     result.pendingSelection,
    pendingBusinessMatch: result.pendingBusinessMatch,
  };
}
