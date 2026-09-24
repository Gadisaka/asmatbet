# Bonus & Promotions System

## Overview

The platform provides promotional bonuses for players.

---

## Types of Bonuses

### Welcome Bonus (Registration Bonus)

Given when a player registers. Same as Registration bonus.

---

### First Deposit Bonus

Given on first deposit only.

---

### Deposit Bonus

Given on deposits (not restricted to first deposit).

---

### Accumulator Bonus

Applied when multiple matches are selected.

Example:

> More than 10 matches → +3% bonus

---

### Cashback (multi-track v3)

Players and offline ticket holders receive a **stake × multiplier** refund
when a ticket loses **exactly 1, 2, or 3** selections (4+ losses → no
cashback). The multiplier comes from the track matching that lost-leg
count, keyed on:

`result = total_odds ÷ sum(lost-leg odds)`

Cashback is evaluated only after **every leg is resolved** (no pending
selections). Combined odds are **recomputed from the graded legs**
(VOID → 1.0, excluded from selection count) rather than from the frozen
`ticket.total_odds` snapshot.

Admin configures (Settings → **Cashback** tab):

- Global: max hours from placement (default 48), disqualifying fixture/match statuses
- Per track (1 / 2 / 3 losses): min selections (≥ inclusive), min stake online,
  min stake offline, max cashback cap, half-open payout tiers
  (`minResult ≤ result < maxResult`; last tier may be open-ended)

**Worked examples:**

- 1 loss: total odds 46, stake 10, lost leg 1.2 → `46 ÷ 1.2 ≈ 38.33` →
  19–40 tier (×1) → **10 birr**.
- 2 losses: total odds 110, stake 5, lost legs summing to 2.6 →
  `110 ÷ 2.6 ≈ 42.3` → 20–45 tier (×1) → **5 birr**.

**Payout paths:**

- **Online** (player wallet ticket, not cashier-printed): credit
  `BONUS` ref `bonus:cashback:<ticketId>` and persist `ticket.cashback_amount`.
- **Offline** (cashier-printed or no `user_id`): persist
  `ticket.cashback_amount` only; cashier redeems via
  `PATCH /api/tickets/:id/cashback-payout` which credits the cashier wallet
  with `BONUS` ref `cashback-payout:<ticketId>` and sets `cashback_paid_at`.

---

## Admin Controls

Admin can:

- Edit bonus
- Enable/disable bonus

---

## Implementation (backend)

- **Storage:** `Bonus` model in Mongo (`name`, `type`, `percentage`, `min_deposit`, `rules` JSON, `status`). The schema enforces **exactly one document per `type`** (`@@unique([type])`). Preset rows for all six types are **created by `db seed`** (`upsert` by `type` with `update: {}` so re-seeding does **not** overwrite live admin edits). **Deploy note:** if an older database has **duplicate** bonuses sharing the same `type`, remove or merge duplicates before applying the unique constraint (e.g. keep the newest per type, delete the rest).
- **Admin API:** `GET /api/admin/bonuses`, `GET /api/admin/bonuses/:id`, `PATCH /api/admin/bonuses/:id` only — there is **no** `POST` to create bonuses. `PATCH` accepts only safe fields; `name`, `type`, and raw `rules` cannot be set by clients — the server builds `rules` from typed inputs (welcome fixed amount, deposit percentages, accumulator tiers, cashback eligibility gates + tiers, etc.). Cashback management is gated on `settings:read` / `settings:update`, held only by **SUPER_ADMIN** and **ADMIN**.
- **Ledger:** Bonus credits use `Transaction.type = BONUS` with unique `reference`:
  - Welcome: `bonus:welcome:<userId>`
  - Deposit (first or repeat): `bonus:deposit-tx:<playerDepositTransactionId>`
  - Cashback on loss (online): `bonus:cashback:<ticketId>`
  - Cashback redemption (offline cashier): `cashback-payout:<ticketId>`
- **Welcome:** `rules.fixedAmount` if set; otherwise `percentage` is treated as a **flat** currency amount.
- **Deposits (online verify + cashier → player):** On the player’s **first** deposit only, the system credits **max(FIRST_DEPOSIT %, DEPOSIT %)** against the same deposit amount (does not stack both). Later deposits use **DEPOSIT** only. `User.first_deposit_at` is set on first successful deposit.
- **Accumulator:** `rules.tiers[]` with `{ minLegs, bonusPercent }`; highest matching tier applies. Gross win = `stake × totalOdds × (1 + bonusPercent/100)`. Snapshotted on the ticket as `accumulator_bonus_percent`; settlement recomputes WON payout using this snapshot.
- **Cashback (multi-track v3):** `rules` holds `maxHours`, `disqualifyFixtureStatuses[]`, `disqualifyMatchStatuses[]`, and `tracks[]` of `{ lostLegs, minSelections, minStakeOnline, minStakeOffline, maxCashback, tiers[] }`. Tier ranges are **half-open** (`minResult ≤ result < maxResult`). When a ticket becomes **LOST**, exact lost-leg count `1|2|3` selects the track; ratio = recomputed total odds ÷ **sum** of lost-leg odds; amount = `min(stake × multiplier, maxCashback)`. Online tickets credit the player wallet and set `ticket.cashback_amount`; offline/cashier-printed tickets only set `cashback_amount` for later `cashback-payout`. Settlement retries while legs are still `PENDING`. **Fallbacks:** if `tracks` is empty, v2 inclusive `tiers` + largest-lost-leg divisor still applies; if no tiers either, legacy flat `percentOfStake` applies. Existing DBs keep old rules until admin saves the Cashback tab or `node backend/scripts/backfillCashbackRules.js` is run.
- **Admin UI:** Settings → **Cashback** tab (dedicated `CashbackPanel` with three track sections); other bonuses remain on the **Bonuses** tab (`/api/admin/bonuses`).
- **Public config for slip:** `GET /api/bets/bonuses/active` — active bonuses (sanitized) for frontend preview.
- **Coupon check:** exposes `cashbackAmount` from `ticket.cashback_amount` (legacy BONUS txn fallback) and `cashbackPaid`.

**Future:** separate locked `bonus_balance` / wagering — v1 credits to main `Wallet.balance`.
