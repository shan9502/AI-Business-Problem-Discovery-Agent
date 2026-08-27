/**
 * lib/agent/logger.ts
 *
 * Lightweight development observability for the 3-agent system.
 * Console-only — no external service dependency.
 *
 * Usage:
 *   import { agentLog } from "@/lib/agent/logger";
 *   agentLog({ agent: "Router", tool: "classifyIntent", latency: 320, route: "read" });
 */

export type AgentName = "Router" | "Reader" | "Writer" | "Composer" | "System";

export interface AgentLogEntry {
  agent: AgentName;
  tool?: string;
  route?: string;
  intent?: string;
  sessionId?: string;
  conversationId?: number;
  businessId?: number;
  model?: string;
  latency?: number;   // ms
  sqlAttempt?: number;
  sqlError?: string;
  dbOp?: string;
  rows?: number;
  note?: string;
}

const isDev = process.env.NODE_ENV !== "production";

/** Emit a structured log entry (dev only). */
export function agentLog(entry: AgentLogEntry): void {
  if (!isDev) return;

  const parts: string[] = [];

  // [Agent] prefix
  parts.push(`[${entry.agent}]`);

  if (entry.tool)           parts.push(`tool=${entry.tool}`);
  if (entry.intent)         parts.push(`intent=${entry.intent}`);
  if (entry.route)          parts.push(`route=${entry.route}`);
  if (entry.model)          parts.push(`model=${entry.model}`);
  if (entry.sessionId)      parts.push(`session=${entry.sessionId.slice(0, 8)}`);
  if (entry.conversationId) parts.push(`conv=${entry.conversationId}`);
  if (entry.businessId)     parts.push(`biz=${entry.businessId}`);
  if (entry.dbOp)           parts.push(`db=${entry.dbOp}`);
  if (entry.sqlAttempt !== undefined) parts.push(`sqlAttempt=${entry.sqlAttempt}`);
  if (entry.rows !== undefined)       parts.push(`rows=${entry.rows}`);
  if (entry.latency !== undefined)    parts.push(`latency=${entry.latency}ms`);
  if (entry.note)           parts.push(`note="${entry.note}"`);
  if (entry.sqlError)       parts.push(`sqlError="${entry.sqlError.slice(0, 80)}"`);

  console.log(`\x1b[36m${parts.join(" ")}\x1b[0m`);
}

/**
 * Wrap an async function and automatically log its execution time.
 */
export async function withLog<T>(
  entry: Omit<AgentLogEntry, "latency">,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    agentLog({ ...entry, latency: Date.now() - start });
    return result;
  } catch (err) {
    agentLog({
      ...entry,
      latency: Date.now() - start,
      note: `ERROR: ${String(err).slice(0, 100)}`,
    });
    throw err;
  }
}
