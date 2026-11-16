// Data layer: Supabase REST (PostgREST) when configured, nothing else.
// The pilot store lives in pilotStore.js and is never used for the
// DB-backed endpoints; those return 503 in pilot mode instead.
//
// All user-table access is scoped by user_id server-side. RLS
// owner-only policies are the second layer (see the migrations); the
// service role key bypasses RLS, so this module must never skip the
// user_id filter. The service role key is server-side only and is
// never sent to a client or written to a log.
import { config, hasSupabaseDb } from "./config.js";

export class DbError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function dbAvailable() {
  return hasSupabaseDb();
}

async function rest(pathWithQuery, { method = "GET", body, prefer } = {}) {
  if (!dbAvailable()) {
    throw new DbError(503, "backend_not_configured");
  }
  const headers = {
    apikey: config.supabaseServiceKey,
    Authorization: "Bearer " + config.supabaseServiceKey,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(config.supabaseUrl + "/rest/v1" + pathWithQuery, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!r.ok) {
    const msg = json && typeof json.message === "string" ? json.message : "supabase error " + r.status;
    throw new DbError(r.status, msg);
  }
  return json;
}

function enc(v) {
  return encodeURIComponent(String(v));
}

// List rows owned by one user, newest first.
export async function listOwned(table, userId, { limit = 100, filters = {} } = {}) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("user_id", "eq." + userId);
  for (const [k, v] of Object.entries(filters)) {
    params.set(k, "eq." + v);
  }
  params.set("order", "created_at.desc");
  params.set("limit", String(Math.min(limit, 200)));
  const rows = await rest("/" + table + "?" + params.toString());
  return Array.isArray(rows) ? rows : [];
}

// List rows from a table with no owner column (plans, tax_rule_packs).
export async function listPublic(table, { limit = 100, filters = {} } = {}) {
  const params = new URLSearchParams();
  params.set("select", "*");
  for (const [k, v] of Object.entries(filters)) {
    params.set(k, "eq." + v);
  }
  params.set("limit", String(Math.min(limit, 200)));
  const rows = await rest("/" + table + "?" + params.toString());
  return Array.isArray(rows) ? rows : [];
}

export async function getOwned(table, id, userId) {
  const params = new URLSearchParams();
  params.set("select", "*");
  params.set("id", "eq." + id);
  params.set("user_id", "eq." + userId);
  params.set("limit", "1");
  const rows = await rest("/" + table + "?" + params.toString());
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function insertRow(table, row) {
  const rows = await rest("/" + table, {
    method: "POST",
    body: row,
    prefer: "return=representation",
  });
  if (Array.isArray(rows) && rows.length) return rows[0];
  return rows;
}

export async function insertRows(table, rows) {
  const out = await rest("/" + table, {
    method: "POST",
    body: rows,
    prefer: "return=representation",
  });
  return Array.isArray(out) ? out : [];
}

export async function updateOwned(table, id, userId, patch) {
  const params = new URLSearchParams();
  params.set("id", "eq." + id);
  params.set("user_id", "eq." + userId);
  const rows = await rest("/" + table + "?" + params.toString(), {
    method: "PATCH",
    body: patch,
    prefer: "return=representation",
  });
  if (Array.isArray(rows) && rows.length) return rows[0];
  return null;
}

export async function deleteOwned(table, id, userId) {
  const params = new URLSearchParams();
  params.set("id", "eq." + id);
  params.set("user_id", "eq." + userId);
  const rows = await rest("/" + table + "?" + params.toString(), {
    method: "DELETE",
    prefer: "return=representation",
  });
  if (Array.isArray(rows)) return rows.length > 0;
  return true;
}

// Single-row lookup by arbitrary equality filters (used for payments
// idempotency and referral codes, where the owner filter differs).
export async function findRows(table, filters, { limit = 10 } = {}) {
  const params = new URLSearchParams();
  params.set("select", "*");
  for (const [k, v] of Object.entries(filters)) {
    params.set(k, "eq." + v);
  }
  params.set("limit", String(limit));
  const rows = await rest("/" + table + "?" + params.toString());
  return Array.isArray(rows) ? rows : [];
}

export function encodeEq(v) {
  return enc(v);
}
