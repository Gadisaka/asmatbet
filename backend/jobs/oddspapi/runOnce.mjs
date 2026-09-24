import "dotenv/config";
import { isOddspapiShadowEnabled } from "../../services/providers/oddspapi/config.js";
import { runOddspapiCatalogue } from "./syncCatalogue.js";
import { runOddspapiFixtures } from "./syncFixtures.js";
import { runOddspapiOdds } from "./syncOdds.js";
import { prisma } from "../../Config/db.js";

/**
 * One-shot Phase-1 ingest: catalogue → near fixtures → hot odds.
 *   ENABLE_ODDSPAPI_SHADOW=1 ODDSPAPI_API_KEY=… node jobs/oddspapi/runOnce.mjs
 */
async function main() {
  if (!isOddspapiShadowEnabled()) {
    console.error("Set ENABLE_ODDSPAPI_SHADOW=1 and ODDSPAPI_API_KEY");
    process.exit(1);
  }
  await prisma.$connect();
  const cat = await runOddspapiCatalogue();
  console.log("catalogue", cat);
  const fx = await runOddspapiFixtures({ label: "near", startOffset: 0, endOffset: 2 });
  console.log("fixtures", fx);
  const odds = await runOddspapiOdds({ tier: "hot" });
  console.log("odds", odds);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
