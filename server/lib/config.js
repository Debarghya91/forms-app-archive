// Shared server configuration. Env vars only; no secret is ever logged.
// Providers: Groq (text) plus Gemini (vision) only. No other provider
// is wired anywhere in this server.
import path from "path";
import { fileURLToPath } from "url";

export const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const APP_DIR = path.resolve(SERVER_DIR, "..");
export const SHARED_DIR = path.join(APP_DIR, "..", "shared");

const E = process.env;

export function envTruthy(name) {
  const v = (E[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export const config = {
  port: +(E.PORT || 8080),
  freeCallsPerDay: +(E.FREE_CALLS_PER_DAY || 20),
  aiTimeoutMs: +(E.AI_TIMEOUT_MS || 60000),
  maxTokens: 1500,
  rateLimitMax: +(E.RATE_LIMIT_MAX || 60),
  rateLimitWindowMs: 60000,
  groqBase: (E.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
  groqText: E.GROQ_MODEL_TEXT || "openai/gpt-oss-120b",
  groqTextFallback: E.GROQ_MODEL_TEXT_FALLBACK || "openai/gpt-oss-20b",
  groqVision: E.GROQ_MODEL_VISION || "qwen/qwen3.8-27b",
  geminiBase: (E.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, ""),
  geminiMain: E.GEMINI_MODEL || "gemini-3.8-flash",
  geminiFallback: E.GEMINI_MODEL_FALLBACK || "gemini-3.5-flash-lite",
  groqApiKey: E.GROQ_API_KEY || "",
  geminiApiKey: E.GEMINI_API_KEY || "",
  supabaseUrl: (E.SUPABASE_URL || "").replace(/\/$/, ""),
  supabaseAnonKey: E.SUPABASE_ANON_KEY || "",
  supabaseServiceKey: E.SUPABASE_SERVICE_ROLE_KEY || "",
  requireAuth: envTruthy("REQUIRE_AUTH"),
  razorpayKeyId: E.RAZORPAY_KEY_ID || "",
  razorpayKeySecret: E.RAZORPAY_KEY_SECRET || "",
  razorpayWebhookSecret: E.RAZORPAY_WEBHOOK_SECRET || "",
  razorpayBase: (E.RAZORPAY_BASE_URL || "https://api.razorpay.com").replace(/\/$/, ""),
  dbPath: E.DB_PATH || path.join(APP_DIR, "db.json"),
  jwtCacheTtlMs: 60000,
  plansCacheTtlMs: 60000,
};

// True only when the server can verify JWTs and reach Supabase REST.
// Pilot mode (unset SUPABASE_URL) keeps the old IP/bearer identity and
// db.json, and DB-backed endpoints return 503.
export function isConfigured() {
  return Boolean(config.supabaseUrl);
}

export function hasSupabaseDb() {
  return Boolean(config.supabaseUrl && config.supabaseServiceKey);
}

// Credit packs, unchanged from the pilot. Amounts in paise.
export const PACKS = {
  notice_pack: { amount: 69900, calls: 300 },
  pro_month: { amount: 29900, calls: 150 },
};

export const PLAN_IDS = ["free", "personal_plus", "business_pro", "ca_professional"];

// Fallback caps used when the plans table cannot be read. The plans
// table is authoritative when configured; these match its seed rows.
export const DEFAULT_PLAN_CAPS = {
  free: { ai_calls_per_day: 20 },
  personal_plus: { ai_calls_per_day: 100 },
  business_pro: { ai_calls_per_day: 300 },
  ca_professional: { ai_calls_per_day: 1000 },
};

export const PROFILE_TYPES = [
  "individual",
  "salaried",
  "freelancer",
  "sole_proprietor",
  "partnership",
  "llp",
  "private_limited",
  "other",
];
