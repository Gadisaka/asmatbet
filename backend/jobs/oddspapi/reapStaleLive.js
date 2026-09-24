import prisma from "../../Config/db.js";
import { PROVIDER } from "../../services/providers/oddspapi/config.js";

const DEFAULT_HOURS = 4;
const DEFAULT_BATCH = 25;

/**
 * OddsPapi only emits statusId 0/1/2/3. If the FT frame is missed, fixtures
 * stay LIVE indefinitely and pollute /fixtures/live plus the hot odds tier.
 * After a plausible football runtime we force FT and let settlement hydrate
 * scores from /v4/scores + /v4/settlements.
 */
export async function runOddspapiReapStaleLive({
  hours = Number(process.env.ODDSPAPI_STALE_LIVE_HOURS || DEFAULT_HOURS),
  limit = Number(process.env.ODDSPAPI_STALE_LIVE_BATCH || DEFAULT_BATCH),
} = {}) {
  const staleHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_HOURS;
  const take = Number.isFinite(limit) && limit > 0 ? Math.min(100, limit) : DEFAULT_BATCH;
  const cutoff = new Date(Date.now() - staleHours * 3600_000);

  const rows = await prisma.fixture.findMany({
    where: {
      provider: PROVIDER,
      status: { in: ["LIVE", "HT"] },
      start_time: { lt: cutoff },
    },
    select: { id: true, provider_fixture_id: true, start_time: true },
    take,
    orderBy: { start_time: "asc" },
  });

  let marked = 0;
  for (const row of rows) {
    await prisma.fixture.update({
      where: { id: row.id },
      data: { status: "FT" },
    });
    marked += 1;
    import("../../services/ticketSettlementService.js")
      .then(({ settleFixture }) => settleFixture(row.id))
      .catch((err) => {
        console.warn("[oddspapi:reap-stale-live] settle failed:", err.message);
      });
  }

  if (marked) {
    console.log(
      `[oddspapi:reap-stale-live] marked ${marked} fixture(s) FT (start_time < ${cutoff.toISOString()})`,
    );
  }
  return { marked, cutoff: cutoff.toISOString(), scanned: rows.length };
}
