/**
 * One-off: write v3 multi-track cashback rules onto the existing CASHBACK
 * bonus row, preserving `status`. Idempotent — re-running overwrites rules
 * with the current DEFAULT_CASHBACK_V3_TRACKS defaults.
 *
 *   node backend/scripts/backfillCashbackRules.js
 */
import { prisma } from "../Config/db.js";
import {
  DEFAULT_CASHBACK_V3_TRACKS,
  DEFAULT_DISQUALIFY_FIXTURE_STATUSES,
  DEFAULT_DISQUALIFY_MATCH_STATUSES,
} from "../lib/bonusEngine.js";

async function main() {
  const existing = await prisma.bonus.findFirst({
    where: { type: "CASHBACK" },
  });
  if (!existing) {
    console.log("No CASHBACK bonus row found — run seed / ensureBonusPresets first.");
    return;
  }

  const prev = existing.rules && typeof existing.rules === "object"
    ? existing.rules
    : {};

  const rules = {
    maxHours: 48,
    disqualifyFixtureStatuses: Array.isArray(prev.disqualifyFixtureStatuses)
      ? prev.disqualifyFixtureStatuses
      : [...DEFAULT_DISQUALIFY_FIXTURE_STATUSES],
    disqualifyMatchStatuses: Array.isArray(prev.disqualifyMatchStatuses)
      ? prev.disqualifyMatchStatuses
      : [...DEFAULT_DISQUALIFY_MATCH_STATUSES],
    tracks: DEFAULT_CASHBACK_V3_TRACKS.map((t) => ({
      ...t,
      tiers: t.tiers.map((tier) => ({ ...tier })),
    })),
  };

  await prisma.bonus.update({
    where: { id: existing.id },
    data: { rules },
  });

  console.log(
    `Updated CASHBACK rules to v3 tracks (status=${existing.status ? "on" : "off"}).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
