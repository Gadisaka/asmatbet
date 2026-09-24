import { QUEUE_NAMES, REPEATABLE_JOB_NAMES, getQueue } from "./queues.js";
import {
  getNearFixtureWindowDays,
  getNearFixtureIntervalHours,
  getDeepFixtureIntervalHours,
  getFixturesDaysAhead,
  getFixturesDaysBehind,
  getLookbackIntervalHours,
} from "../Config/ingestionConfig.js";
import { isOddspapiShadowEnabled } from "../services/providers/oddspapi/config.js";

/**
 * Owns the cadence of recurring background work.
 *
 * BullMQ "repeatable" jobs replace `node-cron`. They are persisted in Redis,
 * survive restarts, and (because each queue runs at concurrency=1 in the
 * worker) overlapping ticks queue up instead of stampeding upstream.
 *
 * Cadence rationale (target ≤ 75k upstream calls/day):
 *   - Live odds poll: 60s ≈ 1,440/day (backstop; relaxed from 30s)
 *   - Live score poll: 5s ≈ 17,280/day (one bulk {live:all} call per tick)
 *   - Near fixtures: cadence × FIXTURES_NEAR_WINDOW_DAYS calendar dates×sports upstream calls/tick
 *   - Deep fixtures: FIXTURES_DEEP_INTERVAL_HOURS × FIXTURES_DAYS_AHEAD span
 *   - Leagues metadata: weekly ≈ negligible
 *   - Odds: capped by API_SPORTS_DAILY_LIMIT and the negative cache
 *
 * Every interval can be overridden through env vars so dev environments
 * can dial things down without touching code.
 */

const SECONDS = 1000;
const MINUTES = 60 * SECONDS;
const HOURS = 60 * MINUTES;
const DAYS = 24 * HOURS;

function envSeconds(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v * SECONDS : fallback;
}

function envMinutes(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v * MINUTES : fallback;
}

function envDays(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v * DAYS : fallback;
}

function envNumber(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * BullMQ rejects custom `jobId` values that contain ":" because it uses ":"
 * as the Redis key separator. We keep the descriptive colon-separated names
 * for logs / job.name and only sanitise when feeding `opts.jobId`.
 */
function toJobId(name) {
  return name.replace(/:/g, "-");
}

function buildRepeatables() {
  const jobs = [
    {
      queue: QUEUE_NAMES.LIVE,
      name: REPEATABLE_JOB_NAMES.LIVE_TICK,
      data: {},
      opts: {
        // Relaxed to 60s: goal detection + the fixture lock are now driven by
        // the dedicated fast score poller below. This poller is the backstop
        // (NS→LIVE / zero-market backfill / Mongo correctness).
        repeat: { every: envSeconds("LIVE_POLL_SECONDS", 60 * SECONDS) },
        jobId: toJobId(REPEATABLE_JOB_NAMES.LIVE_TICK),
      },
    },
    {
      // Fast score-only poll: detects score/state changes within ~5s and drives
      // lockFixture + a targeted odds refresh, on its OWN queue/worker so the
      // heavier odds poll above can never block detection.
      queue: QUEUE_NAMES.LIVE_SCORES,
      name: REPEATABLE_JOB_NAMES.LIVE_SCORES_TICK,
      data: {},
      opts: {
        repeat: { every: envSeconds("LIVE_SCORE_POLL_SECONDS", 5 * SECONDS) },
        jobId: toJobId(REPEATABLE_JOB_NAMES.LIVE_SCORES_TICK),
      },
    },
    {
      queue: QUEUE_NAMES.ODDS,
      name: REPEATABLE_JOB_NAMES.ODDS_TICK,
      data: {},
      opts: {
        repeat: { every: envSeconds("ODDS_INTERVAL_SECONDS", 2 * MINUTES) },
        jobId: toJobId(REPEATABLE_JOB_NAMES.ODDS_TICK),
      },
    },
    {
      queue: QUEUE_NAMES.FIXTURES_BULK,
      name: REPEATABLE_JOB_NAMES.FIXTURES_NEAR,
      data: {
        label: "near",
        startOffset: 0,
        endOffset: Math.max(0, getNearFixtureWindowDays() - 1),
      },
      opts: {
        repeat: {
          every: getNearFixtureIntervalHours() * HOURS,
        },
        // Suffix so changing FIXTURES_NEAR_WINDOW_DAYS replaces the stale repeatable.
        jobId: `${toJobId(REPEATABLE_JOB_NAMES.FIXTURES_NEAR)}-w${getNearFixtureWindowDays()}`,
      },
    },
    {
      queue: QUEUE_NAMES.FIXTURES_BULK,
      name: REPEATABLE_JOB_NAMES.FIXTURES_FUTURE,
      data: {
        daysAhead: getFixturesDaysAhead(),
        label: "future",
      },
      opts: {
        repeat: {
          every: getDeepFixtureIntervalHours() * HOURS,
        },
        // Suffix so changing FIXTURES_DAYS_AHEAD replaces the stale repeatable.
        jobId: `${toJobId(REPEATABLE_JOB_NAMES.FIXTURES_FUTURE)}-d${getFixturesDaysAhead()}`,
      },
    },
    {
      // Lookback sync: re-fetch recent past days to catch fixtures whose
      // status was missed (e.g. match ended after UTC midnight rollover,
      // live poller missed it, etc.). Default: last 2 days, every 4 hours.
      queue: QUEUE_NAMES.FIXTURES_BULK,
      name: REPEATABLE_JOB_NAMES.FIXTURES_LOOKBACK,
      data: {
        label: "lookback",
        startOffset: -getFixturesDaysBehind(),
        endOffset: -1,
      },
      opts: {
        repeat: {
          every: getLookbackIntervalHours() * HOURS,
        },
        jobId: `${toJobId(REPEATABLE_JOB_NAMES.FIXTURES_LOOKBACK)}-b${getFixturesDaysBehind()}`,
      },
    },
    {
      queue: QUEUE_NAMES.LEAGUES_META,
      name: REPEATABLE_JOB_NAMES.LEAGUES_META,
      data: {},
      opts: {
        repeat: { every: envDays("LEAGUES_META_DAYS", 7 * DAYS) },
        jobId: toJobId(REPEATABLE_JOB_NAMES.LEAGUES_META),
      },
    },
    {
      // Safety net: re-runs `settleFixture` for terminal fixtures whose
      // `grading_completed_at` is still null (some legs remained PENDING
      // on the first pass, usually because events/stats enrichment had
      // not caught up). Cadence defaults to 5 minutes; override via
      // `SETTLEMENT_RETRY_MINUTES`.
      queue: QUEUE_NAMES.SETTLEMENT_RETRY,
      name: REPEATABLE_JOB_NAMES.SETTLEMENT_RETRY,
      data: {},
      opts: {
        repeat: {
          every: envMinutes("SETTLEMENT_RETRY_MINUTES", 5 * MINUTES),
        },
        jobId: toJobId(REPEATABLE_JOB_NAMES.SETTLEMENT_RETRY),
      },
    },
    {
      // Expire unpaid OPEN tickets (no receipt) once the earliest leg kicks off.
      queue: QUEUE_NAMES.EXPIRE_UNPAID_TICKETS,
      name: REPEATABLE_JOB_NAMES.EXPIRE_UNPAID_TICKETS,
      data: {},
      opts: {
        repeat: {
          every: envMinutes("EXPIRE_UNPAID_TICKETS_MINUTES", 3 * MINUTES),
        },
        jobId: toJobId(REPEATABLE_JOB_NAMES.EXPIRE_UNPAID_TICKETS),
      },
    },
    {
      queue: QUEUE_NAMES.HOLD_REAPER,
      name: REPEATABLE_JOB_NAMES.HOLD_REAPER_TICK,
      data: {},
      opts: {
        repeat: { every: envSeconds("HOLD_REAPER_SECONDS", 20 * SECONDS) },
        jobId: toJobId(REPEATABLE_JOB_NAMES.HOLD_REAPER_TICK),
      },
    },
  ];

  if (isOddspapiShadowEnabled()) {
    const q = QUEUE_NAMES.ODDSPAPI_SHADOW;
    jobs.push(
      {
        queue: q,
        name: REPEATABLE_JOB_NAMES.ODDSPAPI_CATALOGUE,
        data: {},
        opts: {
          repeat: { every: envMinutes("ODDSPAPI_CATALOGUE_MINUTES", 60 * MINUTES) },
          jobId: toJobId(REPEATABLE_JOB_NAMES.ODDSPAPI_CATALOGUE),
        },
      },
      {
        queue: q,
        name: REPEATABLE_JOB_NAMES.ODDSPAPI_FIXTURES_NEAR,
        data: {},
        opts: {
          repeat: { every: envMinutes("ODDSPAPI_FIXTURES_NEAR_MINUTES", 30 * MINUTES) },
          jobId: toJobId(REPEATABLE_JOB_NAMES.ODDSPAPI_FIXTURES_NEAR),
        },
      },
      {
        queue: q,
        name: REPEATABLE_JOB_NAMES.ODDSPAPI_FIXTURES_FUTURE,
        data: {},
        opts: {
          repeat: { every: getDeepFixtureIntervalHours() * HOURS },
          jobId: toJobId(REPEATABLE_JOB_NAMES.ODDSPAPI_FIXTURES_FUTURE),
        },
      },
      {
        queue: q,
        name: REPEATABLE_JOB_NAMES.ODDSPAPI_FIXTURES_LOOKBACK,
        data: {},
        opts: {
          repeat: { every: getLookbackIntervalHours() * HOURS },
          jobId: toJobId(REPEATABLE_JOB_NAMES.ODDSPAPI_FIXTURES_LOOKBACK),
        },
      },
      {
        queue: q,
        name: REPEATABLE_JOB_NAMES.ODDSPAPI_ODDS_HOT,
        data: {},
        opts: {
          repeat: { every: envMinutes("ODDSPAPI_ODDS_HOT_MINUTES", 15 * MINUTES) },
          jobId: toJobId(REPEATABLE_JOB_NAMES.ODDSPAPI_ODDS_HOT),
        },
      },
      {
        queue: q,
        name: REPEATABLE_JOB_NAMES.ODDSPAPI_ODDS_WARM,
        data: {},
        opts: {
          repeat: { every: envMinutes("ODDSPAPI_ODDS_WARM_MINUTES", 60 * MINUTES) },
          jobId: toJobId(REPEATABLE_JOB_NAMES.ODDSPAPI_ODDS_WARM),
        },
      },
      {
        queue: q,
        name: REPEATABLE_JOB_NAMES.ODDSPAPI_ODDS_COLD,
        data: {},
        opts: {
          repeat: { every: envMinutes("ODDSPAPI_ODDS_COLD_MINUTES", 6 * 60 * MINUTES) },
          jobId: toJobId(REPEATABLE_JOB_NAMES.ODDSPAPI_ODDS_COLD),
        },
      },
      {
        queue: q,
        name: REPEATABLE_JOB_NAMES.ODDSPAPI_SETTLEMENT_SHADOW,
        // Read-only comparison against our own grader. Paced by the 2s
        // settlements cooldown, so a batch of 25 costs ~1 minute of wall time.
        data: { limit: envNumber("ODDSPAPI_SETTLEMENT_SHADOW_BATCH", 25) },
        opts: {
          repeat: {
            every: envMinutes("ODDSPAPI_SETTLEMENT_SHADOW_MINUTES", 30 * MINUTES),
          },
          jobId: toJobId(REPEATABLE_JOB_NAMES.ODDSPAPI_SETTLEMENT_SHADOW),
        },
      },
      {
        queue: q,
        name: REPEATABLE_JOB_NAMES.ODDSPAPI_REAP_STALE_LIVE,
        data: {},
        opts: {
          repeat: {
            every: envMinutes("ODDSPAPI_STALE_LIVE_MINUTES", 15 * MINUTES),
          },
          jobId: toJobId(REPEATABLE_JOB_NAMES.ODDSPAPI_REAP_STALE_LIVE),
        },
      },
      {
        queue: q,
        name: REPEATABLE_JOB_NAMES.ODDSPAPI_SYNC_LOGOS,
        data: {},
        opts: {
          repeat: {
            every: envMinutes("ODDSPAPI_LOGOS_MINUTES", 10 * MINUTES),
          },
          jobId: toJobId(REPEATABLE_JOB_NAMES.ODDSPAPI_SYNC_LOGOS),
        },
      },
    );
  }

  return jobs;
}

function isSameRepeatable(job, spec) {
  const expectedEvery = Number(spec.opts.repeat?.every ?? 0);
  const actualEvery = Number(job.every ?? 0);
  return job.name === spec.name && expectedEvery === actualEvery;
}

async function ensureRepeatable(q, spec) {
  const existing = await q.getRepeatableJobs();

  // Remove stale definitions for the same logical schedule if cadence changed.
  for (const job of existing) {
    if (job.name === spec.name && !isSameRepeatable(job, spec)) {
      await q.removeRepeatableByKey(job.key);
      console.log(
        `[scheduler] removed stale repeatable "${job.name}" on "${q.name}" (every=${job.every})`,
      );
    }
  }

  const refreshed = await q.getRepeatableJobs();
  const same = refreshed.filter((job) => isSameRepeatable(job, spec));

  // Deduplicate historical duplicates left by previous scheduler restarts.
  if (same.length > 1) {
    for (const dup of same.slice(1)) {
      await q.removeRepeatableByKey(dup.key);
    }
    console.warn(
      `[scheduler] deduped ${same.length - 1} duplicate repeatables for "${spec.name}" on "${q.name}"`,
    );
  }

  const finalList = await q.getRepeatableJobs();
  const present = finalList.some((job) => isSameRepeatable(job, spec));
  if (present) {
    const periodMs = spec.opts.repeat?.every;
    console.log(
      `[scheduler] "${spec.name}" already present on "${q.name}" every ${(
        periodMs / 1000
      ).toFixed(0)}s`,
    );
    return;
  }

  await q.add(spec.name, spec.data, spec.opts);
  const periodMs = spec.opts.repeat?.every;
  console.log(
    `[scheduler] registered "${spec.name}" on "${q.name}" every ${(
      periodMs / 1000
    ).toFixed(0)}s (data=${JSON.stringify(spec.data)})`,
  );
}

export async function startScheduler() {
  const repeatables = buildRepeatables();
  for (const r of repeatables) {
    const q = getQueue(r.queue);
    await ensureRepeatable(q, r);
  }
}

/**
 * Best-effort cleanup of registered repeatables. Kept for tests / one-shot
 * resets; the worker doesn't call this on shutdown so cadences survive
 * restarts.
 */
export async function clearAllRepeatables() {
  const repeatables = buildRepeatables();
  const managedNames = new Set(repeatables.map((r) => r.name));
  const queuesSeen = new Set();
  for (const r of repeatables) {
    if (queuesSeen.has(r.queue)) continue;
    queuesSeen.add(r.queue);
    const q = getQueue(r.queue);
    const list = await q.getRepeatableJobs();
    for (const job of list) {
      if (managedNames.has(job.name)) {
        await q.removeRepeatableByKey(job.key);
      }
    }
  }
}

export async function stopScheduler() {
  // Repeatable jobs persist in Redis on purpose so a worker restart picks up
  // the same cadence without us re-registering. There is nothing to tear
  // down at shutdown.
}

export { QUEUE_NAMES, REPEATABLE_JOB_NAMES };
