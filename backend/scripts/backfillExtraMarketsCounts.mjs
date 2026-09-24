/**
 * One-off: recompute available_odd_cells_count / extra_markets_count using the
 * same allowlist as GET /odds (so list +N badges match post-open counts).
 *
 *   node backend/scripts/backfillExtraMarketsCounts.mjs
 */
import "dotenv/config";
import { prisma } from "../Config/db.js";
import { recomputeExtraMarketsCountForFixture } from "../services/extraMarketsCount.js";

async function run() {
  const fixtures = await prisma.fixture.findMany({
    where: {
      markets: { some: { odd_lines: { some: {} } } },
    },
    select: { id: true, api_fixture_id: true },
    orderBy: { start_time: "desc" },
  });

  if (!fixtures.length) {
    console.log("[backfill-extra-markets-counts] nothing to update");
    return;
  }

  console.log(
    `[backfill-extra-markets-counts] recomputing ${fixtures.length} fixtures…`,
  );

  let done = 0;
  for (const fixture of fixtures) {
    await recomputeExtraMarketsCountForFixture(fixture.id);
    done += 1;
    if (done % 100 === 0 || done === fixtures.length) {
      console.log(
        `[backfill-extra-markets-counts] ${done}/${fixtures.length}`,
      );
    }
  }

  console.log(`[backfill-extra-markets-counts] done (${done} fixtures)`);
}

run()
  .catch((err) => {
    console.error("[backfill-extra-markets-counts] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
