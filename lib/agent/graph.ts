import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import type { BusinessObserverState, Intent, ExtractedFieldMeta } from "./state";
import type { Message } from "@/lib/db/schema";
import { loadContext } from "./nodes/context";
import { classifyIntent } from "./nodes/intent";
import { extractFields } from "./nodes/extraction";
import { validateAndWrite } from "./nodes/validation";
import { prioritizeFields } from "./nodes/prioritization";
import { generateQuestion } from "./nodes/question";
import { buildQuerySpec, generateAndExecuteSql } from "./nodes/query";
import { generateResponse } from "./nodes/response";
import { getMissingFields, getBusinessById, createConversation } from "@/lib/db/queries";

// ─── Annotated State (#1 — MemorySaver for in-process, SQLite for durability) ─
const GraphState = Annotation.Root({
  userMessage:             Annotation<string>({ reducer: (a, b) => b ?? a, default: () => "" }),
  conversationId:          Annotation<number | undefined>({ reducer: (a, b) => b ?? a }),
  businessId:              Annotation<number | undefined>({ reducer: (a, b) => b ?? a }),
  intent:                  Annotation<Intent | undefined>({ reducer: (a, b) => b ?? a }),
  businessContext:         Annotation<Record<string, unknown> | undefined>({ reducer: (a, b) => b ?? a }),
  extractedFields:         Annotation<Record<string, string | null> | undefined>({ reducer: (a, b) => b ?? a }),
  extractedFieldsWithMeta: Annotation<ExtractedFieldMeta[] | undefined>({ reducer: (a, b) => b ?? a }),
  missingFields:           Annotation<string[] | undefined>({ reducer: (a, b) => b ?? a }),
  prioritizedFields:       Annotation<string[] | undefined>({ reducer: (a, b) => b ?? a }),
  askedFields:             Annotation<string[] | undefined>({ reducer: (a, b) => b ?? a }),     // #10
  skippedFields: Annotation<string[]>({
    reducer: (a, b) => b ?? a ?? [],
  }),
  problemSignals: Annotation<string[]>({
    reducer: (a, b) => b ?? a ?? [],
  }),
  automationSignals: Annotation<string[]>({
    reducer: (a, b) => b ?? a ?? [],
  }),
  integrationSignals: Annotation<string[]>({
    reducer: (a, b) => b ?? a ?? [],
  }),
  aiSignals: Annotation<string[]>({
    reducer: (a, b) => b ?? a ?? [],
  }),
  evidence: Annotation<string[]>({
    reducer: (a, b) => b ?? a ?? [],
  }),
  opportunityAssessment: Annotation<string | undefined>({
    reducer: (a, b) => b ?? a ?? undefined,
  }),
  conversationSummary:     Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  recentMessages:          Annotation<Message[] | undefined>({ reducer: (a, b) => b ?? a }),
  querySpecification:      Annotation<unknown>({ reducer: (a, b) => b ?? a }),
  generatedSql:            Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  sqlParameters:           Annotation<unknown[] | undefined>({ reducer: (a, b) => b ?? a }),
  sqlResult:               Annotation<unknown>({ reducer: (a, b) => b ?? a }),
  sqlError:                Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  retryCount:              Annotation<number>({ reducer: (a, b) => b ?? a, default: () => 0 }),
  nextField:               Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  nextQuestion:            Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  finalResponse:           Annotation<string | undefined>({ reducer: (a, b) => b ?? a }),
  suggestedOptions:        Annotation<string[]>({ reducer: (a, b) => b ?? a ?? [] }),
  pendingBusinessMatch:    Annotation<{ id: number; name: string } | undefined>({ reducer: (a, b) => b ?? a }),  // #12
  inputMode:               Annotation<"text" | "voice" | undefined>({ reducer: (a, b) => b ?? a }),
});

// ─── Resume handler ────────────────────────────────────────────────────────────
async function handleResume(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  if (!state.businessId) return {};
  const biz = await getBusinessById(state.businessId);
  if (!biz) return {};
  const missing = getMissingFields(biz);
  return {
    businessContext: biz as unknown as Record<string, unknown>,
    missingFields: missing,
  };
}

// ─── Combined extract + write node ────────────────────────────────────────────
async function extractAndWrite(
  state: BusinessObserverState
): Promise<Partial<BusinessObserverState>> {
  const extracted = await extractFields(state);
  const validated = await validateAndWrite({ ...state, ...extracted });
  return { ...extracted, ...validated };
}

// ─── Router ────────────────────────────────────────────────────────────────────
function routeByIntent(
  state: BusinessObserverState
): "extractAndWrite" | "buildQuerySpec" | "handleResume" | "generateResponse" {
  switch (state.intent) {
    case "discover":
    case "update":
    case "confirm_yes":  // #12: confirmation flows through extractAndWrite → validateAndWrite
    case "confirm_no":
      return "extractAndWrite";
    case "query":
      return "buildQuerySpec";
    case "resume":
      return "handleResume";
    case "skip":
    case "general":
    default:
      return "generateResponse";
  }
}

// ─── Build graph ───────────────────────────────────────────────────────────────
// MemorySaver for in-process LangGraph checkpointing ONLY (#1)
// SQLite (conversations/messages/businesses) is the durable persistence layer
const checkpointer = new MemorySaver();

const graph = new StateGraph(GraphState)
  .addNode("loadContext",           loadContext)
  .addNode("classifyIntent",        classifyIntent)
  .addNode("extractAndWrite",       extractAndWrite)
  .addNode("buildQuerySpec",        buildQuerySpec)
  .addNode("generateAndExecuteSql", generateAndExecuteSql)
  .addNode("handleResume",          handleResume)
  .addNode("prioritizeFields",      prioritizeFields)
  .addNode("generateQuestion",      generateQuestion)
  .addNode("generateResponse",      generateResponse)
  .addEdge(START, "loadContext")
  .addEdge("loadContext", "classifyIntent")
  .addConditionalEdges("classifyIntent", routeByIntent, {
    extractAndWrite:  "extractAndWrite",
    buildQuerySpec:   "buildQuerySpec",
    handleResume:     "handleResume",
    generateResponse: "generateResponse",
  })
  // After extract+write: if a pendingBusinessMatch was set, skip to response (ask confirmation)
  .addConditionalEdges("extractAndWrite", (state: BusinessObserverState) =>
    state.pendingBusinessMatch && state.finalResponse
      ? "generateResponse"
      : "prioritizeFields"
  , {
    generateResponse: "generateResponse",
    prioritizeFields: "prioritizeFields",
  })
  .addEdge("handleResume",          "prioritizeFields")
  .addEdge("prioritizeFields",      "generateQuestion")
  .addEdge("generateQuestion",      "generateResponse")
  .addEdge("buildQuerySpec",        "generateAndExecuteSql")
  .addEdge("generateAndExecuteSql", "generateResponse")
  .addEdge("generateResponse",      END);

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
  inputMode?: "text" | "voice"
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
}> {
  // #1: threadId tied to conversationId so MemorySaver can assist within a session
  // But loadContext always rebuilds from SQLite for true durability across restarts
  const threadId = conversationId ? `conv-${conversationId}` : `new-${Date.now()}`;

  const initialState: BusinessObserverState = {
    userMessage,
    conversationId,
    businessId,
    retryCount: 0,
    askedFields:  askedFields ?? [],
    skippedFields: skippedFields ?? [],
    problemSignals: problemSignals ?? [],
    automationSignals: automationSignals ?? [],
    integrationSignals: integrationSignals ?? [],
    aiSignals: aiSignals ?? [],
    evidence: evidence ?? [],
    opportunityAssessment: opportunityAssessment,
    inputMode: inputMode,
  };

  const result = await compiledGraph.invoke(initialState, {
    configurable: { thread_id: threadId },
  });

  return {
    finalResponse:  result.finalResponse ?? "I'm sorry, something went wrong.",
    conversationId: result.conversationId,
    businessId:     result.businessId,
    missingFields:  result.missingFields,
    askedFields:    result.askedFields,
    skippedFields:  result.skippedFields,
    problemSignals: result.problemSignals,
    automationSignals: result.automationSignals,
    integrationSignals: result.integrationSignals,
    aiSignals: result.aiSignals,
    evidence: result.evidence,
    opportunityAssessment: result.opportunityAssessment,
    inputMode: result.inputMode,
    suggestedOptions: result.suggestedOptions,
  };
}
