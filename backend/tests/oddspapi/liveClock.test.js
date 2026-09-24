import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveLiveClock,
  deriveLiveClockFromFixture,
  liveScorePatch,
  periodElapsedMinutes,
} from "../../services/providers/oddspapi/liveClock.js";
import { normalizeScores } from "../../services/providers/oddspapi/normalize.js";

const NOW = Date.parse("2026-09-01T15:00:00.000Z");

function isoMinutesAgo(min) {
  return new Date(NOW - min * 60_000).toISOString();
}

test("1H clock from result.startedAt", () => {
  const clock = deriveLiveClock(
    { result: { startedAt: isoMinutesAgo(23) } },
    NOW,
  );
  assert.deepEqual(clock, { period: "1H", minute: 23, elapsed: 23 });
});

test("1H stoppage renders 45+", () => {
  const clock = deriveLiveClock(
    { result: { startedAt: isoMinutesAgo(48) } },
    NOW,
  );
  assert.equal(clock.period, "1H");
  assert.equal(clock.elapsed, "45+");
  assert.equal(clock.minute, 45);
});

test("p1 without p2 is HT", () => {
  const clock = deriveLiveClock(
    { p1: { startedAt: isoMinutesAgo(50) }, result: { startedAt: isoMinutesAgo(50) } },
    NOW,
  );
  assert.deepEqual(clock, { period: "HT", minute: null, elapsed: null });
});

test("2H clock is 45 + elapsed(p2)", () => {
  const clock = deriveLiveClock(
    {
      p1: { startedAt: isoMinutesAgo(70) },
      p2: { startedAt: isoMinutesAgo(12) },
      result: { startedAt: isoMinutesAgo(70) },
    },
    NOW,
  );
  assert.deepEqual(clock, { period: "2H", minute: 57, elapsed: 57 });
});

test("2H stoppage renders 90+", () => {
  const clock = deriveLiveClock(
    { p2: { startedAt: isoMinutesAgo(48) } },
    NOW,
  );
  assert.equal(clock.period, "2H");
  assert.equal(clock.elapsed, "90+");
  assert.equal(clock.minute, 90);
});

test("bogus startedAt in the future is rejected", () => {
  assert.equal(periodElapsedMinutes(isoMinutesAgo(-10), NOW), null);
  const clock = deriveLiveClock(
    { result: { startedAt: new Date(NOW + 10 * 60_000).toISOString() } },
    NOW,
  );
  assert.equal(clock.period, "1H");
  assert.equal(clock.minute, null);
});

test("startedAt older than 4h is rejected", () => {
  assert.equal(
    periodElapsedMinutes("2026-07-08T15:03:28+00:00", NOW),
    null,
  );
});

test("deriveLiveClockFromFixture recomputes 1H from stored startedAt", () => {
  const clock = deriveLiveClockFromFixture(
    {
      live_period: "1H",
      live_period_started_at: isoMinutesAgo(10),
    },
    NOW,
  );
  assert.equal(clock.period, "1H");
  assert.equal(clock.elapsed, 10);
});

test("liveScorePatch writes live columns from result, not home_score", () => {
  const scored = normalizeScores({
    scores: {
      periods: {
        result: {
          participant1Score: 2,
          participant2Score: 1,
          startedAt: isoMinutesAgo(20),
        },
      },
    },
  });
  const patch = liveScorePatch(scored, NOW);
  assert.equal(patch.live_home_score, 2);
  assert.equal(patch.live_away_score, 1);
  assert.equal(patch.live_period, "1H");
  assert.equal(patch.home_score, undefined);
  assert.equal(patch.away_score, undefined);
});
