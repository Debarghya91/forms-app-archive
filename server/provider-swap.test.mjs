// provider-swap.test.mjs: stub-based verification for the Groq + Gemini
// provider router. No live keys needed.
// Run from this directory: node provider-swap.test.mjs
// Backs up db.json, runs against a fresh store, restores it on exit.
import http from "http";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const D = path.dirname(fileURLToPath(import.meta.url));
const DB = path.join(D, "db.json");
const STUB_PORT = 18101;
const APP_PORT = 18102;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS", name);
  else { failures++; console.log("FAIL", name, extra || ""); }
}

// ---- stub provider server: stands in for Groq and Gemini ----
const calls = []; // {provider, model, hadImages}
const mode = { groq: "ok", gemini: "ok" }; // ok | fail | slow
function readBody(req) {
  return new Promise(res => { let b = ""; req.on("data", c => b += c); req.on("end", () => res(b)); });
}
const stub = http.createServer(async (req, res) => {
  res.on("error", () => {});
  const raw = await readBody(req);
  let body = {};
  try { body = JSON.parse(raw); } catch {}
  const isGroq = req.url.startsWith("/openai/v1/chat/completions");
  const gm = req.url.match(/^\/v1beta\/models\/([^:]+):generateContent/);
  const provider = isGroq ? "groq" : gm ? "gemini" : null;
  if (!provider) { res.writeHead(404); return res.end(); }
  const model = isGroq ? body.model : decodeURIComponent(gm[1]);
  const hadImages = isGroq
    ? (body.messages || []).some(x => Array.isArray(x.content) && x.content.some(p => p.type === "image_url"))
    : JSON.stringify(body).includes("inlineData");
  calls.push({ provider, model, hadImages });
  const md = mode[provider];
  if (md === "slow") await new Promise(r => setTimeout(r, 7000));
  // Note: req.destroyed is true once the body is fully read, so it
  // cannot be used to detect a disconnected client here. A write
  // to a dead socket is absorbed by the res error handler above.
  if (md === "fail") { res.writeHead(500, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "stub failure" })); }
  res.writeHead(200, { "Content-Type": "application/json" });
  if (isGroq) res.end(JSON.stringify({ choices: [{ message: { content: "GROQ:" + model } }] }));
  else res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "GEMINI:" + model }] } }] }));
});

// ---- app server boot helpers ----
function boot(extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["index.js"], {
      cwd: D,
      env: {
        ...process.env,
        PORT: String(APP_PORT),
        AI_TIMEOUT_MS: "5000",
        GROQ_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/openai/v1",
        GEMINI_BASE_URL: "http://127.0.0.1:" + STUB_PORT + "/v1beta",
        ...extraEnv,
      },
      stdio: "ignore",
    });
    const t0 = Date.now();
    const tick = async () => {
      try { const r = await fetch("http://127.0.0.1:" + APP_PORT + "/health"); if (r.ok) return resolve(child); } catch {}
      if (Date.now() - t0 > 10000) return reject(new Error("server did not boot"));
      setTimeout(tick, 200);
    };
    tick();
  });
}
function stop(child) {
  return new Promise(res => { child.once("exit", res); child.kill(); setTimeout(res, 2000); });
}

const base = "http://127.0.0.1:" + APP_PORT;
async function ai(token, body) {
  const r = await fetch(base + "/api/ai", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
async function credits(token) {
  const r = await fetch(base + "/api/credits", { headers: { Authorization: "Bearer " + token } });
  return r.json();
}
const today = () => new Date().toISOString().slice(0, 10);

const dbBackup = fs.existsSync(DB) ? fs.readFileSync(DB, "utf8") : null;
await new Promise(res => stub.listen(STUB_PORT, "127.0.0.1", res));
let child;
try {
  fs.writeFileSync(DB, "{}");
  child = await boot({ GROQ_API_KEY: "stub-groq-key", GEMINI_API_KEY: "stub-gemini-key" });

  // 1. health
  {
    const r = await fetch(base + "/health");
    check("health returns ok", r.ok && (await r.text()) === "ok");
  }

  // 2. credits shape for a fresh user
  {
    const c = await credits("fresh-user");
    check("credits fresh user", c.free_left === 20 && c.credits === 0, JSON.stringify(c));
  }

  // 3. text call routes to Groq default model, charges exactly once
  {
    calls.length = 0;
    const r = await ai("t3", { messages: [{ role: "user", content: "hello" }], tier: "default" });
    const c = await credits("t3");
    check("text routes to Groq 120b", r.status === 200 && r.json.text === "GROQ:openai/gpt-oss-120b", JSON.stringify(r.json));
    check("text calls Groq only", calls.length === 1 && calls[0].provider === "groq" && calls[0].model === "openai/gpt-oss-120b" && !calls[0].hadImages, JSON.stringify(calls));
    check("text success charges once", c.free_left === 19, JSON.stringify(c));
  }

  // 4. image call routes to Gemini default model, charges exactly once
  {
    calls.length = 0;
    const r = await ai("t4", { messages: [{ role: "user", content: "read this notice" }], images: [{ media_type: "image/jpeg", data: "aGVsbG8=" }], tier: "default" });
    const c = await credits("t4");
    check("image routes to Gemini flash", r.status === 200 && r.json.text === "GEMINI:gemini-3.8-flash", JSON.stringify(r.json));
    check("image calls Gemini only, with image", calls.length === 1 && calls[0].provider === "gemini" && calls[0].model === "gemini-3.8-flash" && calls[0].hadImages, JSON.stringify(calls));
    check("image success charges once", c.free_left === 19, JSON.stringify(c));
  }

  // 5. Groq failure falls back to Gemini, charges once
  {
    calls.length = 0;
    mode.groq = "fail";
    const r = await ai("t5", { messages: [{ role: "user", content: "hello" }], tier: "default" });
    const c = await credits("t5");
    mode.groq = "ok";
    check("Groq fail falls back to Gemini", r.status === 200 && r.json.text === "GEMINI:gemini-3.8-flash", JSON.stringify(r.json));
    check("fallback tried both Groq models then Gemini", calls.length === 3 && calls[0].provider === "groq" && calls[1].provider === "groq" && calls[2].provider === "gemini", JSON.stringify(calls));
    check("fallback success charges once", c.free_left === 19, JSON.stringify(c));
  }

  // 6. both providers fail: 502, zero charge
  {
    calls.length = 0;
    mode.groq = "fail"; mode.gemini = "fail";
    const r = await ai("t6", { messages: [{ role: "user", content: "hello" }], tier: "default" });
    const c = await credits("t6");
    mode.groq = "ok"; mode.gemini = "ok";
    check("both fail returns 502", r.status === 502 && r.json.error === "AI error", JSON.stringify(r.json));
    check("both fail charges nothing", c.free_left === 20, JSON.stringify(c));
    check("both fail tried all four attempts", calls.length === 4, JSON.stringify(calls));
  }

  // 7. Gemini failure on image call falls back to Groq vision model
  {
    calls.length = 0;
    mode.gemini = "fail";
    const r = await ai("t7", { messages: [{ role: "user", content: "read this" }], images: [{ media_type: "image/jpeg", data: "aGVsbG8=" }], tier: "default" });
    const c = await credits("t7");
    mode.gemini = "ok";
    check("Gemini fail falls back to Groq vision", r.status === 200 && r.json.text === "GROQ:qwen/qwen3.8-27b", JSON.stringify(r.json));
    check("vision fallback chain order", calls.length === 3 && calls[2].provider === "groq" && calls[2].model === "qwen/qwen3.8-27b" && calls[2].hadImages, JSON.stringify(calls));
    check("vision fallback charges once", c.free_left === 19, JSON.stringify(c));
  }

  // 8. image call, both fail: 502, zero charge
  {
    mode.groq = "fail"; mode.gemini = "fail";
    const r = await ai("t8", { messages: [{ role: "user", content: "read this" }], images: [{ media_type: "image/jpeg", data: "aGVsbG8=" }], tier: "default" });
    const c = await credits("t8");
    mode.groq = "ok"; mode.gemini = "ok";
    check("image both fail returns 502", r.status === 502, JSON.stringify(r.json));
    check("image both fail charges nothing", c.free_left === 20, JSON.stringify(c));
  }

  // 9. tier quick tries the lighter model first
  {
    calls.length = 0;
    const r = await ai("t9", { messages: [{ role: "user", content: "hello" }], tier: "quick" });
    check("quick tier uses Groq 20b first", r.status === 200 && r.json.text === "GROQ:openai/gpt-oss-20b", JSON.stringify(r.json));
  }

  // 10. exhausted user gets 402 and no provider call is made
  {
    const d = JSON.parse(fs.readFileSync(DB, "utf8"));
    d["exhausted"] = { credits: 0, day: today(), used: 20, paid: [] };
    fs.writeFileSync(DB, JSON.stringify(d));
    calls.length = 0;
    const r = await ai("exhausted", { messages: [{ role: "user", content: "hello" }], tier: "default" });
    check("exhausted user gets 402", r.status === 402, JSON.stringify(r.json));
    check("402 makes no provider call", calls.length === 0, JSON.stringify(calls));
  }

  // 11. slow primary times out and falls back
  {
    calls.length = 0;
    mode.groq = "slow";
    const r = await ai("t11", { messages: [{ role: "user", content: "hello" }], tier: "default" });
    mode.groq = "ok";
    check("slow Groq times out to Gemini", r.status === 200 && typeof r.json.text === "string" && r.json.text.startsWith("GEMINI:"), JSON.stringify(r.json));
  }

  // 11b. 2.0 pilot-mode behaviour: DB endpoints 503, tax/RAG work,
  // orchestrator answers a simple question with exactly one call.
  {
    const r = await fetch(base + "/api/cases", { headers: { Authorization: "Bearer t11b" } });
    check("pilot mode cases returns 503", r.status === 503 && (await r.json()).error === "backend_not_configured");
  }
  {
    const r = await fetch(base + "/api/tax/rules/2026-27", { headers: { Authorization: "Bearer t11b" } });
    const j = await r.json();
    check("tax pack serves ay-2026-27", r.status === 200 && j.id === "ay-2026-27" && j.verified === false, JSON.stringify(j).slice(0, 120));
  }
  {
    const r = await fetch(base + "/api/rag/search?q=gstr-3b%20due%20date", { headers: { Authorization: "Bearer t11b" } });
    const j = await r.json();
    check("rag search returns citations", r.status === 200 && Array.isArray(j.results) && j.results.length > 0 && typeof j.results[0].title === "string" && typeof j.results[0].source === "string", JSON.stringify(j).slice(0, 160));
  }
  {
    const r = await fetch(base + "/api/tax/gst", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t11b" }, body: JSON.stringify({ taxable: 10000, rate: 12, interstate: false }) });
    check("legacy gst rate needs explicit flag", r.status === 400 && (await r.json()).error === "legacy_rate_requires_confirmation");
  }
  {
    calls.length = 0;
    const r = await fetch(base + "/api/orchestrate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t11b" }, body: JSON.stringify({ messages: [{ role: "user", content: "hello, what can you do?" }] }) });
    const j = await r.json();
    const c = await credits("t11b");
    check("orchestrator simple question routes direct", r.status === 200 && j.route === "direct" && j.calls_used === 1 && typeof j.answer === "string", JSON.stringify(j).slice(0, 160));
    check("orchestrator simple question makes one provider call", calls.length === 1, JSON.stringify(calls));
    check("orchestrator success charges once", c.free_left === 19, JSON.stringify(c));
  }

  // 12. no keys at all: 502, zero charge
  {
    await stop(child);
    child = await boot({ GROQ_API_KEY: "", GEMINI_API_KEY: "" });
    calls.length = 0;
    const r = await ai("t12", { messages: [{ role: "user", content: "hello" }], tier: "default" });
    const c = await credits("t12");
    check("no keys returns 502", r.status === 502, JSON.stringify(r.json));
    check("no keys charges nothing", c.free_left === 20, JSON.stringify(c));
    check("no keys makes no provider call", calls.length === 0, JSON.stringify(calls));
  }
} finally {
  if (child) await stop(child);
  await new Promise(res => stub.close(res));
  if (dbBackup === null) { try { fs.unlinkSync(DB); } catch {} }
  else fs.writeFileSync(DB, dbBackup);
}

console.log(failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
