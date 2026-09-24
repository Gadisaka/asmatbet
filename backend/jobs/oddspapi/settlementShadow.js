/**
 * Phase 3 — settlement shadow.
 *
 * Grades finished OddsPapi fixtures TWICE: once from `/v4/settlements` (the
 * provider's verdict) and once through `marketEvaluatorV2` (our own engine,
 * from the fixture score). Every disagreement is recorded.
 *
 * This job NEVER touches a ticket. It exists solely to answer the question the
 * whole migration rests on: can we trust `/v4/settlements` to pay customers?
 *
 * A finished fixture returns a verdict for the entire catalogue (~2,200 rows,
 * of which ~1,622 are UNDECIDED filler). We compare only the outcomes that
 * both (a) the provider actually graded and (b) our bridge can express.
 */
import prisma from "../../Config/db.js";
import { getRedisClient } from "../../services/cacheService.js";
import { PROVIDER } from "../../services/providers/oddspapi/config.js";
import { getScores, getSettlements } from "../../services/providers/oddspapi/endpoints.js";
import { normalizeScores } from "../../services/providers/oddspapi/normalize.js";
import { normalizeSettlements } from "../../services/providers/oddspapi/settlement.js";
import { bridgeSelection } from "../../services/providers/oddspapi/marketBridge.js";
import { quotaSnapshot } from "../../services/providers/oddspapi/quota.js";
import { evaluateSelection } from "../../services/marketEvaluatorV2.js";
import { buildMatchResultV2FromFixture } from "../../services/matchResult/v2.js";
import { loadMarketMap, shadowStatsIncr } from "./cache.js";

const DONE_KEY = (apiFixtureId) => `oddspapi:settlement-shadow:${apiFixtureId}`;
const DONE_TTL = 30 * 24 * 3600;

/**
 * Verdict classes. Only `disagree` is a finding; the rest are expected and
 * must not be allowed to inflate the disagreement rate.
 */
const AGREE = "agree";
const DISAGREE = "disagree";
const NO_DATA = "no_data";
const HALF_STAKE = "half_stake_unsupported";
const UNMAPPED = "unmapped";

async function ensureScores(fixture) {
  if (
    Number.isInteger(fixture.home_score) &&
    Number.isInteger(fixture.away_score)
  ) {
    return fixture;
  }
  const res = await getScores(fixture.provider_fixture_id).catch((err) => {
    if (err?.status === 404) return null;
    throw err;
  });
  if (!res) return fixture;

  const { fullTime, halfTime } = normalizeScores(res.json);
  const patch = {};
  if (fullTime) {
    patch.home_score = fullTime.home;
    patch.away_score = fullTime.away;
  }
  if (halfTime) {
    patch.ht_home_score = halfTime.home;
    patch.ht_away_score = halfTime.away;
  }
  if (!Object.keys(patch).length) return fixture;

  await prisma.fixture.update({ where: { id: fixture.id }, data: patch });
  return { ...fixture, ...patch };
}

async function recordDisagreement(fixture, entry) {
  try {
    await prisma.auditLog.create({
      data: {
        action: "ODDSPAPI_SETTLEMENT_SHADOW_MISMATCH",
        module: "SETTLEMENT",
        entity_type: "FIXTURE",
        entity_id: String(fixture.id),
        before: {
          provider: {
            result: entry.provider.result,
            raw: entry.provider.providerResult,
            factor: entry.provider.factor,
          },
        },
        after: {
          ours: { result: entry.ours.result, reason: entry.ours.reason },
        },
        meta: {
          marketCode: entry.market_code,
          selection: entry.selection,
          marketId: entry.marketId,
          outcomeId: entry.outcomeId,
          providerFixtureId: fixture.provider_fixture_id,
          score: `${fixture.home_score}-${fixture.away_score}`,
        },
      },
    });
  } catch {
    /* audit must never break the shadow run */
  }
}

/** Compare one graded outcome. Returns a classification bucket. */
function classify(providerEntry, ourOutcome) {
  if (ourOutcome.reason === "missing_required_data") return NO_DATA;
  if (providerEntry.factor === 0.5) return HALF_STAKE;
  return providerEntry.result === ourOutcome.result ? AGREE : DISAGREE;
}

export async function shadowSettleFixture(fixture, marketMap) {
  const withScores = await ensureScores(fixture);
  const res = await getSettlements(withScores.provider_fixture_id);
  const { byKey, counts } = normalizeSettlements(res.json);

  const matchResult = buildMatchResultV2FromFixture(withScores);
  const tally = {
    [AGREE]: 0,
    [DISAGREE]: 0,
    [NO_DATA]: 0,
    [HALF_STAKE]: 0,
    [UNMAPPED]: 0,
  };

  for (const entry of byKey.values()) {
    if (entry.playerId !== 0) continue;
    const catalogue = marketMap[String(entry.marketId)];
    const bridged = bridgeSelection(entry.marketId, entry.outcomeId, catalogue);
    if (!bridged) {
      tally[UNMAPPED] += 1;
      continue;
    }

    const ourOutcome = evaluateSelection(
      { market_code: bridged.market_code, selection: bridged.selection, params: bridged.params },
      matchResult,
    );
    const bucket = classify(entry, ourOutcome);
    tally[bucket] += 1;

    if (bucket === DISAGREE) {
      await recordDisagreement(withScores, {
        ...bridged,
        marketId: entry.marketId,
        outcomeId: entry.outcomeId,
        provider: entry,
        ours: ourOutcome,
      });
    }
  }

  return { tally, providerCounts: counts, compared: byKey.size };
}

export async function runOddspapiSettlementShadow({ limit = 25, days = 3 } = {}) {
  const snap = await quotaSnapshot();
  if (snap.mode === "freeze" || snap.mode === "critical") {
    console.warn(`[oddspapi:settlement-shadow] skip, quota mode=${snap.mode}`);
    return { skipped: true, reason: snap.mode };
  }

  const since = new Date(Date.now() - days * 24 * 3600_000);
  const candidates = await prisma.fixture.findMany({
    where: {
      provider: PROVIDER,
      status: "FT",
      start_time: { gte: since, lte: new Date() },
    },
    orderBy: { start_time: "desc" },
    take: limit * 4,
  });

  const redis = getRedisClient();
  const marketMap = await loadMarketMap();
  const totals = {
    [AGREE]: 0,
    [DISAGREE]: 0,
    [NO_DATA]: 0,
    [HALF_STAKE]: 0,
    [UNMAPPED]: 0,
  };
  let processed = 0;

  for (const fixture of candidates) {
    if (processed >= limit) break;
    const key = DONE_KEY(fixture.api_fixture_id);
    if (await redis.get(key)) continue;

    try {
      const { tally } = await shadowSettleFixture(fixture, marketMap);
      for (const [k, v] of Object.entries(tally)) totals[k] += v;
      await redis.set(key, "1", "EX", DONE_TTL);
      processed += 1;
    } catch (err) {
      if (err?.status === 404) {
        // Provider has no settlement rows for this fixture. Mark it so we do
        // not pay the 2s cooldown for it on every pass.
        await redis.set(key, "404", "EX", DONE_TTL);
        continue;
      }
      console.warn(
        `[oddspapi:settlement-shadow] ${fixture.provider_fixture_id}: ${err.message}`,
      );
    }
  }

  const graded = totals[AGREE] + totals[DISAGREE];
  const rate = graded ? ((totals[AGREE] / graded) * 100).toFixed(2) : "n/a";
  console.log(
    `[oddspapi:settlement-shadow] fixtures=${processed} agree=${totals[AGREE]} ` +
      `disagree=${totals[DISAGREE]} noData=${totals[NO_DATA]} ` +
      `halfStake=${totals[HALF_STAKE]} unmapped=${totals[UNMAPPED]} agreement=${rate}%`,
  );

  await shadowStatsIncr("settlement_fixtures", processed);
  await shadowStatsIncr("settlement_agree", totals[AGREE]);
  await shadowStatsIncr("settlement_disagree", totals[DISAGREE]);

  return { processed, totals, agreementRate: rate, quota: snap.mode };
}
