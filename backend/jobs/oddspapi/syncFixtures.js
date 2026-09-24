import prisma from "../../Config/db.js";
import { getFixturesDaysAhead, getFixturesDaysBehind } from "../../Config/ingestionConfig.js";
import { upsertNoTx } from "../../utils/upsertNoTx.js";
import { getOddspapiConfig, PROVIDER } from "../../services/providers/oddspapi/config.js";
import { getFixtures } from "../../services/providers/oddspapi/endpoints.js";
import {
  fixtureWindows,
  normalizeFixture,
  windowToRange,
} from "../../services/providers/oddspapi/normalize.js";
import { shadowStatsIncr } from "./cache.js";
import { flagUrlForCategory } from "../../services/providers/oddspapi/countryFlag.js";

const SPORT_SLUG = "football";

async function getFootballSport() {
  return upsertNoTx(prisma.sport, {
    where: { slug: SPORT_SLUG },
    update: {},
    create: { name: "Football", slug: SPORT_SLUG },
  });
}

async function upsertLeague(fx, sportId) {
  const countryFlag = flagUrlForCategory(fx.categorySlug);
  const data = {
    name: fx.tournamentName,
    country: fx.categoryName,
    provider: PROVIDER,
    provider_tournament_id: fx.tournamentId,
    category_slug: fx.categorySlug,
    category_name: fx.categoryName,
    active: true,
    ...(countryFlag ? { country_flag: countryFlag } : {}),
  };
  return upsertNoTx(prisma.league, {
    where: { api_league_id: fx.api_league_id },
    update: data,
    create: {
      api_league_id: fx.api_league_id,
      sport_id: sportId,
      ...data,
    },
  });
}

async function upsertTeam(apiTeamId, participantId, name, leagueId) {
  return upsertNoTx(prisma.team, {
    where: { api_team_id: apiTeamId },
    update: {
      name,
      league_id: leagueId,
      provider: PROVIDER,
      provider_participant_id: participantId,
    },
    create: {
      api_team_id: apiTeamId,
      name,
      league_id: leagueId,
      provider: PROVIDER,
      provider_participant_id: participantId,
    },
  });
}

async function upsertFixture(fx, league, home, away) {
  const data = {
    start_time: fx.start_time,
    status: fx.status,
    provider: PROVIDER,
    provider_fixture_id: fx.provider_fixture_id,
    provider_tournament_id: fx.provider_tournament_id,
    provider_season_id: fx.provider_season_id,
    external_ids: fx.external_ids,
    league_id: league.id,
    home_team_id: home.id,
    away_team_id: away.id,
  };
  return upsertNoTx(prisma.fixture, {
    where: { api_fixture_id: fx.api_fixture_id },
    update: data,
    create: { api_fixture_id: fx.api_fixture_id, ...data },
  });
}

export async function ingestFixtureList(rawList, { sport } = {}) {
  const football = sport || (await getFootballSport());
  let upserts = 0;
  let skipped = 0;
  for (const raw of rawList) {
    try {
      const fx = normalizeFixture(raw);
      const league = await upsertLeague(fx, football.id);
      const home = await upsertTeam(
        fx.home_api_team_id,
        fx.participant1Id,
        fx.participant1Name,
        league.id,
      );
      const away = await upsertTeam(
        fx.away_api_team_id,
        fx.participant2Id,
        fx.participant2Name,
        league.id,
      );
      await upsertFixture(fx, league, home, away);
      upserts += 1;
    } catch (err) {
      skipped += 1;
      console.warn(`[oddspapi:fixtures] skip ${raw?.fixtureId}: ${err.message}`);
    }
  }
  return { upserts, skipped };
}

export async function runOddspapiFixtures({ label = "near", startOffset, endOffset, daysAhead } = {}) {
  const cfgWindows = [];
  if (Number.isFinite(startOffset) && Number.isFinite(endOffset)) {
    cfgWindows.push({ startOffset, endOffset });
  } else if (Number.isFinite(daysAhead)) {
    cfgWindows.push(...fixtureWindows(daysAhead));
  } else {
    cfgWindows.push(...fixtureWindows(getFixturesDaysAhead()));
  }

  const sport = await getFootballSport();
  let total = 0;
  let skipped = 0;
  let calls = 0;

  for (const w of cfgWindows) {
    const { from, to } = windowToRange(w.startOffset, w.endOffset);
    const res = await getFixtures({
      sportId: getOddspapiConfig().sportId,
      from,
      to,
    });
    calls += 1;
    const n = res.empty ? 0 : res.list.length;
    console.log(
      `[oddspapi:fixtures] ${label} ${from.slice(0, 10)}..${to.slice(0, 10)} n=${n} empty=${Boolean(res.empty)} ${res.ms}ms`,
    );
    if (n) {
      const r = await ingestFixtureList(res.list, { sport });
      total += r.upserts;
      skipped += r.skipped;
    }
  }

  await shadowStatsIncr("fixtures_upserts", total);
  return { label, calls, upserts: total, skipped };
}

export async function runOddspapiFixturesLookback() {
  const behind = getFixturesDaysBehind();
  return runOddspapiFixtures({
    label: "lookback",
    startOffset: -behind,
    endOffset: -1,
  });
}
