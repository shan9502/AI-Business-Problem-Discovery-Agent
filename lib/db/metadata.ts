/**
 * lib/db/metadata.ts
 *
 * Canonical database knowledge for the Business Observer.
 * This is the SINGLE SOURCE OF TRUTH for all agents.
 * Do NOT duplicate schema descriptions inside individual agent prompts.
 *
 * All three agents (Router, Reader, Writer) derive their DB knowledge from here.
 */

// ─── Field metadata ───────────────────────────────────────────────────────────

export interface FieldMeta {
  description: string;
  type: "text";
  nullable: true;
  searchable: boolean;   // can be used in WHERE / LIKE filters
  writable: boolean;     // Writer agent can set this field
  analysable: boolean;   // Reader analyst can aggregate/group by this field
  priority: number;      // higher = more important to collect first
}

export const FIELD_META: Record<string, FieldMeta> = {
  company_name: {
    description: "The name of the company being researched.",
    type: "text", nullable: true,
    searchable: true, writable: true, analysable: false, priority: 100,
  },
  industry: {
    description: "The industry in which the company operates (e.g., Distribution, Construction, Retail).",
    type: "text", nullable: true,
    searchable: true, writable: true, analysable: true, priority: 100,
  },
  workflow: {
    description: "The specific business workflow or process being investigated (e.g., order processing, invoicing).",
    type: "text", nullable: true,
    searchable: true, writable: true, analysable: true, priority: 100,
  },
  main_pain: {
    description: "The primary operational pain point, bottleneck, or challenge in the current process.",
    type: "text", nullable: true,
    searchable: true, writable: true, analysable: true, priority: 100,
  },
  current_process: {
    description: "How the workflow currently operates — step-by-step description of the manual or automated process.",
    type: "text", nullable: true,
    searchable: true, writable: true, analysable: false, priority: 95,
  },
  frequency: {
    description: "How often the process is performed (e.g., ~200 orders/day, 3×/week).",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: false, priority: 90,
  },
  time_consumed: {
    description: "The amount of time taken to complete the process (e.g., ~2 hrs/order, ~half a working day).",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: false, priority: 90,
  },
  people_involved: {
    description: "The roles or number of people involved in the process (e.g., '3 data-entry staff').",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: false, priority: 85,
  },
  existing_software: {
    description: "Software currently being used for this process (e.g., Excel, SAP, WhatsApp).",
    type: "text", nullable: true,
    searchable: true, writable: true, analysable: true, priority: 80,
  },
  why_existing_software_fails: {
    description: "Reasons why the current software or manual process is inadequate.",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: false, priority: 80,
  },
  ai_opportunity: {
    description: "Potential use cases or opportunities for AI to improve this process.",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: false, priority: 70,
  },
  automation_opportunity: {
    description: "Potential for standard automation (RPA, scripting, integrations) to improve the process.",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: false, priority: 70,
  },
  estimated_value: {
    description: "Estimated business value or ROI of solving this problem (e.g., '~$5k–10k/month in labor savings').",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: false, priority: 70,
  },
  company_size: {
    description: "The size of the company (e.g., '~70 employees', 'SME ~$5M revenue').",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: false, priority: 60,
  },
  buyer: {
    description: "The typical buyer persona for a solution to this problem (e.g., 'Operations Manager').",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: true, priority: 60,
  },
  decision_maker: {
    description: "The person who has authority to purchase a solution (e.g., 'CEO', 'Head of IT').",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: false, priority: 60,
  },
  integration_difficulty: {
    description: "Estimated difficulty of integrating a new solution into their existing systems.",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: false, priority: 50,
  },
  error_rate: {
    description: "Frequency of errors occurring in the current process (e.g., '~5% of orders have entry errors').",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: false, priority: 50,
  },
  competition: {
    description: "Existing alternative solutions or competitors in this problem space.",
    type: "text", nullable: true,
    searchable: false, writable: true, analysable: false, priority: 40,
  },
  department: {
    description: "The specific department within the company being analyzed (e.g., Sales, Operations, Finance).",
    type: "text", nullable: true,
    searchable: true, writable: true, analysable: true, priority: 40,
  },
};

// ─── Derived views (used by different agents) ─────────────────────────────────

/** All writable field names sorted highest priority first (for Writer agent) */
export const WRITABLE_FIELDS = Object.entries(FIELD_META)
  .filter(([, m]) => m.writable)
  .sort((a, b) => b[1].priority - a[1].priority)
  .map(([name]) => name);

/** Fields that can be used in SQL WHERE filters (for Reader query planner) */
export const SEARCHABLE_FIELDS = Object.entries(FIELD_META)
  .filter(([, m]) => m.searchable)
  .map(([name]) => name);

/** Fields the Data Analyst can meaningfully aggregate or group by */
export const ANALYSABLE_FIELDS = Object.entries(FIELD_META)
  .filter(([, m]) => m.analysable)
  .map(([name]) => name);

/** All field names (used for SQL column validation) */
export const ALL_FIELD_NAMES = Object.keys(FIELD_META);

// ─── Prompt-ready serializations ──────────────────────────────────────────────

/**
 * Full field descriptions for Writer extraction prompt.
 * Format: "  field_name: description"
 */
export const FIELD_DESCRIPTIONS_FOR_WRITER = Object.entries(FIELD_META)
  .sort((a, b) => b[1].priority - a[1].priority)
  .map(([name, meta]) => `  ${name}: ${meta.description}`)
  .join("\n");

/**
 * Searchable field list for Reader query planner prompt.
 */
export const SEARCHABLE_FIELDS_FOR_READER = SEARCHABLE_FIELDS.join(", ");

/**
 * Analysis-ready field list for Data Analyst prompt.
 */
export const ANALYSABLE_FIELDS_FOR_ANALYST = ANALYSABLE_FIELDS.join(", ");

/**
 * SQLite DDL for the businesses table — used in SQL generation prompts.
 * Kept in sync with the actual Drizzle schema.
 */
export const BUSINESSES_SCHEMA_SQL = `
CREATE TABLE businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT,
  industry TEXT,
  company_size TEXT,
  department TEXT,
  workflow TEXT,
  current_process TEXT,
  people_involved TEXT,
  frequency TEXT,
  time_consumed TEXT,
  main_pain TEXT,
  error_rate TEXT,
  existing_software TEXT,
  why_existing_software_fails TEXT,
  ai_opportunity TEXT,
  automation_opportunity TEXT,
  estimated_value TEXT,
  buyer TEXT,
  decision_maker TEXT,
  competition TEXT,
  integration_difficulty TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER REFERENCES businesses(id),
  summary TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id),
  role TEXT CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`.trim();

/**
 * Reader-focused schema: just the businesses table fields with descriptions.
 * Concise version for SQL generation prompts.
 */
export const READER_SCHEMA_CONTEXT = `
Table: businesses
Columns:
${Object.entries(FIELD_META)
  .map(([name, meta]) => `  - ${name} TEXT  -- ${meta.description}`)
  .join("\n")}
  - id INTEGER PRIMARY KEY
  - created_at DATETIME
  - updated_at DATETIME
`.trim();

// ─── Table/column allow-lists for SQL security ────────────────────────────────

export const VALID_TABLES = new Set(["businesses", "conversations", "messages"]);

export const VALID_COLUMNS = new Set([
  "id",
  "created_at",
  "updated_at",
  ...ALL_FIELD_NAMES,
  // conversations columns
  "business_id",
  "summary",
  // messages columns
  "conversation_id",
  "role",
  "content",
]);
