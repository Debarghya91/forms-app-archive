Paste this into any AI app builder, or hand it to a developer.

Build and ship the NoticeMitra 2.0 mobile app from this repository.
- web/ is the app UI: index.html + styles.css + js/ modules + rules/
  (versioned tax packs). Five destinations: Home, Meera AI, Business,
  Compliance, Profile. Sign-in is the mandatory first step (Supabase Auth
  via GoTrue REST in js/auth.js). Do not rewrite it without reason; extend
  it through the existing modules.
- server/ is the Node 18+ backend: Groq + Gemini AI router and orchestrator,
  RAG, tax endpoints, Supabase JWT verification, Razorpay orders/verify/
  webhook, entitlements. Env vars are documented in server/.env.example.
  Providers stay Groq + Gemini ONLY. Never add another provider.
- supabase/ holds the Postgres migrations (run in order), RLS policies,
  storage buckets, and plan seeds. shared/tax-rules/ holds the versioned
  packs the server and the app both read; keep web/rules/ identical.
- Tasks remaining: (1) Provision a NEW Supabase project, run the migrations,
  create the private buckets, enable email + phone auth. (2) Deploy server/
  to Render with all env vars; set web/config.js API_BASE, SUPABASE_URL and
  SUPABASE_ANON_KEY; run npx cap copy ios. (3) Create the Groq API key and
  verify both providers with live calls. (4) Add the native Razorpay
  checkout integration (no checkout object is bundled; the web UI reports
  created orders honestly and takes no payment without one). (5) Produce an
  Xcode archive for the App Store (ios platform present) and add the Android
  platform (npx cap add android) for a signed AAB. (6) Host legal/ as web
  pages and link them in both stores; get a lawyer review first.
- Never collect portal passwords or OTPs. Never scrape government portals.
  Keep the disclaimer text. Never present Meera as a licensed CA. Never
  claim a return was filed unless an authorised filing integration confirms
  it. Tax packs stay versioned JSON; never hardcode a slab, rate, or due
  date as permanent.
