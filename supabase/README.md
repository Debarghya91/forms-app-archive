# Supabase setup for NoticeMitra 2.0

A NEW Supabase project. Nothing here touches any other project.

## Apply order

Run the migration files in numeric order in the Supabase dashboard
SQL editor (or with the Supabase CLI). Each file is idempotent, so
re-running is safe.

1. `0001_core_tables.sql`: profiles, businesses, cases, documents,
   conversations, messages, plus the `set_updated_at` trigger function.
2. `0002_business_tables.sql`: invoices, registers, expenses,
   transactions, reconciliations, compliance tasks.
3. `0003_revenue_tables.sql`: plans, subscriptions, entitlements,
   credit ledger, payments, referrals, analytics, audit log, tax rule
   packs, RAG sources, CA tables.
4. `0004_rls_policies.sql`: row level security, owner-only policies on
   every user table; read-only policies on plans, tax packs, and RAG
   sources.
5. `0005_storage_buckets.sql`: private `documents` and `notices`
   buckets with owner-only object policies.
6. `0006_seed.sql`: plan rows (free, personal_plus, business_pro,
   ca_professional) and tax_rule_packs rows whose payloads match
   `shared/tax-rules/*.json` exactly.

## Manual dashboard steps

1. Create a new project in the Supabase dashboard. Note the project
   URL, the anon (public) key, and the service role (secret) key.
   The service role key goes ONLY in the server env vars, never in
   the client and never in git.
2. Run the six migrations above, in order, in the SQL editor.
3. Storage: if migration 0005 could not write to `storage.buckets`,
   create the buckets by hand: Storage, New bucket, name `documents`,
   private (public off). Repeat for `notices`. Then re-run only the
   policy statements in 0005.
4. Auth, email: Authentication, Providers, Email: enable Email, and
   enable "Confirm email" if email confirmation is wanted. The client
   uses GoTrue REST directly (signup, OTP, verify), no SDK.
5. Auth, phone: Authentication, Providers, Phone: enable Phone and
   configure an SMS provider before phone OTP can work. Phone sign-in
   stays unavailable until this step is done; email sign-in works
   without it.
6. Auth, URL configuration: set the Site URL to the deployed app URL
   and add the app URL to Redirect URLs if email links are used.
7. Copy the keys into env vars:
   - Server (Render): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`. See `server/.env.example`.
   - Client: `window.SUPABASE_URL` and `window.SUPABASE_ANON_KEY` in
     `web/config.js`. The client never gets the service role key.

## Notes

- RLS is enabled on every table. The service role key bypasses RLS,
  so the server also filters every query by user id; direct client
  access through the anon key is owner-only by policy.
- `tax_rule_packs.ay` holds the pack id: `2026-27`, `gst`, or
  `due-dates`. The JSON files in `shared/tax-rules/` are the source
  of truth; regenerate `0006_seed.sql` from them if a pack changes.
- `rag_sources` is created empty. RAG retrieval in this version reads
  the JSON files in `server/rag/sources/`; the table exists for a
  future database-backed RAG store.
- SQL validation: no local Postgres was available when these files
  were written. They were validated structurally (balanced
  parentheses and quotes outside strings, all 30 tables created,
  every table covered by RLS statements, seed payloads byte-matched
  to the JSON files). Run them once in the dashboard SQL editor and
  confirm zero errors before calling the schema live.
