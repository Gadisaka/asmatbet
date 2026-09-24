/**
 * Idempotent bonus preset rows (one per BonusType). Matches db seed semantics:
 * `upsert` with `update: {}` so existing rows are never overwritten.
 *
 * @param {import("@prisma/client").PrismaClient} prisma
 */
import {
  DEFAULT_CASHBACK_V3_TRACKS,
  DEFAULT_DISQUALIFY_FIXTURE_STATUSES,
  DEFAULT_DISQUALIFY_MATCH_STATUSES,
} from "./bonusEngine.js";

export const PRESET_BONUSES = [
  {
    type: "WELCOME",
    name: "Welcome bonus",
    percentage: 0,
    rules: {},
    status: false,
  },
  {
    type: "FIRST_DEPOSIT",
    name: "First deposit bonus",
    percentage: 0,
    min_deposit: 0,
    rules: {},
    status: false,
  },
  {
    type: "DEPOSIT",
    name: "Deposit bonus",
    percentage: 0,
    min_deposit: 0,
    rules: {},
    status: false,
  },
  {
    type: "ACCUMULATOR",
    name: "Accumulator bonus",
    percentage: 0,
    rules: { tiers: [] },
    status: false,
  },
  {
    type: "CASHBACK",
    name: "Cashback on losses",
    percentage: 0,
    // Multi-track (v3): payout = stake × multiplier where multiplier comes
    // from the track matching exact lost-leg count (1|2|3). Ratio =
    // total_odds / sum(lost-leg odds). Offline tickets store amount for
    // cashier redemption.
    rules: {
      maxHours: 48,
      disqualifyFixtureStatuses: [...DEFAULT_DISQUALIFY_FIXTURE_STATUSES],
      disqualifyMatchStatuses: [...DEFAULT_DISQUALIFY_MATCH_STATUSES],
      tracks: DEFAULT_CASHBACK_V3_TRACKS.map((t) => ({
        ...t,
        tiers: t.tiers.map((tier) => ({ ...tier })),
      })),
    },
    status: false,
  },
  {
    type: "REFERRAL",
    name: "Referral (reserved)",
    percentage: 0,
    rules: {},
    status: false,
  },
];

export const PRESET_BONUS_COUNT = PRESET_BONUSES.length;

export async function ensureBonusPresets(prisma) {
  for (const preset of PRESET_BONUSES) {
    await prisma.bonus.upsert({
      where: { type: preset.type },
      update: {},
      create: {
        name: preset.name,
        type: preset.type,
        percentage: preset.percentage,
        min_deposit: preset.min_deposit ?? null,
        rules: preset.rules ?? undefined,
        status: preset.status,
      },
    });
  }
}
