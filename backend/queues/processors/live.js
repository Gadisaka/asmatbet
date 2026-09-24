import syncLiveFixtures from "../../jobs/syncLiveFixtures.js";

/**
 * Processor for the `sync-live` queue. Wraps the existing `syncLiveFixtures`.
 */
export async function processLive(job) {
  if (!process.env.API_FOOTBALL_KEY) {
    return { job: job.name, skipped: true, reason: "API_FOOTBALL_KEY unset" };
  }
  await syncLiveFixtures();
  return { job: job.name };
}
