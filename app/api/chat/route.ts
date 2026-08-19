import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/graph";
import { createConversation } from "@/lib/db/queries";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      message,
      conversationId,
      businessId,
      askedFields,
      skippedFields,
      problemSignals,
      automationSignals,
      integrationSignals,
      aiSignals,
      evidence,
      opportunityAssessment,
      inputMode,
    } = body as {
      message: string;
      conversationId?: number;
      businessId?: number;
      askedFields?: string[];
      skippedFields?: string[];
      problemSignals?: string[];
      automationSignals?: string[];
      integrationSignals?: string[];
      aiSignals?: string[];
      evidence?: string[];
      opportunityAssessment?: string;
      inputMode?: "text" | "voice";
    };

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    // Create conversation if new
    let convId = conversationId;
    if (!convId) {
      const conv = await createConversation(businessId);
      convId = conv.id;
    }

    const result = await runAgent(
      message,
      convId,
      businessId,
      askedFields,
      skippedFields,
      problemSignals,
      automationSignals,
      integrationSignals,
      aiSignals,
      evidence,
      opportunityAssessment,
      inputMode
    );

    return NextResponse.json({
      response:       result.finalResponse,
      conversationId: result.conversationId ?? convId,
      businessId:     result.businessId,
      missingFields:  result.missingFields ?? [],
      askedFields:    result.askedFields ?? [],
      skippedFields:  result.skippedFields ?? [],
      problemSignals: result.problemSignals ?? [],
      automationSignals: result.automationSignals ?? [],
      integrationSignals: result.integrationSignals ?? [],
      aiSignals: result.aiSignals ?? [],
      evidence: result.evidence ?? [],
      opportunityAssessment: result.opportunityAssessment,
    });
  } catch (error) {
    console.error("[chat/route] Error:", error);
    return NextResponse.json(
      { error: "An internal error occurred. Please try again." },
      { status: 500 }
    );
  }
}
