import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { runAgent } from "./lib/agent/graph";
import { sqlite } from "./lib/db/client.sqlite";

async function runOutOfOrderTest() {
  console.log("=====================================");
  console.log("STARTING OUT-OF-ORDER VALIDATION TEST");
  console.log("=====================================\n");

  let conversationId: number | undefined;
  let businessId: number | undefined;
  let askedFields: string[] = [];
  let skippedFields: string[] = [];
  let problemSignals: string[] = [];
  let automationSignals: string[] = [];
  let evidence: string[] = [];
  let opportunityAssessment: string | undefined;

  const turn = async (message: string) => {
    console.log(`\n🗣️ USER: "${message}"`);
    const res = await runAgent(
      message, 
      conversationId, 
      businessId, 
      askedFields, 
      skippedFields,
      problemSignals,
      automationSignals,
      [],
      [],
      evidence,
      opportunityAssessment
    );
    conversationId = res.conversationId;
    businessId = res.businessId;
    askedFields = res.askedFields || [];
    skippedFields = res.skippedFields || [];
    problemSignals = res.problemSignals || [];
    automationSignals = res.automationSignals || [];
    evidence = res.evidence || [];
    opportunityAssessment = res.opportunityAssessment;
    console.log(`🤖 AGENT: "${res.finalResponse}"`);
    return res;
  };

  try {
    // 1. Initial greeting
    const r0 = await turn("Hi, I want to tell you about a problem.");
    
    // 2. Out-of-order problem introduction
    const r1 = await turn("My team spends 4 hours every day copying WhatsApp requests into a master Excel file because they get around 100 messages a day and they keep losing track of them. It's a huge pain.");
    
    // Check DB
    const dbBiz = sqlite.prepare("SELECT * FROM businesses WHERE id = ?").get(businessId) as any;
    console.log("\n📊 DATABASE RECORD AFTER OUT-OF-ORDER TURN:");
    console.log(JSON.stringify(dbBiz, null, 2));

    console.log("\n📡 SIGNALS EXTRACTED:");
    console.log("Problem Signals:", problemSignals);
    console.log("Automation Signals:", automationSignals);
    console.log("Evidence:", evidence);
    console.log("Assessment:", opportunityAssessment);
    
    console.log("\n📈 Missing Fields Prioritization (First 5):", r1.missingFields?.slice(0, 5));

  } catch (err) {
    console.error("Test failed:", err);
  }
}

runOutOfOrderTest();
