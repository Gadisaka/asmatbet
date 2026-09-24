import { getCache } from "../../cacheService.js";
import { getOddspapiConfig, oddspapiWsCacheKey } from "./config.js";
import { flattenOdds, normalizeScores } from "./normalize.js";
import {
  deriveLiveClock,
  deriveLiveClockFromFixture,
} from "./liveClock.js";
import { collapseOddLinesByValue, legacyMarketsFromLines } from "./marketBridge.js";
import { loadMarketMap } from "../../../jobs/oddspapi/cache.js";

const FT_1X2_NAMES = new Set([
  "match winner",
  "full time result",
  "fulltime result",
  "1x2",
  "match result",
]);

const LIVE_PRICE_GUARD_NAMES = new Set([
  ...FT_1X2_NAMES,
  "double chance",
]);

export function isLivePriceGuardMarket(name) {
  return LIVE_PRICE_GUARD_NAMES.has(String(name || "").toLowerCase().trim());
}

export function isInPlayStatus(status) {
  const s = String(status || "").toUpperCase();
  return s === "LIVE" || s === "HT";
}

export function isLivePriceTimestampRequired() {
  const v = String(process.env.LIVE_REQUIRE_PRICE_TIMESTAMP || "").toLowerCase();
  return v === "1" || v === "true";
}

export function hasUsableChangedAt(changedAt) {
  return Number.isFinite(Date.parse(changedAt));
}

export function isPriceStale(changedAt, liveUpdatedAt) {
  const changed = Date.parse(changedAt);
  const scored = Date.parse(liveUpdatedAt);
  if (!Number.isFinite(changed) || !Number.isFinite(scored)) return false;
  return changed < scored;
}

/** In-play 1X2 / DC with no usable changed_at is unusable when the flag is on. */
export function isLiveLineMissingRequiredTimestamp({
  changedAt,
  marketName,
  fixtureStatus,
} = {}) {
  if (!isLivePriceTimestampRequired()) return false;
  if (!isInPlayStatus(fixtureStatus)) return false;
  if (!isLivePriceGuardMarket(marketName)) return false;
  return !hasUsableChangedAt(changedAt);
}

export function annotateLine(ol, {
  liveUpdatedAt = null,
  marketName = "",
  fixtureStatus = null,
} = {}) {
  const active = ol?.active !== false && ol?.suspended !== true;
  const changedAt = ol?.changed_at ?? ol?.changedAt ?? null;
  const stale =
    isLivePriceGuardMarket(marketName) &&
    isPriceStale(changedAt, liveUpdatedAt);
  const missingTs = isLiveLineMissingRequiredTimestamp({
    changedAt,
    marketName,
    fixtureStatus,
  });
  const suspended = !active || stale || missingTs;
  return {
    value: ol.value,
    odd: ol.odd,
    active,
    changed_at: changedAt,
    suspended,
  };
}

function mongoMarkets(fx, liveUpdatedAt) {
  return (fx.markets || [])
    .filter((m) => Array.isArray(m.odd_lines) && m.odd_lines.length > 0)
    .map((m) => ({
      name: m.name,
      odd_lines: collapseOddLinesByValue(
        m.odd_lines.map((ol) =>
          annotateLine(ol, {
            liveUpdatedAt,
            marketName: m.name,
            fixtureStatus: fx.status,
          }),
        ),
      ),
    }));
}

function hasPeriods(periods) {
  return periods && typeof periods === "object" && Object.keys(periods).length > 0;
}

/**
 * Live display fields for an in-play OddsPapi fixture.
 * Prefers the merged WebSocket score tree, then persisted live_* columns,
 * then settlement home/away as a last resort.
 */
export function liveDisplayFields(fx, ws = null) {
  const scored = ws?.scores ? normalizeScores(ws) : null;
  const clock = hasPeriods(scored?.periods)
    ? deriveLiveClock(scored.periods)
    : deriveLiveClockFromFixture(fx);
  const liveHome =
    scored?.result?.home ??
    scored?.fullTime?.home ??
    fx.live_home_score ??
    fx.home_score ??
    null;
  const liveAway =
    scored?.result?.away ??
    scored?.fullTime?.away ??
    fx.live_away_score ??
    fx.away_score ??
    null;
  return {
    home_score: liveHome,
    away_score: liveAway,
    elapsed: clock.elapsed,
    period: clock.period,
    status: clock.period === "HT" ? "HT" : fx.status,
  };
}

/**
 * Build the `/odds/live` payload for OddsPapi fixtures: prefer the merged
 * WebSocket book when it has 1xBet prices, otherwise the last REST snapshot.
 */
export async function buildOddspapiLiveOdds(fixtures, dropUnsupported) {
  const cfg = getOddspapiConfig();
  const marketMap = await loadMarketMap();
  const out = [];
  for (const fx of fixtures) {
    const liveUpdatedAt = fx.live_updated_at || null;
    let markets = mongoMarkets(
      dropUnsupported ? dropUnsupported(fx) : fx,
      liveUpdatedAt,
    );
    const ws = fx.provider_fixture_id
      ? await getCache(oddspapiWsCacheKey(fx.provider_fixture_id))
      : null;
    if (ws?.bookmakerOdds) {
      const { lines, suspended } = flattenOdds(ws, cfg.bookmaker);
      const fromWs = legacyMarketsFromLines(lines, marketMap, {
        bookSuspended: suspended,
      }).map((m) => ({
        name: m.name,
        odd_lines: collapseOddLinesByValue(
          m.odd_lines.map((ol) =>
            annotateLine(ol, {
              liveUpdatedAt,
              marketName: m.name,
              fixtureStatus: fx.status,
            }),
          ),
        ),
      }));
      if (fromWs.length) markets = fromWs;
    }
    const display = liveDisplayFields(fx, ws);
    out.push({
      api_fixture_id: fx.api_fixture_id,
      status: display.status,
      elapsed: display.elapsed,
      period: display.period,
      home_score: display.home_score,
      away_score: display.away_score,
      markets,
    });
  }
  return out;
}
