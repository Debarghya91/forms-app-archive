// Pilot store: the original db.json behaviour, unchanged.
// Used ONLY when SUPABASE_URL is unset. Labelled pilot everywhere it
// is referenced so it is never mistaken for the configured database.
//
// Shape: { "<uid>": {credits, day, used, paid: []}, __orders: {...},
// __payments: {"<payment_id>": {...}} }
import fs from "fs";
import { config } from "./config.js";

export function loadPilot() {
  try {
    return JSON.parse(fs.readFileSync(config.dbPath, "utf8"));
  } catch {
    return {};
  }
}

export function savePilot(d) {
  fs.writeFileSync(config.dbPath, JSON.stringify(d));
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Pilot identity: bearer token, else the request IP. Pilot only.
export function pilotUid(req) {
  return (req.get("authorization") || "").slice(7) || req.ip;
}

export function pilotUser(d, u) {
  const x = d[u] || (d[u] = { credits: 0, day: todayStr(), used: 0, paid: [] });
  if (x.day !== todayStr()) {
    x.day = todayStr();
    x.used = 0;
  }
  return x;
}

// Read-only balance check. Never writes, never charges.
export function pilotHasBalance(u) {
  const x = pilotUser(loadPilot(), u);
  return x.used < config.freeCallsPerDay || x.credits > 0;
}

// Charge exactly one call: free allowance first, then paid credits.
// Called only after a successful provider response.
export function pilotCharge(u) {
  const d = loadPilot();
  const x = pilotUser(d, u);
  let ok = false;
  if (x.used < config.freeCallsPerDay) {
    x.used++;
    ok = true;
  } else if (x.credits > 0) {
    x.credits--;
    ok = true;
  }
  if (ok) savePilot(d);
  return ok;
}

export function pilotCredits(u) {
  const x = pilotUser(loadPilot(), u);
  return {
    free_left: Math.max(0, config.freeCallsPerDay - x.used),
    credits: x.credits,
  };
}
