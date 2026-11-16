# NoticeMitra server 2.0

Node/Express server: Supabase JWT verification, AI orchestration
(Groq text + Gemini vision, the only provider pair), tax packs,
Razorpay revenue, and Supabase REST data access. No new dependencies:
express, cors, express-rate-limit only.

## Architecture

```
index.js            routes, auth middleware mounting, error handling
lib/config.js       env vars, packs, plans, profile types
lib/auth.js         GoTrue JWT verification (60s cache), pilot fallback
lib/db.js           Supabase REST client, owner-scoped queries
lib/pilotStore.js   db.json pilot store (pilot mode only)
lib/providers.js    Groq + Gemini chain with cross-provider fallback
lib/entitlements.js plan caps, daily counters, credit ledger
lib/orchestrator.js keyword routing, single-call orchestration
lib/notice.js       notice analysis prompt + response normalizer
lib/rag.js          keyword retrieval over server/rag/sources/*.json
lib/tax.js          pack loader + regime, GST, ITR-form calculators
lib/compliance.js   due-date calendar from the due-dates pack
lib/reconcile.js    2B-style comparison (user-entered figures only)
lib/expensesImport.js rule-based categorisation + duplicate flagging
lib/analytics.js    PII guard for analytics events
lib/payments.js     Razorpay order/verify/webhook + activation
rag/sources/*.json  verified RAG sources with citations
../shared/tax-rules/*.json  versioned tax packs (source of truth)
```

## Modes

Configured mode: `SUPABASE_URL` is set. Every `/api/*` route except
`/api/pay/webhook` requires a valid Supabase JWT (verified against
`{SUPABASE_URL}/auth/v1/user`, 60s in-memory cache). Invalid, expired,
or missing tokens get 401. Data lives in Supabase Postgres via REST
with the service role key, and every query is filtered by the
authenticated user id. RLS owner-only policies are the second layer.

Pilot mode: `SUPABASE_URL` is unset. Identity is the bearer token or
the request IP, balances live in `db.json`, and the AI, tax, RAG,
orchestrator, notice, and pay order/verify endpoints keep working
exactly as before. DB-backed endpoints (cases, documents, compliance,
profile, invoices, registers, expenses, notes, reconcile, expenses
import, subscription, referral, analytics) return
503 `{error:"backend_not_configured"}`.

`REQUIRE_AUTH=1` forces 401 without a verified JWT even in pilot mode
(where verification is impossible without `SUPABASE_URL`, so every
protected endpoint returns 401).

## Environment variables

See `.env.example` for the full list. Required for live AI:
`GROQ_API_KEY`, `GEMINI_API_KEY`. Required for configured mode:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (REST),
`SUPABASE_ANON_KEY` (GoTrue apikey header; the service key is used as
a fallback). Required for payments: `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Optional:
`FREE_CALLS_PER_DAY` (20), `PORT` (8080), `AI_TIMEOUT_MS` (60000),
`RATE_LIMIT_MAX` (60/min/IP), model and base-URL overrides,
`REQUIRE_AUTH`, `DB_PATH` (tests only).

## Endpoints

Public: `GET /health` returns `ok`. `POST /api/pay/webhook` is public
but HMAC-protected (see below).

Always available (auth required when configured, pilot identity
otherwise): `GET /api/credits`, `POST /api/ai`, `POST /api/orchestrate`,
`POST /api/notice/analyze`, `GET /api/tax/rules/:ay`,
`POST /api/tax/regime`, `POST /api/tax/itr-form`, `POST /api/tax/gst`,
`GET /api/rag/search`, `POST /api/pay/order`, `POST /api/pay/verify`.

DB-backed (503 in pilot mode): cases CRUD + `POST /api/cases/migrate`,
documents, `GET /api/compliance?profile=<type>` plus
`PATCH /api/compliance/tasks/:id` (task key, `{done, note?}`),
profile GET/PUT,
invoices (+ items), registers, expenses (+ import), notes,
`POST /api/reconcile`, subscription GET/cancel, referral GET/redeem,
`POST /api/analytics/events`.

Response shapes follow CONTRACTS-2.0.md section 3. Where the contract
does not pin a shape, this server uses: single GETs return the row
object (invoices include an `items` array); list GETs return
`{cases|documents|invoices|sales|purchases|expenses|notes: [...]}`;
DELETEs return `{ok:true}`; `PUT /api/profile` returns
`{profile, businesses}`; `POST /api/subscription/cancel` returns
`{status}` where status is `cancelled` or `none` when there was no
active subscription.

## AI and entitlements

`/api/ai` keeps its pilot shape `{text}` and charge-on-success rule.
`/api/orchestrate` routes by keyword (no routing AI call) and makes
exactly one provider call; the route is one of direct, gst,
income_tax, tds, accounting, compliance, payroll, notice, insights.
`/api/notice/analyze` returns extracted facts labeled with source and
confidence, plus interpretation, needs_verification, draft_reply,
checklist, risks, and ca_brief. Prompts forbid inventing sections,
deadlines, penalties, rates, or amounts.

Entitlements are enforced server-side on all three AI endpoints. Plan
daily caps come from the plans table (free 20/day, personal_plus 100,
business_pro 300, ca_professional 1000); the free allowance is used
first, then paid credits. An expired subscription falls back to free.
A cancelled subscription keeps its plan until expiry. Charges write
to the `entitlements` row and, best effort, to `credit_ledger`.

## Tax packs and GST rates

Calculators read `../shared/tax-rules/*.json`. `GET /api/tax/rules/:ay`
accepts `2026-27`, `gst`, and `due-dates`. All packs carry
`verified: false` until checked against primary official sources;
every UI using them must show a verify note.

GST rates follow the 56th GST Council decisions, Notification
9/2025-Central Tax (Rate), w.e.f. 22 September 2025: current rates
are 0, 5, 18, and 40 percent, plus a special 3% rate for gold and
silver. The 12% and 28% rates are legacy: `/api/tax/gst` rejects them
with 400 `legacy_rate_requires_confirmation` unless the request sets
`allow_legacy: true` (for invoices dated before 22 September 2025).
Unknown rates get 400 `unknown_rate`. GST interest is estimated at
18% per annum simple, days/365, on the net cash tax; the 24% rate
applies only when the notice states section 50(3).

## Revenue: Razorpay

Buy flows call `/api/pay/order` + Razorpay checkout +
`/api/pay/verify`. Nothing is activated on client success alone:
verify checks the HMAC signature and the stored order, and credits
are added idempotently (a repeated verify with the same payment id
returns the current balance without double-crediting).

The webhook `POST /api/pay/webhook` validates the
`X-Razorpay-Signature` HMAC over the raw body using
`RAZORPAY_WEBHOOK_SECRET` (invalid signature: 400; secret unset:
503). Only `payment.captured` events activate anything; other events
are acknowledged without action. Activation is idempotent on the
payment id via the `payments` table (configured mode) or the pilot
store (pilot mode, credit packs only). Credit packs add calls;
`notes.plan` activates or extends a subscription by
`notes.period_months` (default 1, capped at 12). A failed payment
never reaches this path: Razorpay only sends `payment.captured` for
captured payments, and failed payments send `payment.failed`, which
is acknowledged and ignored. Cancellation via
`POST /api/subscription/cancel` marks the subscription cancelled and
access runs to the end of the paid period; no Razorpay subscription
API is used in this version (one-time plan purchases only).

Referral rewards are NOT configured: `POST /api/referral/redeem`
records the use and credits 0 until the owner sets the amounts.

## Webhook setup (Razorpay dashboard)

1. Settings, Webhooks, Add New Webhook: URL
   `https://<render-service>/api/pay/webhook`.
2. Subscribe to the `payment.captured` event (and `payment.failed`
   if failure visibility is wanted; the server ignores it).
3. Copy the webhook secret into the Render env var
   `RAZORPAY_WEBHOOK_SECRET`. Never commit it.
4. Send a test event from the dashboard and confirm a 200 response.

## Deploy steps (Render)

1. Create a Web Service from the repo, root directory
   `noticemitra/server` (or the directory containing `index.js` and
   `package.json`), build command `npm install`, start command
   `node index.js`. Node 18 or newer.
2. Set env vars from `.env.example` (see above). Keep
   `SUPABASE_SERVICE_ROLE_KEY` and `RAZORPAY_WEBHOOK_SECRET` out of
   the client and out of git.
3. Deploy, then check `GET /health` returns `ok` and
   `GET /api/tax/rules/2026-27` returns the pack.
4. Configure the Razorpay webhook (above) and the Supabase project
   (see `../supabase/README.md`).
5. Pilot mode deploys (no `SUPABASE_URL`) serve AI, tax, and RAG
   only; DB-backed endpoints return 503 until Supabase is configured.

## Analytics privacy

`POST /api/analytics/events` drops any event containing an email
address, a phone number, or a GSTIN, and any event with a sensitive
prop key (email, phone, mobile, gstin). Dropped events are never
stored. The endpoint still returns `{ok:true}`.

## Tests

`npm test` runs the node:test suites in `test/` plus the extended
provider suite (`provider-swap.test.mjs`, 33 checks). All suites use
stubbed fetch targets (providers, GoTrue, Supabase REST, Razorpay);
no live keys are needed. See `test/tax.test.mjs` for the hand-verified
tax cases with expected values and workings.
