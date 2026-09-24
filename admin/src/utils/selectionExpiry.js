const BUFFER_MS = 5 * 60 * 1000;

/** True when kickoff is within 5 minutes or already passed (matches listing buffer). */
export function isSelectionRemovable(startTime, now = Date.now()) {
  const kickoff = new Date(startTime).getTime();
  return Number.isFinite(kickoff) && now + BUFFER_MS >= kickoff;
}

/** True when kickoff time has already passed. */
export function isSelectionStarted(startTime, now = Date.now()) {
  const kickoff = new Date(startTime).getTime();
  return Number.isFinite(kickoff) && now >= kickoff;
}
