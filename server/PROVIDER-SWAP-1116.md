# Provider swap: Anthropic replaced by Groq + Gemini (16 Nov 2026)

The server no longer calls Anthropic. Text calls go to Groq, image
calls go to Gemini, each with a cross-provider fallback. Credit is
charged only after a successful provider response.

## Routing table

| Call type | Primary | Then | Cross-provider fallback |
|---|---|---|---|
| Text, default tier | Groq `openai/gpt-oss-120b` | Groq `openai/gpt-oss-20b` | Gemini `gemini-3.8-flash`, then `gemini-3.5-flash-lite` |
| Text, `quick` tier | Groq `openai/gpt-oss-20b` | Groq `openai/gpt-oss-120b` | Gemini `gemini-3.5-flash-lite`, then `gemini-3.8-flash` |
| Image, default tier | Gemini `gemini-3.8-flash` | Gemini `gemini-3.5-flash-lite` | Groq `qwen/qwen3.8-27b` |
| Image, `quick` tier | Gemini `gemini-3.5-flash-lite` | Gemini `gemini-3.8-flash` | Groq `qwen/qwen3.8-27b` |

A call counts as an image call when it carries at least one image
(notice photo decode, ITR photo extraction). Everything else is a
text call (the 6 specialists, Ask CA chat, regime compare, filing
sheet, calendar text). Any attempt that errors, returns a non-2xx
status, times out, or returns empty text moves to the next attempt.
When every attempt fails, the server returns a clean 502 with no
quota charged.

## Environment variables

Required for live calls (env vars only, never hardcoded, never logged):

- `GROQ_API_KEY`: Groq API key, free tier, no card needed.
- `GEMINI_API_KEY`: Google AI Studio API key, free tier, no card needed.

Optional, with defaults shown:

- `GROQ_MODEL_TEXT` (default `openai/gpt-oss-120b`)
- `GROQ_MODEL_TEXT_FALLBACK` (default `openai/gpt-oss-20b`)
- `GROQ_MODEL_VISION` (default `qwen/qwen3.8-27b`)
- `GEMINI_MODEL` (default `gemini-3.8-flash`)
- `GEMINI_MODEL_FALLBACK` (default `gemini-3.5-flash-lite`)
- `GROQ_BASE_URL` (default `https://api.groq.com/openai/v1`)
- `GEMINI_BASE_URL` (default `https://generativelanguage.googleapis.com/v1beta`)
- `AI_TIMEOUT_MS` (default `60000`, per attempt)
- `FREE_CALLS_PER_DAY` (default `20`), `PORT` (default `8080`),
  `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (unchanged)

If a provider key is missing, that provider's attempts are skipped
and the other provider serves the call. If both keys are missing,
`/api/ai` returns 502 and charges nothing.

## Charge-on-success behaviour

The old code charged credit BEFORE the AI call, so failed calls
burned quota. The rewrite checks the balance first (402 when the
free allowance and paid credits are both exhausted, with no
provider call made), then calls the provider chain, then charges
exactly one call only after a successful response. Provider
errors, timeouts, and missing keys charge nothing.

Unchanged: 20 free calls/day/IP, paid-pack balances, Razorpay
order/verify with HMAC and idempotent `paid[]`, db.json storage,
open CORS, 60 requests/minute/IP rate limit, `/health`,
`/api/credits`, and the `/api/ai` response shape (`{text}`).

## Model IDs: unverified until a live call

The model IDs above are taken from current provider documentation
and third-party limit trackers (November 2026). None has been
verified with a live call from this server yet. The Gemini free
tier limits reported in AI Studio are 5 requests/minute and 20
requests/day on Flash, 15/minute and 500/day on Flash-Lite. Groq
free plan limits reported are 30/minute, 1000/day, 8000
tokens/minute, 200000 tokens/day. Confirm live limits in the
Groq console and AI Studio before depending on them.

## How to verify live once keys exist

1. Set `GROQ_API_KEY` and `GEMINI_API_KEY`, start the server.
2. Text check: POST `/api/ai` with a text-only message. Expect
   a 200 with `{text}` and one credit used.
3. Image check: POST `/api/ai` with one image. Expect a 200
   with `{text}` describing the image.
4. Failure check: temporarily set a bad `GROQ_API_KEY` and
   repeat the text check. Expect a 200 served by Gemini, and
   exactly one credit used.
5. Both-down check: set both keys bad. Expect a 502 and no
   change in `/api/credits`.

## Tests without live keys

`provider-swap.test.mjs` boots the real server against a local
stub standing in for Groq and Gemini, and checks routing,
fallback order, timeout fallback, the 402 path, and the
charge-on-success rule. Run from this directory:

`node provider-swap.test.mjs`

It backs up `db.json`, runs against a fresh store, and restores
the backup on exit. The project has no other test suite.
