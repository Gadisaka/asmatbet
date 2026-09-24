# External Payment Verification Integration Guide (AsmatBet)

End-to-end documentation for how AsmatBet verifies **CBE**, **Telebirr**, and **CBE Birr** transfers via an external Verifier API, then credits a player wallet **once** per payment reference.

This guide is written so another developer (or an AI) can re-implement the same flow in another codebase.

---

## Table of contents

1. [What we use](#1-what-we-use)
2. [High-level architecture](#2-high-level-architecture)
3. [End-to-end player journey](#3-end-to-end-player-journey)
4. [Environment variables](#4-environment-variables)
5. [File map (AsmatBet)](#5-file-map-asmatbet)
6. [External Verifier API contract](#6-external-verifier-api-contract)
7. [Our API contract (player + admin + public)](#7-our-api-contract-player--admin--public)
8. [Step-by-step server flow](#8-step-by-step-server-flow)
9. [Idempotency & ledger references](#9-idempotency--ledger-references)
10. [Receiver matching (anti-mispayment)](#10-receiver-matching-anti-mispayment)
11. [SMS extraction rules](#11-sms-extraction-rules)
12. [Success / amount parsing rules](#12-success--amount-parsing-rules)
13. [Frontend online deposit wizard](#13-frontend-online-deposit-wizard)
14. [Admin configuration](#14-admin-configuration)
15. [Database / Prisma](#15-database--prisma)
16. [Bonuses & notifications](#16-bonuses--notifications)
17. [Error responses](#17-error-responses)
18. [Manual test checklist](#18-manual-test-checklist)
19. [Unit tests](#19-unit-tests)
20. [Security notes](#20-security-notes)
21. [Porting checklist (new project)](#21-porting-checklist-new-project)
22. [Full source code (as used in AsmatBet)](#22-full-source-code-as-used-in-asmatbet)
23. [AI prompt (copy-paste)](#23-ai-prompt-copy-paste)

---

## 1. What we use

### External service

We call **Leul Zenebe / Creofam Verifier API**:

| Item | Value |
|------|--------|
| Public base URL (example) | `https://verifyapi.leulzenebe.pro` |
| API key portal / docs | `https://verify.leul.et` and `https://verify.leul.et/docs` |
| Open-source upstream | `https://github.com/Vixen878/verifier-api` |
| Auth header | `x-api-key: <YOUR_API_KEY>` |
| Content type | `application/json` |

**Important disclaimer (from upstream):** this is **not** an official bank/telecom API. It scrapes publicly available receipt pages. Treat it as a utility verification layer, not a regulated payment gateway.

### Methods AsmatBet supports

| Internal `method` | External path | Player input we send |
|-------------------|---------------|----------------------|
| `cbe` | `POST /verify-cbe` | `reference` + `accountSuffix` (usually parsed from SMS) |
| `telebirr` | `POST /verify-telebirr` | `reference` (usually parsed from SMS) |
| `cbebirr` | `POST /verify-cbebirr` | `receiptNumber` + `phoneNumber` (usually parsed from SMS) |

### What AsmatBet does with a successful verify

1. Confirm provider says the payment completed.
2. Confirm the credited party matches **admin-configured receivers**.
3. Confirm verified amount matches the amount the player typed (ε = `0.01` ETB).
4. Credit the player wallet inside a DB transaction.
5. Store a **unique** ledger `reference` so the same bank receipt cannot be credited twice.
6. Apply deposit bonuses + send a deposit notification.

---

## 2. High-level architecture

```text
┌─────────────────────┐     JWT + permission      ┌──────────────────────────────┐
│  Player frontend    │ ─────────────────────────► │  AsmatBet backend            │
│  Deposit.jsx        │  POST /api/player/         │  onlineDepositController.js │
│  (method, amount,   │       wallet/online-deposit│                              │
│   smsText)          │                            │  1) parse SMS                │
└─────────────────────┘                            │  2) build ledger ref         │
                                                   │  3) call Verifier API        │
┌─────────────────────┐                            │  4) match receivers          │
│  Admin portal       │  PUT receivers settings    │  5) match amount             │
│  OnlineDeposit      │ ─────────────────────────► │  6) credit wallet (unique)   │
│  ReceiversPanel     │                            └──────────────┬───────────────┘
└─────────────────────┘                                           │
                                                                  │ x-api-key
                                                                  ▼
                                                   ┌──────────────────────────────┐
                                                   │  External Verifier API       │
                                                   │  /verify-cbe                 │
                                                   │  /verify-telebirr            │
                                                   │  /verify-cbebirr             │
                                                   └──────────────────────────────┘

┌─────────────────────┐   GET /api/cms/platform-config
│  Player frontend    │ ◄── receivers + deposit limits (public)
└─────────────────────┘
```

**Never call the Verifier API from the browser.** The API key stays on the server (`PAYMENT_VERIFY_API_KEY`). The frontend only talks to our backend.

---

## 3. End-to-end player journey

1. **Admin** configures deposit receivers (name + account/phone) in Admin → Settings → Payments.
2. **Player** opens Deposit → Online tab.
3. Frontend loads public `platform-config` (limits + receiver display details).
4. Player chooses method (`telebirr` / `cbe` / `cbebirr`).
5. Player enters amount (validated against `MIN_DEPOSIT` / `MAX_DEPOSIT`).
6. Player pays that amount in their banking / Telebirr / CBE Birr app **to the displayed receiver**.
7. Player pastes the full SMS into the app.
8. Frontend `POST`s `{ method, amount, smsText }` to `/api/player/wallet/online-deposit` with player JWT.
9. Backend extracts references from SMS, calls Verifier API, validates, credits wallet.
10. Frontend shows success (credited amount + new balance) or failure message.

Manual field mode is also supported by the backend (send `reference` / `accountSuffix` / `receiptNumber` / `phoneNumber` without `smsText`). The current player UI always sends `smsText`.

---

## 4. Environment variables

Set these in `backend/.env` (and production/staging secrets):

```env
# Trailing slash optional — client strips it
PAYMENT_VERIFY_BASE_URL=https://verifyapi.leulzenebe.pro

# Secret — generate at https://verify.leul.et — NEVER commit real keys
PAYMENT_VERIFY_API_KEY=sk_live_REPLACE_ME
```

If either value is missing/blank:

- `isPaymentVerifyConfigured()` returns `false`
- `POST /api/player/wallet/online-deposit` returns **503**  
  `{ "message": "Online deposit is temporarily unavailable." }`

---

## 5. File map (AsmatBet)

| Path | Role |
|------|------|
| `backend/services/paymentVerifyClient.js` | HTTP client to external Verifier API |
| `backend/lib/onlineDepositVerify.js` | Pure helpers: amount parse, success checks, ledger refs |
| `backend/lib/depositSmsExtract.js` | Parse CBE / Telebirr / CBE Birr SMS bodies |
| `backend/lib/onlineDepositReceiversConfig.js` | Admin receiver settings + match against verify response |
| `backend/lib/phone.js` | `normalizeEthiopiaPhone` → `251…` |
| `backend/controllers/onlineDepositController.js` | Main deposit endpoint orchestration |
| `backend/controllers/settingsController.js` | GET/PUT online deposit receivers |
| `backend/routes/player.js` | Mounts `POST /wallet/online-deposit` |
| `backend/routes/settings.js` | Mounts admin receivers routes |
| `backend/routes/cmsPublic.js` | Public receivers via `platform-config` |
| `backend/index.js` | Mounts `/api/player` + `/api/admin/settings` |
| `backend/tests/onlineDeposit.test.js` | Unit tests for verify helpers |
| `backend/tests/onlineDepositReceivers.test.js` | Unit tests for receiver matching |
| `backend/tests/depositSmsExtract.test.js` | Unit tests for SMS parsing |
| `frontend/src/pages/Deposit.jsx` | Player 4-step online deposit UI |
| `frontend/src/services/api.js` | `submitOnlineDeposit`, `fetchPublicPlatformConfig` |
| `frontend/src/hooks/usePlatformSettings.js` | Cached public config (receivers + limits) |
| `admin/src/components/settings/OnlineDepositReceiversPanel.jsx` | Admin form |
| `admin/src/hook/useSettingsQuery.js` | React Query hooks for receivers |
| `admin/src/pages/admin/OnlineDepositReceiversPage.jsx` | Redirects to Settings → Payments |

---

## 6. External Verifier API contract

Base URL from env: `PAYMENT_VERIFY_BASE_URL`.

All verify calls:

```http
POST {BASE}{path}
Content-Type: application/json
x-api-key: {PAYMENT_VERIFY_API_KEY}
```

### 6.1 CBE — `POST /verify-cbe`

**Request**

```json
{
  "reference": "FT26095YRWP5",
  "accountSuffix": "45822425"
}
```

How we get these from SMS: CBE SMS contains a URL like  
`https://apps.cbe.com.et:100/?id=FT26095YRWP545822425`  
→ token after `id=` → last 8 chars = `accountSuffix`, remainder = `reference`.

**Success shape we rely on**

```json
{
  "success": true,
  "amount": "10.00 ETB",
  "receiver": "Tewachew Adimasu",
  "receiverAccount": "E12340910",
  "payer": "...",
  "date": "...",
  "reference": "..."
}
```

AsmatBet success rule: `body.success === true`  
Amount field: `body.amount` (parsed with `parseEtbMoneyString`)  
Receiver match fields: `receiver`, `receiverAccount`

### 6.2 Telebirr — `POST /verify-telebirr`

**Request**

```json
{
  "reference": "DD23HGV3T7"
}
```

**Success shape we rely on**

```json
{
  "success": true,
  "data": {
    "transactionStatus": "Completed",
    "totalPaidAmount": "101.00 Birr",
    "payerName": "...",
    "paymentDate": "...",
    "receiptNo": "...",
    "creditedPartyName": "daniel regasa",
    "creditedPartyAccountNo": "2519****5610"
  }
}
```

AsmatBet success rule:  
`body.success === true` **and** `data.transactionStatus` (case-insensitive) === `"completed"`  
Amount: `body.data.totalPaidAmount`  
Receiver match: `data.creditedPartyName`, `data.creditedPartyAccountNo`

### 6.3 CBE Birr — `POST /verify-cbebirr`

**Request**

```json
{
  "receiptNumber": "DD3419QEAOK",
  "phoneNumber": "251982828380"
}
```

Phone **must** be Ethiopian `251` + 9 digits. We normalize with `normalizeEthiopiaPhone` before calling.

**Success shape we rely on**

```json
{
  "transactionStatus": "Completed",
  "totalPaidAmount": "73000.00",
  "paidAmount": "73000.00",
  "customerName": "...",
  "transactionDate": "...",
  "reference": "...",
  "orderId": "...",
  "receiverName": "AMANUEL LEGESSE",
  "creditAccount": "2519..."
}
```

AsmatBet success rule: `transactionStatus` (case-insensitive) === `"completed"`  
Amount: `totalPaidAmount` then fallback `paidAmount`  
Receiver match: `receiverName`, `creditAccount`

### 6.4 Sample cURL (direct to Verifier — for debugging only)

```bash
# CBE
curl -X POST "$PAYMENT_VERIFY_BASE_URL/verify-cbe" \
  -H "x-api-key: $PAYMENT_VERIFY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "reference": "FT2513001V2G", "accountSuffix": "39003377" }'

# Telebirr
curl -X POST "$PAYMENT_VERIFY_BASE_URL/verify-telebirr" \
  -H "x-api-key: $PAYMENT_VERIFY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "reference": "CE2513001XYT" }'

# CBE Birr
curl -X POST "$PAYMENT_VERIFY_BASE_URL/verify-cbebirr" \
  -H "x-api-key: $PAYMENT_VERIFY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "receiptNumber": "RECEIPT_NUMBER", "phoneNumber": "251912345678" }'
```

### 6.5 Hosting caveat (Telebirr)

Upstream notes that Telebirr receipt pages often block foreign IPs. If Telebirr verifies fail from your VPS, host the verifier (or its proxy) inside Ethiopia, or use their documented fallback. Our AsmatBet client simply surfaces network/API errors as deposit failures.

---

## 7. Our API contract (player + admin + public)

### 7.1 Player: verify + credit

```http
POST /api/player/wallet/online-deposit
Authorization: Bearer <PLAYER_JWT>
Content-Type: application/json
```

**Auth / permission**

- Mounted under `authenticateToken` + `authorizePermission("wallet:deposit")`
- Controller additionally requires `req.user.role === "PLAYER"`

**Body (SMS mode — what the UI sends)**

```json
{
  "method": "telebirr",
  "amount": 30,
  "smsText": "Dear Walelign ... Your transaction number is DD23HGV3T7. ..."
}
```

**Body (manual fields — also supported)**

```json
{
  "method": "cbe",
  "amount": 10,
  "reference": "FT26095YRWP5",
  "accountSuffix": "45822425"
}
```

```json
{
  "method": "cbebirr",
  "amount": 10,
  "receiptNumber": "DD3419QEAOK",
  "phoneNumber": "0912345678"
}
```

**Success `200`**

```json
{
  "ok": true,
  "newBalance": 430.5,
  "creditedAmount": 30,
  "reference": "online-pay:telebirr:DD23HGV3T7",
  "verifySummary": {
    "payerName": "...",
    "paymentDate": "...",
    "receiptNo": "..."
  }
}
```

`verifySummary` shape depends on method (see controller `verifySummaryFromResponse`).

### 7.2 Admin: receivers

```http
GET  /api/admin/settings/online-deposit-receivers
PUT  /api/admin/settings/online-deposit-receivers
Authorization: Bearer <ADMIN_JWT>
```

Permissions: `settings:read` / `settings:update`

**PUT body**

```json
{
  "cbe": {
    "receiverName": "Tewachew Adimasu",
    "receiverAccount": "1000...."
  },
  "telebirr": {
    "receiverName": "daniel regasa",
    "receiverPhone": "251912345610"
  },
  "cbebirr": {
    "receiverName": "AMANUEL LEGESSE",
    "receiverPhone": "2519...."
  }
}
```

Stored in `Setting` table key: `ONLINE_DEPOSIT_RECEIVERS` (JSON string).

### 7.3 Public: display receivers + limits

```http
GET /api/cms/platform-config
```

Returns (among other fields):

```json
{
  "limits": { "MIN_DEPOSIT": 10, "MAX_DEPOSIT": 100000 },
  "onlineDepositReceivers": {
    "cbe": { "receiverName": "...", "receiverAccount": "..." },
    "telebirr": { "receiverName": "...", "receiverPhone": "..." },
    "cbebirr": { "receiverName": "...", "receiverPhone": "..." }
  }
}
```

---

## 8. Step-by-step server flow

Exact order inside `verifyOnlineDeposit`:

1. **Role check** — must be `PLAYER` (403 otherwise).
2. **Config check** — `PAYMENT_VERIFY_*` set (503 otherwise).
3. **Validate method** — one of `cbe` | `cbebirr` | `telebirr`.
4. **Validate amount** — finite, `> 0`, within betting/deposit limits.
5. **Resolve payment parts**
   - If `smsText` present → `extractOnlineDepositFromSms(method, smsText)`.
   - Else use raw body fields.
6. **Required fields per method**
   - Telebirr: `reference`
   - CBE: `reference` + `accountSuffix`
   - CBE Birr: `receiptNumber` + normalizable `phoneNumber`
7. **Build ledger reference** — `buildOnlinePayLedgerReference(...)`.
8. **Build remote payload** — `remotePayloadForMethod(...)` (sanitized / phone-normalized).
9. **Call Verifier** — `verifyPaymentRemote(method, payload)`.
   - Non-OK HTTP → 400 with provider message / generic failure.
10. **Success semantics** — `isSuccessfulVerification(method, data)`.
11. **Receiver match** — load `ONLINE_DEPOSIT_RECEIVERS` setting; `verifyResponseMatchesReceivers`.
12. **Parse verified amount** — `parseVerifiedAmountEtb`.
13. **Amount match** — `amountsMatch(declared, verified, 0.01)`.
14. **Load PLAYER wallet** for `req.user.sub`.
15. **DB transaction**
    - Credit `wallet.balance` by verified amount.
    - Insert `Transaction` type `DEPOSIT` with unique `reference = ledgerRef`.
    - Apply deposit bonuses (`applyDepositBonusesInTx`).
    - Set `User.first_deposit_at` if first deposit.
16. **Notify** player (async-safe).
17. **Return 200** with balance + summary.
18. On Prisma unique violation `P2002` → **409** “already used”.

---

## 9. Idempotency & ledger references

Ledger references (stored in `Transaction.reference`, `@unique`):

| Method | Format |
|--------|--------|
| Telebirr | `online-pay:telebirr:{reference}` |
| CBE | `online-pay:cbe:{reference}:{accountSuffix}` |
| CBE Birr | `online-pay:cbebirr:{receiptNumber}:{normalizedPhone}` |

Sanitization: trim, replace `:` → `-`, strip whitespace.

**Why this matters:** concurrent double-submits of the same SMS converge on one credit because the second insert hits unique constraint `P2002`.

Examples:

```text
online-pay:telebirr:CE626EJRNS
online-pay:cbe:TXN1:12345678
online-pay:cbebirr:R1:251912345678
```

---

## 10. Receiver matching (anti-mispayment)

Configured under setting key `ONLINE_DEPOSIT_RECEIVERS`.

**If all fields for a method are empty → skip matching (treat as pass).**  
If any field is non-empty → that field must match the verifier response.

| Method | Config fields | Verifier fields | Match strategy |
|--------|---------------|-----------------|----------------|
| CBE | `receiverName`, `receiverAccount` | `receiver`, `receiverAccount` | Name: substring (NFKC, casefold). Account: digit-only suffix/contains heuristics |
| Telebirr | `receiverName`, `receiverPhone` | `data.creditedPartyName`, `data.creditedPartyAccountNo` | Name same. Phone: each visible digit segment of masked account (e.g. `2519****5610`) must appear in configured digits |
| CBE Birr | `receiverName`, `receiverPhone` | `receiverName`, `creditAccount` | Name same. Phone: digit suffix/contains heuristics |

This prevents crediting payments sent to the wrong person/account even if the receipt is real.

---

## 11. SMS extraction rules

Implemented in `depositSmsExtract.js`.

### CBE

- Find `id=([A-Za-z0-9]+)` in the SMS URL.
- Token length must be `> 8`.
- `reference = token.slice(0, -8)`
- `accountSuffix = token.slice(-8)`

Sample SMS fragment:

```text
https://apps.cbe.com.et:100/?id=FT26095YRWP545822425
→ reference=FT26095YRWP5, accountSuffix=45822425
```

### Telebirr

1. Prefer regex: `transaction number is ([A-Za-z0-9]+)` (case-insensitive).
2. Fallback: `transactioninfo.ethiotelecom.et/receipt/([A-Za-z0-9]+)`.

### CBE Birr

1. Prefer `Txn ID` / `Txn. ID` style: `Txn.? ID.? [:.]? ([A-Za-z0-9]+)`.
2. Fallback: invoice query `TID=([A-Za-z0-9]+)`.
3. Optional phone from invoice `PH=(\d{10,15})`.

Sample:

```text
Txn ID DD3419QEAOK ... https://cbepay1.cbe.com.et/aureceipt?TID=DD3419QEAOK&PH=251982828380
→ receiptNumber=DD3419QEAOK, phoneNumber=251982828380
```

---

## 12. Success / amount parsing rules

### Amount parser (`parseEtbMoneyString`)

- Accepts numbers or strings.
- Strips commas.
- Takes first `\d+(?:\.\d+)?` match.
- Examples: `"3,000.00 ETB"` → `3000`, `"101.00 Birr"` → `101`.

### Amount equality (`amountsMatch`)

```js
Math.abs(declared - verified) <= 0.01
```

Credit uses **verified** amount (not a trust of client amount beyond the match check).

---

## 13. Frontend online deposit wizard

File: `frontend/src/pages/Deposit.jsx`

| Step | UI | Action |
|------|----|--------|
| 1 | Choose method | Set `method` |
| 2 | Enter amount + show Amharic instructions with admin receivers | Validate limits |
| 3 | Paste full SMS | Require non-empty `smsText` |
| 4 | Result | Success balance or error message |

Submit payload:

```js
{
  method,          // "cbe" | "telebirr" | "cbebirr"
  amount: Number,  // player-entered
  smsText: String  // full SMS
}
```

API helper:

```js
// frontend/src/services/api.js
export async function submitOnlineDeposit(payload) {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");

  const res = await fetch(`${API_URL}/api/player/wallet/online-deposit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || "Online deposit failed");
  }
  return data;
}
```

Receivers for display come from `usePlatformSettings()` → `GET /api/cms/platform-config`.

---

## 14. Admin configuration

UI: Admin Settings → Payments (`OnlineDepositReceiversPanel`).

Copy shown to admins:

> Account or phone and name shown to players for CBE, Telebirr, and CBE Birr. When set, deposits are only credited if the verification API says the payment matched these details.

After save, public `platform-config` serves the new values (frontend memo TTL ≈ 30s).

---

## 15. Database / Prisma

Relevant model:

```prisma
model Transaction {
  id             String          @id @default(uuid()) @map("_id")
  wallet_id      String
  type           TransactionType
  amount         Float
  balance_before Float
  balance_after  Float
  // UNIQUE — prevents double credit for same online-pay ledger ref
  reference      String?         @unique
  created_at     DateTime        @default(now())

  wallet Wallet @relation(fields: [wallet_id], references: [id], onDelete: Restrict)

  @@index([wallet_id])
  @@map("transactions")
}
```

Online deposit creates:

- `type: "DEPOSIT"`
- `amount: verifiedAmount`
- `reference: online-pay:...`

Receivers live in `Setting`:

- `key = "ONLINE_DEPOSIT_RECEIVERS"`
- `value = JSON.stringify({ cbe, telebirr, cbebirr })`

---

## 16. Bonuses & notifications

After wallet credit inside the same Prisma transaction:

- `applyDepositBonusesInTx(...)` — first-deposit / deposit promo logic (see `backend/docs/bonus-promotions.md`).
- If `first_deposit_at` was null → set it now.
- After commit: `notifyUserSafe` with `depositNotification({ amount, source: "online" })`.

---

## 17. Error responses

| HTTP | When |
|------|------|
| 403 | Non-player account |
| 503 | Verifier env not configured |
| 400 | Bad method/amount/SMS/fields; verify failed; not completed; receiver mismatch; amount mismatch; no wallet |
| 409 | Same ledger reference already deposited (`P2002`) |
| 500 | Unexpected server error |

Remote client internal statuses (not always forwarded as-is):

| Status from client | Meaning |
|--------------------|---------|
| 503 | Missing env |
| 400 | Unknown method |
| 502 | Network / fetch error to verifier |
| other | Upstream HTTP status |

Controller maps non-OK remote results to **400** with message from `data.message` or `data.error`.

---

## 18. Manual test checklist

### Prep

- [ ] Set `PAYMENT_VERIFY_BASE_URL` + `PAYMENT_VERIFY_API_KEY`
- [ ] Restart backend
- [ ] In Admin → Payments, set real CBE/Telebirr/CBE Birr receiver name + account/phone
- [ ] Confirm player site shows those details on Deposit step 2
- [ ] Confirm deposit min/max limits

### Happy paths

- [ ] Telebirr: send real ETB to configured phone → paste SMS → credit once
- [ ] CBE: transfer → paste full SMS (with `id=` link) → credit once
- [ ] CBE Birr: send → paste SMS including invoice `TID`/`PH` → credit once
- [ ] Replay same SMS → expect **409** already used
- [ ] Wrong amount typed → amount mismatch 400
- [ ] Pay wrong receiver → recipient mismatch 400

### Direct verifier debug

Use the cURL samples in §6.4 with a known good receipt before blaming AsmatBet.

### Unit tests

```bash
cd backend
node --test tests/onlineDeposit.test.js tests/onlineDepositReceivers.test.js tests/depositSmsExtract.test.js
```

---

## 19. Unit tests

Covered without hitting the network:

- Money string parsing
- Phone normalization
- Ledger reference formats
- Success detection per provider shape
- Amount extraction (including nested Telebirr `data`)
- Amount epsilon matching
- SMS extraction for all three methods
- Receiver matching (empty config skip, CBE name fail, Telebirr masked phone)

---

## 20. Security notes

1. **API key server-only** — never expose `PAYMENT_VERIFY_API_KEY` to frontend or commit it.
2. **Do not trust client-declared amount alone** — always re-read amount from verifier response.
3. **Do not trust SMS alone** — SMS only supplies identifiers; authenticity comes from verifier.
4. **Receiver binding** — configure receivers in production; empty config skips the check (dev convenience only).
5. **Idempotent credits** — unique `Transaction.reference` is mandatory.
6. **AuthZ** — only authenticated players with `wallet:deposit`; cashiers/agents cannot use this endpoint as players.
7. Upstream scraper reliability / ToS — plan operational monitoring and fallbacks.

---

## 21. Porting checklist (new project)

Copy this sequence when integrating into another app:

1. Obtain Verifier API key from `https://verify.leul.et`.
2. Add env: `PAYMENT_VERIFY_BASE_URL`, `PAYMENT_VERIFY_API_KEY`.
3. Implement HTTP client equivalent to `paymentVerifyClient.js` (paths + `x-api-key`).
4. Implement helpers: SMS extract, success checks, amount parse, ledger refs, receiver match, phone normalize.
5. Implement authenticated deposit endpoint that:
   - validates role/amount/method
   - extracts or accepts refs
   - verifies remotely
   - matches receivers + amount
   - credits wallet once (unique constraint / idempotency key)
6. Admin UI/API to store receiver display + match targets.
7. Public endpoint so deposit UI can show where to pay.
8. Player UI: method → amount → paste SMS → confirm.
9. Add unit tests for SMS + success/amount/receiver rules.
10. Production hardening: secrets, monitoring, double-submit tests, Telebirr geo considerations.

---

## 22. Full source code (as used in AsmatBet)

The following is the complete application code that implements this integration (copied from the repo for porting). Paths are relative to the AsmatBet monorepo root.

### 22.1 `backend/services/paymentVerifyClient.js`

```js
/**
 * Server-side calls to external payment verification API.
 * Configure PAYMENT_VERIFY_BASE_URL and PAYMENT_VERIFY_API_KEY in backend/.env
 */

const PATHS = {
  cbe: "/verify-cbe",
  cbebirr: "/verify-cbebirr",
  telebirr: "/verify-telebirr",
};

/**
 * @returns {{ base: string, apiKey: string } | null}
 */
function getConfig() {
  const base = String(process.env.PAYMENT_VERIFY_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const apiKey = String(process.env.PAYMENT_VERIFY_API_KEY ?? "").trim();
  if (!base || !apiKey) return null;
  return { base, apiKey };
}

export function isPaymentVerifyConfigured() {
  return getConfig() !== null;
}

/**
 * @param {"cbe"|"cbebirr"|"telebirr"} method
 * @param {Record<string, string>} payload
 * @returns {Promise<{ ok: boolean, status: number, data: Record<string, unknown> }>}
 */
export async function verifyPaymentRemote(method, payload) {
  const cfg = getConfig();
  if (!cfg) {
    return {
      ok: false,
      status: 503,
      data: { message: "Verification is not configured" },
    };
  }

  const path = PATHS[method];
  if (!path) {
    return {
      ok: false,
      status: 400,
      data: { message: "Invalid payment method" },
    };
  }

  const url = `${cfg.base}${path}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    return {
      ok: res.ok,
      status: res.status,
      data: data && typeof data === "object" ? data : {},
    };
  } catch (err) {
    console.error("verifyPaymentRemote network error:", err?.message || err);
    return {
      ok: false,
      status: 502,
      data: { message: "Could not reach payment verification service" },
    };
  }
}
```

### 22.2 `backend/lib/phone.js` (used for CBE Birr)

```js
/**
 * Canonical Ethiopian phone-number helpers.
 *
 * The app accepts phones in several user-typed formats — local `09xxxxxxxx` /
 * `07xxxxxxxx`, international `+2519xxxxxxxx` / `+2517xxxxxxxx`, or bare
 * `9xxxxxxxx` — that all refer to the same subscriber. Normalizing to a single
 * digit form (`2519xxxxxxxx`) before storing or looking up a phone lets the
 * `User.phone @unique` constraint correctly treat those formats as one account.
 */

/**
 * Collapse any accepted Ethiopian phone format to canonical digits `251XXXXXXXXX`.
 * Strips all non-digits, converts a leading `0` to the `251` country code, and
 * prefixes `251` to a bare 9-digit national number.
 *
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeEthiopiaPhone(input) {
  let d = String(input ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = `251${d.slice(1)}`;
  if (d.length === 9) d = `251${d}`;
  return d;
}

/**
 * Like {@link normalizeEthiopiaPhone} but returns `null` for empty/blank input,
 * for optional-phone flows where an absent phone must stay `null` rather than
 * becoming an empty string.
 *
 * @param {unknown} input
 * @returns {string|null}
 */
export function normalizePhoneOrNull(input) {
  const normalized = normalizeEthiopiaPhone(input);
  return normalized ? normalized : null;
}
```

### 22.3 `backend/lib/onlineDepositVerify.js`

```js
/**
 * Pure helpers for online payment verification (amount parsing, idempotency keys).
 */
import { normalizeEthiopiaPhone } from "./phone.js";

// Re-exported for callers that import the phone normalizer from this module.
export { normalizeEthiopiaPhone };

const ONLINE_PAY_METHODS = new Set(["cbe", "cbebirr", "telebirr"]);

/**
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parseEtbMoneyString(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw).replace(/,/g, "").trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} s
 * @returns {string}
 */
export function sanitizePaySegment(s) {
  return String(s ?? "")
    .trim()
    .replace(/:/g, "-")
    .replace(/\s+/g, "");
}

/**
 * @param {string} method
 * @returns {method is "cbe" | "cbebirr" | "telebirr"}
 */
export function isOnlinePayMethod(method) {
  return ONLINE_PAY_METHODS.has(String(method || "").toLowerCase());
}

/**
 * @param {"cbe"|"cbebirr"|"telebirr"} method
 * @param {{ reference?: string, accountSuffix?: string, receiptNumber?: string, phoneNumber?: string }} parts
 * @returns {string|null}
 */
export function buildOnlinePayLedgerReference(method, parts) {
  const m = String(method).toLowerCase();
  const s = sanitizePaySegment;
  if (m === "telebirr") {
    const ref = s(parts.reference);
    return ref ? `online-pay:telebirr:${ref}` : null;
  }
  if (m === "cbe") {
    const ref = s(parts.reference);
    const suf = s(parts.accountSuffix);
    return ref && suf ? `online-pay:cbe:${ref}:${suf}` : null;
  }
  if (m === "cbebirr") {
    const rec = s(parts.receiptNumber);
    const phone = normalizeEthiopiaPhone(parts.phoneNumber);
    return rec && phone ? `online-pay:cbebirr:${rec}:${phone}` : null;
  }
  return null;
}

/**
 * @param {"cbe"|"cbebirr"|"telebirr"} method
 * @param {Record<string, unknown>} body
 * @returns {number|null}
 */
export function parseVerifiedAmountEtb(method, body) {
  const m = String(method).toLowerCase();
  if (m === "cbe") return parseEtbMoneyString(body?.amount);
  if (m === "cbebirr") {
    return (
      parseEtbMoneyString(body?.totalPaidAmount) ??
      parseEtbMoneyString(body?.paidAmount)
    );
  }
  if (m === "telebirr") {
    const data = body?.data && typeof body.data === "object" ? body.data : {};
    return parseEtbMoneyString(data.totalPaidAmount);
  }
  return null;
}

/**
 * @param {"cbe"|"cbebirr"|"telebirr"} method
 * @param {Record<string, unknown>} body
 * @returns {boolean}
 */
export function isSuccessfulVerification(method, body) {
  const m = String(method).toLowerCase();
  if (m === "cbe") return body?.success === true;
  if (m === "cbebirr") {
    return String(body?.transactionStatus ?? "").toLowerCase() === "completed";
  }
  if (m === "telebirr") {
    const data = body?.data && typeof body.data === "object" ? body.data : {};
    return (
      body?.success === true &&
      String(data.transactionStatus ?? "").toLowerCase() === "completed"
    );
  }
  return false;
}

/**
 * @param {number} declared
 * @param {number} verified
 * @param {number} [epsilon]
 * @returns {boolean}
 */
export function amountsMatch(declared, verified, epsilon = 0.01) {
  return Math.abs(declared - verified) <= epsilon;
}
```

### 22.4 `backend/lib/depositSmsExtract.js`

```js
/**
 * Parse bank / Telebirr SMS bodies for online deposit verification fields.
 */

/**
 * @param {"cbe"|"telebirr"|"cbebirr"} method
 * @param {string} smsText
 * @returns {object}
 */
export function extractOnlineDepositFromSms(method, smsText) {
  const raw = String(smsText ?? "").trim();
  if (!raw) {
    return { ok: false, message: "SMS text is empty." };
  }
  const m = String(method).toLowerCase();

  if (m === "cbe") {
    const match = raw.match(/\bid=([A-Za-z0-9]+)/);
    if (!match) {
      return {
        ok: false,
        message:
          "Could not find a CBE transaction id in the SMS. Paste the full message from the bank.",
      };
    }
    const token = match[1];
    if (token.length <= 8) {
      return {
        ok: false,
        message: "CBE transaction id in SMS is too short.",
      };
    }
    return {
      ok: true,
      reference: token.slice(0, -8),
      accountSuffix: token.slice(-8),
    };
  }

  if (m === "telebirr") {
    let id = null;
    const m1 = raw.match(/transaction\s+number\s+is\s+([A-Za-z0-9]+)/i);
    if (m1) id = m1[1];
    if (!id) {
      const m2 = raw.match(
        /transactioninfo\.ethiotelecom\.et\/receipt\/([A-Za-z0-9]+)/i,
      );
      if (m2) id = m2[1];
    }
    if (!id) {
      return {
        ok: false,
        message:
          "Could not find a Telebirr transaction number in the SMS. Paste the full message.",
      };
    }
    return { ok: true, reference: id };
  }

  if (m === "cbebirr") {
    /** e.g. "Txn ID DD3419QEAOK" or receipt link ?TID=…&PH=… */
    let receiptNumber = null;
    const txnMatch = raw.match(/Txn\.?\s*ID\.?\s*[:.]?\s*([A-Za-z0-9]+)/i);
    if (txnMatch) receiptNumber = txnMatch[1];
    if (!receiptNumber) {
      const tidMatch = raw.match(/[?&]TID=([A-Za-z0-9]+)/i);
      if (tidMatch) receiptNumber = tidMatch[1];
    }
    if (!receiptNumber) {
      return {
        ok: false,
        message:
          "Could not find a CBE Birr transaction id (Txn ID or TID=) in the SMS. Paste the full message.",
      };
    }
    let phoneNumber;
    const phMatch = raw.match(/[?&]PH=(\d{10,15})\b/i);
    if (phMatch) phoneNumber = phMatch[1];
    return {
      ok: true,
      receiptNumber,
      ...(phoneNumber ? { phoneNumber } : {}),
    };
  }

  return { ok: false, message: "Unknown payment method." };
}
```

### 22.5 `backend/lib/onlineDepositReceiversConfig.js`

```js
/**
 * Admin-configured display + verification targets for online deposit channels.
 */

export const ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY = "ONLINE_DEPOSIT_RECEIVERS";

/** @typedef {{ receiverName: string, receiverAccount: string }} CbeReceiver */
/** @typedef {{ receiverName: string, receiverPhone: string }} MmReceiver */

export const DEFAULT_ONLINE_DEPOSIT_RECEIVERS = {
  cbe: { receiverName: "", receiverAccount: "" },
  telebirr: { receiverName: "", receiverPhone: "" },
  cbebirr: { receiverName: "", receiverPhone: "" },
};

/**
 * @param {unknown} raw
 * @returns {typeof DEFAULT_ONLINE_DEPOSIT_RECEIVERS}
 */
function cloneDefaults() {
  return {
    cbe: { ...DEFAULT_ONLINE_DEPOSIT_RECEIVERS.cbe },
    telebirr: { ...DEFAULT_ONLINE_DEPOSIT_RECEIVERS.telebirr },
    cbebirr: { ...DEFAULT_ONLINE_DEPOSIT_RECEIVERS.cbebirr },
  };
}

export function parseReceiversSetting(raw) {
  const base = cloneDefaults();
  if (raw == null || raw === "") return base;
  let obj;
  try {
    obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return base;
  }
  if (!obj || typeof obj !== "object") return base;
  for (const key of ["cbe", "telebirr", "cbebirr"]) {
    const chunk = obj[key];
    if (!chunk || typeof chunk !== "object") continue;
    if (key === "cbe") {
      if (typeof chunk.receiverName === "string")
        base.cbe.receiverName = chunk.receiverName.trim();
      if (typeof chunk.receiverAccount === "string")
        base.cbe.receiverAccount = chunk.receiverAccount.trim();
    } else {
      if (typeof chunk.receiverName === "string")
        base[key].receiverName = chunk.receiverName.trim();
      if (typeof chunk.receiverPhone === "string")
        base[key].receiverPhone = chunk.receiverPhone.trim();
    }
  }
  return base;
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: typeof DEFAULT_ONLINE_DEPOSIT_RECEIVERS } | { ok: false, message: string }}
 */
export function validateReceiversRequestBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Invalid body" };
  }
  const merged = cloneDefaults();
  for (const key of ["cbe", "telebirr", "cbebirr"]) {
    const chunk = body[key];
    if (chunk === undefined) continue;
    if (chunk !== null && typeof chunk !== "object") {
      return { ok: false, message: `${key} must be an object` };
    }
    if (!chunk) continue;
    if (key === "cbe") {
      if (chunk.receiverName !== undefined) {
        if (typeof chunk.receiverName !== "string") {
          return { ok: false, message: "cbe.receiverName must be a string" };
        }
        merged.cbe.receiverName = chunk.receiverName.trim();
      }
      if (chunk.receiverAccount !== undefined) {
        if (typeof chunk.receiverAccount !== "string") {
          return { ok: false, message: "cbe.receiverAccount must be a string" };
        }
        merged.cbe.receiverAccount = chunk.receiverAccount.trim();
      }
    } else {
      if (chunk.receiverName !== undefined) {
        if (typeof chunk.receiverName !== "string") {
          return { ok: false, message: `${key}.receiverName must be a string` };
        }
        merged[key].receiverName = chunk.receiverName.trim();
      }
      if (chunk.receiverPhone !== undefined) {
        if (typeof chunk.receiverPhone !== "string") {
          return { ok: false, message: `${key}.receiverPhone must be a string` };
        }
        merged[key].receiverPhone = chunk.receiverPhone.trim();
      }
    }
  }
  return { ok: true, value: merged };
}

function normalizeName(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function digitsOnly(s) {
  return String(s ?? "").replace(/\D/g, "");
}

function nameMatchesConfigured(configName, verifyName) {
  const a = normalizeName(configName);
  const b = normalizeName(verifyName);
  if (!a.length || !b.length) return false;
  if (a.length < 2 || b.length < 2) return a === b;
  return b.includes(a) || a.includes(b);
}

/** Masked e.g. 2519****2566 — every visible digit run (length ≥2) must appear in configured phone digits */
function telebirrAccountMatchesConfig(configPhone, creditedPartyAccountNo) {
  const cfg = digitsOnly(configPhone);
  const raw = String(creditedPartyAccountNo ?? "");
  if (!cfg.length) return false;
  const segments = raw
    .split(/\*+/)
    .map((p) => digitsOnly(p))
    .filter((s) => s.length >= 2);
  if (segments.length === 0) {
    const all = digitsOnly(raw);
    return all.length > 0 && (cfg.includes(all) || all.includes(cfg.slice(-4)));
  }
  for (const seg of segments) {
    if (seg.length >= 3 && !cfg.includes(seg)) return false;
    if (seg.length === 2 && !cfg.includes(seg) && !cfg.endsWith(seg)) return false;
  }
  return true;
}

function cbeAccountMatches(configAcc, verifyAcc) {
  const c = digitsOnly(configAcc);
  const v = digitsOnly(verifyAcc);
  if (!c.length || !v.length) return false;
  if (c.length >= 4 && v.endsWith(c.slice(-Math.min(8, c.length)))) return true;
  if (v.length >= 4 && c.endsWith(v.slice(-Math.min(8, v.length)))) return true;
  return c === v || v.includes(c) || c.includes(v);
}

/**
 * If all configured fields for the method are empty, returns true (skip check).
 * Otherwise requires each non-empty configured field to match verify response.
 * @param {"cbe"|"telebirr"|"cbebirr"} method
 * @param {typeof DEFAULT_ONLINE_DEPOSIT_RECEIVERS} cfg
 * @param {Record<string, unknown>} verifyData
 * @returns {boolean}
 */
export function verifyResponseMatchesReceivers(method, cfg, verifyData) {
  const m = String(method).toLowerCase();
  if (m === "cbe") {
    const { receiverName, receiverAccount } = cfg.cbe;
    const needName = receiverName.length > 0;
    const needAcc = receiverAccount.length > 0;
    if (!needName && !needAcc) return true;
    const recvName = String(verifyData?.receiver ?? "");
    const recvAcc = String(verifyData?.receiverAccount ?? "");
    if (needName && !nameMatchesConfigured(receiverName, recvName)) return false;
    if (needAcc && !cbeAccountMatches(receiverAccount, recvAcc)) return false;
    return true;
  }
  if (m === "telebirr") {
    const { receiverName, receiverPhone } = cfg.telebirr;
    const needName = receiverName.length > 0;
    const needPhone = receiverPhone.length > 0;
    if (!needName && !needPhone) return true;
    const d = verifyData?.data && typeof verifyData.data === "object" ? verifyData.data : {};
    const name = String(d.creditedPartyName ?? "");
    const acct = String(d.creditedPartyAccountNo ?? "");
    if (needName && !nameMatchesConfigured(receiverName, name)) return false;
    if (needPhone && !telebirrAccountMatchesConfig(receiverPhone, acct)) return false;
    return true;
  }
  if (m === "cbebirr") {
    const { receiverName, receiverPhone } = cfg.cbebirr;
    const needName = receiverName.length > 0;
    const needPhone = receiverPhone.length > 0;
    if (!needName && !needPhone) return true;
    const recvName = String(verifyData?.receiverName ?? "");
    const credit = String(verifyData?.creditAccount ?? "");
    if (needName && !nameMatchesConfigured(receiverName, recvName)) return false;
    if (needPhone) {
      const p = digitsOnly(receiverPhone);
      const c = digitsOnly(credit);
      if (p.length >= 4 && c.length > 0) {
        const ok =
          c.endsWith(p.slice(-Math.min(9, p.length))) ||
          p.endsWith(c.slice(-Math.min(9, c.length))) ||
          c.includes(p.slice(-6)) ||
          p.includes(c.slice(-6));
        if (!ok) return false;
      }
    }
    return true;
  }
  return true;
}
```

### 22.6 `backend/controllers/onlineDepositController.js`

```js
/**
 * POST /api/player/wallet/online-deposit — verify external transfer + credit player wallet once per payment ref.
 */
import { prisma } from "../Config/db.js";
import { notifyUserSafe } from "../lib/createNotification.js";
import { depositNotification } from "../lib/notificationMessages.js";
import { extractOnlineDepositFromSms } from "../lib/depositSmsExtract.js";
import {
  resolveBettingLimits,
  getDepositAmountViolation,
} from "../lib/bettingLimits.js";
import {
  amountsMatch,
  buildOnlinePayLedgerReference,
  isOnlinePayMethod,
  isSuccessfulVerification,
  normalizeEthiopiaPhone,
  parseVerifiedAmountEtb,
  sanitizePaySegment,
} from "../lib/onlineDepositVerify.js";
import {
  ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY,
  parseReceiversSetting,
  verifyResponseMatchesReceivers,
} from "../lib/onlineDepositReceiversConfig.js";
import {
  isPaymentVerifyConfigured,
  verifyPaymentRemote,
} from "../services/paymentVerifyClient.js";
import { applyDepositBonusesInTx } from "../lib/bonusEngine.js";

function verifySummaryFromResponse(method, data) {
  const m = String(method).toLowerCase();
  if (m === "telebirr") {
    const d = data?.data && typeof data.data === "object" ? data.data : {};
    return {
      payerName: d.payerName ?? null,
      paymentDate: d.paymentDate ?? null,
      receiptNo: d.receiptNo ?? null,
    };
  }
  if (m === "cbe") {
    return {
      payer: data?.payer ?? null,
      date: data?.date ?? null,
      reference: data?.reference ?? null,
    };
  }
  if (m === "cbebirr") {
    return {
      customerName: data?.customerName ?? null,
      transactionDate: data?.transactionDate ?? null,
      reference: data?.reference ?? data?.orderId ?? null,
    };
  }
  return {};
}

function remotePayloadForMethod(method, parts) {
  const m = String(method).toLowerCase();
  if (m === "cbe") {
    return {
      reference: sanitizePaySegment(parts.reference),
      accountSuffix: sanitizePaySegment(parts.accountSuffix),
    };
  }
  if (m === "cbebirr") {
    return {
      receiptNumber: sanitizePaySegment(parts.receiptNumber),
      phoneNumber: normalizeEthiopiaPhone(parts.phoneNumber),
    };
  }
  if (m === "telebirr") {
    return { reference: sanitizePaySegment(parts.reference) };
  }
  return null;
}

/**
 * POST /api/player/wallet/online-deposit
 * Body: { method, amount, smsText?, reference?, accountSuffix?, receiptNumber?, phoneNumber? }
 */
export async function verifyOnlineDeposit(req, res) {
  try {
    if (req.user?.role !== "PLAYER") {
      return res.status(403).json({
        message:
          "Online deposit is only for player accounts. Sign in with your player phone.",
      });
    }

    if (!isPaymentVerifyConfigured()) {
      return res.status(503).json({
        message: "Online deposit is temporarily unavailable.",
      });
    }

    const body = req.body ?? {};
    const methodRaw = String(body.method ?? "").toLowerCase();
    const amountNum = Number(body.amount);

    if (!isOnlinePayMethod(methodRaw)) {
      return res.status(400).json({
        message: 'method must be one of: "cbe", "cbebirr", "telebirr"',
      });
    }

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res
        .status(400)
        .json({ message: "amount must be a positive number" });
    }

    const limits = await resolveBettingLimits(prisma);
    const depErr = getDepositAmountViolation(limits, amountNum);
    if (depErr) {
      return res.status(400).json({ message: depErr });
    }

    const parts = {
      reference: body.reference,
      accountSuffix: body.accountSuffix,
      receiptNumber: body.receiptNumber,
      phoneNumber: body.phoneNumber,
    };

    const smsText = String(body.smsText ?? "").trim();

    if (smsText) {
      const extracted = extractOnlineDepositFromSms(methodRaw, smsText);
      if (methodRaw === "cbe" || methodRaw === "telebirr") {
        if (!extracted.ok) {
          return res.status(400).json({ message: extracted.message });
        }
        if (methodRaw === "cbe") {
          parts.reference = extracted.reference;
          parts.accountSuffix = extracted.accountSuffix;
        } else {
          parts.reference = extracted.reference;
        }
      } else if (methodRaw === "cbebirr") {
        if (extracted.ok && "receiptNumber" in extracted) {
          parts.receiptNumber = extracted.receiptNumber;
          if (extracted.phoneNumber) {
            parts.phoneNumber = extracted.phoneNumber;
          }
        } else {
          return res.status(400).json({
            message:
              extracted.message ||
              "Could not read CBE Birr transaction details from SMS.",
          });
        }
      }
    }

    if (methodRaw === "telebirr" || methodRaw === "cbe") {
      if (!sanitizePaySegment(parts.reference)) {
        return res.status(400).json({
          message: smsText
            ? "Could not read reference from SMS."
            : "reference is required (or paste full SMS).",
        });
      }
    }
    if (methodRaw === "cbe") {
      if (!sanitizePaySegment(parts.accountSuffix)) {
        return res.status(400).json({
          message: smsText
            ? "Could not read account suffix from SMS."
            : "accountSuffix is required (or paste full SMS).",
        });
      }
    }
    if (methodRaw === "cbebirr") {
      if (!sanitizePaySegment(parts.receiptNumber)) {
        return res.status(400).json({
          message: smsText
            ? "Could not read receipt number from SMS (or paste a message that includes Txn ID / invoice link)."
            : "receiptNumber is required (or paste full SMS).",
        });
      }
      if (!normalizeEthiopiaPhone(parts.phoneNumber)) {
        return res.status(400).json({
          message: smsText
            ? "Could not read phone from SMS; include the full message with the invoice link (PH=)."
            : "phoneNumber is required (or paste full SMS with invoice link).",
        });
      }
    }

    const ledgerRef = buildOnlinePayLedgerReference(methodRaw, {
      reference: parts.reference,
      accountSuffix: parts.accountSuffix,
      receiptNumber: parts.receiptNumber,
      phoneNumber: parts.phoneNumber,
    });
    if (!ledgerRef) {
      return res
        .status(400)
        .json({ message: "Could not build payment reference" });
    }

    const remoteBody = remotePayloadForMethod(methodRaw, parts);
    if (!remoteBody) {
      return res.status(400).json({ message: "Invalid payment method" });
    }

    const remote = await verifyPaymentRemote(methodRaw, remoteBody);

    if (!remote.ok) {
      const msg =
        (typeof remote.data?.message === "string" && remote.data.message) ||
        (typeof remote.data?.error === "string" && remote.data.error) ||
        "Payment verification failed";
      return res.status(400).json({ message: msg });
    }

    const data = remote.data;
    if (!isSuccessfulVerification(methodRaw, data)) {
      return res.status(400).json({
        message: "Payment could not be verified as completed",
      });
    }

    const receiversRow = await prisma.setting.findUnique({
      where: { key: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY },
    });
    const receiversCfg = parseReceiversSetting(receiversRow?.value);
    if (!verifyResponseMatchesReceivers(methodRaw, receiversCfg, data)) {
      return res.status(400).json({
        message: "Payment recipient does not match platform deposit details.",
      });
    }

    const verifiedAmount = parseVerifiedAmountEtb(methodRaw, data);
    if (verifiedAmount == null || !Number.isFinite(verifiedAmount)) {
      return res.status(400).json({
        message: "Could not read verified amount from payment provider",
      });
    }

    if (!amountsMatch(amountNum, verifiedAmount)) {
      return res.status(400).json({
        message:
          "Amount does not match verification. Check the transaction or amount entered.",
      });
    }

    const wallet = await prisma.wallet.findFirst({
      where: { user_id: req.user.sub, wallet_type: "PLAYER" },
    });
    if (!wallet) {
      return res.status(400).json({ message: "Player wallet not found" });
    }

    const creditAmount = verifiedAmount;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const w = await tx.wallet.findUnique({ where: { id: wallet.id } });
        if (!w) throw new Error("WALLET_GONE");

        const userRow = await tx.user.findUnique({
          where: { id: w.user_id },
          select: { first_deposit_at: true },
        });
        const hadFirst = userRow?.first_deposit_at ?? null;

        const before = Number(w.balance);
        const after = before + creditAmount;

        await tx.wallet.update({
          where: { id: w.id },
          data: { balance: after },
        });

        const depRow = await tx.transaction.create({
          data: {
            wallet_id: w.id,
            type: "DEPOSIT",
            amount: creditAmount,
            balance_before: before,
            balance_after: after,
            reference: ledgerRef,
          },
        });

        await applyDepositBonusesInTx(tx, {
          walletId: w.id,
          depositAmount: creditAmount,
          playerDepositTxId: depRow.id,
          hadFirstDepositAt: hadFirst,
        });

        if (!hadFirst) {
          await tx.user.update({
            where: { id: w.user_id },
            data: { first_deposit_at: new Date() },
          });
        }

        const wFinal = await tx.wallet.findUnique({ where: { id: w.id } });
        return {
          newBalance: Number(wFinal?.balance ?? after),
          creditedAmount: creditAmount,
        };
      });

      const depMsg = depositNotification({
        amount: result.creditedAmount,
        source: "online",
      });
      void notifyUserSafe({
        userId: req.user.sub,
        ...depMsg,
      });

      return res.status(200).json({
        ok: true,
        newBalance: result.newBalance,
        creditedAmount: result.creditedAmount,
        reference: ledgerRef,
        verifySummary: verifySummaryFromResponse(methodRaw, data),
      });
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({
          message: "This payment was already used for a deposit.",
        });
      }
      throw err;
    }
  } catch (error) {
    console.error("verifyOnlineDeposit error:", error);
    return res
      .status(500)
      .json({ message: "Failed to process online deposit" });
  }
}
```

### 22.7 Route mounts

**`backend/routes/player.js` (relevant lines)**

```js
import { verifyOnlineDeposit } from "../controllers/onlineDepositController.js";
import { authorizePermission } from "../middleware/auth.js";

// ...
router.post(
  "/wallet/online-deposit",
  authorizePermission("wallet:deposit"),
  verifyOnlineDeposit,
);
```

**`backend/index.js` (relevant lines)**

```js
app.use("/api/admin/settings", authenticateToken, settingsRoutes);
app.use("/api/player", authenticateToken, playerRoutes);
```

**`backend/routes/settings.js` (relevant lines)**

```js
router.get(
  "/online-deposit-receivers",
  authorizePermission("settings:read"),
  getOnlineDepositReceivers,
);
router.put(
  "/online-deposit-receivers",
  authorizePermission("settings:update"),
  putOnlineDepositReceivers,
);
```

**`backend/controllers/settingsController.js` (receivers handlers)**

```js
export async function getOnlineDepositReceivers(_req, res) {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY },
    });
    const receivers = parseReceiversSetting(row?.value);
    return res.json({
      receivers,
      configuredInDatabase: Boolean(row),
    });
  } catch (error) {
    console.error("getOnlineDepositReceivers error:", error);
    return res
      .status(500)
      .json({ message: "Failed to load online deposit receivers" });
  }
}

export async function putOnlineDepositReceivers(req, res) {
  try {
    const validated = validateReceiversRequestBody(req.body ?? {});
    if (!validated.ok) {
      return res.status(400).json({ message: validated.message });
    }

    const beforeRow = await prisma.setting.findUnique({
      where: { key: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY },
    });
    const beforeParsed = parseReceiversSetting(beforeRow?.value);
    const jsonValue = JSON.stringify(validated.value);

    await prisma.setting.upsert({
      where: { key: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY },
      create: {
        key: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY,
        value: jsonValue,
      },
      update: { value: jsonValue },
    });

    await logAuditEvent({
      req,
      action: "SETTINGS_ONLINE_DEPOSIT_RECEIVERS_UPDATED",
      module: "SETTINGS",
      entityType: "SETTING",
      entityId: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY,
      before: beforeParsed,
      after: validated.value,
    });

    return res.json({
      message: "Online deposit receivers updated",
      receivers: validated.value,
    });
  } catch (error) {
    console.error("putOnlineDepositReceivers error:", error);
    return res
      .status(500)
      .json({ message: "Failed to update online deposit receivers" });
  }
}
```

**`backend/routes/cmsPublic.js` (platform-config excerpt)**

```js
router.get("/platform-config", async (_req, res) => {
  try {
    const [limits, ticketCancelWindowMinutes, receiversRow, winningsTax] =
      await Promise.all([
        resolveBettingLimits(prisma),
        resolveCancelWindowMinutes(prisma),
        prisma.setting.findUnique({
          where: { key: ONLINE_DEPOSIT_RECEIVERS_SETTING_KEY },
        }),
        resolveWinningsTax(prisma),
      ]);
    const onlineDepositReceivers = parseReceiversSetting(receiversRow?.value);
    return res.json({
      limits,
      ticketCancelWindowMinutes,
      onlineDepositReceivers,
      winningsTax: {
        enabled: winningsTax.enabled,
        rate: winningsTax.rate,
      },
    });
  } catch (error) {
    console.error("cmsPublic platform-config error:", error);
    return res.status(500).json({ message: "Failed to load platform config" });
  }
});
```

### 22.8 Frontend API helpers

```js
/** GET /api/cms/platform-config — public */
export async function fetchPublicPlatformConfig() {
  const res = await fetch(`${API_URL}/api/cms/platform-config`);
  if (!res.ok) {
    throw new Error(`Failed to load platform config: ${res.status}`);
  }
  return res.json();
}

/**
 * POST /api/player/wallet/online-deposit — verify bank/mobile payment and credit wallet.
 * @param {{ method: "cbe"|"cbebirr"|"telebirr", amount: number, reference?: string, accountSuffix?: string, receiptNumber?: string, phoneNumber?: string, smsText?: string }} payload
 */
export async function submitOnlineDeposit(payload) {
  const token = getToken();
  if (!token) throw new Error("NOT_LOGGED_IN");

  const res = await fetch(`${API_URL}/api/player/wallet/online-deposit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || "Online deposit failed");
  }
  return data;
}
```

### 22.9 Frontend deposit submit logic (core of `Deposit.jsx`)

```js
async function submitOnline() {
  setOnlineFormError("");
  const n = Number(amountInput);
  if (!Number.isFinite(n) || n <= 0) {
    setOnlineFormError("Enter a valid amount.");
    return;
  }

  if (method === "telebirr" || method === "cbe" || method === "cbebirr") {
    if (!smsText.trim()) {
      setOnlineFormError(
        "Paste the full SMS from your bank or mobile money service.",
      );
      return;
    }
  }

  const payload = { method, amount: n };
  if (method === "telebirr" || method === "cbe" || method === "cbebirr") {
    payload.smsText = smsText.trim();
  }

  setSubmitting(true);
  try {
    const data = await submitOnlineDeposit(payload);
    setOnlineResult({ ok: true, data });
    setOnlineStep(4);
    fetchPlayerWallet().catch(() => {});
  } catch (err) {
    setOnlineResult({
      ok: false,
      message: err.message || "Online deposit failed.",
    });
    setOnlineStep(4);
  } finally {
    setSubmitting(false);
  }
}
```

Full UI (wizard steps, Amharic instructions, logos) lives in `frontend/src/pages/Deposit.jsx` — open that file in the repo for the complete component (≈660 lines). Behavior above is the integration-critical part.

### 22.10 Admin panel (core)

`admin/src/components/settings/OnlineDepositReceiversPanel.jsx` saves:

```js
{
  cbe: { receiverName, receiverAccount },
  telebirr: { receiverName, receiverPhone },
  cbebirr: { receiverName, receiverPhone },
}
```

via:

```js
apiRequest("/admin/settings/online-deposit-receivers", {
  method: "PUT",
  body: JSON.stringify(receivers),
});
```

### 22.11 Unit tests (full)

#### `backend/tests/onlineDeposit.test.js`

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  amountsMatch,
  buildOnlinePayLedgerReference,
  isSuccessfulVerification,
  normalizeEthiopiaPhone,
  parseEtbMoneyString,
  parseVerifiedAmountEtb,
} from "../lib/onlineDepositVerify.js";

test("parseEtbMoneyString handles commas and suffix text", () => {
  assert.equal(parseEtbMoneyString("3,000.00 ETB"), 3000);
  assert.equal(parseEtbMoneyString("101.00 Birr"), 101);
  assert.equal(parseEtbMoneyString(73000), 73000);
  assert.equal(parseEtbMoneyString(null), null);
});

test("normalizeEthiopiaPhone adds 251 prefix", () => {
  assert.equal(normalizeEthiopiaPhone("0912345678"), "251912345678");
  assert.equal(normalizeEthiopiaPhone("251912345678"), "251912345678");
  assert.equal(normalizeEthiopiaPhone("912345678"), "251912345678");
});

test("buildOnlinePayLedgerReference is stable and unique per channel", () => {
  assert.equal(
    buildOnlinePayLedgerReference("telebirr", { reference: "CE626EJRNS" }),
    "online-pay:telebirr:CE626EJRNS",
  );
  assert.equal(
    buildOnlinePayLedgerReference("cbe", {
      reference: "TXN1",
      accountSuffix: "12345678",
    }),
    "online-pay:cbe:TXN1:12345678",
  );
  assert.equal(
    buildOnlinePayLedgerReference("cbebirr", {
      receiptNumber: "R1",
      phoneNumber: "0912345678",
    }),
    "online-pay:cbebirr:R1:251912345678",
  );
});

test("isSuccessfulVerification per provider shape", () => {
  assert.equal(isSuccessfulVerification("cbe", { success: true }), true);
  assert.equal(isSuccessfulVerification("cbe", { success: false }), false);

  assert.equal(
    isSuccessfulVerification("cbebirr", { transactionStatus: "Completed" }),
    true,
  );
  assert.equal(
    isSuccessfulVerification("cbebirr", { transactionStatus: "Failed" }),
    false,
  );

  assert.equal(
    isSuccessfulVerification("telebirr", {
      success: true,
      data: { transactionStatus: "Completed" },
    }),
    true,
  );
  assert.equal(
    isSuccessfulVerification("telebirr", {
      success: true,
      data: { transactionStatus: "Pending" },
    }),
    false,
  );
});

test("parseVerifiedAmountEtb reads nested telebirr data", () => {
  assert.equal(
    parseVerifiedAmountEtb("telebirr", {
      success: true,
      data: { totalPaidAmount: "101.00 Birr" },
    }),
    101,
  );
  assert.equal(
    parseVerifiedAmountEtb("cbebirr", { totalPaidAmount: "73000.00" }),
    73000,
  );
});

test("amountsMatch tolerates tiny float noise", () => {
  assert.equal(amountsMatch(100, 100.005), true);
  assert.equal(amountsMatch(100, 100.02), false);
});
```

#### `backend/tests/onlineDepositReceivers.test.js`

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ONLINE_DEPOSIT_RECEIVERS,
  verifyResponseMatchesReceivers,
} from "../lib/onlineDepositReceiversConfig.js";

test("verifyResponseMatchesReceivers skips when config empty", () => {
  assert.equal(
    verifyResponseMatchesReceivers("cbe", DEFAULT_ONLINE_DEPOSIT_RECEIVERS, {
      receiver: "Anyone",
    }),
    true,
  );
});

test("verifyResponseMatchesReceivers CBE enforces name + account when set", () => {
  const cfg = {
    ...DEFAULT_ONLINE_DEPOSIT_RECEIVERS,
    cbe: {
      receiverName: "Tewachew Adimasu",
      receiverAccount: "E****0910",
    },
  };
  assert.equal(
    verifyResponseMatchesReceivers("cbe", cfg, {
      receiver: "Tewachew Adimasu",
      receiverAccount: "E12340910",
    }),
    true,
  );
  assert.equal(
    verifyResponseMatchesReceivers("cbe", cfg, {
      receiver: "Other Person",
      receiverAccount: "E12340910",
    }),
    false,
  );
});

test("verifyResponseMatchesReceivers telebirr matches masked account", () => {
  const cfg = {
    ...DEFAULT_ONLINE_DEPOSIT_RECEIVERS,
    telebirr: {
      receiverName: "daniel regasa",
      receiverPhone: "251912345610",
    },
  };
  assert.equal(
    verifyResponseMatchesReceivers("telebirr", cfg, {
      success: true,
      data: {
        creditedPartyName: "daniel regasa",
        creditedPartyAccountNo: "2519****5610",
        transactionStatus: "Completed",
      },
    }),
    true,
  );
});
```

#### `backend/tests/depositSmsExtract.test.js`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { extractOnlineDepositFromSms } from "../lib/depositSmsExtract.js";

const CBE_SMS =
  "Dear Gadisa, You have transfered ETB 10.00 to Tewachew Adimasu on 05/04/2026 at 14:09:13 from your account 1*****2425. Your account has been debited with a S.charge of ETB 0.50 and VAT(15%) of ETB0.08 and Disaster Fund (5%) of ETB0.03, with a total of ETB 10.61. Your Current Balance is ETB 3,410.44. Thank you for Banking with CBE! https://apps.cbe.com.et:100/?id=FT26095YRWP545822425 For feedback click the link https://forms.gle/R1s9nkJ6qZVCxRVu9";

const TELEBIRR_SMS =
  "Dear Walelign \nYou have transferred ETB 30.00 to daniel regasa (2519****5610) on 02/04/2026 11:59:46. Your transaction number is DD23HGV3T7. The service fee is  ETB 0.87 and  15% VAT on the service fee is ETB 0.13. Your current E-Money Account  balance is ETB 395.84. To download your payment information please click this link: https://transactioninfo.ethiotelecom.et/receipt/DD23HGV3T7.\n\nThank you for using telebirr\nEthio telecom";

test("extractOnlineDepositFromSms CBE parses id= token into reference + suffix", () => {
  const r = extractOnlineDepositFromSms("cbe", CBE_SMS);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.reference, "FT26095YRWP5");
    assert.equal(r.accountSuffix, "45822425");
  }
});

test("extractOnlineDepositFromSms telebirr parses transaction number", () => {
  const r = extractOnlineDepositFromSms("telebirr", TELEBIRR_SMS);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.reference, "DD23HGV3T7");
  }
});

test("extractOnlineDepositFromSms telebirr fallback receipt URL", () => {
  const r = extractOnlineDepositFromSms(
    "telebirr",
    "x https://transactioninfo.ethiotelecom.et/receipt/AB12CD34EF",
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.reference, "AB12CD34EF");
});

const CBE_BIRR_SMS =
  "Dear Gadisa, you have sent 10.00Br. to AMANUEL LEGESSE on 03/04/26 15:03,Txn ID DD3419QEAOK. Your CBE Birr account balance is 3.07Br.Thank you! For invoice https://cbepay1.cbe.com.et/aureceipt?TID=DD3419QEAOK&PH=251982828380 For your feedback please click the link https://shorturl.at/gy3A0";

test("extractOnlineDepositFromSms cbebirr parses Txn ID and PH from invoice link", () => {
  const r = extractOnlineDepositFromSms("cbebirr", CBE_BIRR_SMS);
  assert.equal(r.ok, true);
  if (r.ok && "receiptNumber" in r) {
    assert.equal(r.receiptNumber, "DD3419QEAOK");
    assert.equal(r.phoneNumber, "251982828380");
  }
});

test("extractOnlineDepositFromSms cbebirr TID fallback when Tx.line missing", () => {
  const r = extractOnlineDepositFromSms(
    "cbebirr",
    "invoice https://cbepay1.cbe.com.et/aureceipt?TID=XX99YY&PH=251911122233",
  );
  assert.equal(r.ok, true);
  if (r.ok && "receiptNumber" in r) {
    assert.equal(r.receiptNumber, "XX99YY");
    assert.equal(r.phoneNumber, "251911122233");
  }
});

test("extractOnlineDepositFromSms cbebirr fails when no id", () => {
  const r = extractOnlineDepositFromSms("cbebirr", "no transaction here");
  assert.equal(r.ok, false);
});
```

---

## 23. AI prompt (copy-paste)

Use the prompt below in another repo / chat to re-implement this integration. Paste it as-is, then attach this markdown file (or keep it in context).

````markdown
# Prompt: Integrate Ethiopian external payment verification (CBE / Telebirr / CBE Birr) like AsmatBet

You are implementing **online player deposits** that verify real bank / mobile-money transfers using the **Leul / Creofam Verifier API**, then credit a user wallet **exactly once** per payment.

## External API

- Base URL env: `PAYMENT_VERIFY_BASE_URL` (e.g. `https://verifyapi.leulzenebe.pro`)
- Secret env: `PAYMENT_VERIFY_API_KEY` (from https://verify.leul.et) — **server only**, never expose to browser
- Auth header on every verify call: `x-api-key: <key>`
- Content-Type: `application/json`

Endpoints to call from the **backend only**:

| method | path | JSON body |
|--------|------|-----------|
| `cbe` | `POST /verify-cbe` | `{ "reference": string, "accountSuffix": string }` |
| `telebirr` | `POST /verify-telebirr` | `{ "reference": string }` |
| `cbebirr` | `POST /verify-cbebirr` | `{ "receiptNumber": string, "phoneNumber": "251XXXXXXXXX" }` |

## Required product flow

1. Admin configures deposit receivers (name + account/phone) per channel; show them on the deposit UI.
2. Authenticated player chooses method, enters amount, pastes **full SMS** after paying.
3. Backend:
   1. Parse SMS → identifiers (see rules below)
   2. Call Verifier API
   3. Require completed/success semantics per channel
   4. Require verified recipient matches configured receivers
   5. Require verified amount matches player amount within `0.01` ETB
   6. Credit wallet with **verified** amount
   7. Persist a unique ledger reference so replaying the same payment returns conflict (HTTP 409), not a second credit

## SMS parsing rules (must match)

**CBE**
- Find `id=([A-Za-z0-9]+)` in SMS
- token length > 8
- `reference = token.slice(0, -8)`
- `accountSuffix = token.slice(-8)`

**Telebirr**
- Prefer: `/transaction\s+number\s+is\s+([A-Za-z0-9]+)/i`
- Fallback: `/transactioninfo\.ethiotelecom\.et\/receipt\/([A-Za-z0-9]+)/i`

**CBE Birr**
- Prefer: `/Txn\.?\s*ID\.?\s*[:.]?\s*([A-Za-z0-9]+)/i`
- Fallback: `/[?&]TID=([A-Za-z0-9]+)/i`
- Optional phone: `/[?&]PH=(\d{10,15})\b/i`
- Normalize phone to digits with Ethiopian `251` prefix (`09…` → `2519…`, 9-digit → `251…`)

## Success / amount rules (must match)

**Success**
- CBE: `body.success === true`
- CBE Birr: `String(body.transactionStatus).toLowerCase() === "completed"`
- Telebirr: `body.success === true` AND `String(body.data.transactionStatus).toLowerCase() === "completed"`

**Amount fields**
- CBE: `body.amount`
- CBE Birr: `body.totalPaidAmount` ?? `body.paidAmount`
- Telebirr: `body.data.totalPaidAmount`
- Parser: strip commas, take first `\d+(?:\.\d+)?` from string (handles `"101.00 Birr"`, `"3,000.00 ETB"`)

**Amount match**
- `Math.abs(declared - verified) <= 0.01`
- Credit `verified`, not the raw client amount beyond the match check

## Receiver matching (must match)

Store config:

```json
{
  "cbe": { "receiverName": "", "receiverAccount": "" },
  "telebirr": { "receiverName": "", "receiverPhone": "" },
  "cbebirr": { "receiverName": "", "receiverPhone": "" }
}
```

- If all fields for a method are empty → skip match (pass)
- Else each non-empty field must match verifier response:
  - CBE: compare `receiver` + `receiverAccount`
  - Telebirr: compare `data.creditedPartyName` + `data.creditedPartyAccountNo` (support masked phones like `2519****5610`)
  - CBE Birr: compare `receiverName` + `creditAccount`
- Names: casefold + NFKC + whitespace collapse; allow substring either direction when length ≥ 2

## Idempotency ledger keys (must match)

Sanitize segments: trim, `:` → `-`, remove whitespace.

- Telebirr: `online-pay:telebirr:{reference}`
- CBE: `online-pay:cbe:{reference}:{accountSuffix}`
- CBE Birr: `online-pay:cbebirr:{receiptNumber}:{normalizedPhone}`

Enforce uniqueness at DB level on that ledger reference. On duplicate insert, return **HTTP 409** with message like: `This payment was already used for a deposit.`

## HTTP client rules

Implement a server helper equivalent to:

```js
async function verifyPaymentRemote(method, payload) {
  // POST `${PAYMENT_VERIFY_BASE_URL}${path}`
  // headers: Content-Type application/json, x-api-key
  // return { ok: res.ok, status, data: json }
  // on network error return status 502
  // if env missing return status 503
}
```

Paths map: `cbe → /verify-cbe`, `telebirr → /verify-telebirr`, `cbebirr → /verify-cbebirr`.

## API endpoints to expose in the host app

1. **Player deposit (auth required)**  
   `POST /api/.../online-deposit`  
   Body: `{ method, amount, smsText? }` (also accept manual fields: `reference`, `accountSuffix`, `receiptNumber`, `phoneNumber`)  
   Success 200: `{ ok: true, newBalance, creditedAmount, reference, verifySummary }`

2. **Admin receivers CRUD (auth + admin permission)**  
   `GET/PUT` settings for the receiver JSON above.

3. **Public config**  
   Expose receivers (+ deposit min/max if you have them) so the deposit UI can show where to pay.

## Frontend UX (minimum)

4-step wizard:

1. Choose method (`telebirr` | `cbe` | `cbebirr`)
2. Enter amount + show receiver name/account/phone from public config
3. Paste full SMS → Confirm
4. Show success (credited + new balance) or error

Never call the Verifier API from the browser.

## Security / correctness constraints

- Never trust SMS alone — SMS only supplies identifiers; Verifier proves the receipt.
- Never trust client amount alone — re-read amount from Verifier response.
- Keep API key server-side only.
- Require authenticated player role for deposit credit.
- Configure receivers in production; empty receiver config skips matching (dev only).
- Note: Verifier is **not** an official bank API (scrapes public receipt pages). Telebirr verification may fail from non-Ethiopia IPs — plan hosting/proxy accordingly.
- Add unit tests for SMS extract, success checks, amount parse, ledger refs, and receiver matching (no network).

## Deliverables

1. Env docs for `PAYMENT_VERIFY_BASE_URL` + `PAYMENT_VERIFY_API_KEY`
2. Backend verify client + helpers + deposit controller
3. Admin receiver settings + public display endpoint
4. Player deposit UI that pastes SMS and credits after verify
5. Unit tests covering the rules above
6. Short README section describing the flow and failure modes (400 verify fail, 409 already used, 503 not configured)

Follow the full AsmatBet reference doc attached in this conversation (`docs/external-payment-verification-integration.md`) for exact code, response field names, and edge cases. Match behavior unless the host stack requires an equivalent adaptation — do not invent alternate success/amount field names.
````

---

## Appendix A — Sample SMS fixtures (for manual / unit testing)

### CBE

```text
Dear Gadisa, You have transfered ETB 10.00 to Tewachew Adimasu on 05/04/2026 at 14:09:13 from your account 1*****2425. Your account has been debited with a S.charge of ETB 0.50 and VAT(15%) of ETB0.08 and Disaster Fund (5%) of ETB0.03, with a total of ETB 10.61. Your Current Balance is ETB 3,410.44. Thank you for Banking with CBE! https://apps.cbe.com.et:100/?id=FT26095YRWP545822425 For feedback click the link https://forms.gle/R1s9nkJ6qZVCxRVu9
```

Extracted: `reference=FT26095YRWP5`, `accountSuffix=45822425`

### Telebirr

```text
Dear Walelign 
You have transferred ETB 30.00 to daniel regasa (2519****5610) on 02/04/2026 11:59:46. Your transaction number is DD23HGV3T7. The service fee is  ETB 0.87 and  15% VAT on the service fee is ETB 0.13. Your current E-Money Account  balance is ETB 395.84. To download your payment information please click this link: https://transactioninfo.ethiotelecom.et/receipt/DD23HGV3T7.

Thank you for using telebirr
Ethio telecom
```

Extracted: `reference=DD23HGV3T7`

### CBE Birr

```text
Dear Gadisa, you have sent 10.00Br. to AMANUEL LEGESSE on 03/04/26 15:03,Txn ID DD3419QEAOK. Your CBE Birr account balance is 3.07Br.Thank you! For invoice https://cbepay1.cbe.com.et/aureceipt?TID=DD3419QEAOK&PH=251982828380 For your feedback please click the link https://shorturl.at/gy3A0
```

Extracted: `receiptNumber=DD3419QEAOK`, `phoneNumber=251982828380`

---

## Appendix B — Quick decision tree (ops)

```text
Deposit failed?
├─ 503 unavailable → check PAYMENT_VERIFY_BASE_URL / API_KEY on server
├─ Could not parse SMS → player must paste FULL SMS (include links)
├─ Payment verification failed → receipt invalid OR verifier/network issue (curl Verifier directly)
├─ not completed → provider status pending/failed
├─ recipient mismatch → payment went to wrong account OR admin receivers misconfigured
├─ amount mismatch → player typed wrong amount
└─ 409 already used → same receipt already credited (expected)
```

---

*Document generated from the AsmatBet codebase integration of the Leul/Creofam Verifier API (CBE / Telebirr / CBE Birr).*
