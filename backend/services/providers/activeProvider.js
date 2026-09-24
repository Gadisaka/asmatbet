/**
 * Which sports data provider the public book currently serves.
 *
 * `apifootball` (default) keeps OddsPapi rows hidden. `oddspapi` serves
 * OddsPapi fixtures and hides leftover API-Football rows.
 */
import {
  PROVIDER_APIFOOTBALL,
  PROVIDER_ODDSPAPI,
} from "./publicScope.js";

export { PROVIDER_APIFOOTBALL, PROVIDER_ODDSPAPI };

export function getActiveSportsProvider() {
  const raw = String(process.env.SPORTS_PROVIDER || PROVIDER_APIFOOTBALL)
    .trim()
    .toLowerCase();
  return raw === PROVIDER_ODDSPAPI ? PROVIDER_ODDSPAPI : PROVIDER_APIFOOTBALL;
}

export function isOddspapiPublic() {
  return getActiveSportsProvider() === PROVIDER_ODDSPAPI;
}
