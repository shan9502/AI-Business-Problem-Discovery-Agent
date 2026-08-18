export interface FieldConfig {
  priority: number;
  description: string;
}

export const BUSINESS_FIELDS: Record<string, FieldConfig> = {
  company_name: {
    priority: 100,
    description: "Name of the business or company",
  },
  industry: {
    priority: 100,
    description: "Primary industry or business sector",
  },
  workflow: {
    priority: 100,
    description: "Business workflow/process being investigated",
  },
  main_pain: {
    priority: 100,
    description: "Primary operational/business problem",
  },
  current_process: {
    priority: 95,
    description: "How the workflow currently operates",
  },
  frequency: {
    priority: 90,
    description: "How frequently the workflow occurs",
  },
  time_consumed: {
    priority: 90,
    description: "Time consumed by the workflow",
  },
  people_involved: {
    priority: 85,
    description: "People involved in the workflow",
  },
  existing_software: {
    priority: 80,
    description: "Existing software used",
  },
  why_existing_software_fails: {
    priority: 80,
    description: "Limitations of existing software",
  },
  ai_opportunity: {
    priority: 70,
    description: "Potential AI opportunity",
  },
  automation_opportunity: {
    priority: 70,
    description: "Potential automation opportunity",
  },
  estimated_value: {
    priority: 70,
    description: "Estimated business value",
  },
  company_size: {
    priority: 60,
    description: "Company size",
  },
  buyer: {
    priority: 60,
    description: "Likely buyer",
  },
  decision_maker: {
    priority: 60,
    description: "Decision maker",
  },
  integration_difficulty: {
    priority: 50,
    description: "Integration difficulty",
  },
  error_rate: {
    priority: 50,
    description: "Current error rate",
  },
  competition: {
    priority: 40,
    description: "Competitive landscape",
  },
  department: {
    priority: 40,
    description: "Relevant department",
  },
};

/** All field names sorted highest priority first */
export const SORTED_FIELD_NAMES = Object.entries(BUSINESS_FIELDS)
  .sort((a, b) => b[1].priority - a[1].priority)
  .map(([name]) => name);

/** SQLite schema string for the businesses table — used in SQL generation prompts */
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
`.trim();
