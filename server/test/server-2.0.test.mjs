// Integration tests for the 2.0 server: JWT auth, pilot mode,
// entitlements, CRUD ownership, compliance PATCH, webhook HMAC and
// idempotency, analytics PII drop, and charge-on-success. Every
// external service is stubbed in-process: Groq/Gemini providers,
// GoTrue /auth/v1/user, Supabase REST, and Razorpay orders. No live
// keys, no network beyond localhost.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const D = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(D, "..");
const STUB_PORT = 18301;
const PORT_A = 18302; // configured
const PORT_B = 18303; // pilot
const PORT_C = 18304; // require-auth, no Supabase
const STUB_BASE = "http://127.0.0.1:" + STUB_PORT;
const BASE_A = "http://127.0.0.1:" + PORT_A;
const BASE_B = "http://127.0.0.1:" + PORT_B;
const BASE_C = "http://127.0.0.1:" + PORT_C;
const WEBHOOK_SECRET = "test-webhook-secret";
const RAZORPAY_SECRET = "stub-razorpay-secret";
const DB_A = "/tmp/nm-20-a-db.json";
const DB_B = "/tmp/nm-20-b-db.json";
const DB_C = "/tmp/nm-20-c-db.json";

const todayStr = () => new Date().toISOString().slice(0, 10);

// ---- stub state ----
const tables = {};
let seq = 0;
const providerCalls = [];
const providerMode = { groq: "ok", gemini: "ok" };
const gotrueHits = {};
let orderCounter = 0;

function table(name) {
  return tables[name] || (tables[name] = []);
}

function seedPlans() {
  for (const [id, cap] of [["free", 20], ["personal_plus", 100], ["business_pro", 300], ["ca_professional", 1000]]) {
    table("plans").push({ id, ai_calls_per_day: cap, _seq: ++seq });
  }
}

const NOTICE_JSON = JSON.stringify({
  extracted: [{ fact: "Notice under section 148", source: "document", confidence: "high" }],
  interpretation: ["The department seeks a response."],
  needs_verification: ["Verify the deadline on the portal."],
  draft_reply: "Dear Sir, I refer to your notice.",
  checklist: ["Collect bank statements."],
  risks: ["Delay may attract a penalty."],
  ca_brief: "Section 148 notice, needs review.",
  notice_type: "Section 148 notice",
  authority: "Income Tax Department",
  period: "2023-24",
  deadline: "2026-12-31",
});

const GOTRUE_USERS = {
  "valid-token": { id: "user-1", email: "one@example.com" },
  "valid-token-2": { id: "user-2", email: "two@example.com" },
  "valid-token-9": { id: "user-9", email: "nine@example.com" },
  "cache-token": { id: "user-3", email: "three@example.com" },
};

function stripRow(row) {
  const copy = { ...row };
  delete copy._seq;
  return copy;
}

function readBody(req) {
  return new Promise((res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => res(b));
  });
}

function handleRest(req, res, raw, query) {
  const m = req.url.match(/^\/rest\/v1\/([A-Za-z_]+)/);
  const name = m[1];
  const rows = table(name);
  const filters = {};
  let order = null;
  let limit = null;
  for (const [k, v] of query.entries()) {
    if (k === "select") continue;
    if (k === "order") order = v;
    else if (k === "limit") limit = +v;
    else if (v.startsWith("eq.")) filters[k] = v.slice(3);
  }
  const matches = (row) => Object.entries(filters).every(([k, v]) => String(row[k]) === v);
  if (req.method === "GET") {
    let out = rows.filter(matches);
    if (order === "created_at.desc") out = [...out].sort((a, b) => b._seq - a._seq);
    if (order === "created_at.asc") out = [...out].sort((a, b) => a._seq - b._seq);
    if (limit !== null) out = out.slice(0, limit);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(out.map(stripRow)));
  }
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (req.method === "POST") {
    const items = Array.isArray(body) ? body : [body];
    const created = items.map((item) => {
      const row = {
        ...item,
        id: item.id || "row-" + ++seq,
        created_at: item.created_at || new Date().toISOString(),
        _seq: ++seq,
      };
      rows.push(row);
      return stripRow(row);
    });
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(created));
  }
  if (req.method === "PATCH") {
    const hit = rows.filter(matches);
    for (const row of hit) Object.assign(row, body);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(hit.map(stripRow)));
  }
  if (req.method === "DELETE") {
    const hit = rows.filter(matches);
    tables[name] = rows.filter((r) => !matches(r));
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(hit.map(stripRow)));
  }
  res.writeHead(405);
  return res.end();
}

const stub = http.createServer(async (req, res) => {
  res.on("error", () => {});
  const raw = await readBody(req);
  const url = new URL(req.url, STUB_BASE);
  // GoTrue
  if (url.pathname === "/auth/v1/user") {
    const token = (req.headers.authorization || "").slice(7);
    gotrueHits[token] = (gotrueHits[token] || 0) + 1;
    const user = GOTRUE_USERS[token];
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid token" }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(user));
  }
  // Supabase REST
  if (url.pathname.startsWith("/rest/v1/")) return handleRest(req, res, raw, url.searchParams);
  // Razorpay orders
  if (url.pathname === "/v1/orders" && req.method === "POST") {
    orderCounter++;
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ id: "order_test_" + orderCounter, amount: body.amount, currency: "INR" }));
  }
  // Providers
  const isGroq = url.pathname === "/openai/v1/chat/completions";
  const gm = url.pathname.match(/^\/v1beta\/models\/([^:]+):generateContent$/);
  if (isGroq || gm) {
    const provider = isGroq ? "groq" : "gemini";
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {}
    const model = isGroq ? body.model : decodeURIComponent(gm[1]);
    const hadImages = raw.includes("image_url") || raw.includes("inlineData");
    providerCalls.push({ provider, model, hadImages });
    if (providerMode[provider] === "fail") {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "stub failure" }));
    }
    const text = raw.includes("Analyse the notice") ? NOTICE_JSON : provider.toUpperCase() + ":" + model;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (isGroq) return res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
    return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
  }
  res.writeHead(404);
  return res.end();
});

// ---- app boot helpers ----
function boot(port, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["index.js"], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        AI_TIMEOUT_MS: "5000",
        GROQ_BASE_URL: STUB_BASE + "/openai/v1",
        GEMINI_BASE_URL: STUB_BASE + "/v1beta",
        GROQ_API_KEY: "stub-groq-key",
        GEMINI_API_KEY: "stub-gemini-key",
        RAZORPAY_KEY_ID: "stub-key-id",
        RAZORPAY_KEY_SECRET: RAZORPAY_SECRET,
        RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
        RAZORPAY_BASE_URL: STUB_BASE,
        RATE_LIMIT_MAX: "1000",
        ...extraEnv,
      },
      stdio: "ignore",
    });
    const t0 = Date.now();
    const tick = async () => {
      try {
        const r = await fetch("http://127.0.0.1:" + port + "/health");
        if (r.ok) return resolve(child);
      } catch {}
      if (Date.now() - t0 > 10000) return reject(new Error("server did not boot on " + port));
      setTimeout(tick, 200);
    };
    tick();
  });
}

function stop(child) {
  return new Promise((res) => {
    child.once("exit", res);
    child.kill();
    setTimeout(res, 2000);
  });
}

async function call(base, method, path, { token, body, headers } = {}) {
  const h = { ...(headers || {}) };
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }
  if (token) h.Authorization = "Bearer " + token;
  const r = await fetch(base + path, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, text };
}

function webhookSig(raw) {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
}

function checkoutSig(orderId, paymentId) {
  return crypto.createHmac("sha256", RAZORPAY_SECRET).update(orderId + "|" + paymentId).digest("hex");
}

function entitlementRow(userId) {
  return table("entitlements").find((r) => r.user_id === userId);
}

function setEntitlement(userId, patch) {
  const row = entitlementRow(userId);
  if (row) Object.assign(row, patch);
  return row;
}

let childA;
let childB;
let childC;

before(async () => {
  seedPlans();
  for (const f of [DB_A, DB_B, DB_C]) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
  await new Promise((res) => stub.listen(STUB_PORT, "127.0.0.1", res));
  childA = await boot(PORT_A, {
    DB_PATH: DB_A,
    SUPABASE_URL: STUB_BASE,
    SUPABASE_ANON_KEY: "stub-anon",
    SUPABASE_SERVICE_ROLE_KEY: "stub-service",
  });
  childB = await boot(PORT_B, { DB_PATH: DB_B });
  childC = await boot(PORT_C, { DB_PATH: DB_C, REQUIRE_AUTH: "1" });
});

after(async () => {
  await stop(childA);
  await stop(childB);
  await stop(childC);
  await new Promise((res) => stub.close(res));
  for (const f of [DB_A, DB_B, DB_C]) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
});

// ---- configured mode: auth ----

test("configured: missing or bad token is 401, valid token works", async () => {
  const noToken = await call(BASE_A, "GET", "/api/credits");
  assert.equal(noToken.status, 401);
  const bad = await call(BASE_A, "GET", "/api/credits", { token: "bogus" });
  assert.equal(bad.status, 401);
  const ok = await call(BASE_A, "GET", "/api/credits", { token: "valid-token" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { free_left: 20, credits: 0 });
  assert.ok(entitlementRow("user-1"), "entitlement row created on first use");
});

test("configured: JWT verification is cached for 60s", async () => {
  const beforeCount = gotrueHits["cache-token"] || 0;
  for (let i = 0; i < 3; i++) {
    const r = await call(BASE_A, "GET", "/api/credits", { token: "cache-token" });
    assert.equal(r.status, 200);
  }
  assert.equal((gotrueHits["cache-token"] || 0) - beforeCount, 1);
});

// ---- configured mode: CRUD + ownership ----

test("configured: cases CRUD, client user_id ignored, other user blocked", async () => {
  const created = await call(BASE_A, "POST", "/api/cases", {
    token: "valid-token",
    body: { case: { title: "My notice", user_id: "user-2", status: "open" } },
  });
  assert.equal(created.status, 200);
  const id = created.json.id;
  assert.ok(id);
  const fetched = await call(BASE_A, "GET", "/api/cases/" + id, { token: "valid-token" });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.user_id, "user-1", "server user id wins over client value");
  const other = await call(BASE_A, "GET", "/api/cases/" + id, { token: "valid-token-2" });
  assert.equal(other.status, 404);
  const patched = await call(BASE_A, "PATCH", "/api/cases/" + id, {
    token: "valid-token",
    body: { status: "replied", notes: "sent" },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.status, "replied");
  const deleted = await call(BASE_A, "DELETE", "/api/cases/" + id, { token: "valid-token" });
  assert.equal(deleted.status, 200);
  const gone = await call(BASE_A, "GET", "/api/cases/" + id, { token: "valid-token" });
  assert.equal(gone.status, 404);
});

test("configured: cases migrate", async () => {
  const r = await call(BASE_A, "POST", "/api/cases/migrate", {
    token: "valid-token",
    body: { cases: [{ title: "Migrated 1" }, { title: "Migrated 2", status: "open" }] },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.migrated, 2);
});

test("configured: documents metadata", async () => {
  const created = await call(BASE_A, "POST", "/api/documents", {
    token: "valid-token",
    body: { name: "notice.pdf", kind: "notice", storage_path: "user-1/notice.pdf" },
  });
  assert.equal(created.status, 200);
  const list = await call(BASE_A, "GET", "/api/documents", { token: "valid-token" });
  assert.equal(list.status, 200);
  assert.ok(list.json.documents.some((d) => d.id === created.json.id));
  const bad = await call(BASE_A, "POST", "/api/documents", {
    token: "valid-token",
    body: { name: "no path" },
  });
  assert.equal(bad.status, 400);
  const deleted = await call(BASE_A, "DELETE", "/api/documents/" + created.json.id, { token: "valid-token" });
  assert.equal(deleted.status, 200);
});

test("configured: compliance tasks and PATCH completion state", async () => {
  const list = await call(BASE_A, "GET", "/api/compliance?profile=sole_proprietor", { token: "valid-token" });
  assert.equal(list.status, 200);
  assert.ok(list.json.tasks.length > 0);
  const gstr3b = list.json.tasks.find((t) => t.key === "gstr3b");
  assert.ok(gstr3b, "tasks carry their key");
  assert.equal(gstr3b.status, "pending");
  const badProfile = await call(BASE_A, "GET", "/api/compliance?profile=bogus", { token: "valid-token" });
  assert.equal(badProfile.status, 400);
  const patched = await call(BASE_A, "PATCH", "/api/compliance/tasks/gstr3b", {
    token: "valid-token",
    body: { done: true, note: "filed on time" },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.task.status, "done");
  assert.equal(patched.json.task.key, "gstr3b");
  const again = await call(BASE_A, "GET", "/api/compliance?profile=sole_proprietor", { token: "valid-token" });
  const updated = again.json.tasks.find((t) => t.key === "gstr3b");
  assert.equal(updated.status, "done");
  assert.equal(updated.user_note, "filed on time");
  const undone = await call(BASE_A, "PATCH", "/api/compliance/tasks/gstr3b", {
    token: "valid-token",
    body: { done: false },
  });
  assert.equal(undone.json.task.status, "pending");
  const unknown = await call(BASE_A, "PATCH", "/api/compliance/tasks/nope", {
    token: "valid-token",
    body: { done: true },
  });
  assert.equal(unknown.status, 404);
  // Another user's completion does not touch this user's state.
  await call(BASE_A, "PATCH", "/api/compliance/tasks/gstr3b", {
    token: "valid-token-2",
    body: { done: true },
  });
  const mine = await call(BASE_A, "GET", "/api/compliance?profile=sole_proprietor", { token: "valid-token" });
  assert.equal(mine.json.tasks.find((t) => t.key === "gstr3b").status, "pending");
});

test("configured: profile get and put with businesses", async () => {
  const before = await call(BASE_A, "GET", "/api/profile", { token: "valid-token" });
  assert.equal(before.status, 200);
  assert.equal(before.json.profile, null);
  assert.deepEqual(before.json.businesses, []);
  const put = await call(BASE_A, "PUT", "/api/profile", {
    token: "valid-token",
    body: { full_name: "Test User", businesses: [{ name: "Test Traders", gstin: "27ABCDE1234F1Z5" }] },
  });
  assert.equal(put.status, 200);
  assert.equal(put.json.profile.full_name, "Test User");
  assert.equal(put.json.businesses.length, 1);
  const afterPut = await call(BASE_A, "GET", "/api/profile", { token: "valid-token" });
  assert.equal(afterPut.json.businesses[0].name, "Test Traders");
});

test("configured: invoices with line items", async () => {
  const created = await call(BASE_A, "POST", "/api/invoices", {
    token: "valid-token",
    body: {
      number: "INV-100",
      buyer_name: "Buyer Co",
      taxable: 10000,
      rate: 18,
      total: 11800,
      items: [
        { description: "Widget", qty: 2, price: 5000, taxable: 10000, rate: 18, tax: 1800 },
      ],
    },
  });
  assert.equal(created.status, 200);
  const fetched = await call(BASE_A, "GET", "/api/invoices/" + created.json.id, { token: "valid-token" });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.items.length, 1);
  assert.equal(fetched.json.items[0].description, "Widget");
});

test("configured: registers, expenses, notes round trip", async () => {
  const sale = await call(BASE_A, "POST", "/api/registers/sales", {
    token: "valid-token",
    body: { date: "2026-10-05", invoice_no: "S-1", buyer: "B", taxable: 1000, total: 1180, month: "2026-10" },
  });
  assert.equal(sale.status, 200);
  const sales = await call(BASE_A, "GET", "/api/registers/sales", { token: "valid-token" });
  assert.ok(sales.json.sales.some((r) => r.id === sale.json.id));
  const expense = await call(BASE_A, "POST", "/api/expenses", {
    token: "valid-token",
    body: { date: "2026-10-06", vendor: "Vendor", amount: 500, category: "fuel" },
  });
  assert.equal(expense.status, 200);
  const note = await call(BASE_A, "POST", "/api/notes", {
    token: "valid-token",
    body: { type: "credit", number: "CN-1", party: "Buyer", amount: 100 },
  });
  assert.equal(note.status, 200);
  const notes = await call(BASE_A, "GET", "/api/notes", { token: "valid-token" });
  assert.ok(notes.json.notes.some((n) => n.id === note.json.id));
});

test("configured: reconcile compares register against user figures", async () => {
  await call(BASE_A, "POST", "/api/registers/purchases", {
    token: "valid-token",
    body: { date: "2026-10-05", invoice_no: "P-1", vendor: "V", gstin: "27ABCDE1234F1Z5", taxable: 10000, tax: 1800, month: "2026-10" },
  });
  await call(BASE_A, "POST", "/api/registers/purchases", {
    token: "valid-token",
    body: { date: "2026-10-06", invoice_no: "P-2", vendor: "V", gstin: "27ABCDE1234F1Z5", taxable: 5000, tax: 900, month: "2026-10" },
  });
  const r = await call(BASE_A, "POST", "/api/reconcile", {
    token: "valid-token",
    body: {
      month: "2026-10",
      gstr2b: [
        { invoice_no: "P-1", gstin: "27ABCDE1234F1Z5", taxable: 10000, tax: 1800 },
        { invoice_no: "P-2", gstin: "27ABCDE1234F1Z5", taxable: 5000, tax: 950 },
        { invoice_no: "P-9", gstin: "27ABCDE1234F1Z5", taxable: 1000, tax: 180 },
      ],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.summary.matched, 1);
  assert.equal(r.json.summary.mismatched, 1);
  assert.equal(r.json.summary.missing, 1);
  assert.equal(r.json.missing_purchases[0].invoice_no, "P-9");
  assert.ok(r.json.note.includes("user-entered"));
  const bad = await call(BASE_A, "POST", "/api/reconcile", {
    token: "valid-token",
    body: { month: "October" },
  });
  assert.equal(bad.status, 400);
});

test("configured: expense import flags duplicates, uncertain stays unreviewed", async () => {
  await call(BASE_A, "POST", "/api/expenses", {
    token: "valid-token",
    body: { date: "2026-11-01", vendor: "Vendor A", amount: 1000 },
  });
  const r = await call(BASE_A, "POST", "/api/expenses/import", {
    token: "valid-token",
    body: {
      rows: [
        { date: "2026-11-01", vendor: "Vendor A", amount: 1000 },
        { date: "2026-11-02", vendor: "Indian Oil petrol pump", amount: 2000 },
        { date: "2026-11-03", vendor: "Mystery XYZ", amount: 300 },
      ],
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.duplicates_flagged, 1);
  assert.equal(r.json.imported, 2);
  assert.equal(r.json.categorized[1].category, "fuel");
  assert.equal(r.json.categorized[2].category, "unreviewed");
  assert.equal(r.json.categorized[2].review_status, "unreviewed");
});

test("configured: referral code, redeem, and double redeem", async () => {
  const mine = await call(BASE_A, "GET", "/api/referral", { token: "valid-token" });
  assert.equal(mine.status, 200);
  assert.ok(mine.json.code.startsWith("NM-"));
  const own = await call(BASE_A, "POST", "/api/referral/redeem", {
    token: "valid-token",
    body: { code: mine.json.code },
  });
  assert.equal(own.status, 400);
  const redeemed = await call(BASE_A, "POST", "/api/referral/redeem", {
    token: "valid-token-2",
    body: { code: mine.json.code },
  });
  assert.equal(redeemed.status, 200);
  assert.equal(redeemed.json.credited, 0);
  const again = await call(BASE_A, "POST", "/api/referral/redeem", {
    token: "valid-token-2",
    body: { code: mine.json.code },
  });
  assert.equal(again.status, 400);
  const invalid = await call(BASE_A, "POST", "/api/referral/redeem", {
    token: "valid-token-9",
    body: { code: "NM-XXXXXXX" },
  });
  assert.equal(invalid.status, 400);
  const after = await call(BASE_A, "GET", "/api/referral", { token: "valid-token" });
  assert.equal(after.json.count, 1);
});

test("configured: analytics drops PII events before storage", async () => {
  const before = table("analytics_events").length;
  const r = await call(BASE_A, "POST", "/api/analytics/events", {
    token: "valid-token",
    body: {
      events: [
        { name: "screen_view", ts: new Date().toISOString(), props: { screen: "home" } },
        { name: "share", props: { contact: "a@example.com" } },
        { name: "note", props: { text: "GSTIN 27ABCDE1234F1Z5" } },
        { name: "call", props: { text: "call 9876543210" } },
      ],
    },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(table("analytics_events").length - before, 1);
  assert.equal(table("analytics_events")[table("analytics_events").length - 1].name, "screen_view");
});

// ---- configured mode: AI + entitlements ----

test("configured: orchestrator uses one call, routes specialists, charges on success only", async () => {
  providerCalls.length = 0;
  const simple = await call(BASE_A, "POST", "/api/orchestrate", {
    token: "valid-token",
    body: { messages: [{ role: "user", content: "hello, what can you do" }] },
  });
  assert.equal(simple.status, 200);
  assert.equal(simple.json.route, "direct");
  assert.equal(simple.json.calls_used, 1);
  assert.equal(providerCalls.length, 1);
  providerCalls.length = 0;
  const gst = await call(BASE_A, "POST", "/api/orchestrate", {
    token: "valid-token",
    body: { messages: [{ role: "user", content: "when is gstr-3b due" }] },
  });
  assert.equal(gst.json.route, "gst");
  assert.equal(gst.json.specialist, "gst");
  assert.equal(providerCalls.length, 1);
  assert.ok(gst.json.sources.length > 0, "RAG citations are returned");
  const usedAfterSuccess = entitlementRow("user-1").ai_calls_today;
  assert.equal(usedAfterSuccess, 2);
  providerMode.groq = "fail";
  providerMode.gemini = "fail";
  const failed = await call(BASE_A, "POST", "/api/orchestrate", {
    token: "valid-token",
    body: { messages: [{ role: "user", content: "hello again" }] },
  });
  providerMode.groq = "ok";
  providerMode.gemini = "ok";
  assert.equal(failed.status, 502);
  assert.equal(entitlementRow("user-1").ai_calls_today, 2, "failed calls charge nothing");
});

test("configured: notice analysis shape and vision path", async () => {
  providerCalls.length = 0;
  const r = await call(BASE_A, "POST", "/api/notice/analyze", {
    token: "valid-token",
    body: { brief: "I received a notice.", due_date: "2026-12-15", amount: "50000" },
  });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.extracted));
  assert.ok(r.json.extracted.every((f) => f.fact && f.source && f.confidence));
  assert.ok(r.json.extracted.some((f) => f.fact.includes("2026-12-15") && f.source === "user"));
  assert.ok(r.json.extracted.some((f) => f.fact.includes("50000")));
  assert.equal(r.json.notice_type, "Section 148 notice");
  assert.ok(typeof r.json.draft_reply === "string" && r.json.draft_reply.length > 0);
  assert.ok(typeof r.json.ca_brief === "string" && r.json.ca_brief.length > 0);
  assert.ok(Array.isArray(r.json.needs_verification) && r.json.needs_verification.length > 0);
  providerCalls.length = 0;
  const vision = await call(BASE_A, "POST", "/api/notice/analyze", {
    token: "valid-token",
    body: { brief: "Read this notice.", images: [{ media_type: "image/jpeg", data: "aGVsbG8=" }] },
  });
  assert.equal(vision.status, 200);
  assert.equal(providerCalls[0].provider, "gemini", "image path uses the vision provider first");
  assert.equal(providerCalls[0].hadImages, true);
});

test("configured: entitlement caps, paid credits, and plan caps", async () => {
  setEntitlement("user-1", { ai_calls_today: 20, ai_calls_day: todayStr(), credits: 0 });
  providerCalls.length = 0;
  const exhausted = await call(BASE_A, "POST", "/api/ai", {
    token: "valid-token",
    body: { messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(exhausted.status, 402);
  assert.equal(providerCalls.length, 0);
  setEntitlement("user-1", { credits: 2 });
  const paid = await call(BASE_A, "POST", "/api/ai", {
    token: "valid-token",
    body: { messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(paid.status, 200);
  const credits = await call(BASE_A, "GET", "/api/credits", { token: "valid-token" });
  assert.equal(credits.json.credits, 1);
  assert.equal(credits.json.free_left, 0);
  // Plan cap: business_pro allows 300/day, so 150 used is fine.
  table("subscriptions").push({
    id: "sub-1",
    user_id: "user-1",
    plan: "business_pro",
    status: "active",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    _seq: ++seq,
  });
  setEntitlement("user-1", { ai_calls_today: 150, credits: 0 });
  const planCall = await call(BASE_A, "POST", "/api/ai", {
    token: "valid-token",
    body: { messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(planCall.status, 200);
  assert.equal(entitlementRow("user-1").ai_calls_today, 151);
  tables["subscriptions"] = table("subscriptions").filter((s) => s.id !== "sub-1");
  setEntitlement("user-1", { ai_calls_today: 0, ai_calls_day: todayStr(), credits: 0 });
});

// ---- configured mode: payments ----

test("configured: pay order and verify, idempotent on replay", async () => {
  const order = await call(BASE_A, "POST", "/api/pay/order", {
    token: "valid-token",
    body: { pack: "notice_pack" },
  });
  assert.equal(order.status, 200);
  assert.ok(order.json.order_id);
  assert.equal(order.json.amount, 69900);
  const paymentId = "pay_test_1";
  const sig = checkoutSig(order.json.order_id, paymentId);
  const verified = await call(BASE_A, "POST", "/api/pay/verify", {
    token: "valid-token",
    body: { order_id: order.json.order_id, payment_id: paymentId, signature: sig },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.json.credits, 300);
  const replay = await call(BASE_A, "POST", "/api/pay/verify", {
    token: "valid-token",
    body: { order_id: order.json.order_id, payment_id: paymentId, signature: sig },
  });
  assert.equal(replay.json.credits, 300, "replay does not double credit");
  const badSig = await call(BASE_A, "POST", "/api/pay/verify", {
    token: "valid-token",
    body: { order_id: order.json.order_id, payment_id: "pay_other", signature: "bad" },
  });
  assert.equal(badSig.status, 400);
});

test("configured: webhook HMAC, idempotent replay, subscription activation", async () => {
  const badPayload = JSON.stringify({ event: "payment.captured", payload: {} });
  const bad = await call(BASE_A, "POST", "/api/pay/webhook", {
    body: badPayload,
    headers: { "X-Razorpay-Signature": "bad" },
  });
  assert.equal(bad.status, 400);
  const failedPayload = JSON.stringify({ event: "payment.failed", payload: {} });
  const failed = await call(BASE_A, "POST", "/api/pay/webhook", {
    body: failedPayload,
    headers: { "X-Razorpay-Signature": webhookSig(failedPayload) },
  });
  assert.equal(failed.status, 200);
  // Credit pack via webhook, using an order created through the API.
  const order = await call(BASE_A, "POST", "/api/pay/order", {
    token: "valid-token",
    body: { pack: "pro_month" },
  });
  const payloadObj = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_wh_1",
          order_id: order.json.order_id,
          amount: 29900,
          currency: "INR",
          notes: {},
        },
      },
    },
  };
  const raw = JSON.stringify(payloadObj);
  const first = await call(BASE_A, "POST", "/api/pay/webhook", {
    body: raw,
    headers: { "X-Razorpay-Signature": webhookSig(raw) },
  });
  assert.equal(first.status, 200);
  const afterFirst = await call(BASE_A, "GET", "/api/credits", { token: "valid-token" });
  assert.equal(afterFirst.json.credits, 450, "300 from verify + 150 from webhook");
  const replay = await call(BASE_A, "POST", "/api/pay/webhook", {
    body: raw,
    headers: { "X-Razorpay-Signature": webhookSig(raw) },
  });
  assert.equal(replay.status, 200);
  const afterReplay = await call(BASE_A, "GET", "/api/credits", { token: "valid-token" });
  assert.equal(afterReplay.json.credits, 450, "webhook replay does not double credit");
  // Subscription via webhook notes.
  const subPayload = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_wh_2",
          order_id: "order_test_sub",
          amount: 29900,
          currency: "INR",
          notes: { plan: "business_pro", user_id: "user-9", period_months: 1 },
        },
      },
    },
  });
  const sub = await call(BASE_A, "POST", "/api/pay/webhook", {
    body: subPayload,
    headers: { "X-Razorpay-Signature": webhookSig(subPayload) },
  });
  assert.equal(sub.status, 200);
  const subGet = await call(BASE_A, "GET", "/api/subscription", { token: "valid-token-9" });
  assert.equal(subGet.status, 200);
  assert.equal(subGet.json.plan, "business_pro");
  assert.equal(subGet.json.status, "active");
});

test("configured: subscription cancel keeps access to expiry, then none", async () => {
  const cancelled = await call(BASE_A, "POST", "/api/subscription/cancel", { token: "valid-token-9" });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.status, "cancelled");
  const after = await call(BASE_A, "GET", "/api/subscription", { token: "valid-token-9" });
  assert.equal(after.json.plan, "business_pro", "cancelled plan runs to expiry");
  assert.equal(after.json.status, "cancelled");
  const none = await call(BASE_A, "POST", "/api/subscription/cancel", { token: "valid-token-9" });
  assert.equal(none.json.status, "none");
});

test("configured: tax endpoints require auth, legacy GST gate holds", async () => {
  const noAuth = await call(BASE_A, "GET", "/api/tax/rules/2026-27");
  assert.equal(noAuth.status, 401);
  const ok = await call(BASE_A, "GET", "/api/tax/rules/2026-27", { token: "valid-token" });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.id, "ay-2026-27");
  const legacy = await call(BASE_A, "POST", "/api/tax/gst", {
    token: "valid-token",
    body: { taxable: 10000, rate: 12, interstate: false },
  });
  assert.equal(legacy.status, 400);
  assert.equal(legacy.json.error, "legacy_rate_requires_confirmation");
  const current = await call(BASE_A, "POST", "/api/tax/gst", {
    token: "valid-token",
    body: { taxable: 10000, rate: 18, interstate: true },
  });
  assert.deepEqual(current.json, { cgst: 0, sgst: 0, igst: 1800, total: 11800 });
});

// ---- pilot mode ----

test("pilot: DB-backed endpoints return 503", async () => {
  for (const [method, path] of [
    ["GET", "/api/cases"],
    ["GET", "/api/documents"],
    ["GET", "/api/compliance"],
    ["GET", "/api/profile"],
    ["GET", "/api/invoices"],
    ["GET", "/api/subscription"],
    ["GET", "/api/referral"],
    ["POST", "/api/analytics/events"],
    ["POST", "/api/reconcile"],
  ]) {
    const r = await call(BASE_B, method, path, { token: "pilot-user", body: method === "POST" ? {} : undefined });
    assert.equal(r.status, 503, path);
    assert.equal(r.json.error, "backend_not_configured", path);
  }
});

test("pilot: AI, tax, and RAG keep working", async () => {
  const credits = await call(BASE_B, "GET", "/api/credits", { token: "pilot-user" });
  assert.deepEqual(credits.json, { free_left: 20, credits: 0 });
  const ai = await call(BASE_B, "POST", "/api/ai", {
    token: "pilot-user",
    body: { messages: [{ role: "user", content: "hello" }] },
  });
  assert.equal(ai.status, 200);
  const regime = await call(BASE_B, "POST", "/api/tax/regime", {
    body: { ay: "2026-27", income: 1275000, salaried: true, deductions: {} },
  });
  assert.equal(regime.json.new.total, 0);
  const rag = await call(BASE_B, "GET", "/api/rag/search?q=gstr-3b");
  assert.equal(rag.status, 200);
  assert.ok(rag.json.results.length > 0);
});

test("pilot: webhook credits packs idempotently", async () => {
  const order = await call(BASE_B, "POST", "/api/pay/order", {
    token: "pilot-user",
    body: { pack: "notice_pack" },
  });
  assert.equal(order.status, 200);
  const raw = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_pilot_1",
          order_id: order.json.order_id,
          amount: 69900,
          currency: "INR",
          notes: { pack: "notice_pack" },
        },
      },
    },
  });
  const bad = await call(BASE_B, "POST", "/api/pay/webhook", {
    body: raw,
    headers: { "X-Razorpay-Signature": "bad" },
  });
  assert.equal(bad.status, 400);
  const first = await call(BASE_B, "POST", "/api/pay/webhook", {
    body: raw,
    headers: { "X-Razorpay-Signature": webhookSig(raw) },
  });
  assert.equal(first.status, 200);
  const after = await call(BASE_B, "GET", "/api/credits", { token: "pilot-user" });
  assert.equal(after.json.credits, 300);
  const replay = await call(BASE_B, "POST", "/api/pay/webhook", {
    body: raw,
    headers: { "X-Razorpay-Signature": webhookSig(raw) },
  });
  assert.equal(replay.status, 200);
  const afterReplay = await call(BASE_B, "GET", "/api/credits", { token: "pilot-user" });
  assert.equal(afterReplay.json.credits, 300);
});

// ---- require-auth mode ----

test("require-auth: 401 without a verifiable JWT, health and webhook exempt", async () => {
  const noToken = await call(BASE_C, "GET", "/api/credits");
  assert.equal(noToken.status, 401);
  const withToken = await call(BASE_C, "GET", "/api/credits", { token: "valid-token" });
  assert.equal(withToken.status, 401);
  const health = await call(BASE_C, "GET", "/health");
  assert.equal(health.status, 200);
  const raw = JSON.stringify({ event: "payment.failed", payload: {} });
  const webhook = await call(BASE_C, "POST", "/api/pay/webhook", {
    body: raw,
    headers: { "X-Razorpay-Signature": webhookSig(raw) },
  });
  assert.equal(webhook.status, 200);
});
