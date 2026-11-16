// NoticeMitra server 2.0: Groq + Gemini provider router, Supabase JWT
// verification, AI orchestration, tax packs, and Razorpay revenue.
//
// Modes: configured (SUPABASE_URL set: JWT auth required, Supabase
// REST data layer) and pilot (unset: IP/bearer identity, db.json, and
// DB-backed endpoints return 503). See README-2.0.md.
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import path from "path";
import { APP_DIR, config, isConfigured, PACKS, PROFILE_TYPES } from "./lib/config.js";
import { authenticate, requireConfigured } from "./lib/auth.js";
import { DbError, deleteOwned, findRows, getOwned, insertRow, insertRows, listOwned, updateOwned } from "./lib/db.js";
import { loadPilot, pilotUser, savePilot } from "./lib/pilotStore.js";
import { runAiChain } from "./lib/providers.js";
import { allowanceFor, creditsFor, findReferralByCode, resolveEntitlement, addCredits } from "./lib/entitlements.js";
import { buildOrchestratedCall } from "./lib/orchestrator.js";
import { buildNoticeMessages, parseNoticeResponse } from "./lib/notice.js";
import { searchRag } from "./lib/rag.js";
import { compareRegimes, computeGst, getPack, recommendItrForm } from "./lib/tax.js";
import { buildComplianceTasks, findDueDateEntry, singleTask } from "./lib/compliance.js";
import { reconcilePurchases } from "./lib/reconcile.js";
import { categorizeBatch } from "./lib/expensesImport.js";
import { filterAnalyticsEvents } from "./lib/analytics.js";
import {
  activatePaymentConfigured,
  activatePaymentPilot,
  createRazorpayOrder,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  webhookPaymentEntity,
} from "./lib/payments.js";
import { asNumber, asString, isPlainObject, pickFields, validMessages } from "./lib/validation.js";

const app = express();
app.use(cors());
app.use(
  express.json({
    limit: "15mb",
    // Keep the raw body for the Razorpay webhook HMAC check.
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(rateLimit({ windowMs: config.rateLimitWindowMs, limit: config.rateLimitMax }));

const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const AI_402 = "Free limit reached. Please buy a pack.";

app.get("/health", (q, s) => s.send("ok"));

// ---- Razorpay webhook: public, HMAC-protected, idempotent. ----
// Defined before the auth middleware so it never requires a JWT.
app.post(
  "/api/pay/webhook",
  wrap(async (req, res) => {
    if (!config.razorpayWebhookSecret) {
      return res.status(503).json({ error: "webhook_not_configured" });
    }
    const signature = req.get("x-razorpay-signature") || "";
    if (!req.rawBody || !verifyWebhookSignature(req.rawBody, signature)) {
      return res.status(400).json({ error: "invalid_signature" });
    }
    const body = req.body || {};
    if (body.event !== "payment.captured") return res.json({ ok: true });
    const entity = webhookPaymentEntity(body);
    if (!entity) return res.json({ ok: true });
    try {
      if (isConfigured()) await activatePaymentConfigured(entity);
      else activatePaymentPilot(entity);
    } catch (e) {
      console.error("webhook activation failed:", e.message);
      return res.status(502).json({ error: "activation_failed" });
    }
    return res.json({ ok: true });
  })
);

// All other /api/* routes require auth when configured; pilot mode
// falls back to IP/bearer identity (see lib/auth.js).
app.use("/api", authenticate);

// ---- Credits and AI (work in both modes) ----

app.get(
  "/api/credits",
  wrap(async (req, res) => {
    res.json(await creditsFor(req.auth));
  })
);

app.post(
  "/api/ai",
  wrap(async (req, res) => {
    const { messages, images = [], tier } = req.body || {};
    if (!validMessages(messages)) {
      return res.status(400).json({ error: "Bad request" });
    }
    const allowance = await allowanceFor(req.auth);
    if (!allowance.allowed) return res.status(402).json({ error: AI_402 });
    try {
      const { text } = await runAiChain(messages, images, tier);
      await allowance.charge(); // success only
      return res.json({ text });
    } catch {
      return res.status(502).json({ error: "AI error" });
    }
  })
);

// ---- Orchestrator: one provider call per question ----

app.post(
  "/api/orchestrate",
  wrap(async (req, res) => {
    const { messages, context, tier } = req.body || {};
    if (!validMessages(messages)) {
      return res.status(400).json({ error: "Bad request" });
    }
    const allowance = await allowanceFor(req.auth);
    if (!allowance.allowed) return res.status(402).json({ error: AI_402 });
    const { route, messages: callMessages, sources } = buildOrchestratedCall(messages, context);
    try {
      const { text } = await runAiChain(callMessages, [], tier);
      await allowance.charge(); // success only
      const out = { route, answer: text, sources, calls_used: 1 };
      if (route !== "direct") out.specialist = route;
      return res.json(out);
    } catch {
      return res.status(502).json({ error: "AI error" });
    }
  })
);

// ---- Notice analysis ----

app.post(
  "/api/notice/analyze",
  wrap(async (req, res) => {
    const { brief, images = [], due_date, amount } = req.body || {};
    const hasImages = Array.isArray(images) && images.length > 0;
    if ((typeof brief !== "string" || !brief.trim()) && !hasImages) {
      return res.status(400).json({ error: "Bad request" });
    }
    const allowance = await allowanceFor(req.auth);
    if (!allowance.allowed) return res.status(402).json({ error: AI_402 });
    const callMessages = buildNoticeMessages({ brief, dueDate: due_date, amount });
    try {
      const { text } = await runAiChain(callMessages, images);
      await allowance.charge(); // success only
      return res.json(parseNoticeResponse(text, { hasImages, dueDate: due_date, amount }));
    } catch {
      return res.status(502).json({ error: "AI error" });
    }
  })
);

// ---- Tax packs and calculators (work in both modes) ----

app.get("/api/tax/rules/:ay", (req, res) => {
  const pack = getPack(req.params.ay);
  if (!pack) return res.status(404).json({ error: "pack_not_found" });
  return res.json(pack);
});

app.post("/api/tax/regime", (req, res) => {
  const { ay, income, deductions, salaried } = req.body || {};
  const incomeNum = asNumber(income);
  if (incomeNum === null || incomeNum < 0) {
    return res.status(400).json({ error: "Bad request" });
  }
  const result = compareRegimes({
    ay: ay || "2026-27",
    income: incomeNum,
    deductions: isPlainObject(deductions) ? deductions : {},
    salaried: salaried === true,
  });
  if (!result) return res.status(404).json({ error: "pack_not_found" });
  return res.json(result);
});

app.post("/api/tax/itr-form", (req, res) => {
  const answers = (req.body && req.body.answers) || req.body || {};
  return res.json(recommendItrForm(answers));
});

app.post("/api/tax/gst", (req, res) => {
  const { taxable, rate, interstate } = req.body || {};
  const taxableNum = asNumber(taxable);
  const rateNum = asNumber(rate);
  if (taxableNum === null || taxableNum < 0 || rateNum === null || rateNum < 0) {
    return res.status(400).json({ error: "Bad request" });
  }
  const allowLegacy = req.body.allow_legacy === true || req.body.legacy === true;
  try {
    return res.json(computeGst({ taxable: taxableNum, rate: rateNum, interstate: interstate === true, allowLegacy }));
  } catch (e) {
    if (e.code === "legacy_rate") {
      return res.status(400).json({
        error: "legacy_rate_requires_confirmation",
        hint: "12% and 28% are legacy rates withdrawn for most supplies from 22 September 2025. Pass allow_legacy: true only for invoices dated before that date.",
      });
    }
    return res.status(400).json({ error: "unknown_rate" });
  }
});

// ---- RAG search (work in both modes) ----

app.get("/api/rag/search", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  return res.json({ results: searchRag(q) });
});

// ---- Payments: order and verify (work in both modes) ----

app.post(
  "/api/pay/order",
  wrap(async (req, res) => {
    const packId = req.body && req.body.pack;
    const pack = PACKS[packId];
    if (!pack) return res.status(400).json({ error: "Bad pack" });
    const order = await createRazorpayOrder(packId);
    if (!order || !order.id) return res.status(502).json({ error: "Order failed" });
    if (req.auth.mode === "pilot") {
      const d = loadPilot();
      (d.__orders || (d.__orders = {}))[order.id] = { pack: packId, u: req.auth.userId };
      savePilot(d);
    } else {
      try {
        await insertRow("payments", {
          user_id: req.auth.userId,
          razorpay_order_id: order.id,
          pack: packId,
          amount: order.amount,
          currency: order.currency || "INR",
          status: "created",
        });
      } catch (e) {
        console.error("order record failed:", e.message);
        return res.status(502).json({ error: "Order failed" });
      }
    }
    return res.json({ order_id: order.id, amount: order.amount, key: config.razorpayKeyId });
  })
);

app.post(
  "/api/pay/verify",
  wrap(async (req, res) => {
    const { order_id, payment_id, signature } = req.body || {};
    if (!order_id || !payment_id || !signature) {
      return res.status(400).json({ error: "Invalid payment" });
    }
    if (req.auth.mode === "pilot") {
      const d = loadPilot();
      const o = (d.__orders || {})[order_id];
      if (!o || o.u !== req.auth.userId || !verifyCheckoutSignature(order_id, payment_id, signature)) {
        return res.status(400).json({ error: "Invalid payment" });
      }
      const x = pilotUser(d, o.u);
      if (!x.paid.includes(payment_id)) {
        x.paid.push(payment_id);
        x.credits += PACKS[o.pack].calls;
        savePilot(d);
      }
      return res.json({ credits: x.credits });
    }
    const rows = await findRows("payments", { razorpay_order_id: order_id }, { limit: 1 });
    const orderRow = rows[0];
    if (
      !orderRow ||
      orderRow.user_id !== req.auth.userId ||
      !PACKS[orderRow.pack] ||
      !verifyCheckoutSignature(order_id, payment_id, signature)
    ) {
      return res.status(400).json({ error: "Invalid payment" });
    }
    if (orderRow.razorpay_payment_id === payment_id && ["verified", "activated"].includes(orderRow.status)) {
      const snapshot = await resolveEntitlement(req.auth.userId);
      return res.json({ credits: snapshot.credits });
    }
    const credits = await addCredits(req.auth.userId, PACKS[orderRow.pack].calls, "verify:" + orderRow.pack);
    await updateOwned("payments", orderRow.id, req.auth.userId, {
      razorpay_payment_id: payment_id,
      status: "verified",
    });
    return res.json({ credits });
  })
);

// ---- DB-backed endpoints: 503 in pilot mode ----

const dbOnly = [requireConfigured];

// Cases
app.get(
  "/api/cases",
  dbOnly,
  wrap(async (req, res) => {
    res.json({ cases: await listOwned("cases", req.auth.userId) });
  })
);

const CASE_FIELDS = ["title", "notice_type", "authority", "period", "deadline", "status", "notes", "amount", "details"];

function caseRowFrom(body, userId) {
  const src = isPlainObject(body.case) ? body.case : body || {};
  const row = pickFields(src, CASE_FIELDS);
  if (typeof row.title !== "string" || !row.title.trim()) row.title = "Untitled case";
  if (typeof row.status !== "string" || !row.status.trim()) row.status = "open";
  row.user_id = userId;
  return row;
}

app.post(
  "/api/cases",
  dbOnly,
  wrap(async (req, res) => {
    const row = await insertRow("cases", caseRowFrom(req.body, req.auth.userId));
    res.json({ id: row.id });
  })
);

app.get(
  "/api/cases/:id",
  dbOnly,
  wrap(async (req, res) => {
    const row = await getOwned("cases", req.params.id, req.auth.userId);
    if (!row) return res.status(404).json({ error: "not_found" });
    return res.json(row);
  })
);

app.patch(
  "/api/cases/:id",
  dbOnly,
  wrap(async (req, res) => {
    const patch = pickFields(req.body || {}, CASE_FIELDS);
    const row = await updateOwned("cases", req.params.id, req.auth.userId, patch);
    if (!row) return res.status(404).json({ error: "not_found" });
    return res.json(row);
  })
);

app.delete(
  "/api/cases/:id",
  dbOnly,
  wrap(async (req, res) => {
    const ok = await deleteOwned("cases", req.params.id, req.auth.userId);
    if (!ok) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true });
  })
);

app.post(
  "/api/cases/migrate",
  dbOnly,
  wrap(async (req, res) => {
    const incoming = Array.isArray(req.body && req.body.cases) ? req.body.cases.slice(0, 50) : [];
    if (!incoming.length) return res.json({ migrated: 0 });
    const rows = incoming.map((c) => caseRowFrom({ case: c }, req.auth.userId));
    const inserted = await insertRows("cases", rows);
    return res.json({ migrated: inserted.length });
  })
);

// Documents (metadata only; uploads use Supabase Storage signed URLs)
app.get(
  "/api/documents",
  dbOnly,
  wrap(async (req, res) => {
    res.json({ documents: await listOwned("documents", req.auth.userId) });
  })
);

app.post(
  "/api/documents",
  dbOnly,
  wrap(async (req, res) => {
    const name = asString(req.body && req.body.name, 500);
    const storagePath = asString(req.body && req.body.storage_path, 1000);
    if (!name || !storagePath) return res.status(400).json({ error: "Bad request" });
    const row = await insertRow("documents", {
      user_id: req.auth.userId,
      name,
      kind: asString(req.body.kind, 100) || "other",
      storage_path: storagePath,
    });
    return res.json({ id: row.id });
  })
);

app.delete(
  "/api/documents/:id",
  dbOnly,
  wrap(async (req, res) => {
    const ok = await deleteOwned("documents", req.params.id, req.auth.userId);
    if (!ok) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true });
  })
);

// Compliance calendar
app.get(
  "/api/compliance",
  dbOnly,
  wrap(async (req, res) => {
    const profileType = typeof req.query.profile === "string" ? req.query.profile : "individual";
    if (!PROFILE_TYPES.includes(profileType)) {
      return res.status(400).json({ error: "unknown_profile" });
    }
    let storedByKey = {};
    try {
      const stored = await listOwned("compliance_tasks", req.auth.userId, { limit: 200 });
      for (const row of stored) {
        if (row.task_key) storedByKey[row.task_key] = { status: row.status, note: row.note };
      }
    } catch (e) {
      console.error("compliance tasks read failed:", e.message);
    }
    return res.json({ tasks: buildComplianceTasks(profileType, storedByKey) });
  })
);

// Mark a compliance task done or pending, with an optional note.
// :id is the task key from GET /api/compliance (for example "gstr3b").
// State is stored per user in compliance_tasks and owner-checked.
app.patch(
  "/api/compliance/tasks/:id",
  dbOnly,
  wrap(async (req, res) => {
    const entry = findDueDateEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: "not_found" });
    const body = req.body || {};
    const existing = await listOwned("compliance_tasks", req.auth.userId, {
      limit: 1,
      filters: { task_key: req.params.id },
    });
    const current = existing[0];
    const status =
      body.done === true ? "done" : body.done === false ? "pending" : (current && current.status) || "pending";
    const note =
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim().slice(0, 2000)
        : (current && current.note) || null;
    const task = singleTask(entry.key, { status, note });
    if (current) {
      await updateOwned("compliance_tasks", current.id, req.auth.userId, {
        status,
        note,
        title: entry.label,
        category: entry.category,
        due: task.due,
      });
    } else {
      await insertRow("compliance_tasks", {
        user_id: req.auth.userId,
        task_key: entry.key,
        title: entry.label,
        due: task.due,
        category: entry.category,
        status,
        note,
      });
    }
    return res.json({ task });
  })
);

// Profile and businesses
app.get(
  "/api/profile",
  dbOnly,
  wrap(async (req, res) => {
    const profiles = await listOwned("profiles", req.auth.userId, { limit: 1 });
    const businesses = await listOwned("businesses", req.auth.userId);
    return res.json({ profile: profiles[0] || null, businesses });
  })
);

const PROFILE_FIELDS = ["full_name", "phone", "pan", "gstin", "address", "city", "state", "pincode", "profile_type"];

app.put(
  "/api/profile",
  dbOnly,
  wrap(async (req, res) => {
    const body = req.body || {};
    const patch = pickFields(body, PROFILE_FIELDS);
    if (body.email && typeof body.email === "string") patch.email = body.email.slice(0, 320);
    const existing = await listOwned("profiles", req.auth.userId, { limit: 1 });
    if (existing.length) {
      await updateOwned("profiles", existing[0].id, req.auth.userId, patch);
    } else {
      await insertRow("profiles", { user_id: req.auth.userId, ...patch });
    }
    if (Array.isArray(body.businesses)) {
      for (const b of body.businesses.slice(0, 20)) {
        if (!isPlainObject(b)) continue;
        const business = pickFields(b, ["name", "gstin", "pan", "address", "business_type"]);
        if (b.id) {
          await updateOwned("businesses", b.id, req.auth.userId, business);
        } else if (business.name) {
          await insertRow("businesses", { user_id: req.auth.userId, ...business });
        }
      }
    }
    const profiles = await listOwned("profiles", req.auth.userId, { limit: 1 });
    const businesses = await listOwned("businesses", req.auth.userId);
    return res.json({ profile: profiles[0] || null, businesses });
  })
);

// Generic owner-scoped collections: list, create, get, patch, delete.
function registerCollection(pathPrefix, table, listKey, fields) {
  app.get(
    pathPrefix,
    dbOnly,
    wrap(async (req, res) => {
      res.json({ [listKey]: await listOwned(table, req.auth.userId) });
    })
  );
  app.post(
    pathPrefix,
    dbOnly,
    wrap(async (req, res) => {
      // Re-POST with an owned id updates instead of inserting, so a
      // client edit that re-sends a record cannot duplicate it
      // server-side. An id owned by nobody (or by another user)
      // falls through to a fresh insert under this user.
      const body = req.body || {};
      const id = typeof body.id === "string" && body.id ? body.id : null;
      if (id && (await getOwned(table, id, req.auth.userId))) {
        const row = await updateOwned(table, id, req.auth.userId, pickFields(body, fields));
        return res.json({ id: row.id });
      }
      const row = await insertRow(table, { user_id: req.auth.userId, ...pickFields(body, fields) });
      res.json({ id: row.id });
    })
  );
  app.get(
    pathPrefix + "/:id",
    dbOnly,
    wrap(async (req, res) => {
      const row = await getOwned(table, req.params.id, req.auth.userId);
      if (!row) return res.status(404).json({ error: "not_found" });
      return res.json(row);
    })
  );
  app.patch(
    pathPrefix + "/:id",
    dbOnly,
    wrap(async (req, res) => {
      const row = await updateOwned(table, req.params.id, req.auth.userId, pickFields(req.body || {}, fields));
      if (!row) return res.status(404).json({ error: "not_found" });
      return res.json(row);
    })
  );
  app.delete(
    pathPrefix + "/:id",
    dbOnly,
    wrap(async (req, res) => {
      const ok = await deleteOwned(table, req.params.id, req.auth.userId);
      if (!ok) return res.status(404).json({ error: "not_found" });
      return res.json({ ok: true });
    })
  );
}

registerCollection("/api/registers/sales", "sales_register", "sales", [
  "date", "invoice_no", "buyer", "gstin", "taxable", "rate", "cgst", "sgst", "igst", "total", "month",
]);
registerCollection("/api/registers/purchases", "purchase_register", "purchases", [
  "date", "invoice_no", "vendor", "gstin", "taxable", "tax", "cgst", "sgst", "igst", "itc_eligible", "month",
]);
registerCollection("/api/expenses", "expenses", "expenses", [
  "date", "vendor", "category", "amount", "gst", "description", "month", "review_status",
]);
registerCollection("/api/notes", "credit_debit_notes", "notes", [
  "type", "date", "number", "party", "gstin", "amount", "tax", "reason", "against_invoice", "month",
]);

// Invoices, with line items stored in invoice_items.
const INVOICE_FIELDS = ["number", "date", "buyer_name", "buyer_gstin", "taxable", "rate", "cgst", "sgst", "igst", "total", "month", "status", "notes"];
const INVOICE_ITEM_FIELDS = ["description", "hsn", "qty", "price", "taxable", "rate", "tax"];

app.get(
  "/api/invoices",
  dbOnly,
  wrap(async (req, res) => {
    res.json({ invoices: await listOwned("invoices", req.auth.userId) });
  })
);

app.post(
  "/api/invoices",
  dbOnly,
  wrap(async (req, res) => {
    const src = isPlainObject(req.body && req.body.invoice) ? req.body.invoice : req.body || {};
    const row = await insertRow("invoices", { user_id: req.auth.userId, ...pickFields(src, INVOICE_FIELDS) });
    const items = Array.isArray(src.items) ? src.items.slice(0, 100) : [];
    if (items.length) {
      await insertRows(
        "invoice_items",
        items.map((it) => ({ invoice_id: row.id, ...pickFields(it, INVOICE_ITEM_FIELDS) }))
      );
    }
    return res.json({ id: row.id });
  })
);

app.get(
  "/api/invoices/:id",
  dbOnly,
  wrap(async (req, res) => {
    const row = await getOwned("invoices", req.params.id, req.auth.userId);
    if (!row) return res.status(404).json({ error: "not_found" });
    const items = await findRows("invoice_items", { invoice_id: row.id }, { limit: 100 });
    return res.json({ ...row, items });
  })
);

// Reconciliation (2B-style, user-entered figures only)
app.post(
  "/api/reconcile",
  dbOnly,
  wrap(async (req, res) => {
    const month = asString(req.body && req.body.month, 7);
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "Bad request" });
    }
    const figures = Array.isArray(req.body.gstr2b)
      ? req.body.gstr2b
      : Array.isArray(req.body.figures)
        ? req.body.figures
        : [];
    const register = await listOwned("purchase_register", req.auth.userId, {
      limit: 200,
      filters: { month },
    });
    const result = reconcilePurchases(register, figures);
    try {
      await insertRow("reconciliations", {
        user_id: req.auth.userId,
        month,
        summary: result.summary,
      });
    } catch (e) {
      console.error("reconciliation record failed:", e.message);
    }
    return res.json(result);
  })
);

// Expense import (rule-based categorisation, duplicates flagged)
app.post(
  "/api/expenses/import",
  dbOnly,
  wrap(async (req, res) => {
    const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows.slice(0, 500) : [];
    const existing = await listOwned("expenses", req.auth.userId, { limit: 200 });
    const existingKeys = new Set(
      existing.map((r) => {
        const date = String(r.date || "").slice(0, 10);
        return date + "|" + String(r.vendor || "").trim().toLowerCase() + "|" + (Number(r.amount) || 0).toFixed(2);
      })
    );
    const { categorized, duplicates_flagged } = categorizeBatch(rows, existingKeys);
    const toInsert = categorized
      .filter((c) => !c.duplicate)
      .map((c) => ({
        user_id: req.auth.userId,
        date: c.date,
        vendor: c.vendor,
        amount: c.amount,
        description: c.description,
        category: c.category,
        review_status: c.review_status,
      }));
    if (toInsert.length) await insertRows("expenses", toInsert);
    return res.json({ imported: toInsert.length, duplicates_flagged, categorized });
  })
);

// Subscription
app.get(
  "/api/subscription",
  dbOnly,
  wrap(async (req, res) => {
    const snapshot = await resolveEntitlement(req.auth.userId);
    const sub = snapshot.subscription;
    const expired = sub && sub.expires_at && new Date(sub.expires_at).getTime() <= Date.now();
    return res.json({
      plan: expired ? "free" : snapshot.plan,
      status: !sub ? "active" : expired ? "expired" : sub.status,
      expires_at: sub ? sub.expires_at : null,
      credits: snapshot.credits,
    });
  })
);

app.post(
  "/api/subscription/cancel",
  dbOnly,
  wrap(async (req, res) => {
    const subs = await listOwned("subscriptions", req.auth.userId, {
      limit: 5,
      filters: { status: "active" },
    });
    if (!subs.length) return res.json({ status: "none" });
    for (const sub of subs) {
      await updateOwned("subscriptions", sub.id, req.auth.userId, { status: "cancelled" });
    }
    return res.json({ status: "cancelled" });
  })
);

// Referral
app.get(
  "/api/referral",
  dbOnly,
  wrap(async (req, res) => {
    let rows = await listOwned("referrals", req.auth.userId, { limit: 1 });
    if (!rows.length) {
      const code = "NM-" + crypto.createHash("sha256").update(req.auth.userId).digest("hex").slice(0, 8).toUpperCase();
      const created = await insertRow("referrals", { user_id: req.auth.userId, code });
      rows = [created];
    }
    const uses = await findRows("referral_uses", { referrer_id: req.auth.userId }, { limit: 200 });
    const earned = uses.reduce((sum, u) => sum + (Number(u.credits_earned) || 0), 0);
    return res.json({ code: rows[0].code, count: uses.length, earned });
  })
);

app.post(
  "/api/referral/redeem",
  dbOnly,
  wrap(async (req, res) => {
    const code = asString(req.body && req.body.code, 32);
    if (!code) return res.status(400).json({ error: "Bad request" });
    const referral = await findReferralByCode(code);
    if (!referral) return res.status(400).json({ error: "invalid_code" });
    if (referral.user_id === req.auth.userId) return res.status(400).json({ error: "own_code" });
    const mine = await findRows("referral_uses", { user_id: req.auth.userId }, { limit: 1 });
    if (mine.length) return res.status(400).json({ error: "already_redeemed" });
    // Referral reward amounts are not decided yet: the use is recorded
    // and nothing is credited until the owner sets the amounts.
    await insertRow("referral_uses", {
      referrer_id: referral.user_id,
      user_id: req.auth.userId,
      code,
      credits_earned: 0,
    });
    return res.json({ ok: true, credited: 0 });
  })
);

// Analytics (PII events dropped before storage)
app.post(
  "/api/analytics/events",
  dbOnly,
  wrap(async (req, res) => {
    const events = Array.isArray(req.body && req.body.events) ? req.body.events.slice(0, 100) : [];
    const { kept } = filterAnalyticsEvents(events);
    if (kept.length) {
      await insertRows(
        "analytics_events",
        kept.map((e) => ({
          user_id: req.auth.userId,
          name: String(e.name || "unknown").slice(0, 200),
          ts: e.ts || new Date().toISOString(),
          props: e.props || {},
        }))
      );
    }
    return res.json({ ok: true });
  })
);

app.use(express.static(path.join(APP_DIR, "../web")));

// Errors: {error} only, no stack traces. Database faults surface as
// 503 backend_not_configured or a generic 502.
app.use((err, _req, res, _next) => {
  console.error("request failed:", err && err.message);
  if (err instanceof DbError) {
    if (err.status === 503) return res.status(503).json({ error: "backend_not_configured" });
    return res.status(502).json({ error: "database_error" });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Bad request" });
  }
  return res.status(500).json({ error: "server_error" });
});

app.listen(config.port, () => console.log("NoticeMitra server running"));
