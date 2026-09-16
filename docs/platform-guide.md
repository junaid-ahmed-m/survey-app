# Platform guide

Everything the Scan & Reward platform does, how to use each feature, and how the hard
parts are engineered: code uniqueness, anti-guessing, race conditions, data loss,
security and performance.

Companion documents:

* [README.md](../README.md) — install, run, configure
* [docs/survey-setup.md](survey-setup.md) — Contentful and third-party survey providers

---

## Table of contents

**Part I — The product**

1. [What the platform does](#1-what-the-platform-does)
2. [Concepts and vocabulary](#2-concepts-and-vocabulary)
3. [Admin access: roles, permissions, users](#3-admin-access-roles-permissions-users)
4. [Coupon types and inventory](#4-coupon-types-and-inventory)
5. [Surveys](#5-surveys)
6. [Response forwarding (webhook / RudderStack)](#6-response-forwarding-webhook--rudderstack)
7. [Batches and code generation](#7-batches-and-code-generation)
8. [QR codes and CSV export](#8-qr-codes-and-csv-export)
9. [The consumer redemption flow](#9-the-consumer-redemption-flow)
10. [Dashboard, alerts and responses](#10-dashboard-alerts-and-responses)
11. [Outbound event monitoring](#11-outbound-event-monitoring)

**Part II — How it is engineered**

12. [How code uniqueness is guaranteed](#12-how-code-uniqueness-is-guaranteed)
13. [How the anti-guessing mechanism works](#13-how-the-anti-guessing-mechanism-works)
14. [How race conditions are prevented](#14-how-race-conditions-are-prevented)
15. [How data loss is prevented](#15-how-data-loss-is-prevented)
16. [How security is catered for](#16-how-security-is-catered-for)
17. [How performance is optimised](#17-how-performance-is-optimised)

**Part III — Reference**

18. [Configuration reference](#18-configuration-reference)
19. [API reference](#19-api-reference)
20. [Operations runbook](#20-operations-runbook)
21. [Known limits and what to do next](#21-known-limits-and-what-to-do-next)

---

# Part I — The product

## 1. What the platform does

A consumer buys a product, scans a QR code printed on the pack with the native camera,
answers a short survey, and instantly receives a discount coupon on screen and by e-mail.

```
 QR on pack          Public web app                     API                        Data
 ──────────          ──────────────                     ───                        ────
 /read/ABC123  ──►   verify the code            ──►  checksum → hash lookup   ──►  Code
                     reserve a coupon           ──►  FOR UPDATE SKIP LOCKED   ──►  Coupon (RESERVED)
                     show the survey            ──►  native / Contentful / URL
                     submit answers             ──►  one transaction:              SurveyResponse
                                                       response + code + coupon    Code (USED)
                                                       + outbound event            Coupon (ISSUED)
                                                                                   EventDelivery
                     show + e-mail the coupon
```

The same React bundle serves both the public scan app and the admin portal; the same
NestJS API serves both `/api/public/*` and `/api/admin/*`.

### The two audiences

| | Public scan app | Admin portal |
| --- | --- | --- |
| URL | `/` and `/read/:code` | `/admin` |
| Auth | None — the code *is* the credential | JWT + role permissions |
| Rate limit | 10 verify/min per IP, 3 per 5 s | 60/min per IP |
| What it can see | One survey, one coupon | Everything the role allows |

---

## 2. Concepts and vocabulary

| Term | Meaning |
| ---- | ------- |
| **Code** | The secret string behind a QR code. Printed on the pack, never stored in clear text. |
| **Batch** | A production run of codes that all share one survey, one coupon type, one SKU and one charset/length. |
| **SKU** | The product identifier a batch of codes is printed on. Optional, searchable, exported in the CSV and forwarded in events. |
| **Coupon type** | A named reward — `SAVE10`, `FREESHIP`. Carries a value, an active flag and a low-stock threshold. |
| **Coupon** | One redeemable reward code in the inventory of a type. Moves `AVAILABLE → RESERVED → ISSUED`. |
| **Session** | A started redemption. Identified by a 256-bit `sessionToken`, lives for `REDEEM_SESSION_TTL_MINUTES`. |
| **Reservation** | A short hold (`COUPON_RESERVATION_SECONDS`, default 60) that keeps one coupon for one code. |
| **Survey response** | The stored answers plus the consumer e-mail — unless the survey opted out of retention. |
| **Event delivery** | A queued outbound webhook/RudderStack message in the transactional outbox. |

### State machines

**Code** — `UNUSED → USED` (one way), or `DISABLED` (administrative kill switch).

> A code flips to `USED` the moment the survey is handed out, **not** when it is
> submitted. This is deliberate: it makes one QR = one survey, and closes the window in
> which a shared screenshot could open two surveys. An abandoned session therefore spends
> the code but returns the coupon to stock.

**Coupon** — `AVAILABLE → RESERVED → ISSUED`, with `RESERVED → AVAILABLE` on timeout and
`AVAILABLE → EXPIRED` when the stock's own expiry date passes.

**Batch generation** — `PENDING → RUNNING → COMPLETE`, with `RUNNING → PENDING` between
slices and on stale-lock reclaim, and `→ FAILED` after repeated failures.

**Event delivery** — `PENDING → DELIVERING → DELIVERED`, with `DELIVERING → PENDING` on
retry and `→ FAILED` when attempts are exhausted or the destination rejects permanently.

---

## 3. Admin access: roles, permissions, users

### 3.1 Permissions, not roles, are the unit of access

Every admin capability is a permission string. A role is nothing more than a named bundle
of them, stored as JSON in the `Role` table, so a new role never requires a code change.

| Group | Permission | Grants |
| ----- | ---------- | ------ |
| Dashboard | `dashboard:view` | Statistics, alerts, recent activity |
| Batches | `batches:view` | See batches, codes (masked), stats |
| | `batches:manage` | Create batches, pause/archive, preview code strength |
| | `codes:reveal` | Decrypt one code, see its QR image |
| | `codes:export` | Download the code CSV / QR PNG |
| Coupons | `coupons:view` | Types and inventory counts |
| | `coupons:manage` | Create/update coupon types and thresholds |
| | `coupons:reveal` | Decrypt one coupon code |
| | `coupons:import` | Upload or generate coupon stock |
| Surveys | `surveys:view` / `surveys:manage` | Read / write surveys and their forwarding config |
| Responses | `responses:view` | Response feed (e-mails masked) |
| | `responses:export` | Download the response CSV |
| | `emails:reveal` | See consumer e-mail addresses in clear text |
| Integrations | `events:view` / `events:manage` | Inspect / retry outbound deliveries |
| Access control | `roles:view` / `roles:manage` | Read / write roles |
| | `users:view` / `users:manage` | Invite users, change role, reset password |

Three roles ship with the platform and cannot be deleted:

* **SUPER_ADMIN** — always resolved to *all* permissions at request time, so a new
  permission added in a release is granted automatically and can never be missing.
* **CAMPAIGN_MANAGER** — runs campaigns end to end but holds no `*:reveal` permission.
* **VIEWER** — read-only, everything sensitive stays masked.

### 3.2 Using it

**Admin → Access → Roles** — create a role, tick permissions. Permissions flagged
*sensitive* (`codes:reveal`, `coupons:reveal`, `emails:reveal`, exports, imports) are
highlighted because each one turns masked data into clear text.

**Admin → Access → Users** — invite a user with an e-mail, name and role. Changing a
user's password sets `passwordChangedAt`, which immediately invalidates every JWT that
was issued before that moment — a compromised session cannot outlive a password reset.

**Login** — `POST /api/admin/auth/login` returns a JWT (default 8 h). The token carries
`sub`, `email` and `role` only; permissions are resolved from the database on every
request, so revoking a permission takes effect on the next call rather than the next
login.

---

## 4. Coupon types and inventory

### 4.1 Create a type

**Admin → Coupons → New type**

| Field | Notes |
| ----- | ----- |
| Code | Upper-cased, unique. This is what a batch references. |
| Name | Shown to the consumer in the reward card and e-mail. |
| Value | Free text — `10% off`, `₹100`. Copied onto each imported coupon unless overridden. |
| Low stock threshold | The dashboard raises an alert at or below this many `AVAILABLE` coupons. Default 10. |
| Active | Inactive types are excluded from low-stock alerts. |

### 4.2 Load inventory

**Admin → Coupons → Import** accepts either:

* **A list of codes** — paste or upload codes supplied by the partner running the
  discount. Codes are trimmed, upper-cased and de-duplicated.
* **A generate count** — the platform mints the codes itself using the same generator as
  scan codes.

Both paths are **idempotent**: existing `couponCodeHash` values are looked up first and
skipped, so re-sending the same partner file imports nothing twice. The response reports
`requested / imported / skippedDuplicates`.

An optional `expiresAt` marks the stock's own expiry; the cleanup cron flips expired
`AVAILABLE` coupons to `EXPIRED` so they are never handed out.

### 4.3 What the inventory looks like

**Admin → Coupons** shows per type: available / reserved / issued / expired. Individual
coupon codes are **masked** in the list (`SAVE****89`); a holder of `coupons:reveal` can
decrypt exactly one at a time, and every reveal is written to the audit log.

### 4.4 Running out

An empty pool does **not** burn a code. `verify` answers `503 COUPONS_EXHAUSTED` with
*"We are unable to cater to this request right now. Please try again later."*, the code
stays `UNUSED`, and the consumer can rescan once stock is topped up. The dashboard shows
the empty type at the top of the alert list together with how many **active batches**
depend on it.

---

## 5. Surveys

A batch chooses one of three providers. Full provider setup lives in
[docs/survey-setup.md](survey-setup.md); this is the summary.

| `surveyType` | Questions come from | Required field | Answers stored here? |
| ------------ | ------------------- | -------------- | -------------------- |
| `NATIVE` | The built-in builder | `surveyId` | Yes (unless retention is off) |
| `CONTENTFUL` | A Contentful entry, live | `surveyId` (entry id) | Yes |
| `THIRD_PARTY` | An external tool by URL | `surveyUrl` | No — only a receipt |

### 5.1 Native surveys

**Admin → Surveys → New survey.** Add questions of type `single_choice`,
`multi_choice`, `rating`, `nps`, `text` or `textarea`; each has a label, optional help
text, a required flag and, for choices, a list of options.

Native surveys are the only type where the API **validates required answers on submit**
(`400 INCOMPLETE_SURVEY` listing the missing labels) and where unknown answer keys are
dropped — the stored object can only contain declared question ids.

Question ids are stable once created; answers are stored against them, so renaming a
label keeps historic data intact.

### 5.2 Contentful

Fetched live with `include=3`, cached in memory for 60 s, 8 s timeout. A failure returns
`SURVEY_UNAVAILABLE`, **releases the reserved coupon** and leaves the code `UNUSED`.

### 5.3 Third party

The platform appends `ref` (the session token) and `return_url` to your survey URL,
opens it with `rel="noopener noreferrer nofollow"`, and waits for the consumer on
`/survey/return?session=…`. Only a receipt (`{"source":"third_party"}`) is stored; join
your export on `ref`.

---

## 6. Response forwarding (webhook / RudderStack)

Use this when the consumer data should live in *your* analytics stack rather than here.

### 6.1 Configure it

**Admin → Surveys → (a survey) → Forwarding**

| Field | Meaning |
| ----- | ------- |
| Target | `NONE`, `WEBHOOK` or `RUDDERSTACK` |
| URL | Your endpoint, or the RudderStack **data plane** URL |
| Secret | Webhook signing secret, or the RudderStack **write key**. Stored AES-256-GCM encrypted and never returned by the API — the UI only reports whether one is set. |
| Event name | Defaults to `Survey Completed` |
| Retain responses | Turn **off** to store no answers and no e-mail in this platform at all |

**Send test event** posts a synthetic payload through exactly the same transport as the
worker, so a 401 or a firewall block shows up before the campaign goes live.

### 6.2 What is sent

`POST` with `Content-Type: application/json`.

**Webhook**

```json
{
  "event": "Survey Completed",
  "messageId": "0f1c…",
  "anonymousId": "9a7b…",
  "occurredAt": "2026-09-16T16:01:43.884Z",
  "properties": {
    "surveyType": "NATIVE",
    "surveyRef": "fc77…", "surveyTitle": "Pack feedback",
    "batchId": "f26c…", "batchName": "Diwali run", "sku": "SNK-500G",
    "couponTypeCode": "SAVE10", "couponValue": "10% off",
    "codeId": "7d21…",
    "completedAt": "2026-09-16T16:01:43.884Z",
    "answers": { "q1": "Yes", "q2": ["A", "C"], "q3": 9 }
  }
}
```

**RudderStack** — the same `properties`, wrapped in a `type: "track"` envelope with
`messageId`, `anonymousId`, `originalTimestamp` and `channel: "server"`, posted to
`<dataPlaneUrl>/v1/track` with the write key as HTTP Basic username.

Headers:

| Header | Webhook | RudderStack |
| ------ | ------- | ----------- |
| `X-Event-Id` | delivery id | delivery id |
| `X-Idempotency-Key` | `codeId` — stable across every retry | — |
| `X-Webhook-Timestamp` | epoch ms | — |
| `X-Webhook-Signature` | `sha256=HMAC_SHA256(secret, "<timestamp>.<body>")` | — |
| `Authorization` | — | `Basic base64(writeKey + ":")` |

**Verifying the signature** (Node):

```js
const expected = 'sha256=' + crypto
  .createHmac('sha256', SECRET)
  .update(`${req.get('X-Webhook-Timestamp')}.${rawBody}`)
  .digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.get('X-Webhook-Signature')));
```

Use the **raw** body, reject timestamps older than a few minutes, and treat
`X-Idempotency-Key` as a de-duplication key — the outbox guarantees *at-least-once*
delivery, not exactly-once.

### 6.3 No PII, by construction

* The e-mail address is **never** put in the payload. Downstream systems get
  `anonymousId` — an HMAC-SHA256 of the lowercased e-mail with the platform pepper. It is
  stable, so sessions stitch together, but it is not reversible without the pepper.
* Free-text answers are additionally scrubbed: anything matching an e-mail address, a
  phone number or a 9+ digit run becomes `[redacted-email]` / `[redacted-number]`, and
  every string is clamped to 2 000 characters.
* With **retain responses off**, `SurveyResponse.answers` is `{}` and `email` is `null`;
  the coupon is issued with no `issuedToEmail`. The e-mail is used once, in memory, to
  send the reward. The forwarded event becomes the system of record.

### 6.4 Monitoring

**Admin → Events** lists every delivery with status, attempt count, last HTTP status,
last error and next attempt time, plus headline counts of pending / delivered / failed.
Endpoints are shown without their query string (tokens hide there). Payloads are safe to
open for debugging precisely because they contain no PII. A `FAILED` delivery can be
re-queued with **Retry**.

---

## 7. Batches and code generation

### 7.1 Create a batch

**Admin → Batches & QR → New batch**

| Field | Notes |
| ----- | ----- |
| Name / description | Free text, shown to the consumer as the campaign name |
| SKU | The product this run is printed on. Searchable, exported, forwarded. |
| Survey source | Native / Contentful / Third party (see §5) |
| Coupon type | Must already exist and have stock |
| Prefix | Up to 12 chars `A–Z 0–9 -`, prepended to every code, e.g. `DIWALI` |
| Charset | Defaults to `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — 32 unambiguous characters with no `0/O/1/I` |
| Code length | 6–32, the length of the **random body** (prefix and checksum are added on top) |
| Quantity | 1 – 1 000 000 |
| Expires at | Optional campaign end date; afterwards scans return `BATCH_INACTIVE` |

**Preview** shows five sample codes, the example redeem URL and a strength rating
(`weak` < 40 bits, `fair` < 60, `strong` < 80, `very-strong` ≥ 80) before you commit.

Creation is refused with `WEAK_CODE_SPACE` when
`charsetSize^codeLength < quantity × 1000` — see §13 for why that specific rule.

### 7.2 Inline vs. queued generation

| Quantity | What happens | Response |
| -------- | ------------ | -------- |
| ≤ 10 000 | Generated inside the request | `generated: <n>, queued: false` |
| > 10 000 | Queued for the background worker | `generated: 0, queued: true`, returns in ~30 ms |

Encrypting and inserting hundreds of thousands of codes inside an HTTP request would
block the Node event loop for minutes and time the caller out, so anything large is
handed to a cron.

### 7.3 The background worker

`CodeGenerationService` runs every 10 seconds:

1. **Reclaim** — any batch left `RUNNING` for more than 5 minutes (a process that crashed
   mid-slice) goes back to `PENDING`.
2. **Claim** — takes ownership of the oldest `PENDING` batch with a single
   `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`. Several
   API instances can run the cron and will never pick the same batch.
3. **Fill** — produces codes in **2 000-code slices** for up to a **5-second budget**,
   `await`ing `setImmediate` between slices so the event loop keeps serving traffic, and
   persisting `generatedCount` after **every** slice.
4. **Release** — full → `COMPLETE` with `generationCompletedAt`; not full → back to
   `PENDING`, and the next tick resumes exactly where this one stopped.
5. **Fail** — a failing slice re-queues the batch with the error recorded. After 5
   consecutive failed attempts it is parked as `FAILED` rather than looping forever.

Because progress is persisted per slice, a crash loses at most one slice of work, never
the batch.

**Measured:** a 25 000-code batch returns from `POST /admin/batches` in 28 ms and is
fully generated 4.8 s later.

### 7.4 Watching progress

Every batch payload carries a `generation` object:

```json
{ "status": "RUNNING", "generated": 14000, "total": 25000, "percent": 56,
  "error": null, "startedAt": "…", "completedAt": null }
```

* **Batches list** — a compact progress bar in the *Codes* column; the list auto-refreshes
  every 5 s while anything is `PENDING` or `RUNNING`, and stops polling when everything is
  `COMPLETE`.
* **Batch detail** — a full-width progress card and a 3 s refresh.
* **CSV export** is disabled in the UI and answers `409 GENERATION_IN_PROGRESS` on the API
  until the batch completes. Sending a half-generated print file to a supplier would be
  worse than sending none.

### 7.5 Managing a live batch

**Pause** (`status: PAUSED`) stops all redemptions immediately with `BATCH_INACTIVE`
without touching the codes — useful when a coupon partner has a problem. **Archive** ends
the campaign. Setting `expiresAt` in the past has the same effect as pausing.

---

## 8. QR codes and CSV export

### 8.1 What the QR contains

`{PUBLIC_APP_URL}/read/{CODE}` — nothing else. No tracking parameters, no batch id. The
image is a 512 px PNG at error-correction level M with a 2-module quiet zone, which
survives the usual print and glare conditions on a pack.

`PUBLIC_APP_URL` must be the real public origin: it is baked into the printed artwork and
is also what `return_url` is built from for third-party surveys.

### 8.2 Getting the codes out

| Need | Endpoint | Permission |
| ---- | -------- | ---------- |
| One code in clear text | `GET /admin/batches/codes/:codeId/reveal` | `codes:reveal` |
| One QR as a data URL (for the screen) | `GET /admin/batches/codes/:codeId/qr` | `codes:reveal` |
| One QR as a PNG download | `GET /admin/batches/codes/:codeId/qr.png` | `codes:reveal` |
| The whole batch as CSV | `GET /admin/batches/:id/export.csv` | `codes:export` |

The CSV has `batch, sku, code, url, status, used_at` and is **streamed**: rows are pulled
in cursor-paged chunks of 1 000, decrypted, written to the socket, and dropped. A
million-row export costs a bounded amount of memory instead of building one giant string.
The writer honours back-pressure — a slow client throttles the reader rather than making
the server buffer the file.

Every reveal and every export is written to the audit log with the actor and the row
count. This is the moment secret material leaves the system, so it is the moment worth
recording.

### 8.3 Sending codes to the printer

Export the CSV, hand the `url` column to the artwork tool, and keep the file out of
general circulation — it is the complete list of valid secrets for that campaign. The
platform never needs the file back; codes are verified from the database.

---

## 9. The consumer redemption flow

### 9.1 Step by step

**1 — Scan.** The native camera opens `/read/:code`.

**2 — `POST /api/public/redeem/verify`.**

* The code is normalised (upper-cased, everything except `A–Z 0–9 -` stripped), so a
  consumer typing `abc-123 ` works.
* The **checksum character** is verified locally. A failure returns `INVALID_CODE`
  *without touching the database* — this is the cheap filter that makes enumeration
  expensive (§13).
* The code is looked up by its HMAC hash on a unique index — one index probe.
* `DISABLED` → `CODE_DISABLED`. Inactive or expired batch → `BATCH_INACTIVE`.
* `scanCount` is incremented and `lastScanAt` stamped (visible in the admin code list).
* **A coupon is reserved before the survey is shown.** No stock → `503 COUPONS_EXHAUSTED`
  and the code stays `UNUSED`.
* The survey is resolved. If the provider is down the reservation is rolled back and the
  code stays `UNUSED`.
* The code is claimed with a conditional update (`WHERE status = 'UNUSED'`). The winner
  gets a fresh session; a parallel scan that loses the race **resumes the winner's
  session** rather than being told the code is spent.
* Returns the session token, expiry, campaign name and the survey.

**3 — `GET /api/public/redeem/session/:token`.** Rehydrates a session on refresh or on
return from a third-party tool. Returns the survey again, or the coupon if the session is
already complete — so the reward page is safe to reload and bookmark.

**4 — `POST /api/public/redeem/complete`.** Session token + e-mail + answers.

* Required answers are validated for native surveys.
* The reservation is **extended** (or a fresh coupon pulled if the hold lapsed), so the
  cleanup cron cannot pull the rug mid-submit.
* Answers are **rebuilt, not trusted** — see §16.5.
* One transaction writes the `SurveyResponse`, flips the code, issues the coupon and
  enqueues the outbound event. All four land, or none do.
* The coupon e-mail is sent *after* the commit; a mail failure does not lose the coupon,
  which is already on screen and re-readable from the session endpoint.

### 9.2 What the consumer sees when something is wrong

| Code | HTTP | Message |
| ---- | ---- | ------- |
| `INVALID_CODE` | 404 | "This code is not valid. Please check the QR code and try again." |
| `CODE_ALREADY_USED` | 409 | "This code has already been used." |
| `CODE_DISABLED` | 403 | "This code has been deactivated." |
| `BATCH_INACTIVE` | 403 | "This campaign is not active at the moment." / "This campaign has ended." |
| `COUPONS_EXHAUSTED` | 503 | "We are unable to cater to this request right now. Please try again later." |
| `SESSION_EXPIRED` | 404 | "This session has expired. Please scan the QR code again." |
| `SURVEY_UNAVAILABLE` | 503 | "The survey is not available right now. Please try again later." |
| `RATE_LIMITED` | 429 | Standard throttler response |

Note that `INVALID_CODE` is returned for **both** a bad checksum and an unknown code. The
two cases are indistinguishable from outside, so the endpoint cannot be used as an oracle
to tell "well-formed but unsold" from "malformed".

---

## 10. Dashboard, alerts and responses

### 10.1 Dashboard

**Admin → Dashboard** shows code totals and redemption rate, coupon inventory across all
types, batch and response counts, the ten most recent audit entries, and the low-stock
alert list.

### 10.2 Coupon exhaustion alerts

Each **active** coupon type is compared against **its own** `lowStockThreshold` rather
than one global number — 50 left is comfortable for a slow SKU and an emergency for a
national launch. Each alert carries:

* `available` and `reserved` counts,
* the `threshold` that triggered it,
* `activeBatches` — how many live campaigns are pointed at that type, which is the real
  measure of urgency,
* `severity`: `EMPTY` (available = 0, redemptions are already failing) or `LOW`.

Empty pools sort first, then the closest to running out.

### 10.3 Responses

**Admin → Responses** is a paged feed filterable by batch. E-mails are **masked** unless
the caller holds `emails:reveal`. Answers are rendered from the stored JSON.

**Export CSV** produces one column per distinct answer key across the result set, with
multi-choice answers joined by ` | `. E-mails are clear text only with `emails:reveal`;
the export is audited with the row count and whether e-mails were masked.

---

## 11. Outbound event monitoring

Covered in §6.4. The operational point: **pending is normal, failed needs a human.** A
pending count that climbs steadily means the destination is slow or down; the backoff
will keep trying for hours. A failed count means either the credential is wrong (a 401 is
treated as permanent) or the destination rejected the payload shape — fix it and press
Retry, the payload is still there.

---

# Part II — How it is engineered

## 12. How code uniqueness is guaranteed

Uniqueness is enforced at four layers, from cheapest to most authoritative.

### Layer 1 — The clear-text code is never the key

A code is stored three ways and **never** in clear text:

| Column | Value | Purpose |
| ------ | ----- | ------- |
| `codeHash` | `HMAC-SHA256(code, CODE_HASH_SECRET)` | Lookup **and uniqueness** |
| `codeEncrypted` | AES-256-GCM ciphertext | Reversible, for export/QR only |
| `codeMasked` | `ABCD****89` | Safe to show in listings |

This split exists because AES-GCM is **randomised** — the same code encrypted twice
produces different ciphertext, so `codeEncrypted` cannot carry a unique constraint. The
deterministic HMAC can. The pepper (`CODE_HASH_SECRET`) means an attacker holding a
database dump still cannot build a rainbow table of candidate codes.

### Layer 2 — Uniform random generation

Each character is drawn with `crypto.randomInt(0, charset.length)`, which uses rejection
sampling. A naive `randomBytes(1)[0] % 32` would be fine for 32 but biased for any charset
size that is not a power of two; `randomInt` is uniform for **every** charset the admin
can configure.

### Layer 3 — Three de-duplication passes before the insert

1. **Within a slice** — candidates are accumulated in a `Set`, so one generation call can
   never emit the same code twice. It retries up to `count × 20 + 100` times and throws
   `Unable to generate the requested number of unique codes` if the space is too small to
   fill the request, which surfaces a bad charset/length immediately.
2. **Against the table** — every chunk of 500 candidates is checked with a single
   `SELECT codeHash WHERE codeHash IN (…)`, and clashes are dropped before the insert.
3. **Across rounds** — `generateInto` loops until it has inserted the requested count (up
   to 10 rounds), regenerating whatever the pre-filter removed. A collision therefore
   costs one extra round trip rather than a failed batch.

### Layer 4 — The database is the final arbiter

`Code.codeHash` carries a `@unique` index. Even if two API instances generated the same
code at the same microsecond, PostgreSQL rejects the second one. The same pattern protects
`Coupon.couponCodeHash`, `Code.sessionToken`, `Coupon.codeId`, `SurveyResponse.codeId` and
`EventDelivery.codeId`.

### How likely is a collision anyway?

With the default 32-character charset and a 12-character body the space is
$32^{12} = 2^{60} \approx 1.15 \times 10^{18}$. For a batch of $n$ codes the birthday
bound gives

$$P(\text{any collision}) \approx \frac{n^2}{2N}$$

| Batch size | Collision probability |
| ---------- | --------------------- |
| 25 000 | $2.7 \times 10^{-10}$ |
| 1 000 000 | $4.3 \times 10^{-7}$ |

Layers 3 and 4 turn even that into a retry rather than an error.

---

## 13. How the anti-guessing mechanism works

The QR URL is public and unauthenticated — the code *is* the credential. Four mechanisms
stack up.

### 13.1 The HMAC checksum character

Every code is `prefix + randomBody + checksumChar`, where

```
checksumChar = CHECKSUM_ALPHABET[ HMAC_SHA256(CODE_CHECKSUM_SECRET, prefix+body)[0] mod 32 ]
```

The checksum alphabet is fixed at 32 characters on purpose: verification must work
*without knowing which batch* (and therefore which charset) a code belongs to.

Consequences:

* **31 of every 32 random guesses (96.9%) are rejected with zero database work.** Under an
  enumeration attack the database never sees the traffic — only the CPU cost of one HMAC.
* An attacker cannot compute the checksum offline: it needs `CODE_CHECKSUM_SECRET`, which
  never leaves the server.
* It doubles as a typo detector for anyone entering a code by hand.

### 13.2 A mandatory sparse code space

Batch creation is rejected with `WEAK_CODE_SPACE` unless

$$\text{charsetSize}^{\text{codeLength}} \;\ge\; \text{quantity} \times 1000$$

So **at most 1 in 1 000** well-formed bodies is a live code. Combined with the checksum,
the guaranteed worst case for a single random guess is

$$P(\text{hit}) \;\le\; \frac{1}{1000 \times 32} = \frac{1}{32\,000}$$

and the public rate limit of 10 verifies per minute per IP turns that floor into roughly
**one hit per 53 hours per IP** — and that is the *worst configuration the platform will
accept*.

The realistic case is far better. A 25 000-code batch at length 12 has
$P = 25\,000 / 32^{13} \approx 7 \times 10^{-16}$ per guess: about $10^{15}$ guesses for
an even chance, which at 10/min is longer than the age of the universe per IP.

`codeLength` is additionally floored at 6 by the DTO, and the **preview** endpoint shows
the entropy and rating before a batch is committed, so a weak configuration is visible
before it is printed.

### 13.3 Layered rate limiting

| Scope | Limit | Why |
| ----- | ----- | --- |
| Global | 60 / 60 s per IP | Blanket ceiling |
| `redeem/verify`, `redeem/complete` | 10 / 60 s **and** 3 / 5 s | Sustained + burst |
| `redeem/session/:token` | 30 / 60 s | Refreshes are legitimate; still bounded |
| `admin/auth/login` | 8 / 60 s | Password spraying |

The burst limiter matters as much as the sustained one: a scripted attacker will fire in
bursts, and three attempts per five seconds makes distributed enumeration expensive in
*IP addresses*, which is the scarce resource.

> **Deployment note.** The throttler keys on `req.ip`, and `TRUST_PROXY_HOPS` must match
> the real number of reverse proxies. Trusting a hop that does not exist lets any client
> forge `X-Forwarded-For` and get a brand new bucket on every request — which silently
> disables all of the above. It defaults to `0` (trust nothing) for exactly this reason.

### 13.4 No oracle

`verify` returns the *same* `404 INVALID_CODE` with the *same* message for a bad checksum
and for an unknown code. An attacker cannot distinguish "wrong shape" from "right shape,
not sold", so failures reveal nothing about the structure of the live key space. Both
cases are audit-logged (`REDEEM_INVALID_CHECKSUM` / `REDEEM_UNKNOWN_CODE`) with the IP, so
an enumeration attempt is visible in the activity feed even though it is invisible to the
attacker.

---

## 14. How race conditions are prevented

### 14.1 The strategy

**No optimistic-lock retry loops, and no pessimistic lock held across a round trip.**

Every contended state change is either

* an **atomic conditional write** — `UPDATE … WHERE id = ? AND status = 'EXPECTED'`,
  compare-and-swap semantics, where the affected row count tells you whether you won; or
* a **single-statement queue pop** — `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP
  LOCKED LIMIT n) RETURNING *`; or
* a **unique constraint** that lets the database arbitrate and the loser recover.

`FOR UPDATE SKIP LOCKED` is a pessimistic row lock, but it is held for microseconds
*inside one statement* — the transaction never spans an application round trip, so there
is nothing to dead-lock and nothing to time out. Crucially, `SKIP LOCKED` means N
concurrent workers take N **different** rows instead of all queueing behind the same one:
throughput scales with workers instead of collapsing to serial.

### 14.2 The catalogue

| # | Race | Where | Mechanism | Loser's outcome |
| - | ---- | ----- | --------- | --------------- |
| 1 | Same QR scanned twice at once | `verify` | `updateMany({ id, status: 'UNUSED' })` — CAS | Resumes the winner's session; **no second survey** |
| 2 | Both scans reserve a coupon | `reserveForCode` | `Coupon.codeId @unique` + catch | Re-uses the coupon the winner reserved; **no double spend** |
| 3 | N shoppers pop the same coupon | `reserveForCode` | `FOR UPDATE SKIP LOCKED LIMIT 1` | Gets a *different* coupon; no retry loop, no false "exhausted" |
| 4 | Cleanup releases a hold mid-submit | `complete` | Re-reserve before the transaction + CAS on `status:'RESERVED'` | Either the hold is extended or a fresh coupon is pulled |
| 5 | Survey submitted twice | `complete` | `SurveyResponse.codeId @unique` inside the transaction | `409 CODE_ALREADY_USED`; one response, one coupon |
| 6 | Issue vs. release | `issueForCode` | `updateMany({ codeId, status:'RESERVED' })`, `count !== 1` → abort | `503`, whole transaction rolls back, nothing half-done |
| 7 | Two dispatchers claim an event | `EventDispatcher.claim` | `FOR UPDATE SKIP LOCKED LIMIT 25` | Claims different rows |
| 8 | Dispatcher crashes mid-POST | `reclaimStaleLocks` | `DELIVERING` older than 5 min → `PENDING` | Redelivered; consumer de-dupes on `X-Idempotency-Key` |
| 9 | Two workers claim a batch | `CodeGeneration.claim` | `FOR UPDATE SKIP LOCKED LIMIT 1` | Picks a different batch or idles |
| 10 | Generator crashes mid-slice | `reclaimStaleLocks` | `RUNNING` older than 5 min → `PENDING` | Resumes from the last persisted `generatedCount` |
| 11 | Cron tick overruns its interval | `drain()` | In-process `working` / `draining` re-entrancy flag | The next tick returns immediately |
| 12 | Partner re-uploads a coupon file | `importCoupons` | Pre-filter on `couponCodeHash` + unique index | Counted as `skippedDuplicates` |
| 13 | Two instances mint the same code | `generateInto` | `Code.codeHash @unique` | Pre-filtered, or rejected and regenerated |

### 14.3 Why the coupon is reserved *before* the survey

This is the single most important ordering decision in the system. If the coupon were
reserved at submit time, a consumer could answer a ten-question survey and *then* be told
there is no reward — which is exactly the experience the platform exists to avoid.

Reserving first means the worst case is being turned away **before** any effort is spent,
with the code still `UNUSED` so a retry later works. The cost is that reservations can be
abandoned, which is why they are short (60 s, refreshed by `complete`) and swept by a cron
every minute.

### 14.4 The one transaction that matters

```ts
await prisma.$transaction(async (tx) => {
  await tx.surveyResponse.create(...)   // the answers
  await tx.code.update(...)             // the code is spent
  const coupon = await coupons.issueForCode(record.id, email, tx)
  if (!coupon) throw new ServiceUnavailableException(...)  // rolls everything back
  if (forwardConfig) await events.enqueueSurveyCompleted(tx, ...)  // the outbox row
})
```

Four writes, one commit. There is no interleaving in which a consumer's answers are stored
but the coupon is not issued, or a coupon is issued but the analytics event is missing.

---

## 15. How data loss is prevented

"No data loss" means four separate promises.

### 15.1 A redemption is never half-done

The transaction in §14.4. Any failure — including "the coupon was released underneath us"
— rolls back the whole thing and leaves the session **replayable** rather than burning the
reward.

### 15.2 A forwarded event can never be lost — the transactional outbox

The naive implementation (`await fetch(...)` after the commit) loses the event whenever the
process dies, the network blips or the destination is down. Instead:

1. The `EventDelivery` row is written **inside the same transaction** as the
   `SurveyResponse`. Once the consumer sees "thank you", the event is durable in *our*
   database. Committing the response without queueing the event is not a reachable state.
2. A cron drains the outbox out of band, claiming up to 25 due rows per pass (up to 4
   passes per tick) with `FOR UPDATE SKIP LOCKED`.
3. The **attempt counter is incremented at claim time**, not after the response. A process
   that dies mid-POST therefore cannot produce an infinite retry loop.
4. Failures retry with **exponential backoff and jitter**: 30 s base, doubling, capped at
   6 hours, ±20 % jitter so a recovering destination is not stampeded by every pending
   row at once. Up to 12 attempts spans several days.
5. A crash mid-flight leaves a `DELIVERING` row, which is reclaimed after 5 minutes.
6. Nothing is ever deleted. An exhausted or permanently-rejected delivery becomes `FAILED`
   with its payload, last status code and last error intact, and can be re-queued from the
   admin UI once the destination is fixed.

**Delivery semantics: at-least-once.** Exactly-once is not achievable across a network
boundary, so the platform makes de-duplication trivial instead — `X-Idempotency-Key` is
the `codeId` (unique per redemption) and `messageId` is the delivery id, both stable
across every retry.

### 15.3 A coupon is never stranded

| Situation | Outcome |
| --------- | ------- |
| Survey provider is down after reserving | Reservation explicitly released, code stays `UNUSED` |
| Consumer abandons the survey | Hold expires, cron returns it to `AVAILABLE` within a minute |
| Process crashes between reserve and issue | Same — the hold has a deadline, not a process |
| Submit races the cleanup cron | `complete` re-reserves first; the CAS on `RESERVED` prevents a ghost issue |
| Coupon stock itself expires | Flipped to `EXPIRED` so it is never handed out silently |

### 15.4 A consumer never loses a coupon they earned

The reward is rendered on screen from the `complete` response **and** is re-readable at
any time from `GET /redeem/session/:token`, which returns the coupon for a completed
session. E-mail is sent after the commit and is best-effort: `emailed: false` comes back
in the response, the coupon is still on screen, and the reward page can be reloaded or
bookmarked. With no SMTP configured the e-mail is logged instead, which keeps development
honest.

### 15.5 Deliberately *not* preserved

When a survey has **retain responses off**, answers and the e-mail are intentionally not
written here — that is the point of the feature, and the forwarded event is the system of
record. Turn it on if this platform should hold the data.

---

## 16. How security is catered for

Mapped to the OWASP Top 10.

### 16.1 A01 — Broken access control

* Every admin controller is `@UseGuards(JwtAuthGuard, PermissionsGuard)`; the public
  redeem controller is explicitly `@Public()`. There is no third category.
* Handlers declare `@RequirePermissions(...)`; a handler with no declaration is not
  reachable by a lesser role by accident because the guard runs regardless.
* Permissions are resolved **from the database on every request**, not read from the JWT.
  Revoking access takes effect on the next call.
* `SUPER_ADMIN` resolves to `ALL_PERMISSIONS` at request time, so a permission added in a
  release can never be silently missing from the top role.
* Sensitive reads are **step-up and singular**: listings return masked values only
  (`code: null`, `couponCode: null`), and clear text requires a separate call, a separate
  permission, and produces an audit record.

### 16.2 A02 — Cryptographic failures

* Codes and coupon codes: **AES-256-GCM** (authenticated encryption) with a random 12-byte
  IV per value and a 16-byte auth tag. Stored as `iv.tag.ciphertext`, base64.
* Lookups: **HMAC-SHA256 with a pepper**, never a bare SHA-256 — a bare hash of a
  short, structured code is trivially rainbow-tabled from a database dump.
* Admin passwords: **bcrypt cost 12**.
* The key accepts 32-byte hex or base64, and derives with **scrypt** from anything else,
  so a passphrase in `.env` still produces a proper key.
* Tokens (`sessionToken`, event ids) come from `crypto.randomBytes(32)` — 256 bits.
* Comparisons that matter use `crypto.timingSafeEqual`.
* Destination secrets (webhook signing keys, RudderStack write keys) are encrypted at rest
  and **never returned by the API** — the UI only learns whether one is set.

### 16.3 A03 — Injection

* All data access goes through Prisma. The two raw statements (`reserveForCode`,
  `claim`) use tagged-template parameter binding — values are never interpolated into SQL.
* CSV cells are escaped by doubling quotes and wrapping.
* React escapes by default; no `dangerouslySetInnerHTML` is used.

### 16.4 A04 — Insecure design

* The reserve-before-survey ordering (§14.3).
* The `WEAK_CODE_SPACE` guard makes an unguessable code space a *precondition of creating
  a batch* rather than a deployment recommendation.
* `INVALID_CODE` is a single uniform answer (§13.4).
* The e-mail is structurally absent from forwarded payloads (§6.3) rather than filtered
  out later.

### 16.5 A05 — Security misconfiguration

* **Secrets fail fast in production.** With `NODE_ENV=production`, a missing or
  still-default `CODE_ENCRYPTION_KEY`, `CODE_HASH_SECRET`, `CODE_CHECKSUM_SECRET` or
  `JWT_SECRET` throws at startup with instructions to generate one. A shipped default
  `JWT_SECRET` would let anyone mint an admin token; the app refuses to boot instead.
* `SEED_ADMIN_PASSWORD` is mandatory when seeding in production, the seeder never resets
  an already-rotated password on re-run, and the password is not printed in production.
* `TRUST_PROXY_HOPS` defaults to `0` (§13.3).
* `MAX_BODY_SIZE` defaults to `64kb`, far below the Express default, so one request cannot
  push megabytes at the database.
* Helmet is enabled; CORS is an explicit allow-list from `CORS_ORIGINS`.
* `ValidationPipe` runs with `whitelist: true` **and** `forbidNonWhitelisted: true` — an
  undeclared property is a `400`, not a silently-ignored field, which kills mass
  assignment.
* The global exception filter returns a stable `{ statusCode, code, message, path,
  timestamp }` shape and never leaks a stack trace; unexpected errors are logged
  server-side and reported as a generic message.

### 16.6 A07 — Identification and authentication failures

* Login always runs a bcrypt comparison — against a dummy hash when the account does not
  exist — so response timing does not leak account existence.
* One uniform `INVALID_CREDENTIALS` for unknown user, wrong password and disabled account.
* Login is throttled at 8/min per IP.
* `passwordChangedAt` invalidates every token issued before a password change: the JWT
  strategy compares `iat` against it (with 1 s of slack for second-precision `iat`) and
  rejects with *"Your password changed. Please sign in again."*
* `isActive: false` locks a user out immediately — the check is in the strategy, on every
  request.

### 16.7 A08 — Data integrity

* Every outbound webhook can be signed: `sha256=HMAC(secret, "<timestamp>.<body>")` over
  the raw body, with the timestamp in its own header so replays are detectable.
* The audit log records reveals, exports, redemptions, invalid-code attempts and coupon
  exhaustion, with actor and IP.

### 16.8 A10 — SSRF

Forwarding destinations are admin-supplied but the request leaves *our* server, which is
textbook SSRF. `assertSafeDestinationUrl` rejects, in production:

* any scheme other than `https:`,
* URLs with embedded credentials (use the secret field),
* `localhost`, `*.local`, `*.internal`, `metadata`, `metadata.google.internal`,
  `instance-data`,
* IPv4 in `0/8`, `10/8`, `127/8`, `169.254/16` (**cloud metadata**), `172.16–31/12`,
  `192.168/16`, `100.64/10` (CGNAT) and anything `≥ 224` (multicast/reserved),
* IPv6 loopback `::1`/`::` and `fc00::/7`, `fe80::/10`.

The dispatcher additionally sets `redirect: 'manual'` — a `30x` from an otherwise
legitimate destination could point anywhere, including back inside the network — and a
10 s timeout via `AbortSignal.timeout`.

Outside production `allowLocal` is true so a developer can point at a local listener.

### 16.9 Input handling on the one endpoint anyone can reach

`complete` accepts a free-form `answers` object. It is **rebuilt rather than trusted**:

| Bound | Value | Why |
| ----- | ----- | --- |
| Allowed keys | For a native survey, **only the declared question ids** | An attacker cannot invent columns |
| Key length (non-native) | 64 chars | Bounds the key space |
| Fields | 100 | Bounds the row |
| Array entries | 50, and only `string` / `number` / `boolean` | No nested payload bombs |
| String length | 2 000 chars | Bounds each value |
| Objects | Dropped entirely | No arbitrary structure |

Combined with the 64 kb body cap and `forbidNonWhitelisted`, there is no path from a
crafted redemption body to an oversized row, an unexpected column, or an object graph in
an outbound event.

### 16.10 Privacy

E-mails are masked in every listing and export unless `emails:reveal` is held; the mask
helper keeps a few leading characters and the last two so a human can still recognise a
record without reading it. Forwarded payloads contain no e-mail at all. `retainResponses:
false` removes consumer data from this system entirely.

---

## 17. How performance is optimised

Design target: **billions of codes, millions of scans**, on ordinary PostgreSQL.

### 17.1 Every hot path is an index probe

The consumer path does no scans and no joins that are not on a primary key:

| Operation | Access |
| --------- | ------ |
| Verify a code | Unique index on `Code.codeHash` — one probe, O(log n) at any table size |
| Rehydrate a session | Unique index on `Code.sessionToken` |
| Pop a coupon | `@@index([couponTypeCode, status, createdAt])` — the index supplies the `ORDER BY`, so the scan stops at the first unlocked row instead of sorting the pool |
| Detect a completed session | Unique index on `SurveyResponse.codeId` |

A bad checksum does not reach the database at all, so the cheapest possible request — a
garbage code — is also the most common under attack.

### 17.2 The full index set and what each is for

| Model | Index | Serves |
| ----- | ----- | ------ |
| `Code` | `codeHash` (unique) | The verify lookup |
| | `sessionToken` (unique) | Session rehydration |
| | `[batchId, status]` | Per-batch stats and filtered listings |
| | `[status]` | Global dashboard counts |
| | `[batchId, id]` | **Stable** code listing and cursor-paged export |
| | `[sessionExpiresAt]` | The cleanup cron — without it, a full table scan **every 60 seconds** |
| `Coupon` | `couponCodeHash` (unique) | Import de-duplication |
| | `codeId` (unique) | One coupon per code (also a race guard) |
| | `[couponTypeCode, status, createdAt]` | The queue pop |
| | `[couponTypeCode, status]`, `[status]` | Inventory counts |
| | `[status, reservedUntil]` | Reservation sweep |
| | `[status, expiresAt]` | Stock expiry sweep |
| `Batch` | `[status]`, `[sku]` | Listing and SKU search |
| | `[generationStatus, createdAt]` | The generation worker's claim |
| `SurveyResponse` | `codeId` (unique) | Duplicate-submit guard |
| | `[batchId, completedAt]` | Per-batch feed, newest first |
| | `[completedAt]` | Unfiltered feed |
| `EventDelivery` | `[status, nextAttemptAt]` | The dispatcher's claim |
| | `[createdAt]`, `codeId` (unique) | Admin listing; idempotency |
| `AuditLog` | `[action, createdAt]`, `[createdAt]`, `[entityId]` | Activity feed and per-entity history |

> Applying these to a live table should use `CREATE INDEX CONCURRENTLY` in a migration —
> `prisma db push` builds them with a lock.

### 17.3 Pagination that is actually correct

`Code.createdAt` is **not** a valid sort key: a bulk insert runs in one transaction and
stamps every row in the batch with an identical timestamp, so `ORDER BY createdAt` with
`OFFSET` silently skips and repeats rows. Both the listing and the export order by `id`,
backed by `@@index([batchId, id])`.

The CSV export goes further and uses **cursor pagination** (`cursor` + `skip: 1`) rather
than `OFFSET`, because `OFFSET 900000` makes PostgreSQL walk 900 000 rows to throw them
away. Cursor paging is O(chunk) regardless of how deep the export has run.

Every list endpoint has a hard page-size ceiling (100 or 200) so a client cannot request
the whole table.

### 17.4 Memory is bounded on the big operations

| Operation | Technique | Peak memory |
| --------- | --------- | ----------- |
| Code CSV export | Cursor chunks of 1 000, written to the socket, with back-pressure | ~1 000 rows |
| Code generation | Slices of 2 000, inserts of 500 | ~2 000 rows |
| Coupon import | Chunked hash pre-check + `createMany` | Bounded by the upload |

The export writer awaits `drain` when the socket is full, so a slow client throttles the
reader instead of forcing the server to buffer a million-row file in RAM.

### 17.5 The event loop is never blocked

Node is single-threaded, and both AES-GCM encryption and bcrypt are CPU-bound. Two rules
follow:

* **Nothing unbounded runs inside a request.** Above 10 000 codes, generation moves to the
  worker and the request returns in ~30 ms.
* **The worker yields.** It works a 5-second budget per 10-second tick and `await`s
  `setImmediate` between 2 000-code slices, so a million-code job never starves consumer
  traffic. The trade is a ~50 % duty cycle — roughly 20 minutes for a million codes.

Both crons carry a re-entrancy flag, so a slow tick can never stack workers on top of each
other.

### 17.6 Concurrency scales out, not down

`FOR UPDATE SKIP LOCKED` is the reason the coupon pool does not become a bottleneck. With
a naive `SELECT … ORDER BY createdAt LIMIT 1 FOR UPDATE`, every concurrent shopper queues
behind the *same* oldest row and throughput collapses to serial. With `SKIP LOCKED`, N
shoppers take N different coupons in parallel, with no retry loop and no spurious
"exhausted" under load.

The same pattern makes both crons safe to run on **every** API instance: workers skip each
other's rows rather than colliding, so horizontal scaling needs no leader election for the
outbox or the generator.

### 17.7 Cheap statistics

Per-batch and per-type counts use `groupBy` over an index rather than N+1 counts; the
batch list fetches stats for the whole page in one query. Contentful entries are cached in
memory for 60 s, so a campaign hitting a single survey makes at most one upstream call per
minute.

### 17.8 Front-end behaviour

TanStack Query caches and de-duplicates requests. Progress polling is **conditional** —
`refetchInterval` returns `false` once nothing is generating, so an idle admin tab makes
no requests at all. The public app is a small Vite bundle with no survey logic downloaded
until a session exists.

---

# Part III — Reference

## 18. Configuration reference

All back-end settings live in `apps/api/.env` (template `apps/api/.env.example`).

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `NODE_ENV` | `development` | `production` enables secret fail-fast and SSRF blocking |
| `PORT` | `3000` | API port |
| `PUBLIC_APP_URL` | `http://localhost:5173` | **Baked into printed QR codes.** Must be the real public origin |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allow-list |
| `TRUST_PROXY_HOPS` | `0` | Number of reverse proxies. Must match the deployment exactly (§13.3) |
| `MAX_BODY_SIZE` | `64kb` | Request body ceiling |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `CODE_ENCRYPTION_KEY` | — | 32-byte hex/base64. AES-256-GCM key for codes and coupons |
| `CODE_HASH_SECRET` | — | HMAC pepper for the lookup hash |
| `CODE_CHECKSUM_SECRET` | — | HMAC secret for the checksum character |
| `JWT_SECRET` | — | Admin token signing key |
| `JWT_EXPIRES_IN` | `8h` | Admin session lifetime |
| `REDEEM_SESSION_TTL_MINUTES` | `30` | How long a started survey stays open |
| `COUPON_RESERVATION_SECONDS` | `60` | How long a coupon is held for a code |
| `RATE_LIMIT_TTL_SECONDS` / `RATE_LIMIT_MAX` | `60` / `60` | Global throttle |
| `REDEEM_RATE_LIMIT_TTL_SECONDS` / `REDEEM_RATE_LIMIT_MAX` | `60` / `10` | Public redeem throttle |
| `CONTENTFUL_SPACE_ID` / `_ENVIRONMENT` / `_ACCESS_TOKEN` | — | Contentful Delivery API (read-only token) |
| `SMTP_HOST` / `_PORT` / `_SECURE` / `_USER` / `_PASSWORD` / `MAIL_FROM` | — | Mail. Empty `SMTP_HOST` logs e-mails to the console |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | `admin@example.com` / `Admin@12345` | Seeded admin. The password is **required** when seeding with `NODE_ENV=production` |

The four secrets fail fast in production. Generate each with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Changing `CODE_ENCRYPTION_KEY`, `CODE_HASH_SECRET` or `CODE_CHECKSUM_SECRET` invalidates
> every code and coupon already in the database. Treat them as permanent per environment.

---

## 19. API reference

All routes are prefixed with `/api`. Admin routes need `Authorization: Bearer <token>`.

### Public

| Method | Path | Throttle | Purpose |
| ------ | ---- | -------- | ------- |
| `POST` | `/public/redeem/verify` | 10/60 s + 3/5 s | Validate a code, reserve a coupon, return the survey |
| `GET` | `/public/redeem/session/:token` | 30/60 s | Rehydrate a session or return the issued coupon |
| `POST` | `/public/redeem/complete` | 10/60 s + 3/5 s | Store answers, issue + e-mail the coupon |
| `GET` | `/health` | — | Liveness |

### Admin

| Method | Path | Permission |
| ------ | ---- | ---------- |
| `POST` | `/admin/auth/login` | — (8/60 s) |
| `GET` | `/admin/auth/me` | authenticated |
| `GET` | `/admin/stats` | `dashboard:view` |
| `GET` | `/admin/responses` | `responses:view` |
| `GET` | `/admin/responses/export.csv` | `responses:export` |
| `POST` | `/admin/batches/preview` | `batches:manage` |
| `POST` | `/admin/batches` | `batches:manage` |
| `GET` | `/admin/batches` · `/admin/batches/:id` · `/admin/batches/:id/codes` | `batches:view` |
| `PATCH` | `/admin/batches/:id/status` | `batches:manage` |
| `GET` | `/admin/batches/codes/:codeId/reveal` · `/qr` · `/qr.png` | `codes:reveal` |
| `GET` | `/admin/batches/:id/export.csv` | `codes:export` |
| `GET` | `/admin/coupons/types` · `/admin/coupons` | `coupons:view` |
| `POST`/`PATCH` | `/admin/coupons/types` · `/types/:code` | `coupons:manage` |
| `POST` | `/admin/coupons/import` | `coupons:import` |
| `GET` | `/admin/coupons/:id/reveal` | `coupons:reveal` |
| `GET` | `/admin/surveys` · `/admin/surveys/:id` | `surveys:view` |
| `POST`/`PATCH`/`DELETE` | `/admin/surveys` · `/:id` | `surveys:manage` |
| `POST` | `/admin/surveys/:id/forwarding/test` | `surveys:manage` |
| `GET` | `/admin/events` · `/admin/events/:id` | `events:view` |
| `POST` | `/admin/events/:id/retry` | `events:manage` |
| `GET` | `/admin/roles` · `/admin/roles/permissions` | `roles:view` |
| `POST`/`PATCH`/`DELETE` | `/admin/roles` · `/:name` | `roles:manage` |
| `GET` | `/admin/users` | `users:view` |
| `POST`/`PATCH` | `/admin/users` · `/:id` | `users:manage` |

### Error shape

```json
{
  "statusCode": 409,
  "code": "CODE_ALREADY_USED",
  "message": "This code has already been used.",
  "details": { "usedAt": "2026-09-16T16:01:43.884Z" },
  "path": "/api/public/redeem/verify",
  "timestamp": "2026-09-16T16:02:11.001Z"
}
```

Always branch on `code`, never on `message` — messages are consumer-facing copy and will
change.

---

## 20. Operations runbook

### Launching a campaign

1. Create the coupon type and **import stock first** — an empty pool blocks every scan.
2. Build or configure the survey; use **Send test event** if forwarding is on.
3. Create the batch with the SKU, prefix, length and quantity. Check the **preview**
   rating is at least `strong`.
4. Wait for generation to reach `COMPLETE` (watch the progress bar).
5. Export the CSV and hand the `url` column to the artwork tool.
6. Confirm `PUBLIC_APP_URL` matches the origin in the exported URLs **before** printing.

### Daily checks

| Signal | Where | Action |
| ------ | ----- | ------ |
| Coupon alerts with `EMPTY` | Dashboard | Import stock immediately — redemptions are failing now |
| Coupon alerts with `LOW` and high `activeBatches` | Dashboard | Import before it empties |
| Rising event `pending` | Admin → Events | Destination slow or down; backoff is working |
| Any event `failed` | Admin → Events | Fix credential/endpoint, then **Retry** |
| Bursts of `REDEEM_INVALID_CHECKSUM` | Dashboard activity | Probable enumeration attempt; consider tightening the redeem limit |
| A batch stuck in `FAILED` | Admin → Batches | Read `generation.error` — usually an exhausted code space |

### Incidents

**"Consumers see *unable to cater to this request*"** — the coupon pool for that batch's
type is empty. No codes were burnt; import stock and they can rescan.

**"A batch is stuck at `PENDING` and not moving"** — the API process that runs the cron is
down. Any instance will pick it up within 10 seconds of starting; a stale `RUNNING` claim
clears itself after 5 minutes.

**"We need to stop a campaign right now"** — set the batch to `PAUSED`. Every scan gets
`BATCH_INACTIVE` immediately; nothing is destroyed.

**"A code list leaked"** — disable the affected codes, or archive the batch and reprint.
Rotating `CODE_HASH_SECRET` would invalidate *every* code in the environment, not just the
leaked ones.

**"An admin account is compromised"** — set `isActive: false` (locks out on the next
request) or change the password, which invalidates every existing token via
`passwordChangedAt`.

### Smoke test

With the API running:

```bash
npm run test:smoke --workspace @app/api
```

Covers admin auth, the redeem happy path, duplicate scans, already-used codes, coupon
exhaustion and rate limiting. It deliberately sleeps between public calls to stay inside
the throttle, and includes a rate-limit recovery wait, so it takes a few minutes.

---

## 21. Known limits and what to do next

Honest list of what is *not* yet done, in the order worth doing.

| Gap | Impact | Fix |
| --- | ------ | --- |
| **Throttler storage is in-memory** | Rate limits are per-instance: N instances means N× the intended limit. This is the one gap with a direct security consequence. | `@nest-lab/throttler-storage-redis` |
| **Dashboard aggregates are live `groupBy`** | Fine to tens of millions of rows; a full `Code` scan at a billion. | Counter tables maintained by trigger or on write |
| **No completion proof for third-party surveys** | Anyone holding a session token can claim the coupon without finishing the external survey. | A signed callback from the survey tool before `complete` is accepted |
| **`exportResponsesCsv` loads all rows** | Memory spike on a very large response export. The *code* export is already streamed. | Apply the same cursor-streaming pattern |
| **Crons run on every instance** | Harmless — `SKIP LOCKED` prevents duplicate work — but N× the idle polling. | `pg_advisory_lock` leader election |
| **No account lockout or MFA** | Only the 8/min IP throttle stands between an attacker and password guessing. | Per-account lockout + TOTP |
| **No CSP on the web bundle** | Helmet protects the API responses, not the static front end. | Add a CSP header at the static host |
| **`db push`, not migrations** | Index creation locks the table. | `prisma migrate` with `CREATE INDEX CONCURRENTLY` |
| **Generation duty cycle is ~50 %** | ~20 minutes per million codes. | Shorter interval, larger tick budget, or `COPY` instead of `createMany` |
