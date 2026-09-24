# Cashier manual deposit — duplicate transaction reference fix

**Status:** Fixed (2026-06-01)  
**Affected endpoint:** `POST /api/cashier/wallet/deposit`  
**Symptom:** Manual deposit from the cashier page worked locally but returned **500 Internal Server Error** in production.

---

## Executive summary

Cashier-to-player deposits create **two ledger rows** (cashier wallet debits, player wallet credits). Both rows were written with the **same** `Transaction.reference` value. Production enforces a **global unique index** on that field, so the second insert failed with Prisma **`P2002`**, rolled back the transaction, and surfaced as a generic 500.

The fix gives each leg its own reference while keeping a shared prefix for reporting and history queries.

Use this document when porting wallet flows to other betting / cashier projects that share the same Prisma schema pattern.

---

## Symptoms

| Environment | Behavior |
|-------------|----------|
| Local dev | Deposit succeeds |
| Production | `POST /api/cashier/wallet/deposit` → **500** |

Production logs (grep):

```bash
docker compose -f docker-compose.prod.yml logs backend --tail=100 | grep -i "cashierDeposit error"
```

Typical output before the fix:

```text
cashierDeposit error: PrismaClientKnownRequestError:
```

The message is truncated in default Docker log formatting; the underlying error is **`P2002`** (unique constraint on `reference`).

---

## Root cause

### Dual-wallet deposit flow

When a cashier deposits into a player account:

1. Cashier wallet balance **decreases** → ledger row `type: WITHDRAW`
2. Player wallet balance **increases** → ledger row `type: DEPOSIT`

Both rows were created with identical references:

```js
reference: `cashier-deposit:${cashierUserId}:to:${playerId}`
```

### Global unique constraint

In [backend/prisma/schema.prisma](../backend/prisma/schema.prisma):

```prisma
model Transaction {
  // ...
  reference String? @unique
}
```

`reference` is unique **across all wallets**, not per wallet. The second `transaction.create` in the same `$transaction` block always failed in production.

### Why local worked but production did not

| Factor | Local | Production |
|--------|-------|------------|
| Schema sync | Often older DB or `db push` not re-run after `@unique` was added | `prisma db push` applied; unique index exists |
| Constraint enforcement | Duplicate references may insert successfully | MongoDB / Prisma rejects duplicate → **P2002** |

**Rule of thumb:** If a wallet flow works locally but fails only after deploy with `PrismaClientKnownRequestError`, check whether production has indexes or constraints that local Mongo does not.

---

## Fix

**File:** [backend/controllers/cashierWalletController.js](../backend/controllers/cashierWalletController.js)  
**Function:** `cashierDeposit`

Each ledger leg gets a distinct suffix; reporting prefixes stay unchanged:

```js
const depositRefBase = `cashier-deposit:${req.user.sub}:to:${player.id}`;

// Cashier wallet (money out)
reference: `${depositRefBase}:cashier`,

// Player wallet (money in)
reference: `${depositRefBase}:player`,
```

### Why this suffix pattern

Existing queries filter cashier-side activity with `startsWith: "cashier-deposit:"`:

- [backend/controllers/cashierWalletController.js](../backend/controllers/cashierWalletController.js) — cashier history
- [backend/controllers/cashierDashboardController.js](../backend/controllers/cashierDashboardController.js) — dashboard stats
- [backend/controllers/agentController.js](../backend/controllers/agentController.js) — agent cashier wallet activity

The cashier leg still matches those filters. The player leg is only needed for the player wallet ledger and bonus engine (`applyDepositBonusesInTx` uses the player deposit transaction id, not the reference string).

### Correct pattern elsewhere in this codebase

Withdraw approval already uses **different** references per leg ([backend/lib/completePendingPlayerWithdrawal.js](../backend/lib/completePendingPlayerWithdrawal.js)):

- Player pending row: updated to `approved:{approverId}:…`
- Cashier credit row: `cashier-withdraw-approve:{approverId}:from:{playerId}`

New dual-wallet flows should follow that model, not reuse one reference for both sides.

---

## Deployment checklist

After merging the fix:

```bash
cd ~/sishubet   # or project root on the VPS
git pull
docker compose -f docker-compose.prod.yml up -d --build backend worker
```

Verify:

1. Retry a manual deposit from the cashier UI — expect **200** and updated balances.
2. Confirm logs are clean:

   ```bash
   docker compose -f docker-compose.prod.yml logs backend --tail=50 | grep -i "cashierDeposit error"
   ```

3. Optional: confirm ledger rows in Mongo — two references for one deposit, e.g.  
   `cashier-deposit:…:cashier` and `cashier-deposit:…:player`.

No schema migration is required; this is application-level reference naming only.

---

## Reuse guide for similar projects

### When to suspect this bug

Apply this checklist when **any** flow writes more than one `Transaction` row in a single business action:

- [ ] Cashier / agent / admin transfer between two wallets
- [ ] Deposit, withdraw, or internal transfer with debit + credit legs
- [ ] Refund or reversal that mirrors an original entry
- [ ] Works locally, fails in production with **500** or **409**
- [ ] Logs mention `PrismaClientKnownRequestError` or **`P2002`**

### Design rules for `Transaction.reference`

1. **One reference per row** — never reuse the same string for two inserts.
2. **Shared semantic prefix** — use a common prefix (`cashier-deposit:`, `agent-transfer:`) plus a leg suffix (`:cashier`, `:player`, `:out`, `:in`).
3. **Idempotency** — use a stable, unique reference per *attempt* (e.g. include idempotency key or external payment id), not one string for both sides of a transfer.
4. **Query compatibility** — if dashboards use `startsWith`, keep the prefix on the leg those queries read (usually the operator/cashier wallet).
5. **Document in schema** — if `reference @unique` is intentional, comment it in `schema.prisma` and enforce unique references in tests (see [backend/tests/fixtures/prismaInMemoryStub.js](../backend/tests/fixtures/prismaInMemoryStub.js)).

### Reference naming template

```text
{flow}:{actorId}:{direction}:{counterpartyId}:{leg}

Examples:
  cashier-deposit:{cashierUserId}:to:{playerId}:cashier
  cashier-deposit:{cashierUserId}:to:{playerId}:player
  cashier-withdraw-approve:{cashierUserId}:from:{playerId}
  bonus:deposit-tx:{playerDepositTransactionId}
```

### Minimal test to catch regressions

In an in-memory or integration test stub that enforces `reference @unique`:

1. Create cashier + player wallets with balance.
2. Run the deposit transaction helper.
3. Assert two transaction rows exist with **different** `reference` values.
4. Assert both wallets reflect the expected balances.

---

## Related files

| Area | Location |
|------|----------|
| Deposit handler | `backend/controllers/cashierWalletController.js` → `cashierDeposit` |
| Withdraw (correct dual-leg pattern) | `backend/lib/completePendingPlayerWithdrawal.js` |
| Unique reference constraint | `backend/prisma/schema.prisma` → `Transaction.reference` |
| In-memory unique reference simulation | `backend/tests/fixtures/prismaInMemoryStub.js` |
| Cashier API route | `backend/routes/cashierWallet.js` |
| Admin UI hook | `admin/src/hook/useCashierWallet.js` |

---

## Lessons learned

1. **Local ≠ production for constraints** — always run `prisma db push` (or migrations) against a fresh local DB when debugging prod-only failures.
2. **Generic 500s hide P2002** — improve error logging temporarily (`console.error(error.message, error.code, error.meta)`) when triaging production wallet bugs.
3. **Dual-leg flows need a reference convention** — document it once and apply consistently across deposit, withdraw, transfer, and settlement code paths.
