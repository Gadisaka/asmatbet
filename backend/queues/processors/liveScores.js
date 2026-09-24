import syncLiveScores from "../../jobs/syncLiveScores.js";

/**
 * Processor for the `sync-live-scores` queue. Wraps the fast score-only poller.
 */
export async function processLiveScores(job) {
  if (!process.env.API_FOOTBALL_KEY) {
    return { job: job.name, skipped: true, reason: "API_FOOTBALL_KEY unset" };
  }
  await syncLiveScores();
  return { job: job.name };
}
