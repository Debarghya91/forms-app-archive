// Razorpay: order creation, checkout verification, and webhook
// handling. Nothing is ever activated on client success alone: the
// verify path checks the HMAC signature and the stored order, and the
// webhook path checks the webhook HMAC and is idempotent on the
// payment id. Both paths credit through the same helpers.
import crypto from "crypto";
import { config, PACKS, PLAN_IDS } from "./config.js";
import { findRows, insertRow, updateOwned } from "./db.js";
import { addCredits } from "./entitlements.js";
import { loadPilot, pilotUser, savePilot } from "./pilotStore.js";

export function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function safeEqualHex(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Checkout signature: HMAC over "order_id|payment_id" with the key
// secret. Unchanged from the pilot.
export function verifyCheckoutSignature(orderId, paymentId, signature) {
  const expected = hmacHex(config.razorpayKeySecret || "", orderId + "|" + paymentId);
  return safeEqualHex(expected, signature);
}

// Webhook signature: HMAC over the RAW request body with the webhook
// secret, compared against the X-Razorpay-Signature header.
export function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpayWebhookSecret) return false;
  const expected = hmacHex(config.razorpayWebhookSecret, rawBody);
  return safeEqualHex(expected, signature);
}

export async function createRazorpayOrder(packId) {
  const pack = PACKS[packId];
  if (!pack) return null;
  const r = await fetch(config.razorpayBase + "/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic " +
        Buffer.from(config.razorpayKeyId + ":" + config.razorpayKeySecret).toString("base64"),
    },
    body: JSON.stringify({ amount: pack.amount, currency: "INR" }),
    signal: AbortSignal.timeout(15000),
  });
  const order = await r.json().catch(() => ({}));
  if (!r.ok) return null;
  return order;
}

// Extract the payment entity from a Razorpay webhook payload. Returns
// null for payloads without a payment entity.
export function webhookPaymentEntity(payload) {
  const entity =
    payload &&
    payload.payload &&
    payload.payload.payment &&
    payload.payload.payment.entity;
  if (!entity || typeof entity !== "object") return null;
  return entity;
}

// Activate a captured payment in configured mode. Idempotent: if a
// payments row already exists for this payment id with an activated
// status, nothing is credited again. Returns {activated, reason}.
export async function activatePaymentConfigured(entity) {
  const paymentId = entity.id;
  const existing = await findRows("payments", { razorpay_payment_id: paymentId }, { limit: 1 });
  if (existing.length && ["verified", "activated", "captured"].includes(existing[0].status)) {
    return { activated: false, reason: "duplicate" };
  }
  const notes = entity.notes || {};
  const orderId = entity.order_id || null;
  // Find the owning user: prefer an existing payments row for the
  // order (created at order time), else the user id in the notes.
  let userId = typeof notes.user_id === "string" ? notes.user_id : null;
  let orderRow = null;
  if (orderId) {
    const orderRows = await findRows("payments", { razorpay_order_id: orderId }, { limit: 1 });
    if (orderRows.length) {
      orderRow = orderRows[0];
      userId = userId || orderRow.user_id;
    }
  }
  if (!userId) return { activated: false, reason: "unknown_user" };
  const packId = typeof notes.pack === "string" ? notes.pack : orderRow ? orderRow.pack : null;
  const planId = typeof notes.plan === "string" ? notes.plan : null;
  if (packId && PACKS[packId]) {
    await addCredits(userId, PACKS[packId].calls, "webhook:" + packId);
  } else if (planId && PLAN_IDS.includes(planId) && planId !== "free") {
    await activateSubscription(userId, planId, notes);
  } else if (orderRow && orderRow.pack && PACKS[orderRow.pack]) {
    await addCredits(userId, PACKS[orderRow.pack].calls, "webhook:" + orderRow.pack);
  } else {
    return { activated: false, reason: "unknown_product" };
  }
  const row = {
    user_id: userId,
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    amount: entity.amount ?? null,
    currency: entity.currency || "INR",
    pack: packId || (orderRow ? orderRow.pack : null),
    plan: planId || null,
    status: "activated",
  };
  if (orderRow && orderRow.id) {
    await updateOwned("payments", orderRow.id, userId, {
      razorpay_payment_id: paymentId,
      status: "activated",
      amount: row.amount,
    });
  } else {
    await insertRow("payments", row);
  }
  return { activated: true, reason: "ok" };
}

export async function activateSubscription(userId, planId, notes) {
  const months = Math.max(1, Math.min(12, Number(notes.period_months) || 1));
  const now = Date.now();
  const existing = await findRows(
    "subscriptions",
    { user_id: userId, status: "active" },
    { limit: 5 }
  );
  const samePlan = existing.find((s) => s.plan === planId);
  const base = samePlan && samePlan.expires_at && new Date(samePlan.expires_at).getTime() > now
    ? new Date(samePlan.expires_at).getTime()
    : now;
  const expiresAt = new Date(base + months * 30 * 24 * 60 * 60 * 1000).toISOString();
  if (samePlan) {
    await updateOwned("subscriptions", samePlan.id, userId, {
      expires_at: expiresAt,
      status: "active",
    });
    return { id: samePlan.id, expires_at: expiresAt, extended: true };
  }
  const row = await insertRow("subscriptions", {
    user_id: userId,
    plan: planId,
    status: "active",
    started_at: new Date(now).toISOString(),
    expires_at: expiresAt,
  });
  return { id: row && row.id, expires_at: expiresAt, extended: false };
}

// Pilot-mode webhook activation: credit packs only, through db.json.
// Idempotent via the __payments record and the paid[] list.
export function activatePaymentPilot(entity) {
  const d = loadPilot();
  const payments = d.__payments || (d.__payments = {});
  if (payments[entity.id]) return { activated: false, reason: "duplicate" };
  const notes = entity.notes || {};
  const order = entity.order_id ? (d.__orders || {})[entity.order_id] : null;
  const packId = typeof notes.pack === "string" ? notes.pack : order ? order.pack : null;
  const userId = typeof notes.user_id === "string" ? notes.user_id : order ? order.u : null;
  if (!packId || !PACKS[packId] || !userId) {
    payments[entity.id] = { status: "ignored", reason: "unknown_product" };
    savePilot(d);
    return { activated: false, reason: "unknown_product" };
  }
  const user = pilotUser(d, userId);
  if (!user.paid.includes(entity.id)) {
    user.paid.push(entity.id);
    user.credits += PACKS[packId].calls;
  }
  payments[entity.id] = { status: "activated", pack: packId, user: userId };
  savePilot(d);
  return { activated: true, reason: "ok" };
}
