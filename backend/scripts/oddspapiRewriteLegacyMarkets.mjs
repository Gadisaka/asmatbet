#!/usr/bin/env node
/**
 * One-off: drop OddsPapi FixtureMarket rows stored as "101:Full Time Result"
 * so the next odds ingest can rewrite them in the legacy API-Football shape
 * ("Match Winner", "Home", …).
 *
 *   node scripts/oddspapiRewriteLegacyMarkets.mjs
 *   node scripts/oddspapiRewriteLegacyMarkets.mjs --ingest
 */
import "dotenv/config";
import prisma from "../Config/db.js";
import { PROVIDER } from "../services/providers/oddspapi/config.js";
import { runOddspapiOdds } from "../jobs/oddspapi/syncOdds.js";

const STALE_NAME = /^\d+:/;
const ingest = process.argv.includes("--ingest");

async function main() {
  const fixtures = await prisma.fixture.findMany({
    where: { provider: PROVIDER },
    select: { id: true },
  });
  const fixtureIds = fixtures.map((f) => f.id);
  console.log(`oddspapi fixtures: ${fixtureIds.length}`);

  let deleted = 0;
  const FIXTURE_BATCH = 50;
  const DELETE_BATCH = 20;
  for (let i = 0; i < fixtureIds.length; i += FIXTURE_BATCH) {
    const slice = fixtureIds.slice(i, i + FIXTURE_BATCH);
    const markets = await prisma.fixtureMarket.findMany({
      where: { fixture_id: { in: slice } },
      select: { id: true, name: true },
    });
    const staleIds = markets.filter((m) => STALE_NAME.test(m.name)).map((m) => m.id);
    for (let j = 0; j < staleIds.length; j += DELETE_BATCH) {
      const ids = staleIds.slice(j, j + DELETE_BATCH);
      await prisma.fixtureMarket.deleteMany({ where: { id: { in: ids } } });
      deleted += ids.length;
    }
  }
  console.log(`deleted provider-shaped markets: ${deleted}`);

  if (ingest) {
    for (const tier of ["hot", "warm", "cold"]) {
      const res = await runOddspapiOdds({ tier });
      console.log(`ingest ${tier}`, res);
    }
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
