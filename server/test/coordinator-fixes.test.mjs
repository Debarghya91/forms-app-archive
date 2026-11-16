// Coordinator integration fixes, tested end to end against the real
// server booted as a child process with stubbed GoTrue + Supabase
// REST. Covers: malformed chat bodies get 400 (never reach the
// provider chain, never crash the process); register re-POST with an
// owned id updates instead of duplicating; /api/tax/regime excludes
// surcharge with the stated assumption.
import assert from "node:assert";
import http from "node:http";
import { spawn } from "node:child_process";
import { test, before, after } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STUB_PORT = 18311;
const APP_PORT = 18312;
const STUB_BASE = "http://127.0.0.1:" + STUB_PORT;
const BASE = "http://127.0.0.1:" + APP_PORT;
const TOKEN = "valid-token";

const tables = {};
let seq = 0;

function readBody(req) {
  return new Promise((res) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => res(s));
  });
}

function eqFilters(params) {
  const out = {};
  for (const [k, v] of params.entries()) {
    if (["select", "order", "limit"].includes(k)) continue;
    if (v.startsWith("eq.")) out[k] = decodeURIComponent(v.slice(3));
  }
  return out;
}

const stub = http.createServer(async (req, res) => {
  const raw = await readBody(req);
  const url = new URL(req.url, STUB_BASE);
  res.setHeader("Content-Type", "application/json");
  if (url.pathname === "/auth/v1/user") {
    const token = (req.headers.authorization || "").slice(7);
    if (token !== TOKEN) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: "invalid token" }));
    }
    res.writeHead(200);
    return res.end(JSON.stringify({ id: "user-1", email: "test@example.com" }));
  }
  const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (m) {
    const rows = (tables[m[1]] = tables[m[1]] || []);
    const filters = eqFilters(url.searchParams);
    const match = (r) => Object.entries(filters).every(([k, v]) => String(r[k]) === v);
    if (req.method === "GET") {
      let out = rows.filter(match).sort((a, b) => b._seq - a._seq);
      const limit = Number(url.searchParams.get("limit") || 200);
      out = out.slice(0, limit).map(({ _seq, ...r }) => r);
      res.writeHead(200);
      return res.end(JSON.stringify(out));
    }
    if (req.method === "POST") {
      const body = JSON.parse(raw || "{}");
      const items = Array.isArray(body) ? body : [body];
      const made = items.map((it) => {
        const row = { id: "row_" + ++seq, created_at: new Date().toISOString(), ...it, _seq: seq };
        rows.push(row);
        const { _seq, ...r } = row;
        return r;
      });
      res.writeHead(201);
      return res.end(JSON.stringify(made));
    }
    if (req.method === "PATCH") {
      const patch = JSON.parse(raw || "{}");
      const hit = rows.filter(match);
      for (const r of hit) Object.assign(r, patch);
      res.writeHead(200);
      return res.end(JSON.stringify(hit.map(({ _seq, ...r }) => r)));
    }
    if (req.method === "DELETE") {
      const hit = rows.filter(match);
      tables[m[1]] = rows.filter((r) => !match(r));
      res.writeHead(200);
      return res.end(JSON.stringify(hit.map(({ _seq, ...r }) => r)));
    }
  }
  res.writeHead(404);
  return res.end(JSON.stringify({ error: "stub miss" }));
});

let child;
async function call(method, p, { token, body } = {}) {
  const h = {};
  let payload;
  if (body !== undefined) {
    h["Content-Type"] = "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }
  if (token) h.Authorization = "Bearer " + token;
  const r = await fetch(BASE + p, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json, text };
}

before(async () => {
  await new Promise((res) => stub.listen(STUB_PORT, "127.0.0.1", res));
  child = spawn("node", ["index.js"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      SUPABASE_URL: STUB_BASE,
      SUPABASE_ANON_KEY: "stub-anon",
      SUPABASE_SERVICE_ROLE_KEY: "stub-service",
      GROQ_API_KEY: "",
      GEMINI_API_KEY: "",
      RAZORPAY_KEY_ID: "stub",
      RAZORPAY_KEY_SECRET: "stub",
      RATE_LIMIT_MAX: "1000",
    },
    stdio: "ignore",
  });
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(BASE + "/health");
      if (r.ok) break;
    } catch {}
    if (Date.now() - t0 > 10000) throw new Error("server did not boot");
    await new Promise((r) => setTimeout(r, 200));
  }
});

after(async () => {
  child.kill();
  await new Promise((res) => stub.close(res));
});

test("null message entry gets 400 and the server stays up", async () => {
  const r = await call("POST", "/api/ai", { token: TOKEN, body: { messages: [null] } });
  assert.equal(r.status, 400);
  const h = await call("GET", "/health");
  assert.equal(h.status, 200);
});

test("non-array and malformed messages get 400", async () => {
  for (const body of [
    { messages: "nope" },
    { messages: [] },
    {},
    { messages: [{ role: "user" }] },
    { messages: ["hello"] },
    { messages: [42] },
  ]) {
    const r = await call("POST", "/api/ai", { token: TOKEN, body });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test("orchestrate rejects malformed messages with 400", async () => {
  const r = await call("POST", "/api/orchestrate", { token: TOKEN, body: { messages: [null] } });
  assert.equal(r.status, 400);
});

test("register re-POST with an owned id updates instead of duplicating", async () => {
  const sale = { date: "2026-11-01", buyer: "Apex", taxable: 10000, rate: 18, total: 11800, month: "2026-11" };
  const c1 = await call("POST", "/api/registers/sales", { token: TOKEN, body: sale });
  assert.equal(c1.status, 200);
  const id = c1.json.id;
  assert.ok(id);
  const c2 = await call("POST", "/api/registers/sales", {
    token: TOKEN,
    body: { id, ...sale, buyer: "Apex Traders" },
  });
  assert.equal(c2.status, 200);
  assert.equal(c2.json.id, id);
  const list = await call("GET", "/api/registers/sales", { token: TOKEN });
  assert.equal(list.status, 200);
  assert.equal(list.json.sales.length, 1);
  assert.equal(list.json.sales[0].buyer, "Apex Traders");
});

test("tax regime endpoint excludes surcharge end to end", async () => {
  const r = await call("POST", "/api/tax/regime", {
    token: TOKEN,
    body: { ay: "2026-27", income: 6000000, deductions: {}, salaried: false },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.new.surcharge, 0);
  assert.equal(r.json.new.total, 1435200);
  assert.ok(r.json.assumptions.some((a) => a.includes("Surcharge excluded")));
});
