/**
 * lib/agent/agents/reader/resume.ts
 *
 * Resume handler — Reader's responsibility.
 *
 * Intelligently determines what the user actually wants:
 *   - "What did we learn?" → Reader only: summarize knowledge
 *   - "What is missing?" → Reader only: list gaps
 *   - "What's the main problem?" → Reader only: surface problem
 *   - "Continue the research." → Reader + Writer: summarize then continue asking
 *
 * Only invokes Writer path when continued data collection is actually needed.
 */

import { callGemini, callGeminiStructured } from "@/lib/ai/gemini";
import { agentLog } from "@/lib/agent/logger";
import { getBusinessById, getMissingFields } from "@/lib/db/queries";
import { FIELD_META } from "@/lib/db/metadata";
import { z } from "zod";
import type { BusinessObserverState, ReaderResult, ResumeIntent } from "../../state";
import { resolveBusinessReference } from "./simple_tools";

// ─── Classify what kind of resume the user wants ─────────────────────────────

const ResumeIntentSchema = z.object({
  resumeIntent: z.enum([
    "what_did_we_learn",
    "what_is_missing",
    "continue_research",
    "identify_problem",
    "assess_opportunity",
  ]),
  reason: z.string().optional(),
});

async function classifyResumeIntent(userMessage: string, conversationSummary?: string): Promise<ResumeIntent> {
  const prompt = `Classify what the user wants when resuming a business research session.

User message: "${userMessage}"
${conversationSummary ? `Conversation so far: ${conversationSummary}` : ""}

Classify into one of:
- "what_did_we_learn"   → User wants a summary of what is known (e.g., "What did we find out?", "What do we know about them?")
- "what_is_missing"     → User wants to know what gaps remain (e.g., "What's missing?", "What don't we know?")
- "continue_research"   → User wants to actively continue gathering information (e.g., "Let's continue", "What should I ask next?", "Where did we stop?" — when context implies resuming)
- "identify_problem"    → User wants to surface the core problem (e.g., "What was the main issue?", "What problem did we find?")
- "assess_opportunity"  → User wants an opportunity assessment (e.g., "Is this a good opportunity?", "What's the potential here?")

Return ONLY: { "resumeIntent": "...", "reason": "..." }`;

  try {
    const result = await callGeminiStructured(prompt, ResumeIntentSchema, "resume_intent");
    return result.resumeIntent as ResumeIntent;
  } catch {
    return "continue_research"; // safe default
  }
}

// ─── Main resume handler ──────────────────────────────────────────────────────

export async function resumeResearch(
  state: BusinessObserverState
): Promise<{ readerResult: ReaderResult; needsWriter: boolean }> {
  agentLog({
    agent: "Reader",
    tool: "resumeResearch",
    conversationId: state.conversationId,
    businessId: state.businessId,
  });

  // ── 1. Resolve business ───────────────────────────────────────────────────
  let businessId = state.businessId;

  if (!businessId) {
    const resolved = await resolveBusinessReference(state);
    if (resolved.resolvedId) {
      businessId = resolved.resolvedId;
    } else if (resolved.candidates && resolved.candidates.length > 0) {
      return {
        readerResult: {
          status: "ambiguous",
          markdown: "Which business did you want to resume?",
          candidates: resolved.candidates.map((c) => ({
            id: c.id,
            label: c.company_name,
          })),
        },
        needsWriter: false,
      };
    } else {
      return {
        readerResult: {
          status: "empty",
          markdown: "I couldn't find a matching business. Could you tell me the company name?",
        },
        needsWriter: false,
      };
    }
  }

  // ── 2. Retrieve business + conversation state ─────────────────────────────
  const biz = await getBusinessById(businessId);
  if (!biz) {
    return {
      readerResult: {
        status: "error",
        errorMessage: "Business record not found.",
        markdown: "I couldn't find that business record.",
      },
      needsWriter: false,
    };
  }

  const missing = getMissingFields(biz);
  const known = Object.entries(biz).filter(
    ([k, v]) => v && !["id", "created_at", "updated_at"].includes(k) && k in FIELD_META
  );
  const fillRate = Math.round(
    ((Object.keys(FIELD_META).length - missing.length) / Object.keys(FIELD_META).length) * 100
  );

  // ── 3. Classify resume intent ─────────────────────────────────────────────
  const resumeIntent = await classifyResumeIntent(state.userMessage, state.conversationSummary);
  const needsWriter = resumeIntent === "continue_research";

  agentLog({
    agent: "Reader",
    tool: "resumeResearch",
    businessId,
    note: `resumeIntent=${resumeIntent} fillRate=${fillRate}% missing=${missing.length} needsWriter=${needsWriter}`,
  });

  // ── 4. Build context strings ──────────────────────────────────────────────
  const knownSummary = known
    .map(([k, v]) => `- ${FIELD_META[k]?.description ?? k}: ${v}`)
    .join("\n");

  const topMissing = missing
    .slice(0, 4)
    .map((f) => FIELD_META[f]?.description ?? f)
    .join(", ");

  const conversationContext = state.conversationSummary
    ? `\nConversation history: ${state.conversationSummary}`
    : "";

  // ── 5. Generate appropriate response based on intent ──────────────────────
  let prompt: string;

  switch (resumeIntent) {
    case "what_did_we_learn":
      prompt = `You are a business research assistant.

What we know (${fillRate}% complete):
${knownSummary || "(nothing yet)"}
${conversationContext}

Summarize what we have learned about this business in 3–5 sentences.
Focus on: what the business does, the core workflow or problem discovered, key facts (frequency, people, tools).
Do NOT list field names. Write naturally as a researcher would speak.`;
      break;

    case "what_is_missing":
      prompt = `You are a business research assistant.

What we know (${fillRate}% complete):
${knownSummary || "(nothing yet)"}
Missing information: ${topMissing || "most fields"}
${conversationContext}

Explain what information is still needed to complete a strong opportunity assessment.
Focus on the MOST IMPORTANT gaps — the ones that would most help evaluate if there is a real, valuable problem to solve.
Write in 2–4 sentences. Do NOT list field names — describe what we need to understand.`;
      break;

    case "identify_problem":
      prompt = `You are a business research assistant.

What we know (${fillRate}% complete):
${knownSummary || "(nothing yet)"}
${conversationContext}

Describe the core problem or bottleneck we have identified in this business.
If no clear problem is known yet, say so directly and note what we need to find out.
2–4 sentences, natural language.`;
      break;

    case "assess_opportunity":
      prompt = `You are a business research assistant and opportunity analyst.

What we know (${fillRate}% complete):
${knownSummary || "(nothing yet)"}
${conversationContext}

Assess whether there is a genuine automation or AI opportunity based on what we know.
Be direct: rate the opportunity signal (strong/moderate/weak/unclear), explain why, and note what additional information would strengthen the assessment.
3–5 sentences.`;
      break;

    case "continue_research":
    default:
      prompt = `You are a business research assistant. The user wants to continue where we left off.

What we know about this business (${fillRate}% complete):
${knownSummary || "(nothing recorded yet)"}
${conversationContext}

Most important still needed: ${topMissing || "nothing specific yet"}

Write a SHORT progress briefing (2–3 sentences) as a researcher would speak:
- Mention what we've learned (process, problem, key facts found)
- Note the single most important thing still missing
- Do NOT list field names or use database terminology
- End naturally so the next question follows logically`;
      break;
  }

  const markdown = await callGemini(prompt);

  return {
    readerResult: {
      status: "success",
      markdown,
      resolvedBusinessId: businessId,
      businessContext: biz as unknown as Record<string, unknown>,
      missingFields: missing,
    },
    needsWriter,
  };
}
