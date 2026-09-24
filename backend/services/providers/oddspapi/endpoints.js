import { getOddspapiConfig } from "./config.js";
import { oddspapiRequest } from "./client.js";
import { reconcileProviderCount } from "./quota.js";

export async function getAccount() {
  const { json } = await oddspapiRequest("/v4/account", {}, { bucket: "account" });
  const sub =
    json.subscriptions?.find((s) => s.subscription_id === json.current_subscription_id) ||
    json.subscriptions?.find((s) => s.is_active) ||
    json.subscriptions?.[0];
  if (sub) await reconcileProviderCount(sub);
  return { account: json, sub };
}

export function getTournaments(sportId) {
  const sid = sportId ?? getOddspapiConfig().sportId;
  return oddspapiRequest("/v4/tournaments", { sportId: sid }, { bucket: "catalogue" });
}

export function getMarkets() {
  return oddspapiRequest("/v4/markets", { language: "en" }, { bucket: "catalogue" });
}

export function getParticipants(sportId) {
  const sid = sportId ?? getOddspapiConfig().sportId;
  return oddspapiRequest("/v4/participants", { sportId: sid }, { bucket: "catalogue" });
}

export function getFixtures(params) {
  return oddspapiRequest("/v4/fixtures", params, { bucket: "fixtures" });
}

export function getOddsByTournaments(tournamentIds, extra = {}) {
  const cfg = getOddspapiConfig();
  return oddspapiRequest(
    "/v4/odds-by-tournaments",
    {
      tournamentIds: tournamentIds.join(","),
      bookmakers: cfg.bookmaker,
      verbosity: 3,
      ...extra,
    },
    { bucket: extra.bucket || "odds" },
  );
}

export function getOdds(fixtureId) {
  const cfg = getOddspapiConfig();
  return oddspapiRequest(
    "/v4/odds",
    { fixtureId, bookmakers: cfg.bookmaker, verbosity: 3 },
    { bucket: "ondemand" },
  );
}

export function getSettlements(fixtureId) {
  return oddspapiRequest("/v4/settlements", { fixtureId }, { bucket: "settlement" });
}

export function getScores(fixtureId) {
  return oddspapiRequest("/v4/scores", { fixtureId }, { bucket: "scores" });
}
