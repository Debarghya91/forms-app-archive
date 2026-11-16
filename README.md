# NoticeMitra 2.0: Virtual CA app (iOS build; Android platform not added yet)

Contents: `web/` app UI (5 destinations: Home, Meera AI, Business, Compliance,
Profile) · `server/` Node backend (AI orchestration, tax packs, Razorpay,
entitlements) · `supabase/` migrations + RLS + storage · `shared/tax-rules/`
versioned tax packs · `seo-site/` static SEO site + tools · Capacitor config ·
`legal/` draft policies · `BUILD_PROMPT.md`.

AI providers: Groq (text) + Gemini (vision) ONLY, with cross-fallback and
charge-on-success. No other provider is called anywhere.

## Run locally

Server: `cd server && npm install`, copy `.env.example` to `.env` and fill
`GROQ_API_KEY`, `GEMINI_API_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
Without `SUPABASE_URL` the server runs in pilot mode (IP identity, db.json,
DB-backed endpoints return 503). With `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` it verifies Supabase JWTs and uses Postgres.
Then `npm start` and open http://localhost:8080 (the server also serves
`web/`). Run the tests with `npm test`.

Web app alone: serve `web/` over any static server. With no Supabase config
in `web/config.js`, the app opens on an honest setup screen with a clearly
labeled on-this-device-only mode. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`
and `API_BASE` in `web/config.js` once the backend is live.

## Deploy

1. Provision a NEW Supabase project (separate from any other project).
   Run the migrations in `supabase/migrations/` in order in the SQL editor,
   create the private `documents` and `notices` buckets, enable email + phone
   auth. See `supabase/README.md`.
2. Deploy `server/` to Render (root dir `server`, start `npm start`) with all
   env vars from `server/.env.example`, including the Razorpay webhook secret.
   See `server/README-2.0.md`.
3. Set `web/config.js` (`API_BASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`),
   then `npx cap copy ios` and rebuild the app.

## Build apps

iOS platform is present: `npm install`, `npx cap sync ios` (runs the copy;
pod install runs on the Mac), open `ios/App/App.xcworkspace` in Xcode,
select a signing team, Run/Archive. Or use a cloud builder such as Codemagic.
Android: `npx cap add android` first; no Android build has been produced yet.

## Done in 2.0 (tested as documented in the delivery note)

Mandatory sign-in gate (Supabase Auth, email + phone OTP + password), first
sign-in migration of local cases, 5-destination UI, Meera orchestrator with
RAG citations, notice analysis with labeled facts, case management, document
vault, personalised compliance calendar with completion tracking, invoice
maker, registers, ITC + GSTR-2B reconciliation, expenses + bank-statement
CSV import, tax calculators from versioned packs, plans + credit packs +
Razorpay webhook + entitlements (server-side), referrals, multi-business,
SEO site with 13 working tool pages.

## Not done yet (be honest with users and testers)

- Supabase project not provisioned; migrations never run against a live
  database; phone/SMS provider not set up.
- Groq API key not created (owner step, own browser). Gemini key exists.
  Model IDs unverified against live calls.
- Server not deployed; Razorpay live keys not connected; no native
  Razorpay checkout object is bundled (web checkout integration pending).
- Tax packs carry verified:false; values were checked against secondary
  summaries, not line by line against official notification text. Surcharge
  is excluded from all calculators with a stated assumption.
- iOS build never compiled here (no Xcode); nothing device-tested.
- Excel and PDF import not built (CSV only). Push/email/WhatsApp
  notifications not built. CA client dashboard UI not built (schema only).
  No App Store / Play listings yet. Analytics events endpoint exists;
  client-side event emission is not wired.
- Review legal/ with a lawyer. Check current Play/Apple policies for
  finance and AI apps. Never collect portal passwords or OTPs.

## Costs (approx, original estimates, unverified)

Play Rs 2,100 once · Apple Rs 8,300/yr · hosting Rs 1,000-3,000/mo ·
AI about Rs 3-15 per notice · Razorpay about 2% + GST ·
legal review Rs 1,000-6,000.

## Store listing (draft)

Title: NoticeMitra: GST and ITR helper · Short: Understand GST notices, plan
replies, compare tax regimes. · Disclosure: AI tool, not a CA; you file on
the official portal.
