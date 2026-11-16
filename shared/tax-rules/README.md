# Tax rule packs (shared)

Plain JSON, no Node-only features. The server reads these files and the
client may load the same files. Nothing hardcodes a slab, rate, or due
date as permanent: calculators read the packs.

Files:

- `ay-2026-27.json`: income tax slabs and rebate rules for assessment
  year 2026-27 (financial year 2025-26), new and old regimes.
- `gst.json`: GST rates in force from 22 September 2025, legacy rates,
  and the interest estimator input.
- `due-dates.json`: standard due-date rules with computable schedules.

The contract example in CONTRACTS-2.0.md section 5 shows gst and
due_dates nested inside the assessment-year pack. This tree keeps them
as separate files, as section 1 requires (one file per assessment year
plus `gst.json` and `due-dates.json`), so a GST change does not force a
new income-tax pack version. The server serves all three through
GET /api/tax/rules/:ay (`:ay` accepts `2026-27`, `gst`, `due-dates`).

Every pack carries `sources` and a `verified` flag. `verified` is false
unless the pack was checked against a primary official source (CBDT tax
reference tables, CBIC notifications, the GST portal). Secondary-source
checks are recorded in `sources` with an `accessed` date, but they do
not flip the flag. Every UI using a pack must show a "verify on the
official portal" note while `verified` is false.

To add a new assessment year: copy `ay-2026-27.json`, change `id`,
`assessment_year`, `financial_year`, `effective_from`, and `version`,
update the figures and sources, and add a matching seed row in
`supabase/migrations/0006_seed.sql`. Bump `version` on any change to an
existing pack and keep the old version in git history, not in a
second file.
