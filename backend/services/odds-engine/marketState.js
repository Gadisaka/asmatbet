const FIXTURE_CLOSED_STATUSES = new Set([
  "FT",
  "AET",
  "PEN",
  "FINISHED",
  "CANC",
  "PST",
  "ABD",
  "AWD",
  "WO",
  "INT",
]);

export function normalizeFixtureStatus(status) {
  return String(status || "")
    .trim()
    .toUpperCase();
}

export function resolveMarketState({
  fixtureStatus,
  hasOddLine,
  operatorState = null,
}) {
  const normalizedStatus = normalizeFixtureStatus(fixtureStatus);
  if (FIXTURE_CLOSED_STATUSES.has(normalizedStatus)) {
    return "CLOSED";
  }
  const op = String(operatorState || "")
    .trim()
    .toUpperCase();
  if (op === "LOCKED" || op === "SUSPENDED" || op === "CLOSED") {
    return op;
  }
  if (!hasOddLine) {
    return "SUSPENDED";
  }
  return "OPEN";
}

const LIVE_FIXTURE_STATUSES = new Set([
  "LIVE",
  "HT",
  "PEN",
  "1H",
  "2H",
  "ET",
  "BT",
  "P",
]);

export function isLiveFixtureStatus(status) {
  return LIVE_FIXTURE_STATUSES.has(normalizeFixtureStatus(status));
}

export function resolveLiveLegState({
  fixtureStatus,
  started = false,
  hasLiveOdds = false,
  hasDbFallback = false,
  redisState = null,
  lockRemainingMs = 0,
  fixtureLockRemainingMs = 0,
}) {
  const serverLive = isLiveFixtureStatus(fixtureStatus);

  if (FIXTURE_CLOSED_STATUSES.has(normalizeFixtureStatus(fixtureStatus))) {
    return { marketState: "CLOSED", serverLive };
  }

  if (Number(fixtureLockRemainingMs) > 0) {
    return { marketState: "LOCKED", serverLive };
  }

  let marketState;
  if (serverLive) {
    const operatorState =
      Number(lockRemainingMs) > 0 ? "LOCKED" : redisState || null;
    marketState = resolveMarketState({
      fixtureStatus,
      hasOddLine: Boolean(hasLiveOdds),
      operatorState,
    });
  } else if (!started) {
    marketState = resolveMarketState({
      fixtureStatus,
      hasOddLine: Boolean(hasLiveOdds || hasDbFallback),
      operatorState: redisState || null,
    });
  } else {
    marketState = resolveMarketState({
      fixtureStatus,
      hasOddLine: false,
      operatorState: null,
    });
  }
  return { marketState, serverLive };
}
