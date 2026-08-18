import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { runAgent } from "./lib/agent/graph";
import { sqlite } from "./lib/db/client";
import { businesses, messages, conversations } from "./lib/db/schema";
import { eq } from "drizzle-orm";

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("=====================================");
  console.log("STARTING END-TO-END VALIDATION TESTS");
  console.log("=====================================\n");

  let conversationId: number | undefined;
  let businessId: number | undefined;
  let askedFields: string[] = [];
  let skippedFields: string[] = [];

  // Helper to run turn
  const turn = async (message: string) => {
    console.log(`\n🗣️ USER: "${message}"`);
    const res = await runAgent(message, conversationId, businessId, askedFields, skippedFields);
    conversationId = res.conversationId;
    businessId = res.businessId;
    askedFields = res.askedFields || [];
    skippedFields = res.skippedFields || [];
    console.log(`🤖 AGENT: "${res.finalResponse}"`);
    return res;
  };

  try {
    // 1. Natural Conversation / Evidence Extraction / Normalization
    console.log("\n--- TEST 1: Complex extraction & Normalization ---");
    const r1 = await turn("I'm looking at a construction company named BuildCorp. They have about 50 employees. The main problem is in project management where site engineers send WhatsApp messages daily and it takes half the day to consolidate them manually into Excel.");
    
    // Check DB
    const dbBiz = sqlite.prepare("SELECT * FROM businesses WHERE id = ?").get(businessId) as any;
    console.log("\n📊 DATABASE RECORD AFTER TURN 1:");
    console.log(JSON.stringify(dbBiz, null, 2));

    // 2. Problem-first discovery & Adaptive questioning
    console.log("\n--- TEST 2: Prioritization ---");
    console.log(`Next prioritized fields (from missing): ${r1.missingFields?.slice(0, 5).join(", ")}`);
    
    // 3. Unknown fields & skipping
    console.log("\n--- TEST 3: Unknown fields & Skipping ---");
    const r2 = await turn("I don't know the error rate.");
    console.log(`Skipped fields array: ${skippedFields.join(", ")}`);

    // 4. Updates
    console.log("\n--- TEST 4: Updates ---");
    const r3 = await turn("Actually, BuildCorp has exactly 55 employees, not 50.");
    const dbBizUpdated = sqlite.prepare("SELECT * FROM businesses WHERE id = ?").get(businessId) as any;
    console.log(`Company Size in DB is now: ${dbBizUpdated.company_size}`);

    // 5. Query / SQL recovery
    console.log("\n--- TEST 5: Database queries & SQL recovery ---");
    const r4 = await turn("Which construction companies have a manual WhatsApp process?");

    // 6. Resume
    console.log("\n--- TEST 6: Resume ---");
    const r5 = await turn("Where did we stop with BuildCorp?");

    console.log("\n✅ TESTS COMPLETED.");

  } catch (err) {
    console.error("Test failed:", err);
  }
}

runTests();
