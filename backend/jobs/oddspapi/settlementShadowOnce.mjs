import "dotenv/config";
import { isOddspapiShadowEnabled } from "../../services/providers/oddspapi/config.js";
import { runOddspapiCatalogue } from "./syncCatalogue.js";
import { loadMarketMap } from "./cache.js";
import { runOddspapiSettlementShadow } from "./settlementShadow.js";
import { prisma } from "../../Config/db.js";

/**
 * One-shot Phase-3 settlement comparison.
 *
 *   ENABLE_ODDSPAPI_SHADOW=1 node jobs/oddspapi/settlementShadowOnce.mjs [limit] [days]
 */
async function main() {
  if (!isOddspapiShadowEnabled()) {
    console.error("Set ENABLE_ODDSPAPI_SHADOW=1 and ODDSPAPI_API_KEY");
    process.exit(1);
  }
  const limit = Number(process.argv[2] || 25);
  const days = Number(process.argv[3] || 3);

  await prisma.$connect();

  // The bridge resolves outcome ids through the cached catalogue's `outcomes`
  // map, which older catalogue runs did not persist.
  const cached = await loadMarketMap();
  const sample = Object.values(cached)[0];
  if (!sample?.outcomes) {
    console.log("catalogue missing outcome names — refreshing");
    await runOddspapiCatalogue();
  }

  const res = await runOddspapiSettlementShadow({ limit, days });
  console.log(JSON.stringify(res, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
