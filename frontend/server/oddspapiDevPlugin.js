import {
  configureOddspapiFeed,
  fixturesForUtcDate,
  hasOddspapiKey,
  liveFixtures,
  oddsForFixture,
  sidebarLeagues,
} from "./oddspapiFeed.js";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Serves real OddsPapi fixtures on the public football routes during `vite dev`,
 * so the sportsbook does not depend on the Mongo ingest worker.
 */
export function oddspapiDevPlugin(apiKey) {
  configureOddspapiFeed(apiKey);

  return {
    name: "oddspapi-dev-fixtures",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!hasOddspapiKey() || req.method !== "GET") return next();
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const path = url.pathname.replace(/\/+$/, "") || "/";

        try {
          if (path === "/api/football/fixtures") {
            const date = url.searchParams.get("date");
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
              sendJson(res, 400, { message: "Invalid or missing date" });
              return;
            }
            sendJson(res, 200, await fixturesForUtcDate(date));
            return;
          }
          if (path === "/api/football/fixtures/live") {
            sendJson(res, 200, await liveFixtures());
            return;
          }
          if (path === "/api/football/sidebar-leagues") {
            sendJson(res, 200, await sidebarLeagues());
            return;
          }
          const oddsMatch = path.match(/^\/api\/football\/odds\/(\d+)$/);
          if (oddsMatch) {
            sendJson(res, 200, await oddsForFixture(oddsMatch[1]));
            return;
          }
          if (path === "/api/football/odds/live") {
            sendJson(res, 200, []);
            return;
          }
        } catch (err) {
          console.error("[oddspapi]", err.message);
          sendJson(res, 502, { message: "Failed to load fixtures" });
          return;
        }

        next();
      });
    },
  };
}
