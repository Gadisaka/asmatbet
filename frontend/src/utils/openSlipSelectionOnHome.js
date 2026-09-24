import { normalizeApiFixtureId } from "./fixtureId";
import { getCalendarDayOffset } from "./matchTimeUtils";
import { dayOffsetToTimeId } from "./sportsbookTimeOptions";

export function matchIdFromFixtureId(apiFixtureId) {
  const id = normalizeApiFixtureId(apiFixtureId);
  if (id == null) return null;
  return `fx-${id}`;
}

export function findMatchByFixtureId(allMatches, apiFixtureId) {
  const target = normalizeApiFixtureId(apiFixtureId);
  if (target == null) return null;
  return (
    (allMatches || []).find(
      (m) => normalizeApiFixtureId(m?.apiFixtureId) === target,
    ) ?? null
  );
}

function timeIdFromKickoffAt(kickoffAt) {
  if (!kickoffAt) return null;
  const d = new Date(kickoffAt);
  if (Number.isNaN(d.getTime())) return null;
  const offset = getCalendarDayOffset(null, new Date(), kickoffAt);
  if (offset == null) return null;
  return dayOffsetToTimeId(offset);
}

/**
 * Filter values that make a fixture visible on Home.
 *
 * @param {Record<string, unknown> | null | undefined} match
 * @param {string | null | undefined} kickoffAt
 * @returns {{ sportId?: string, leagueId: string, timeId?: string | null, clubSearch: string }}
 */
export function filtersToRevealMatch(match, kickoffAt) {
  const sportId = match?.sportId ? String(match.sportId) : undefined;
  const effectiveKickoff = kickoffAt ?? match?.kickoffAt ?? null;
  const offset = getCalendarDayOffset(
    match?.date,
    new Date(),
    effectiveKickoff,
  );
  const timeIdFromMatch = offset != null ? dayOffsetToTimeId(offset) : null;
  const timeId = timeIdFromMatch ?? timeIdFromKickoffAt(effectiveKickoff);

  return {
    sportId,
    leagueId: "all-leagues",
    timeId,
    clubSearch: "",
  };
}
