// Entitlements, enforced server-side on /api/ai, /api/orchestrate and
// /api/notice/analyze. Plan daily caps come from the plans table when
// configured; the free plan is 20 calls/day. In pilot mode the
// existing FREE logic in pilotStore.js applies.
//
// Configured-mode model: one entitlements row per user tracks the
// daily counter and the paid-credit balance. Subscriptions decide the
// effective plan; an expired subscription falls back to free. Every
// charge also writes a credit_ledger row (best effort: a ledger write
// failure must not lose the AI answer, but the entitlement counter
// update is authoritative and its failure is surfaced).
import { config, DEFAULT_PLAN_CAPS } from "./config.js";
import { findRows, insertRow, listOwned, listPublic, updateOwned } from "./db.js";
import { pilotCharge, pilotCredits, pilotHasBalance, todayStr } from "./pilotStore.js";

let plansCache = { rows: null, expiresAt: 0 };

export function clearPlansCache() {
  plansCache = { rows: null, expiresAt: 0 };
}

export async function getPlans() {
  if (plansCache.rows && plansCache.expiresAt > Date.now()) return plansCache.rows;
  let rows = [];
  try {
    rows = await listPublic("plans");
  } catch (e) {
    console.error("plans read failed, using fallback caps:", e.message);
    rows = [];
  }
  if (!rows.length) {
    rows = Object.entries(DEFAULT_PLAN_CAPS).map(([id, caps]) => ({
      id,
      ai_calls_per_day: caps.ai_calls_per_day,
    }));
  }
  plansCache = { rows, expiresAt: Date.now() + config.plansCacheTtlMs };
  return rows;
}

export function capForPlan(plans, planId) {
  const row = plans.find((p) => p.id === planId);
  if (row && Number.isFinite(+row.ai_calls_per_day)) return +row.ai_calls_per_day;
  const fallback = DEFAULT_PLAN_CAPS[planId] || DEFAULT_PLAN_CAPS.free;
  return fallback.ai_calls_per_day;
}

async function getOrCreateEntitlement(userId) {
  const rows = await listOwned("entitlements", userId, { limit: 1 });
  if (rows.length) return rows[0];
  try {
    const row = await insertRow("entitlements", {
      user_id: userId,
      plan: "free",
      ai_calls_today: 0,
      ai_calls_day: todayStr(),
      credits: 0,
    });
    if (row && row.id) return row;
  } catch (e) {
    console.error("entitlement create failed:", e.message);
  }
  const retry = await listOwned("entitlements", userId, { limit: 1 });
  if (retry.length) return retry[0];
  // Last resort: an in-memory shaped row so a transient DB fault does
  // not lock the user out; charging will retry the write.
  return { user_id: userId, plan: "free", ai_calls_today: 0, ai_calls_day: todayStr(), credits: 0 };
}

// A subscription grants its plan while its status is active, and
// also while it is cancelled but not yet expired (access runs to the
// end of the paid period). Expired rows grant nothing.
async function activeSubscription(userId) {
  let rows = [];
  try {
    rows = await listOwned("subscriptions", userId, { limit: 5 });
  } catch (e) {
    console.error("subscription read failed:", e.message);
    return null;
  }
  if (!rows.length) return null;
  const now = Date.now();
  const live = rows.filter(
    (s) =>
      (s.status === "active" || s.status === "cancelled") &&
      (!s.expires_at || new Date(s.expires_at).getTime() > now)
  );
  if (!live.length) return null;
  live.sort((a, b) => new Date(b.expires_at || 0) - new Date(a.expires_at || 0));
  return live[0];
}

// Resolve the effective entitlement snapshot for one user. Returns
// {plan, cap, usedToday, credits, freeLeft, entitlement, subscription}.
export async function resolveEntitlement(userId) {
  const [plans, entitlement, subscription] = await Promise.all([
    getPlans(),
    getOrCreateEntitlement(userId),
    activeSubscription(userId),
  ]);
  const plan = subscription && subscription.plan ? subscription.plan : entitlement.plan || "free";
  const cap = capForPlan(plans, plan);
  const usedToday = entitlement.ai_calls_day === todayStr() ? +entitlement.ai_calls_today || 0 : 0;
  const credits = +entitlement.credits || 0;
  return {
    plan,
    cap,
    usedToday,
    credits,
    freeLeft: Math.max(0, cap - usedToday),
    entitlement,
    subscription,
    plans,
  };
}

export function hasAllowance(snapshot) {
  return snapshot.usedToday < snapshot.cap || snapshot.credits > 0;
}

// Charge exactly one call against the snapshot. Daily allowance
// first, then paid credits. Returns true when a charge was recorded.
export async function chargeEntitlement(userId, snapshot) {
  const today = todayStr();
  const base = snapshot.entitlement;
  const patch = {};
  let usedCredit = false;
  if (snapshot.usedToday < snapshot.cap) {
    patch.ai_calls_day = today;
    patch.ai_calls_today = (base.ai_calls_day === today ? +base.ai_calls_today || 0 : 0) + 1;
  } else if (snapshot.credits > 0) {
    patch.credits = snapshot.credits - 1;
    usedCredit = true;
    if (base.ai_calls_day !== today) {
      patch.ai_calls_day = today;
      patch.ai_calls_today = 0;
    }
  } else {
    return false;
  }
  if (base.id) {
    const updated = await updateOwned("entitlements", base.id, userId, patch);
    if (!updated) return false;
  } else {
    try {
      await insertRow("entitlements", {
        user_id: userId,
        plan: snapshot.plan,
        ai_calls_today: patch.ai_calls_today ?? 0,
        ai_calls_day: patch.ai_calls_day || today,
        credits: patch.credits ?? snapshot.credits,
      });
    } catch (e) {
      console.error("entitlement charge insert failed:", e.message);
      return false;
    }
  }
  try {
    await insertRow("credit_ledger", {
      user_id: userId,
      delta: -1,
      reason: usedCredit ? "ai_call_credit" : "ai_call_free",
      balance_after: usedCredit ? snapshot.credits - 1 : snapshot.credits,
    });
  } catch (e) {
    console.error("credit ledger write failed (charge already recorded):", e.message);
  }
  return true;
}

// Add paid credits to a user (webhook / verify paths). Idempotency is
// the caller's job: it checks the payments table first.
export async function addCredits(userId, amount, reason) {
  const entitlement = await getOrCreateEntitlement(userId);
  const next = (+entitlement.credits || 0) + amount;
  if (entitlement.id) {
    await updateOwned("entitlements", entitlement.id, userId, { credits: next });
  } else {
    await insertRow("entitlements", {
      user_id: userId,
      plan: "free",
      ai_calls_today: 0,
      ai_calls_day: todayStr(),
      credits: next,
    });
  }
  try {
    await insertRow("credit_ledger", {
      user_id: userId,
      delta: amount,
      reason: reason || "purchase",
      balance_after: next,
    });
  } catch (e) {
    console.error("credit ledger write failed:", e.message);
  }
  return next;
}

// Unified allowance interface for the AI endpoints. In pilot mode it
// delegates to the pilot store; in configured mode it uses plans and
// entitlements. Returns {allowed, charge} where charge() records
// exactly one call and must only be called after provider success.
export async function allowanceFor(auth) {
  if (auth.mode === "pilot") {
    return {
      allowed: pilotHasBalance(auth.userId),
      charge: async () => pilotCharge(auth.userId),
    };
  }
  const snapshot = await resolveEntitlement(auth.userId);
  return {
    allowed: hasAllowance(snapshot),
    snapshot,
    charge: async () => chargeEntitlement(auth.userId, snapshot),
  };
}

export async function creditsFor(auth) {
  if (auth.mode === "pilot") return pilotCredits(auth.userId);
  const snapshot = await resolveEntitlement(auth.userId);
  return { free_left: snapshot.freeLeft, credits: snapshot.credits };
}

// Referral code lookup helper, shared by the referral routes.
export async function findReferralByCode(code) {
  const rows = await findRows("referrals", { code }, { limit: 1 });
  return rows.length ? rows[0] : null;
}
