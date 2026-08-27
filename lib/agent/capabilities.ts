/**
 * lib/agent/capabilities.ts
 *
 * Structured capability registry for the Router agent.
 * The Router uses this to understand what each agent can do
 * without needing a giant textual description embedded in its prompt.
 */

export interface AgentCapability {
  description: string;
  capabilities: string[];
  tools: string[];
}

export const AGENT_CAPABILITIES: Record<"reader" | "writer", AgentCapability> = {
  reader: {
    description:
      "Reads and analyzes persisted business information from the database. Handles all queries, searches, aggregations, comparisons, analysis, and resume flows.",
    capabilities: [
      "search businesses by name, industry, workflow, or description",
      "retrieve full business details",
      "resume research — summarize what is known and what is missing",
      "find businesses similar to a natural-language description",
      "count businesses matching criteria",
      "aggregate data (e.g., most common problems, industries)",
      "compare businesses across fields",
      "analyze patterns and trends across the database",
      "generate Markdown analysis reports",
      "identify opportunities and highlight recurring problems",
    ],
    tools: [
      "searchBusinesses",
      "getBusiness",
      "getBusinessSummary",
      "getMissingFields",
      "generateQuerySpec",
      "generateSql",
      "validateSql",
      "executeReadOnlySql",
      "validateData",
      "analyzeData",
      "resumeResearch",
    ],
  },

  writer: {
    description:
      "Creates and updates structured business information. Handles all discovery conversations, field extraction, normalization, validation, CRUD operations, and progress tracking.",
    capabilities: [
      "create a new business record",
      "update an existing business record",
      "extract structured information from natural-language user messages",
      "normalize values (headcount, frequency, time, software names)",
      "track extraction certainty (explicit / estimated / inferred / uncertain)",
      "handle update semantics (new value, correction, approximation, range, conflict)",
      "detect and prevent duplicate business records",
      "calculate research progress for a business",
      "track asked and skipped fields",
      "adaptively prioritize the next most valuable field to ask about",
      "generate a natural follow-up question",
      "continue interrupted research sessions",
    ],
    tools: [
      "createBusiness",
      "updateBusiness",
      "getBusiness",
      "searchBusinesses",
      "getMissingFields",
      "validateExtraction",
      "calculateProgress",
      "generateQuestion",
    ],
  },
};

/**
 * Prompt-ready capability summary for the Router's system prompt.
 * Lists each agent's capabilities in natural language.
 */
export function buildCapabilitySummary(): string {
  return Object.entries(AGENT_CAPABILITIES)
    .map(([name, cap]) => {
      const capList = cap.capabilities.map((c) => `    - ${c}`).join("\n");
      return `## ${name.toUpperCase()} AGENT\n${cap.description}\n\nCapabilities:\n${capList}`;
    })
    .join("\n\n");
}
