/**
 * Name+country matching against the local SportsLogo catalogue.
 * Used after the one-shot API-Football ingest and by the OddsPapi logo job.
 */

export const CATALOG_PROVIDER = "apifootball";

const NAME_ALIASES = Object.freeze({
  "man city": "manchester city",
  "manchester city": "manchester city",
  "man utd": "manchester united",
  "man united": "manchester united",
  "manchester utd": "manchester united",
  "manchester united": "manchester united",
  spurs: "tottenham hotspur",
  tottenham: "tottenham hotspur",
  "tottenham hotspur": "tottenham hotspur",
  wolves: "wolverhampton wanderers",
  wolverhampton: "wolverhampton wanderers",
  "wolverhampton wanderers": "wolverhampton wanderers",
  psg: "paris saint germain",
  "paris sg": "paris saint germain",
  "paris saint germain": "paris saint germain",
  "inter milan": "internazionale",
  "inter milano": "internazionale",
  internazionale: "internazionale",
  "atletico de madrid": "atletico madrid",
  "atletico madrid": "atletico madrid",
  "athletic bilbao": "athletic club",
  "nottingham": "nottingham forest",
  "nottm forest": "nottingham forest",
  "west ham": "west ham united",
  newcastle: "newcastle united",
  brighton: "brighton and hove albion",
  "brighton hove albion": "brighton and hove albion",
  leicester: "leicester city",
  leeds: "leeds united",
  "sheff utd": "sheffield united",
  "sheffield utd": "sheffield united",
  "sheffield united": "sheffield united",
  "sheff wed": "sheffield wednesday",
  "sheffield wed": "sheffield wednesday",
  qpr: "queens park rangers",
  "west brom": "west brom",
  "west bromwich": "west brom",
  "west bromwich albion": "west brom",
  "nottingham forest": "nottingham forest",
  "english premier league": "premier league",
  "efl championship": "championship",
  "efl league one": "league one",
  "efl league two": "league two",
  "sky bet championship": "championship",
  "sky bet league one": "league one",
  "sky bet league two": "league two",
  "uefa champions league": "champions league",
  "uefa europa league": "europa league",
  "uefa europa conference league": "conference league",
  "uefa conference league": "conference league",
  "europa conference league": "conference league",
  laliga: "la liga",
  "la liga": "la liga",
  "laliga 2": "la liga 2",
  "la liga 2": "la liga 2",
  "efl cup": "league cup",
  "carabao cup": "league cup",
  "league cup": "league cup",
  "super lig": "super lig",
  "turkiye kupasi": "turkish cup",
  "turkey cup": "turkish cup",
  "turkish cup": "turkish cup",
  "liga profesional argentina": "liga profesional argentina",
  "greece cup": "greek cup",
  "greek cup": "greek cup",
  "paok thessaloniki": "paok",
  paok: "paok",
  "ofi crete": "ofi",
  ofi: "ofi",
  "barquisimeto sc": "barquisimeto",
  barquisimeto: "barquisimeto",
  "manisa futbol kulubu": "manisa",
  "manisa f k": "manisa",
  manisa: "manisa",
  igdir: "igdir",
});

const COUNTRY_ALIASES = Object.freeze({
  uk: "england",
  "united kingdom": "england",
  "great britain": "england",
  britain: "england",
  usa: "usa",
  "united states": "usa",
  "united states of america": "usa",
  america: "usa",
  uae: "united arab emirates",
  "south korea": "korea republic",
  "korea republic": "korea republic",
  korea: "korea republic",
  "ivory coast": "cote d ivoire",
  czechia: "czech republic",
  turkey: "turkey",
  turkiye: "turkey",
  world: "international",
  europe: "international",
  international: "international",
  "international clubs": "international",
  "world clubs": "international",
  uefa: "international",
});

const UK_HOME = new Set(["england", "wales", "scotland", "northern ireland"]);

const MAJOR_COUNTRIES = new Set([
  "england",
  "spain",
  "italy",
  "germany",
  "france",
  "portugal",
  "netherlands",
  "belgium",
  "scotland",
  "turkey",
  "brazil",
  "argentina",
  "usa",
  "mexico",
  "ukraine",
  "poland",
  "austria",
  "switzerland",
  "greece",
  "denmark",
  "sweden",
  "norway",
  "russia",
  "japan",
  "korea republic",
  "australia",
  "colombia",
  "chile",
  "uruguay",
  "croatia",
  "serbia",
  "czech republic",
  "romania",
  "hungary",
  "wales",
]);

const GENERIC_TAIL = new Set([
  "united",
  "utd",
  "city",
  "town",
  "county",
  "rovers",
  "wanderers",
  "athletic",
  "hotspur",
  "albion",
  "rangers",
  "wednesday",
  "end",
]);

const LEAGUE_KEY_EXPANSIONS = Object.freeze({
  "champions league": ["uefa champions league"],
  "europa league": ["uefa europa league"],
  "conference league": [
    "uefa europa conference league",
    "uefa conference league",
    "europa conference league",
  ],
  "premier league": ["english premier league"],
  championship: ["efl championship", "sky bet championship"],
  "league one": ["efl league one", "sky bet league one"],
  "league two": ["efl league two", "sky bet league two"],
  "la liga": ["laliga", "primera division"],
  "la liga 2": ["laliga 2", "segunda division"],
  "league cup": ["efl cup", "carabao cup"],
  "turkish cup": ["turkiye kupasi", "turkey cup"],
  "super lig": ["super lig"],
  "greek cup": ["greece cup", "cup"],
  "greece cup": ["greek cup", "cup"],
  "super league": ["super league 1"],
});

const COUNTRY_ADJECTIVES = Object.freeze({
  greece: "greek",
  turkey: "turkish",
  spain: "spanish",
  italy: "italian",
  france: "french",
  germany: "german",
  england: "english",
  russia: "russian",
  denmark: "danish",
  sweden: "swedish",
  norway: "norwegian",
  portugal: "portuguese",
  netherlands: "dutch",
  belgium: "belgian",
  austria: "austrian",
  switzerland: "swiss",
  poland: "polish",
  hungary: "hungarian",
  romania: "romanian",
  "czech republic": "czech",
  brazil: "brazilian",
  argentina: "argentine",
  mexico: "mexican",
  usa: "american",
  japan: "japanese",
  "korea republic": "korean",
  croatia: "croatian",
  serbia: "serbian",
});

const GENERIC_LEAGUE_FOLDS = new Set([
  "cup",
  "super cup",
  "league cup",
  "premier league",
  "super league",
  "first league",
  "1st division",
  "primera division",
  "segunda division",
  "primera liga",
  "national league",
]);

export function foldName(value, { stripClubSuffix = true } = {}) {
  let s = String(value || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ğ/g, "g")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/ñ/g, "n")
    .replace(/ß/g, "ss")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripClubSuffix) {
    s = s
      .replace(/\b(futbol|spor)\s+(kulubu|klubu|clubu)\b/g, " ")
      .replace(/\bf\s*k\b/g, "fk")
      .replace(/\bs\s*k\b/g, "sk")
      .replace(/\b(fc|cf|sc|fk|afc|bk|if|sk|ac)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return s;
}

export function canonicalName(value, { stripClubSuffix = true, country } = {}) {
  const folded = foldName(value, { stripClubSuffix });
  if (!stripClubSuffix) {
    const c = canonicalCountry(country);
    if (c === "spain") {
      if (folded === "primera division" || folded === "laliga") return "la liga";
      if (folded === "segunda division" || folded === "laliga 2") return "la liga 2";
    }
    if (c === "argentina" && folded === "liga profesional") {
      return "liga profesional argentina";
    }
  }
  return NAME_ALIASES[folded] || folded;
}

export function canonicalCountry(value) {
  let folded = foldName(value, { stripClubSuffix: false });
  folded = folded.replace(/\s+(amateur|amateurs|youth|women|ladies)$/g, "").trim();
  return COUNTRY_ALIASES[folded] || folded;
}

export function isInternationalCountry(value) {
  const c = canonicalCountry(value);
  if (!c) return false;
  if (c === "international") return true;
  return /\b(international|world|europe|uefa|afc|caf|concacaf|conmebol|ofc)\b/.test(c);
}

export function leagueNameWithoutCountry(name, country) {
  const n = foldName(name, { stripClubSuffix: false });
  const c = canonicalCountry(country);
  if (!n) return n;
  if (c && n.startsWith(`${c} `)) return n.slice(c.length + 1);
  const adj = c ? COUNTRY_ADJECTIVES[c] : null;
  if (adj && n.startsWith(`${adj} `)) return n.slice(adj.length + 1);
  for (const [nation, adjective] of Object.entries(COUNTRY_ADJECTIVES)) {
    if (n.startsWith(`${adjective} `) && (!c || c === nation)) {
      return n.slice(adjective.length + 1);
    }
  }
  return n;
}

export function nameScore(query, candidate, { stripClubSuffix = true, country } = {}) {
  const a = canonicalName(query, { stripClubSuffix, country });
  const b = canonicalName(candidate, { stripClubSuffix, country });
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (!stripClubSuffix && country) {
    const qs = leagueNameWithoutCountry(query, country);
    const cs = leagueNameWithoutCountry(candidate, country);
    if (qs && cs && qs === cs) return 100;
    if (qs && (qs === b || qs === foldName(candidate, { stripClubSuffix: false }))) return 100;
  }
  const shorter = a.length < b.length ? a : b;
  const longer = a.length >= b.length ? a : b;
  if (b.includes(a) || a.includes(b)) {
    if (shorter.length >= 5) return 80;
    if (shorter.length >= 3 && longer.startsWith(`${shorter} `)) return 80;
  }
  const ta = new Set(a.split(" ").filter((t) => t.length > 2));
  const tb = new Set(b.split(" ").filter((t) => t.length > 2));
  const inter = [...ta].filter((t) => tb.has(t));
  if (inter.length >= 2) return 60;
  if (inter.length === 1 && shorter.length >= 8) return 40;
  return 0;
}

function countryAdjust(queryCountry, candidateCountry) {
  const q = canonicalCountry(queryCountry);
  const c = canonicalCountry(candidateCountry);
  if (!q || !c) return 0;
  if (q === c) return 20;
  if (UK_HOME.has(q) && UK_HOME.has(c)) return 15;
  if (isInternationalCountry(q) || isInternationalCountry(c)) return 5;
  return -60;
}

export function lookupKeys(name, kind = "team", country) {
  const strip = kind !== "league";
  const folded = foldName(name, { stripClubSuffix: strip });
  const canon = canonicalName(name, { stripClubSuffix: strip, country });
  const keys = new Set([folded, canon]);

  for (const v of [folded, canon]) {
    if (!v) continue;
    keys.add(v.replace(/\bunited\b/g, "utd").replace(/\s+/g, " ").trim());
    keys.add(v.replace(/\butd\b/g, "united").replace(/\s+/g, " ").trim());
  }

  let parts = canon.split(" ").filter(Boolean);
  while (parts.length >= 2 && GENERIC_TAIL.has(parts[parts.length - 1])) {
    parts = parts.slice(0, -1);
    keys.add(parts.join(" "));
  }
  const tokens = canon.split(" ").filter(Boolean);
  if (tokens.length >= 2) keys.add(tokens[0]);
  if (tokens.length >= 3) keys.add(tokens.slice(0, 2).join(" "));
  const last = tokens[tokens.length - 1];
  if (tokens.length >= 2 && last && last.length >= 5 && !GENERIC_TAIL.has(last)) {
    keys.add(last);
  }

  if (kind === "league") {
    for (const extra of LEAGUE_KEY_EXPANSIONS[canon] || []) keys.add(extra);
    for (const extra of LEAGUE_KEY_EXPANSIONS[folded] || []) keys.add(extra);
    const stripped = leagueNameWithoutCountry(name, country);
    if (stripped && stripped !== canon) keys.add(stripped);
    if (stripped === "cup" || canon.endsWith(" cup")) keys.add("cup");
  }

  return [...keys].filter(Boolean);
}

function bestNameScore(query, entry, kind, country) {
  const strip = kind !== "league";
  let best = nameScore(query, entry.name, { stripClubSuffix: strip, country });
  for (const extra of entry.extra_names || []) {
    best = Math.max(
      best,
      nameScore(query, extra, { stripClubSuffix: strip, country }),
    );
  }
  return best;
}

function countryRank(country) {
  const c = canonicalCountry(country);
  if (!c) return 0;
  if (MAJOR_COUNTRIES.has(c)) return 2;
  return 1;
}

export function pickBest(entries, name, country, kind = "team") {
  if (!Array.isArray(entries) || !name) return null;
  const minName = 80;
  const scored = [];

  for (const entry of entries) {
    const ns = bestNameScore(name, entry, kind, country);
    if (ns < minName) continue;
    const cs = countryAdjust(country, entry.country);
    if (cs < 0) continue;
    scored.push({ entry, ns, cs, total: ns + cs });
  }

  if (!scored.length) return null;
  scored.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.ns !== a.ns) return b.ns - a.ns;
    return countryRank(b.entry.country) - countryRank(a.entry.country);
  });

  const best = scored[0];
  const tied = scored.filter((s) => s.total === best.total && s.ns === best.ns);
  if (tied.length > 1) {
    const topRank = countryRank(best.entry.country);
    const majors = tied.filter((s) => countryRank(s.entry.country) === topRank);
    if (majors.length !== 1) return null;
    return { ...majors[0].entry, match_score: majors[0].total };
  }
  return { ...best.entry, match_score: best.total };
}

export async function recomputeCatalogNameFolds(prisma, { log = console.log } = {}) {
  if (!prisma?.sportsLogo?.findMany) return { scanned: 0, updated: 0 };
  const rows = await prisma.sportsLogo.findMany({
    select: { id: true, kind: true, name: true, name_fold: true },
  });
  let updated = 0;
  for (const row of rows) {
    const next = canonicalName(row.name, { stripClubSuffix: row.kind !== "league" });
    if (!next || next === row.name_fold) continue;
    await prisma.sportsLogo.update({
      where: { id: row.id },
      data: { name_fold: next },
    });
    updated += 1;
  }
  log(`[logo-catalog] recomputed name_fold on ${updated} / ${rows.length} rows`);
  return { scanned: rows.length, updated };
}

export function buildCatalogIndex(entries) {
  const leagues = [];
  const teams = [];
  for (const entry of entries || []) {
    if (entry?.kind === "league") leagues.push(entry);
    else if (entry?.kind === "team") teams.push(entry);
  }
  return { leagues, teams };
}

export function lookupInIndex(index, kind, name, country) {
  if (!index) return null;
  const list = kind === "league" ? index.leagues : index.teams;
  return pickBest(list, name, country, kind);
}

export function isWeakLogoUrl(url) {
  const s = String(url || "");
  if (!s) return true;
  return (
    s.includes("/api/football/logo/") ||
    s.includes("img.sofascore.com")
  );
}

export function shouldReplaceLogo(current, incoming) {
  if (!incoming) return false;
  if (!current) return true;
  return isWeakLogoUrl(current);
}

export function catalogRowFromLeague(entry) {
  const lg = entry?.league;
  if (!lg?.id || !lg.name) return null;
  const country = entry.country?.name || null;
  const logo =
    lg.logo || `https://media.api-sports.io/football/leagues/${lg.id}.png`;
  const season =
    entry.seasons?.find((s) => s.current)?.year ??
    entry.seasons?.[entry.seasons.length - 1]?.year ??
    null;
  return {
    kind: "league",
    provider: CATALOG_PROVIDER,
    api_id: lg.id,
    name: lg.name,
    name_fold: canonicalName(lg.name, { stripClubSuffix: false }),
    country,
    country_fold: country ? canonicalCountry(country) : null,
    logo,
    flag: entry.country?.flag || null,
    season,
    extra_names: [],
  };
}

export function catalogRowFromTeam(entry) {
  const team = entry?.team;
  if (!team?.id || !team.name) return null;
  const country = team.country || null;
  const logo =
    team.logo || `https://media.api-sports.io/football/teams/${team.id}.png`;
  const extras = [team.code].filter((v) => v && foldName(v) !== foldName(team.name));
  return {
    kind: "team",
    provider: CATALOG_PROVIDER,
    api_id: team.id,
    name: team.name,
    name_fold: canonicalName(team.name),
    country,
    country_fold: country ? canonicalCountry(country) : null,
    logo,
    flag: null,
    extra_names: extras,
  };
}

export function patchFromHit(entity, hit, { flag = false } = {}) {
  if (!entity || !hit?.logo) return null;
  const patch = {};
  if (shouldReplaceLogo(entity.logo, hit.logo)) {
    patch.logo = hit.logo;
  }
  if (flag && !entity.country_flag && hit.flag) {
    patch.country_flag = hit.flag;
  }
  if (!Object.keys(patch).length) return null;
  patch.logo_checked_at = new Date();
  return patch;
}

export async function loadCatalogEntries(prisma) {
  if (!prisma?.sportsLogo?.findMany) return [];
  return prisma.sportsLogo.findMany({
    where: { provider: CATALOG_PROVIDER },
    select: {
      kind: true,
      api_id: true,
      name: true,
      country: true,
      logo: true,
      flag: true,
      extra_names: true,
    },
  });
}

const CATALOG_SELECT = {
  kind: true,
  api_id: true,
  name: true,
  country: true,
  logo: true,
  flag: true,
  extra_names: true,
};

function mergeEntries(into, extra) {
  const seen = new Set(into.map((e) => `${e.kind}:${e.api_id}:${e.name}`));
  for (const row of extra || []) {
    const id = `${row.kind}:${row.api_id}:${row.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    into.push(row);
  }
  return into;
}

export async function lookupCatalogHit(prisma, kind, name, country) {
  if (!prisma?.sportsLogo?.findMany || !name) return null;
  const keys = lookupKeys(name, kind, country);
  if (!keys.length) return null;
  const cf = country ? canonicalCountry(country) : null;
  const generic = keys.filter((k) => GENERIC_LEAGUE_FOLDS.has(k));
  const specific = keys.filter((k) => !GENERIC_LEAGUE_FOLDS.has(k));

  let entries = [];
  if (specific.length) {
    entries = await prisma.sportsLogo.findMany({
      where: {
        provider: CATALOG_PROVIDER,
        kind,
        name_fold: { in: specific },
      },
      select: CATALOG_SELECT,
      take: 40,
    });
  }
  if (kind === "league" && generic.length) {
    const scoped = await prisma.sportsLogo.findMany({
      where: {
        provider: CATALOG_PROVIDER,
        kind,
        name_fold: { in: generic },
        ...(cf
          ? { OR: [{ country_fold: cf }, { country: { contains: country } }] }
          : {}),
      },
      select: CATALOG_SELECT,
      take: 20,
    });
    entries = mergeEntries(entries, scoped);
  } else if (generic.length) {
    const more = await prisma.sportsLogo.findMany({
      where: {
        provider: CATALOG_PROVIDER,
        kind,
        name_fold: { in: generic },
      },
      select: CATALOG_SELECT,
      take: 40,
    });
    entries = mergeEntries(entries, more);
  }

  let hit = pickBest(entries, name, country, kind);
  if (hit) return hit;

  const strip = kind !== "league";
  const tokens = canonicalName(name, { stripClubSuffix: strip })
    .split(" ")
    .filter((t) => t.length >= 5 && !GENERIC_TAIL.has(t));
  const first = tokens[0];
  if (first) {
    const more = await prisma.sportsLogo.findMany({
      where: {
        provider: CATALOG_PROVIDER,
        kind,
        name_fold: { startsWith: first },
      },
      select: CATALOG_SELECT,
      take: 40,
    });
    entries = mergeEntries(entries, more);
    hit = pickBest(entries, name, country, kind);
    if (hit) return hit;
  }

  const distinctive = [...tokens].sort((a, b) => b.length - a.length)[0];
  if (distinctive && distinctive.length >= 6 && distinctive !== first) {
    const more = await prisma.sportsLogo.findMany({
      where: {
        provider: CATALOG_PROVIDER,
        kind,
        name_fold: { contains: distinctive },
      },
      select: CATALOG_SELECT,
      take: 40,
    });
    entries = mergeEntries(entries, more);
    hit = pickBest(entries, name, country, kind);
  }
  return hit;
}

export async function applyCatalogToOddspapi({
  prisma,
  index,
  deleteByPattern,
  now = new Date(),
  log = console.log,
} = {}) {
  if (!prisma) {
    return { leagues: 0, teams: 0 };
  }

  const leagues = await prisma.league.findMany({
    where: { provider: "oddspapi" },
    select: {
      id: true,
      name: true,
      country: true,
      category_name: true,
      logo: true,
      country_flag: true,
    },
  });
  const teams = await prisma.team.findMany({
    where: { provider: "oddspapi" },
    select: {
      id: true,
      name: true,
      logo: true,
      league: { select: { country: true, category_name: true } },
    },
  });

  let leagueHits = 0;
  let teamHits = 0;
  log(
    `[logo-catalog] applying to ${leagues.length} leagues and ${teams.length} teams`,
  );

  for (const league of leagues) {
    const country = league.country || league.category_name;
    const hit = index
      ? lookupInIndex(index, "league", league.name, country)
      : await lookupCatalogHit(prisma, "league", league.name, country);
    const patch = patchFromHit(league, hit, { flag: true });
    if (!patch) continue;
    await prisma.league.update({ where: { id: league.id }, data: patch });
    leagueHits += 1;
  }

  let seen = 0;
  for (const team of teams) {
    seen += 1;
    const country = team.league?.country || team.league?.category_name;
    const hit = index
      ? lookupInIndex(index, "team", team.name, country)
      : await lookupCatalogHit(prisma, "team", team.name, country);
    const patch = patchFromHit(team, hit);
    if (patch) {
      await prisma.team.update({ where: { id: team.id }, data: patch });
      teamHits += 1;
    }
    if (seen % 500 === 0) {
      log(`[logo-catalog] teams scanned=${seen}/${teams.length} hits=${teamHits}`);
    }
  }

  if ((leagueHits || teamHits) && deleteByPattern) {
    await deleteByPattern("fixtures:*");
    await deleteByPattern("live:fixtures:*");
    await deleteByPattern("sidebar-leagues:*");
  }

  return { leagues: leagueHits, teams: teamHits, checkedAt: now };
}
