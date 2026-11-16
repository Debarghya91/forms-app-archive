// JWT verification against Supabase GoTrue, plus the pilot fallback.
//
// When SUPABASE_URL is set: every /api/* request except the Razorpay
// webhook must carry a Bearer Supabase JWT. The token is verified by
// calling {SUPABASE_URL}/auth/v1/user with the token. Token claims are
// never accepted without that check. Successful verifications are
// cached in memory for 60 seconds, keyed by a hash of the token; the
// token itself is never logged or stored.
//
// When SUPABASE_URL is unset: pilot mode. Identity is the bearer
// token or the request IP, exactly as the original server behaved.
// DB-backed endpoints return 503 in pilot mode (see requireConfigured).
//
// REQUIRE_AUTH=1 forces a 401 for any request without a verified JWT,
// including in pilot mode, where verification is impossible without
// SUPABASE_URL.
import crypto from "crypto";
import { config, isConfigured } from "./config.js";
import { pilotUid } from "./pilotStore.js";

const cache = new Map(); // tokenHash -> {user, expiresAt}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function verifyJwt(token) {
  const key = hashToken(token);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.user;
  cache.delete(key);
  let r;
  try {
    r = await fetch(config.supabaseUrl + "/auth/v1/user", {
      headers: {
        Authorization: "Bearer " + token,
        apikey: config.supabaseAnonKey || config.supabaseServiceKey || "",
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return null;
  }
  if (!r.ok) return null;
  let user = null;
  try {
    user = await r.json();
  } catch {
    return null;
  }
  if (!user || typeof user.id !== "string" || !user.id) return null;
  cache.set(key, { user, expiresAt: Date.now() + config.jwtCacheTtlMs });
  return user;
}

export function clearJwtCache() {
  cache.clear();
}

export function bearerToken(req) {
  const h = req.get("authorization") || "";
  if (!h.startsWith("Bearer ")) return "";
  return h.slice(7).trim();
}

// Sets req.auth = {userId, email, mode} or ends the request with 401.
export async function authenticate(req, res, next) {
  if (isConfigured()) {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: "unauthorized" });
    const user = await verifyJwt(token);
    if (!user) return res.status(401).json({ error: "unauthorized" });
    req.auth = { userId: user.id, email: user.email || null, mode: "configured" };
    return next();
  }
  if (config.requireAuth) {
    return res.status(401).json({ error: "unauthorized" });
  }
  req.auth = { userId: pilotUid(req), email: null, mode: "pilot" };
  return next();
}

// DB-backed endpoints: 503 in pilot mode, per the contract.
export function requireConfigured(req, res, next) {
  if (!isConfigured()) {
    return res.status(503).json({ error: "backend_not_configured" });
  }
  return next();
}
