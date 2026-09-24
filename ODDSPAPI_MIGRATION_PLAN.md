# Migrating from API-Football to OddsPapi

**Status:** proposal / implementation plan
**Author:** engineering
**Scope:** backend ingestion, odds pipeline, settlement, quota governance

---

## 1. The headline

The 500,000 requests/month limit sounds like a 90% cut from the 150,000/day we
have on API-Football. It is not, because the two providers bill completely
differently.

On API-Football, **odds are billed per fixture**. `GET /odds?fixture=X` returns
one fixture. Covering 2,000 upcoming fixtures once costs 2,000 requests. That
single fact is what drove our volume: the odds tick alone was budgeted at up to
250 calls every 2 minutes (~180k/day theoretical), and the 5-second live poller
added another ~17k/day.

On OddsPapi, **odds are billed per tournament batch**. `GET
/v4/odds-by-tournaments?tournamentIds=17,8,39,...` returns every fixture in
every listed tournament, with full market/outcome/price data, for **1 request**.
Refreshing the entire prematch book becomes single-digit requests instead of
thousands.

On top of that, our account has three properties that change the arithmetic
again:

| Property | Value | Consequence |
|---|---|---|
| WebSocket access | Enabled | Live odds, price changes, `statusId` transitions and score updates arrive over a push feed that does **not** consume quota (measured — §1.1) |
| `/v4/account` | Unmetered | We can read authoritative `request_count` / `request_limit` as often as we like, for free |
| `/v4/historical-odds` | Free | Closing-line audit and dispute resolution cost nothing |

### 1.1 Measured, not assumed

The WebSocket billing question was the load-bearing assumption in this plan, so
it was tested directly rather than left to support.
`backend/scripts/oddspapiWsQuotaProbe.mjs` polls the unmetered `/v4/account`
endpoint while streaming, with a positive control (known-billable `/v4/sports`
calls) to prove the counter actually moves.

Run on 2026-09-01 07:01–07:11 UTC, 130 live soccer fixtures in play:

| Phase | Observation |
|---|---|
| Idle, 1 min, 5 `/v4/account` polls | `request_count` +0 — confirms `/v4/account` is unmetered |
| Control, 3 × `/v4/sports` | `request_count` **+3**, visible after ~5s — instrument works, lag is negligible |
| Socket, 8 min, **603 messages** across **417 fixtures** | `request_count` **+0** |

**The WebSocket does not consume quota.** Implied cost per message: 0.0000. The
zero in the live-odds row of §4.1 is a measurement, not an estimate.

Two secondary findings from the same run:

- **The stream is not live-only.** 417 distinct fixtures produced updates while
  only 130 were in play, so prematch price movement is pushed too. This means
  the REST odds sweeps in §4.1 are a *reconciliation and seeding* mechanism, not
  the primary price path — and their cadence can likely be relaxed well below
  what is budgeted there. Quantify this in phase 1 by diffing the socket's
  materialised view against a REST snapshot.
- **`1xbet` reports `has_player_props: false`** on the live account, confirming
  §3.3. Goalscorer and player-based markets are unavailable and must leave the
  allowlist.

Also observed: `rate_limit` is `null` on the subscription, but endpoints enforce
their documented per-endpoint cooldowns and return `429` with a `retryMs` hint
(`RATE_LIMITED`), which is distinct from the quota-exhaustion `429`
(`REQUEST_LIMIT_EXCEEDED`). The client must tell these apart — one is retriable
after a short wait, the other must trip Freeze mode (§5.2).

### 1.2 The rest of the support questions, measured 2026-09-01

Script: `backend/scripts/oddspapiCalibrate.mjs`. Cost: **23 billable calls**
for the main run, plus a handful of live-odds follow-ups. Provider
`request_count` matched our local counter exactly, including 4xx.

| # | Question | Result |
|---|---|---|
| 2a | Max `tournamentIds` per `/v4/odds-by-tournaments` | **5.** `n=10` returns HTTP 400 `INVALID_PARAMETER`: *"Please provide a maximum of 5 tournament IDs"*. The plan's assumed 25 is wrong. |
| 2b | Truncation / payload | No silent truncation. 5 busy tournaments → 61 fixtures, **4.9 MB**, 465 ms. Empty/no-odds lists return HTTP **404** `FIXTURE_NOT_FOUND` (and that 404 **is billed**). |
| 2c | `verbosity` | Changes **fixture metadata**, not prices. `verbosity=3` adds names, slugs, `statusName`, `externalProviders`. Player/price keys are identical at 1 and 3; size ratio ~1.01x. Use 3 on ingest so we do not need extra `/v4/fixture` calls. |
| 3a | 1xBet soccer markets | **137 distinct `marketId`s** on a 5-tournament prematch sample, vs 1,122 soccer rows in `/v4/markets`. Most of the catalogue is unused handicap/totals *lines* (each line is its own id) plus player props. Core 1x2 / BTTS / O-U / AH / EH / team totals / first-last goal / odd-even are present. First/second-half result was **not** in this sample — do not treat 137 as the offerable set until we snapshot a weekend slate. |
| 3b | Player props | Confirmed. `has_player_props: false`, and **zero** `playerId ≠ 0` prices in the odds tree. |
| 4a | Settlements vs priced markets | `/v4/settlements` returns the **entire catalogue** (~1,066 markets / ~2,200 outcomes per fixture). ~1,622 of those are `UNDECIDED` on finished matches — unused catalogue, not lag. 1xBet historical-odds had 81–99 priced markets; those show up as WIN/LOSE/HALF\*/PUSH. Grade **only legs we actually took**. Never treat leftover `UNDECIDED` as "not ready yet". |
| 4b | Delay after FT | Not timed to the second (no kickoff-finish caught live). Four finished fixtures aged **~4–6 h** already had a full WIN/LOSE/HALF\*/PUSH set on the priced markets. |
| 4c | Can results change later? | **Not tested** — needs days of re-fetch. |
| 4d | Cancelled fixtures | Two `statusId=3` fixtures: **2,232/2,232 outcomes `CANCELLED`**. Yes. |
| 5a | Monthly reset | **31-day rolling**, not calendar. This sub: `valid_from=2026-08-29T06:43:07Z` → `valid_until=2026-09-29T06:43:07Z`. Redis quota keys must use that window, not `YYYY-MM`. |
| 5b | `request_count` lag | Seconds, not minutes. Local billable count and `/v4/account` stayed in lockstep. |
| 5c | Is a quota-429 billed? | Quota exhaustion not tested. **Cooldown 429 `RATE_LIMITED` IS billed** (parallel `/v4/sports` → 200+429, both incremented `request_count`). Blind retries burn the month. |
| 6 | Cooldowns | **Per-endpoint, independent.** Two `/v4/sports` in parallel → 200 + 429. `/v4/bookmakers` + `/v4/languages` in parallel → 200 + 200. `rate_limit` on the subscription is still `null`; the documented per-path cooldowns are what actually fire. |
| 1b | Concurrent sockets | Two connections both stay up and see the **same global feed** (3/3 fixture overlap). No subscribe message. |
| 1c | Reconnect resync | **No snapshot.** A reconnect delivered 5 sparse delta messages in 12s, not the book. REST-reseed after every reconnect. |
| 1d | Heartbeat / idle timeout | Some non-JSON frames (1 per socket / 25s). Idle-timeout not measured. |

Operational footguns discovered in the same run:

- **`GET /v4/fixtures?tournamentId=X` with no `from`/`to` returns the archive.** Club friendlies: 6,312 rows / 5.6 MB, including 5,846 finished. Always pass a date window.
- **A 12-day `sportId`+`from`+`to` window is HTTP 400.** Docs say 10 days; that cap is enforced.
- **`liveFixtures` on `/v4/tournaments` is a hint, not a live odds list.** Morning sample: 47 "live" tournaments, but `/v4/fixtures?statusId=1&hasOdds=true&bookmakers=1xbet` returned nothing, and sampled in-play fixtures had `hasOdds=false` and empty `/v4/odds`. In-play 1xBet prices should be treated as **WebSocket-primary** until we catch a priced live match on REST (re-check at a Premier League 15:00 GMT).
- **HALFWIN / HALFLOSS are not theoretical.** Every finished sample had ~13–14 of each. Quarter-line Asian handicaps are on 1xBet *today*.

Recosted workload with a **max-5 batch** and WebSocket as the primary price path (REST = seed + reconcile) lands around **3,000–5,000 requests/day** against ~16,400/day — still comfortable, but the old "25 ids/call, 2,700/day" table is obsolete. See §4.

The real work in this migration is **not** quota engineering. It is the ID and
market-model rewrite, and the settlement rewrite — which is the whole reason we
are moving.

---

## 2. Why we are moving: settlement

Today settlement is inference. `enrichFixtureResult.js` pulls
`/fixtures/events` and `/fixtures/statistics`, `matchResult/v2.js` normalises
them into a `MatchResultV2`, and ~120 hand-written grader modules in
`services/markets/` re-derive each market's outcome from goals, cards, corners,
offsides, fouls, saves and shots. Every one of those graders is a place where we
can disagree with the bookmaker.

OddsPapi gives us the answer directly:

```
GET /v4/settlements?fixtureId=id1000000761280685

{ "fixtureId": "...", "markets": {
    "101": { "outcomes": {
        "101": { "players": { "0": { "result": "WIN"  } } },
        "102": { "players": { "0": { "result": "LOSE" } } },
        "103": { "players": { "0": { "result": "LOSE" } } } } },
    "1056": { "outcomes": {
        "1056": { "players": { "0": { "result": "PUSH" } } } } } } }
```

Results are `WIN | LOSE | HALFWIN | HALFLOSS | PUSH | CANCELLED | UNDECIDED`,
keyed by exactly the `(marketId, outcomeId, playerId)` triple we priced the bet
on. Grading a leg becomes a dictionary lookup.

Three consequences worth stating plainly:

1. **`enrichFixtureResult.js` and the entire events/statistics pipeline can be
   deleted.** Corners, cards, offsides, fouls, saves and shots markets settle
   from `/v4/settlements` like everything else. We never need a statistics
   endpoint — which is good, because OddsPapi does not have one.
2. **The ~120 grader modules become dead code** for OddsPapi-sourced legs. Keep
   them only for the admin-managed `Match`/`Odd` path, which is not
   provider-driven.
3. **We must support fractional settlement.** `HALFWIN` and `HALFLOSS` (Asian
   handicap quarter lines) have no representation in our current
   `PENDING/WON/LOST/VOID` model. This is a schema and payout change, covered in
   §6.

---

## 3. What has to change structurally

### 3.1 Fixture identity is now a string

`Fixture.api_fixture_id` is an `Int` holding an API-Football numeric id.
OddsPapi fixture ids look like `id1000001761301153` — a string, and not
safely coercible.

Rather than mutating the existing column in place (which would break every
in-flight ticket, every cached Redis key and the frontend's
`utils/fixtureId.js`), add parallel provider-scoped columns:

```prisma
model Fixture {
  // existing
  api_fixture_id      Int?     @unique   // relaxed to optional
  // new
  provider            String   @default("apifootball") // "apifootball" | "oddspapi"
  provider_fixture_id String?                          // "id1000001761301153"
  provider_tournament_id Int?
  provider_season_id     Int?
  external_ids        Json?    // OddsPapi `externalProviders` blob

  @@unique([provider, provider_fixture_id])
}
```

`external_ids` is genuinely valuable: OddsPapi hands us `betradarId`,
`sofascoreId`, `flashscoreId`, `pinnacleId` and `opticoddsId` for free on every
fixture. That is our migration bridge (§8) and our escape hatch if we ever
change provider again.

Mirror the same pattern on `League` (`provider_tournament_id`, plus
`category_slug`/`category_name`) and `Team` (`provider_participant_id`).

### 3.2 Markets become structured instead of stringly-typed

Today `FixtureMarket.name` stores an API-Football display string
(`"Match Winner"`, `"Goals Over/Under"`) and `FixtureOddLine.value` stores a
label (`"Over 2.5"`). `marketSupport.js` then reverse-engineers a canonical
`market_code` from that string with a 120-entry lowercase lookup table and a
`mappingMismatch()` heuristic that guesses whether `"Yellow Double Chance"` is
really a double chance. That whole layer exists because the provider gave us
prose.

OddsPapi gives us a typed catalogue from `GET /v4/markets` (one request,
cache for a week):

```json
{ "marketId": 106, "marketName": "Over Under Full Time", "marketLength": 2,
  "playerProp": false, "sportId": 10, "handicap": 0.5, "period": "fulltime",
  "marketType": "totals",
  "outcomes": [ { "outcomeId": 106, "outcomeName": "Over" },
                { "outcomeId": 107, "outcomeName": "Under" } ] }
```

`marketType` + `period` + `handicap` is precisely our `(market_code,
market_params)` pair. So:

- Add `backend/services/markets/oddspapiMarketMap.js`, generated from
  `/v4/markets` by a script, mapping `marketId -> { market_code, period,
  handicap, market_type }` and `outcomeId -> selection semantics`.
- **Store provider identity on every priced selection.** `FixtureOddLine` gains
  `provider_market_id`, `provider_outcome_id`, `provider_player_id`,
  `main_line`, `max_limit`, `active`. `TicketSelection` gains the same triple.
- `marketSupport.js` keeps its allowlist role (`isCodeAllowed`, phases) but
  loses `PROVIDER_NAME_TO_CODE`, `mappingMismatch()`, `hasStatQualifier()` and
  `isPeriodQualifier()`. Those exist only to compensate for string parsing.

The allowlist itself (`Config/marketAllowlist.js`) survives conceptually but
gets re-keyed from API-Football bet ids to OddsPapi `marketId`s, and its meaning
inverts in a good way: instead of "which markets can our graders settle", the
question becomes "which markets does `/v4/settlements` return results for" —
which we can measure empirically rather than reason about.

### 3.3 One bookmaker, not a fallback chain

The plan grants exactly one bookmaker: **1xBet (`1xbet`)**, pregame and live,
**no player props**. So:

- `parseBookmakerFallbackChain()`, `DEFAULT_BOOKMAKER_FALLBACK_CHAIN`,
  `BOOKMAKER_FALLBACK_CHAIN`, the admin preferred-bookmaker setting and the
  whole `Bookmaker` selection path collapse to a constant.
- **Player-prop markets must be removed from the allowlist**:
  `GOALSCORER_ANYTIME`, `FIRST_GOALSCORER`, `LAST_GOALSCORER`, their
  `_HOME`/`_AWAY` variants, `PLAYER_CARDS`, `PLAYER_SHOTS` and the shots
  wrappers. We will not receive prices for them. This is a product decision to
  confirm before build, not a technical detail — if player props matter, the
  subscription needs upgrading.
- Everything else in `CODES_ENRICHED` becomes *easier*, not harder, since
  settlement no longer depends on stats enrichment.

### 3.4 Live goes from polling to push

Current live path: `sync-live-scores` polls `/fixtures?live=all` every 5s
(~17k calls/day) purely to detect score changes, which then fire
`liveFixtureLock` and a targeted per-fixture odds refresh; `sync-live` polls the
same endpoint every 60s as a correctness backstop.

Replace both with a **single persistent WebSocket** to
`wss://api.oddspapi.io/v4/ws?apiKey=...`, which pushes:

- price changes per `(bookmaker, marketId, outcomeId, playerId)` with
  `active`, `limit`, `price`, `changedAt`
- `statusId` transitions (0 pre-game → 1 live → 2 finished → 3 cancelled)
- period scores under `scores.periods`

This is strictly better than what we have. We currently infer "the market should
be locked" from a score delta. The WebSocket tells us `active: false` and
`suspended: true` directly, from the bookmaker. `liveFixtureLock.js` stops being
a heuristic and becomes a passthrough of the bookmaker's own suspension state.

Because messages are partial deltas, the socket consumer must maintain an
in-memory + Redis materialised view per live fixture rather than treating each
message as a snapshot. Note the documented quirk: **player objects are
retransmitted whole** when any field changes, so merge at the player level, not
the field level.

---

## 4. The request budget

Monthly limit 500,000 → **16,438/day**. We govern to a **13,000/day soft
ceiling** (79%), leaving ~3,400/day of unallocated burst.

### 4.1 Steady-state allocation (re-costed after §1.2)

Hard constraints from calibration: **max 5 tournament IDs per odds call**,
WebSocket is the primary price path, REST odds is seed + reconcile only.
Naive "poll all 111 upcoming tournaments every 3 minutes" would be
`ceil(111/5)×480 ≈ 10,600/day` on odds alone — over the daily share. Do not
do that.

Observed slate at calibration: 1,772 soccer tournaments, **111 with
upcoming (24h) fixtures**, ~565 with any future/upcoming/live count.

| Job | Endpoint | Cadence | Calls/tick | Calls/day |
|---|---|---|---|---|
| Static catalogue | `/v4/markets` (8.8 MB — cache a week), sports/bookmakers | weekly | 3 | ~0 |
| Tournament catalogue | `/v4/tournaments?sportId=10` | 1h | 1 | 24 |
| Participants | `/v4/participants?sportId=10` | 12h | 1 | 2 |
| Fixture sweep (14d, two ≤10d windows) | `/v4/fixtures?sportId=10&from&to` | 30m | 2 | 96 |
| Fixture lookback (2d) | `/v4/fixtures?sportId=10&from&to` | 1h | 1 | 24 |
| Odds seed/hot (kickoff ≤ 3h, ~40 tournaments) | `/v4/odds-by-tournaments` (5 ids) | 15m | 8 | 768 |
| Odds warm (≤ 24h, ~111 tournaments) | `/v4/odds-by-tournaments` | 1h | 23 | 552 |
| Odds cold (non-empty tournaments, ~565) | `/v4/odds-by-tournaments` | 6h | 113 | 452 |
| Live odds | **WebSocket** | push | 0 | **0** |
| Settlement | `/v4/settlements` **only fixtures with open tickets** | on FT + retry | 1/fixture | ~200–400 |
| Scores | `/v4/scores` bet-carrying only | on FT | 1/fixture | ~200 |
| Account | `/v4/account` | 5m | 0 | 0 |
| **Total** | | | | **~2,300–2,500** |

Still ~15% of the 16,400/day share. The 5-ID cap did **not** blow the budget
*provided* REST is not the live path.

Settlement dropped from ~1,000/day to a few hundred because we must not fetch
settlements for every finished fixture in the 36h lookback (472 finished in
that window). Only fixtures with `TicketSelection`s.

### 4.2 Batch size is no longer an unknown

**Maximum `tournamentIds` = 5.** Payload at 5 busy tournaments was 4.9 MB /
61 fixtures / 137 market ids — fine for a worker, too big to dump on a
request path. `verbosity=3` on those calls is cheap (+1%) and gives us
names + `externalProviders` in the same request.

`/v4/tournaments` `upcomingFixtures` / `liveFixtures` / `futureFixtures`
counts are the right way to *build* batch lists, but `liveFixtures` is
stale and includes matches with no 1xBet odds. Filter batches from **our
DB** (tournaments in which we actually have unsold or open-ticket
fixtures), not from the raw catalogue counts.

### 4.3 Degradation reserve (must be scoped)

The old ladder assumed **1 batch** of live tournaments. Reality: ~47
catalogue entries claim live fixtures, which at 5 ids/call is ~10 batches.
Polling that every 20s is `10 × 4,320 = 43,200/day` — over the daily share
by itself.

Fallback is therefore **only tournaments (or fixtures) with in-play
exposure** — open tickets, or markets on the live page we are currently
serving:

| WS state | What we poll | Cadence | Calls/day (15 exposed fixtures ≈ 3 batches) |
|---|---|---|---|
| Healthy | — | — | 0 |
| Reconnecting (< 2 min) | those 3 batches | 30s | 8,640 if it lasted a full day; actually a few dozen |
| Down, budget healthy | those 3 batches | 60s | 4,320 |
| Down, budget < 25% remaining | fixtures with **open tickets only**, `/v4/odds` | 2 min | well under 1,000 |

Do not poll the global live catalogue as a fallback.

### 4.4 Endpoint cooldowns are a separate constraint

Quota is monthly; cooldowns are per-endpoint and per-call. These must be
enforced independently of the budget governor:

| Endpoint | Cooldown |
|---|---|
| `/v4/odds`, `/v4/fixture` | 500 ms |
| `/v4/odds-by-tournaments`, `/v4/tournaments`, `/v4/scores`, `/v4/markets`, `/v4/participants`, `/v4/account` | 1,000 ms |
| `/v4/fixtures`, `/v4/settlements` | 2,000 ms |
| `/v4/historical-odds` | 5,000 ms (304s count too) |

The existing global gate in `apiSportsService.js` is a single
`MIN_REQUEST_INTERVAL_MS` shared by all endpoints. That is not sufficient here —
`/v4/settlements` at 2s and `/v4/odds` at 500ms need separate token buckets, or
a settlement burst will throttle everything else. This is a rewrite of the rate
gate, not a parameter change.

Practical ceiling check: `/v4/settlements` at 2s cooldown caps at 43,200/day, so
the cooldown is never the binding constraint on our ~1,000/day settlement load.

---

## 5. Quota governance

Today's quota control is `dailyCalls`, an in-memory `Map` in
`apiSportsService.js` that resets on process restart and is not shared between
the API process and the worker. With a monthly budget that cannot be replenished
by waiting until tomorrow, that is not adequate. Overspending in week one means
a dark sportsbook in week four.

### 5.1 Redis-backed monthly ledger

`backend/services/quota/oddspapiQuota.js`:

- `INCR` on key `oddspapi:usage:{valid_from}` on every billable call, TTL to
  `valid_until`. The period is **rolling 31 days from subscription start**,
  not a calendar month. Shared across API + worker processes.
- Per-bucket sub-counters `oddspapi:usage:{YYYY-MM}:{bucket}` where bucket ∈
  `catalogue | fixtures | odds_hot | odds_warm | odds_cold | live_fallback |
  settlement | scores | ondemand`. This is what makes overspend diagnosable
  instead of mysterious.
- Reconcile against `GET /v4/account` every 5 minutes. It is **unmetered**, so
  this costs nothing and gives us the provider's authoritative `request_count`.
  Our counter will drift; the provider's number wins. Count **every HTTP
  round-trip that is not `/v4/account` or `/v4/historical-odds`**, including
  404 `FIXTURE_NOT_FOUND` and 429 `RATE_LIMITED`. Only skip increment when
  the call never left the process (local cooldown gate).

### 5.2 Pace, don't cliff-edge

Define `expected_burn = request_limit * (elapsed_period / total_period)` and
`burn_ratio = request_count / expected_burn`.

| `burn_ratio` | Mode | Behaviour |
|---|---|---|
| < 1.0 | Normal | Full cadences |
| 1.0 – 1.15 | Watch | Log + alert, no change |
| 1.15 – 1.35 | Conserve | Hot odds 3m→5m, warm 20m→45m, cold 3h→8h, live fallback 20s→45s |
| > 1.35 | Critical | Odds sweeps to 15m/2h/24h, live fallback 90s, drop `/v4/scores` display calls |
| > 0.95 of limit | Freeze | **Settlement and fixture-status calls only.** Odds ingestion halts; the frontend serves last-known prices marked stale, and placement is blocked on stale markets |

The Freeze row is the important one and it must be built, not bolted on later.
Running out of quota must never mean unsettled tickets — that is a financial
liability, not a UX degradation. Settlement is the last thing we stop doing.

### 5.3 Never spend quota on the request path

`routes/footballPublic.js` currently calls `getLiveOdds()` and falls through to
`getOdds()` on a cache miss for `/odds/:apiFixtureId`; `odds-engine/
resolveLiveOdds.js` calls `getSingleFixtureLiveOdds()` during bet validation.
Under a monthly cap, a traffic spike or a scraper hitting an uncached fixture
becomes a quota incident.

**Public HTTP handlers must read only from Redis/Mongo.** On a miss, return the
last known snapshot with a staleness flag, or 503 the market — never fetch
upstream synchronously. Any on-demand need goes through a coalesced, rate-capped
background refresh with its own small bucket (`ondemand`, capped at e.g.
200/day).

---

## 6. Settlement rewrite

### 6.1 New flow

```
statusId → 2 (finished)          [WebSocket push, or fixture sweep]
   ↓
enqueue settle:{fixtureId}       [delay 60s — let the provider grade]
   ↓
GET /v4/settlements?fixtureId    [1 request]
   ↓
for each TicketSelection on the fixture:
     look up markets[provider_market_id]
              .outcomes[provider_outcome_id]
              .players[provider_player_id ?? "0"].result
   ↓
   WIN       → WON        (factor 1.0)
   LOSE      → LOST       (factor 0.0)
   HALFWIN   → WON        (factor 0.5 on the profit portion)
   HALFLOSS  → LOST       (factor 0.5 — half stake returned)
   PUSH      → VOID       (odds → 1.0, stake returned)
   CANCELLED → VOID
   UNDECIDED → stay PENDING and retry **only if we actually offered that
               marketId**. Catalogue-wide UNDECIDED is normal and must not
               drive retries (1,622 unused rows per finished fixture).
   missing   → stay PENDING, escalate to manual review after N attempts
   ↓
recomputeTicketStatus + wallet credit   [unchanged]
```

`ticketSettlementService.settleFixture()` keeps its signature and its
transaction boundary. What changes is that `gradeSelectionsInTx` stops calling
`marketEvaluatorV2` and instead consumes a settlement map.

### 6.2 Fractional results need a schema change

This is the one place where OddsPapi is *more* expressive than our model and it
must not be skipped. Asian handicap quarter lines (`-0.25`, `+0.75`) settle as
half-win or half-loss. Today we can only record `WON` or `LOST`, which would
overpay or overcharge every quarter-line bet.

```prisma
model TicketSelection {
  result        String   // PENDING | WON | LOST | VOID  (unchanged)
  result_factor Decimal? // 1.0 | 0.5 | 0.0 — NEW
  provider_market_id  Int?
  provider_outcome_id Int?
  provider_player_id  Int?     @default(0)
  provider_settlement Json?    // raw result blob, for audit
}
```

Payout for a leg becomes `stake * (1 + (odds - 1) * result_factor)` for wins and
`stake * (1 - result_factor)` returned for half-losses. Ticket-level
accumulation must be updated in `recomputeTicketStatus` accordingly.

Quarter-line handicaps are already on 1xBet (HALFWIN/HALFLOSS appeared on
every finished sample). Excluding them in phase 1 is still the safer
payout-math choice, but it is a product cut of markets customers will see
priced, not of a hypothetical edge case.

### 6.3 UNDECIDED and retry policy

`UNDECIDED` is normal — it means the provider has not graded that market yet.
Retry schedule: 1m, 5m, 15m, 30m, 1h, 2h, 6h, 12h, 24h. That is at most 9
requests per stubborn fixture. Cap concurrent settlement fetches so a mass
finish at 22:00 CET does not saturate the 2s cooldown; the existing
`settlement-retry` queue at concurrency 1 already provides this.

After 24h with legs still `UNDECIDED`, flag for manual review. Keep
`postponedSettlement.js`'s 72h void rule for `statusId: 3` (cancelled) fixtures —
though note that OddsPapi returns `CANCELLED` per outcome, which is more precise
than our current fixture-level postponement heuristic and should take priority
when present.

### 6.4 Reconciliation, cheaply

`/v4/historical-odds` is **free**, returns `ETag`/`If-None-Match` for finished
fixtures, and covers everything since January 2026. Use it for a nightly
closing-line audit and for customer disputes ("what price was showing at
19:42?") without touching quota. This is a capability we simply do not have
today.

---

## 7. Code layout

Introduce a provider abstraction rather than editing the API-Football client in
place, so both can run side by side during cutover.

```
backend/services/providers/
├── index.js                    # getProvider() — switches on SPORTS_PROVIDER
├── contract.md                 # the interface both providers satisfy
├── apifootball/                # existing apiSportsService.js, moved
└── oddspapi/
    ├── client.js               # axios + apiKey query param + per-endpoint cooldown gate
    ├── quota.js                # Redis ledger, burn_ratio, mode selection
    ├── endpoints.js            # typed wrappers: tournaments, fixtures, oddsByTournaments,
    │                           #   settlements, scores, markets, participants, account
    ├── websocket.js            # persistent WS, reconnect w/ jitter, heartbeat, staleness
    ├── normalize/
    │   ├── fixture.js          # OddsPapi fixture → Fixture upsert shape
    │   ├── odds.js             # bookmakerOdds tree → FixtureMarket / FixtureOddLine
    │   └── settlement.js       # settlements tree → { marketId,outcomeId,playerId } → result
    └── marketMap.generated.js  # from GET /v4/markets
```

| Existing file | Fate |
|---|---|
| `services/apiSportsService.js` | Move under `providers/apifootball/`, keep behind flag |
| `jobs/syncFixtures.js` | Rewrite against `/v4/fixtures`; drop inline league/team upsert (OddsPapi embeds richer metadata) |
| `jobs/syncOdds.js` | **Replaced** by a tournament-batch sweeper; per-fixture odds loop disappears |
| `jobs/syncLiveFixtures.js`, `jobs/syncLiveScores.js` | **Replaced** by the WebSocket consumer + a degraded-mode poller |
| `jobs/enrichFixtureResult.js` | **Delete** |
| `services/matchResult/v2.js` | **Delete** for provider legs |
| `services/marketEvaluator*.js`, `services/markets/*` graders | Retain only for the admin `Match`/`Odd` path |
| `services/markets/marketSupport.js` | Keep allowlist; delete string-parsing layer |
| `Config/marketAllowlist.js` | Re-key to OddsPapi `marketId`s |
| `services/odds-engine/liveFixtureLock.js` | Simplify to a passthrough of `suspended`/`marketActive`/`active` |
| `lib/socketHub.js` | Unchanged interface; now fed by the OddsPapi WS instead of goal heuristics |
| `routes/footballPublic.js` | Remove all synchronous upstream fetches (§5.3) |

### New env vars

```
SPORTS_PROVIDER=oddspapi            # apifootball | oddspapi
ODDSPAPI_API_KEY=
ODDSPAPI_BASE_URL=https://api.oddspapi.io
ODDSPAPI_BOOKMAKER=1xbet
ODDSPAPI_SPORT_ID=10
ODDSPAPI_WS_URL=wss://api.oddspapi.io/v4/ws
ODDSPAPI_WS_ENABLED=1

ODDSPAPI_MONTHLY_LIMIT=500000
ODDSPAPI_SOFT_CEILING_RATIO=0.79
ODDSPAPI_TOURNAMENT_BATCH_SIZE=5    # hard cap from the API (§1.2)
ODDSPAPI_ODDS_HOT_SECONDS=180
ODDSPAPI_ODDS_WARM_SECONDS=1200
ODDSPAPI_ODDS_COLD_SECONDS=10800
ODDSPAPI_LIVE_FALLBACK_SECONDS=20
ODDSPAPI_ONDEMAND_DAILY_CAP=200
```

---

## 8. Migration sequence

The hard constraint: **open tickets placed on API-Football fixtures must still
settle correctly.** They cannot be re-keyed to OddsPapi ids retroactively,
because their `market_code`/`market_params` were resolved from API-Football
strings.

Strategy: **run both providers concurrently until the last API-Football-sourced
ticket resolves.** New tickets go to OddsPapi, old tickets keep settling on the
old path. The `provider` column on `Fixture` and `TicketSelection` makes this a
routing decision, not a fork.

| Phase | Work | Exit criteria |
|---|---|---|
| **0. Calibrate** | **Done, §1.1–1.2** (WS billing, batch cap=5, verbosity, 1xBet market sample, settlements shape, rolling quota, per-endpoint 429). Remaining: catch one in-play 1xBet fixture on REST during a major-league window; snapshot weekend market coverage. | In-play REST vs WS settled; weekend market set signed off |
| **1. Read-only shadow** | **Implemented behind `ENABLE_ODDSPAPI_SHADOW`.** Provider client, quota ledger, catalogue/fixture/odds jobs, WebSocket consumer. Rows stored with `provider="oddspapi"` and excluded from public/settlement/API-Football jobs. Nothing served to customers. | 7 days of clean ingestion; actual daily burn within 30% of the §4.1 model |
| **2. Fixture bridge** | Match OddsPapi fixtures to existing rows via `externalProviders` and `(startTime, participant names)` fuzzy match. Populate cross-references. | >99% match rate on the next-7-day slate; unmatched fixtures reported |
| **3. Settlement shadow** | Run `/v4/settlements` alongside the V2 grader on finished fixtures. Compare every leg. **Do not** act on OddsPapi results yet. | Zero disagreements over 1,000+ legs, or every disagreement explained |
| **4. Market allowlist rebuild** | Derive allowlist from measured `/v4/settlements` coverage per `marketId`. Remove player props. Decide on quarter-line handicaps (§6.2). | Allowlist signed off; placement guard enforces it |
| **5. WebSocket** | Consumer, materialised view, reconnect, degraded-mode fallback, `market:locked` wired to `suspended`/`active`. | 48h continuous uptime; delta view matches a REST snapshot on demand |
| **6. Cutover** | `SPORTS_PROVIDER=oddspapi`. New tickets on OddsPapi. API-Football jobs keep running **settlement only**. | Live for 14 days |
| **7. Decommission** | Last API-Football ticket settled → delete `enrichFixtureResult`, `matchResult/v2`, grader modules, API-Football client, its env vars and its 150k/day contract. | — |

Phase 3 is the one to be strict about. It is the only phase that proves the
premise of the entire migration, and it costs almost nothing to run long. Do not
shorten it to hit a date.

---

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `odds-by-tournaments` capped at **5** ids | Naive hot-polling blows the day | Measured. REST is seed/reconcile only; WS is the price path (§4.1) |
| 1xBet priced **137** market ids in a weekday sample (many are O/U and AH *lines*) | Offerable set is smaller than the 1,122-row catalogue | Snapshot a weekend slate before locking the allowlist |
| No player props on the plan | Goalscorer markets removed | Confirmed on the live account |
| WS fallback polling the whole live catalogue | 43k requests/day | Scope fallback to in-play **exposure** only (§4.3) |
| 429 retries / empty 404s | Silent quota leak | Local cooldown gate; never scan empty id lists |
| `/v4/fixtures?tournamentId=` without dates | Multi-MB archive, wasted call | Always pass `from`/`to` |
| WebSocket unstable | Live betting degrades to polling | Degradation ladder (§4.3) sized so even permanent WS loss fits budget |
| Settlement disagrees with our graders in shadow | Migration premise weakened | Phase 3 gate. If disagreements are systematic, we learn it before customers do |
| Monthly quota exhausted mid-period | Sportsbook goes dark | Burn-ratio pacing (§5.2) + Freeze mode that preserves settlement above all else |
| Quarter-line Asian handicaps mis-paid | Financial loss | Exclude from phase-1 allowlist; ship `result_factor` separately (§6.2) |
| Fixture bridge misses fixtures during cutover | Orphaned open tickets | Dual-provider run until the last old ticket settles; no retroactive re-keying |
| `/v4/settlements` returns `UNDECIDED` indefinitely | Tickets stuck pending | Bounded retry ladder + manual-review escalation at 24h (§6.3) |

---

## 10. What to decide before writing code

1. **Player props** — confirmed unavailable on `1xbet` (§1.1). Accept losing
   goalscorer markets, or upgrade the plan?
2. **Market breadth** — weekday sample saw 137 priced 1xBet `marketId`s.
   Snapshot a Saturday 15:00 GMT slate before locking the allowlist.
3. **Quarter-line handicaps** — they **are** priced and they **do** settle
   HALFWIN/HALFLOSS. Exclude in phase 1 (recommended), or build
   `result_factor` up front?
4. **Sports** — the plan covers Soccer only (`sportId: 10`). Confirm nothing
   else is planned, since `sportsRegistry.js` currently anticipates basketball
   and others.

---

## Appendix: reference tables

### OddsPapi status ids

| `statusId` | Meaning | Our action |
|---|---|---|
| 0 | Pre-Game | Prematch odds; placement open |
| 1 | Live | WS-driven prices; live placement rules apply |
| 2 | Finished | Enqueue settlement |
| 3 | Cancelled | Void via settlement `CANCELLED` results |

### Billing classification

| Class | Endpoints |
|---|---|
| Billable | `/v4/players`, `/v4/settlements`, `/v4/fixtures`, `/v4/fixture`, `/v4/odds-by-tournaments`, `/v4/languages`, `/v4/sports`, `/v4/bookmakers`, `/v4/markets`, `/v4/tournaments`, `/v4/participants`, `/v4/scores`, `/v4/odds` |
| Free | `/v4/historical-odds` |
| Unmetered | `/v4/account` |

A request is counted **after** the endpoint processes it, including 4xx and 5xx.
Calls rejected before reaching the endpoint (invalid key, quota already
exhausted) are not counted. Measured: **cooldown 429 and empty 404s *are*
counted.** A retry loop or a scan of empty tournaments burns the month just
like working code. Every job must halt a bucket after N consecutive non-200
responses, and the HTTP client must wait out `retryMs` *locally* so those
429s never hit the wire.
