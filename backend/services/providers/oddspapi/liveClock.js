/**
 * OddsPapi has no minute/clock field. Derive { period, minute, elapsed }
 * from named score periods and their `startedAt` timestamps.
 *
 * statusId is only NS/LIVE/FT/CANC, so half-time is inferred from periods:
 *   p2 present → 2H (minute = 45 + elapsed(p2))
 *   p1 present, no p2 → HT
 *   only result → 1H (elapsed(result), stoppage as 45+)
 */

const MAX_AGE_MS = 4 * 3600_000;
const FUTURE_SKEW_MS = 2 * 60_000;
const FIRST_HALF_LENGTH = 45;
const SECOND_HALF_LENGTH = 45;
const STOPPAGE_BAND_MIN = 15;

export function periodElapsedMinutes(startedAt, now = Date.now()) {
  if (startedAt == null || startedAt === "") return null;
  const t = startedAt instanceof Date ? startedAt.getTime() : Date.parse(startedAt);
  if (!Number.isFinite(t)) return null;
  if (t > now + FUTURE_SKEW_MS) return null;
  if (now - t > MAX_AGE_MS) return null;
  return Math.max(0, Math.floor((now - t) / 60_000));
}

function activePeriodStartedAt(periods, period) {
  if (period === "2H") return periods?.p2?.startedAt || null;
  if (period === "HT") return periods?.p1?.startedAt || periods?.result?.startedAt || null;
  if (period === "1H") return periods?.result?.startedAt || periods?.p1?.startedAt || null;
  return periods?.result?.startedAt || null;
}

/**
 * @param {Record<string, {startedAt?: string|null}>|null|undefined} periods
 * @param {number} [now]
 * @returns {{ period: "1H"|"HT"|"2H"|null, minute: number|null, elapsed: number|string|null }}
 */
export function deriveLiveClock(periods, now = Date.now()) {
  if (!periods || typeof periods !== "object") {
    return { period: null, minute: null, elapsed: null };
  }

  if (periods.p2) {
    const elapsed = periodElapsedMinutes(periods.p2.startedAt, now);
    if (elapsed == null) return { period: "2H", minute: null, elapsed: null };
    const minute = FIRST_HALF_LENGTH + elapsed;
    if (minute <= FIRST_HALF_LENGTH + SECOND_HALF_LENGTH) {
      return { period: "2H", minute, elapsed: minute };
    }
    if (elapsed <= SECOND_HALF_LENGTH + STOPPAGE_BAND_MIN) {
      return { period: "2H", minute: 90, elapsed: "90+" };
    }
    return { period: "2H", minute: null, elapsed: null };
  }

  if (periods.p1) {
    return { period: "HT", minute: null, elapsed: null };
  }

  if (periods.result) {
    const elapsed = periodElapsedMinutes(periods.result.startedAt, now);
    if (elapsed == null) return { period: "1H", minute: null, elapsed: null };
    if (elapsed <= FIRST_HALF_LENGTH) {
      return { period: "1H", minute: elapsed, elapsed };
    }
    if (elapsed <= FIRST_HALF_LENGTH + STOPPAGE_BAND_MIN) {
      return { period: "1H", minute: 45, elapsed: "45+" };
    }
    return { period: "1H", minute: null, elapsed: null };
  }

  return { period: null, minute: null, elapsed: null };
}

/**
 * Recompute the clock from persisted live_* columns when the WS cache
 * has no period map (REST-only fixture, or cache TTL expired).
 */
export function deriveLiveClockFromFixture(fx, now = Date.now()) {
  if (!fx) return { period: null, minute: null, elapsed: null };
  if (fx.live_period === "HT") {
    return { period: "HT", minute: null, elapsed: null };
  }
  const startedAt = fx.live_period_started_at;
  const periods = {};
  if (fx.live_period === "2H") {
    if (startedAt) periods.p2 = { startedAt };
    else return { period: "2H", minute: null, elapsed: null };
  } else if (startedAt) {
    periods.result = { startedAt };
  } else if (fx.live_period === "1H") {
    return { period: "1H", minute: null, elapsed: null };
  } else {
    return { period: fx.live_period || null, minute: null, elapsed: null };
  }
  const clock = deriveLiveClock(periods, now);
  if (clock.period) return clock;
  return { period: fx.live_period || null, minute: null, elapsed: null };
}

export function liveScorePatch(scored, now = Date.now()) {
  const patch = {};
  const live = scored?.result || scored?.fullTime || null;
  if (live) {
    patch.live_home_score = live.home;
    patch.live_away_score = live.away;
  }
  const clock = deriveLiveClock(scored?.periods, now);
  if (clock.period) patch.live_period = clock.period;
  const startedAt = activePeriodStartedAt(scored?.periods, clock.period);
  if (startedAt) {
    const t = startedAt instanceof Date ? startedAt.getTime() : Date.parse(startedAt);
    if (Number.isFinite(t)) patch.live_period_started_at = new Date(t);
  }
  if (Object.keys(patch).length) patch.live_updated_at = new Date(now);
  return patch;
}
