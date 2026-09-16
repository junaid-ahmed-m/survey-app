# Scan &amp; Reward — QR → Survey → Coupon

A monorepo containing one React front end (public scan app **and** admin portal) and one NestJS back end.

A consumer scans a QR code on a pack with the native camera. The QR points to
`https://<host>/read/:code`. The app verifies the code, **reserves a coupon first**,
shows a survey (built-in, Contentful, or a third-party URL), and on completion returns
the coupon on screen and by e-mail.

**Full documentation**

| Document | Covers |
| -------- | ------ |
| [docs/platform-guide.md](docs/platform-guide.md) | Every feature in detail, plus how code uniqueness, anti-guessing, race conditions, no-data-loss, security and performance are engineered |
| [docs/survey-setup.md](docs/survey-setup.md) | Contentful content model and third-party survey integration |

---

## 1. Requirements

| Tool | Version |
| ---- | ------- |
| Node.js | 20 or newer (tested on 24) |
| npm | 10 or newer |
| PostgreSQL | 14 or newer |

Create an empty database once (any name, the default used below is `qr_rewards`):

```sql
CREATE DATABASE qr_rewards;
```

---

## 2. Run the project

```bash
# from the repository root
cp apps/api/.env.example apps/api/.env   # then set DATABASE_URL + the secrets
npm run setup     # installs all workspaces, creates the DB schema and seeds demo data
npm run dev       # starts the API and the web app together
```

| App | URL |
| --- | --- |
| Public scan app | http://localhost:5173 |
| Admin portal | http://localhost:5173/admin/login |
| API | http://localhost:3000/api |
| Health check | http://localhost:3000/api/health |

**Seeded admin login:** `admin@example.com` / `Admin@12345` (defined in `apps/api/.env`, change it before any real deployment).

The seed also creates a *Demo Launch Batch* with 20 codes. Open the batch in
**Admin → Batches & QR** to see the QR codes, or copy any code URL from the code table
and open it directly (e.g. `http://localhost:5173/read/DEMO…`).

### Windows / PowerShell note

If PowerShell refuses to run `npm.ps1` (execution-policy error), run the commands through cmd:

```powershell
cmd /c "npm run setup"
cmd /c "npm run dev"
```

### Run the apps separately

```bash
npm run dev:api    # NestJS on :3000 (watch mode)
npm run dev:web    # Vite on :5173 (proxies /api to :3000)
```

### Production build

```bash
npm run build                                  # builds both workspaces
npm run start:prod --workspace @app/api        # serves the API from apps/api/dist
npm run preview   --workspace @app/web         # serves the built front end
```

---

## 3. Where is the database?

The project runs on **PostgreSQL**. There is no database file in the repository — the data
lives in your Postgres server, in the database named by `DATABASE_URL`.

* Connection string: `DATABASE_URL` in [apps/api/.env](apps/api/.env), for example
  `postgresql://USER:PASSWORD@localhost:5432/qr_rewards?schema=public`
* Schema: [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma)
* Seed data: [apps/api/prisma/seed.ts](apps/api/prisma/seed.ts)

The tables (`AdminUser`, `Role`, `Survey`, `Batch`, `Code`, `CouponType`, `Coupon`,
`SurveyResponse`, `EventDelivery`, `AuditLog`) are created in the schema given by the
`?schema=` parameter, which defaults to `public`.

### Database commands (run inside `apps/api`)

| Command | What it does |
| ------- | ------------ |
| `npm run db:push` | Applies `schema.prisma` to the database |
| `npm run db:seed` | Inserts/refreshes the demo data (idempotent) |
| `npm run db:studio` | Opens Prisma Studio, a browser UI for the data |
| `npm run db:generate` | Regenerates the Prisma client |

To start from scratch, drop and recreate the database (or run
`npx prisma migrate reset`) and then run `npm run db:push && npm run db:seed`.

### Migrations

`db:push` is fine while iterating. For anything deployed, switch to versioned migrations:

```bash
cd apps/api
npx prisma migrate dev --name init      # creates prisma/migrations and applies it
npx prisma migrate deploy               # on the server
```

### Hosted Postgres (Supabase, Neon, RDS…)

Just point `DATABASE_URL` at the hosted instance. Managed providers usually need
`?sslmode=require`, and pooled connections (PgBouncer) additionally need
`?pgbouncer=true&connection_limit=1` plus a `DIRECT_URL` for migrations.

---

## 4. Configuration

All back-end settings live in `apps/api/.env` (template: `apps/api/.env.example`).

| Variable | Purpose |
| -------- | ------- |
| `NODE_ENV` | `production` makes the secrets below mandatory and blocks internal forwarding URLs |
| `PORT`, `PUBLIC_APP_URL`, `CORS_ORIGINS` | Hosting/URL settings; `PUBLIC_APP_URL` is what QR codes point to |
| `TRUST_PROXY_HOPS` | Number of reverse proxies in front of the API. Must match the deployment — see below |
| `MAX_BODY_SIZE` | Request body ceiling (default `64kb`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `CODE_ENCRYPTION_KEY` | 32-byte hex key — AES-256-GCM encryption of codes and coupons |
| `CODE_HASH_SECRET` | HMAC pepper used for the unique code lookup hash |
| `CODE_CHECKSUM_SECRET` | HMAC secret for the code checksum character |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Admin session tokens |
| `REDEEM_SESSION_TTL_MINUTES` | How long a started survey (and its coupon reservation) is held |
| `COUPON_RESERVATION_SECONDS` | How long a single coupon is held for a code before returning to the pool |
| `RATE_LIMIT_*` | Throttling of the open `/api/public/redeem/*` endpoints |
| `CONTENTFUL_*` | Space/token used by the Contentful survey provider |
| `SMTP_*` | Mail delivery; when empty, reward e-mails are printed to the log |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Credentials created by the seed |

> **Production.** `CODE_ENCRYPTION_KEY`, `CODE_HASH_SECRET`, `CODE_CHECKSUM_SECRET` and
> `JWT_SECRET` must be set to strong, unique values — with `NODE_ENV=production` the API
> refuses to start otherwise. Generate each with
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

> **`TRUST_PROXY_HOPS`** defaults to `0` (no proxy). Rate limiting keys on the client IP,
> so trusting a hop that does not exist lets any client forge `X-Forwarded-For` and get a
> fresh rate-limit bucket on every request. Set it to the real number of proxies, no more.

> Changing `CODE_ENCRYPTION_KEY`, `CODE_HASH_SECRET` or `CODE_CHECKSUM_SECRET` invalidates
> every code and coupon already stored in the database.

---

## 5. Project layout

```
apps/
  api/                     NestJS back end
    prisma/                schema.prisma, seed.ts
    src/
      auth/                admin login (JWT + bcrypt)
      batches/             batch + code/QR generation, background worker, CSV streaming
      coupons/             coupon types, inventory import, reservation & issuing
      redeem/              public verify → survey → complete flow, session cleanup cron
      surveys/             native surveys + Contentful provider + forwarding config
      events/              transactional outbox: webhook / RudderStack dispatcher
      dashboard/           admin statistics, low-stock alerts, responses
      roles/ users/        permission bundles and admin accounts
      common/crypto/       encryption, HMAC hashing, code generator
    test/smoke.e2e.mjs     end-to-end smoke suite
  web/                     React + Vite + Tailwind front end
    src/pages/public/      scan app (home, /read/:code, third-party return)
    src/pages/admin/       dashboard, batches, coupons, surveys, responses, events, access
    src/components/        survey runner, reward card, shared UI
docs/                      platform guide + survey provider setup
```

---

## 6. How the flow works

1. **Scan** — the camera opens `/read/:code`.
2. **Verify** — `POST /api/public/redeem/verify` normalises the code, checks the HMAC
   checksum (invalid codes are rejected without a database hit), looks it up by hash and
   rejects used/disabled codes and inactive batches.
3. **Reserve first** — a coupon is reserved *before* the survey is rendered. If the
   inventory is empty the API answers `503 COUPONS_EXHAUSTED`
   ("We are unable to cater to this request right now. Please try again later.")
   and the code stays `UNUSED` so it can be scanned again later.
4. **Claim** — the code flips to `USED` the moment the survey is handed out, with a
   conditional update. One QR therefore opens exactly one survey; a parallel scan resumes
   the same session instead of starting a second one.
5. **Survey** — served from the built-in engine, fetched from Contentful, or opened as a
   configured third-party URL (with a `return_url` back to the app).
6. **Complete** — `POST /api/public/redeem/complete` stores the answers, issues the
   reserved coupon and queues any outbound analytics event **in one transaction**, then
   e-mails the coupon.
7. **Cleanup** — a cron job releases reservations from abandoned sessions every minute.

### Other moving parts

* **Background code generation** — batches over 10 000 codes are queued and filled by a
  cron in 2 000-code slices, with live progress in the admin UI. The create request
  returns in milliseconds.
* **Response forwarding** — a survey can push a PII-free `Survey Completed` event to a
  webhook or RudderStack through a transactional outbox with retries, and can opt out of
  storing consumer data here at all.

Security highlights: codes and coupon codes are stored AES-256-GCM encrypted (only
decrypted for verification/issuing), lookups use a peppered HMAC hash with a unique index,
an HMAC checksum character rejects ~96.9% of guesses before any database work, the public
endpoints are IP rate limited (10/min plus a 3-per-5s burst cap), secrets fail fast in
production, and Helmet, strict validation and a permission-guarded admin API are enabled
by default. The full reasoning is in [docs/platform-guide.md](docs/platform-guide.md).

---

## 7. Tests

With the API running:

```bash
npm run test:smoke --workspace @app/api
```

Covers admin authentication, the redeem happy path, duplicate scans, already-used codes,
coupon exhaustion and rate limiting.
