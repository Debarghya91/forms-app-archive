// Unit tests: orchestrator routing, no-invention prompts, notice
// parsing, RAG citations, compliance dates, reconciliation, expense
// import rules, and the analytics PII guard. No server boot, no keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrchestratedCall, routeQuestion, systemPromptFor } from "../lib/orchestrator.js";
import { NOTICE_SYSTEM_PROMPT, parseNoticeResponse } from "../lib/notice.js";
import { citationsFor, searchRag } from "../lib/rag.js";
import { buildComplianceTasks, nextDue, findDueDateEntry } from "../lib/compliance.js";
import { reconcilePurchases } from "../lib/reconcile.js";
import { categorizeBatch, categorizeExpense } from "../lib/expensesImport.js";
import { eventContainsPii, filterAnalyticsEvents } from "../lib/analytics.js";

test("routing: specialists win over direct, notice wins over gst", () => {
  assert.equal(routeQuestion("when is gstr-3b due"), "gst");
  assert.equal(routeQuestion("I got a notice about my GST return"), "notice");
  assert.equal(routeQuestion("what is the 80c limit"), "income_tax");
  assert.equal(routeQuestion("how do I file my tds return"), "tds");
  assert.equal(routeQuestion("pf deposit date for my staff"), "payroll");
  assert.equal(routeQuestion("what is the due date for filing"), "compliance");
  assert.equal(routeQuestion("help me reconcile my purchase register"), "accounting");
  assert.equal(routeQuestion("give me a sales summary for this quarter"), "insights");
  assert.equal(routeQuestion("hello, what can you do"), "direct");
});

test("routing: short keywords match whole words only", () => {
  // "helpful" contains "pf" as a substring but must not route payroll.
  assert.equal(routeQuestion("give me a helpful summary"), "direct");
  assert.equal(routeQuestion("my pf account"), "payroll");
});

test("routing: every route has a no-invention system prompt", () => {
  for (const route of ["direct", "gst", "income_tax", "tds", "accounting", "compliance", "payroll", "notice", "insights"]) {
    const prompt = systemPromptFor(route);
    assert.ok(prompt.includes("Do not invent"), route + " prompt must forbid invention");
    assert.ok(prompt.includes("sections"), route);
    assert.ok(prompt.includes("deadlines"), route);
    assert.ok(prompt.includes("penalties"), route);
    assert.ok(prompt.includes("amounts"), route);
  }
});

test("orchestrated call: simple question stays direct with one message set", () => {
  const { route, messages, sources } = buildOrchestratedCall(
    [{ role: "user", content: "hello, what can you do" }],
    null
  );
  assert.equal(route, "direct");
  assert.ok(Array.isArray(sources));
  assert.ok(messages.length >= 2);
  assert.ok(messages[0].content.includes("Meera"));
});

test("notice prompt forbids inventing sections, deadlines, penalties, amounts", () => {
  assert.ok(NOTICE_SYSTEM_PROMPT.includes("Do not invent sections"));
  assert.ok(NOTICE_SYSTEM_PROMPT.includes("deadlines"));
  assert.ok(NOTICE_SYSTEM_PROMPT.includes("penalties"));
  assert.ok(NOTICE_SYSTEM_PROMPT.includes("amounts"));
  assert.ok(NOTICE_SYSTEM_PROMPT.includes("needs_verification"));
});

test("notice parse: valid JSON normalizes to the contract shape", () => {
  const text = JSON.stringify({
    extracted: [
      { fact: "Notice under section 148", source: "document", confidence: "high" },
      { fact: "Period 2023-24", source: "document", confidence: 0.9 },
      "A bare string fact",
    ],
    interpretation: ["The department wants the return re-examined."],
    needs_verification: ["Check the deadline on the portal."],
    draft_reply: "Dear Sir, ...",
    checklist: ["Gather bank statements."],
    risks: ["Penalty if ignored."],
    ca_brief: "Section 148 notice for 2023-24.",
    notice_type: "Section 148",
    authority: "Income Tax Department",
    period: "2023-24",
    deadline: "2026-12-31",
  });
  const out = parseNoticeResponse(text, { hasImages: true });
  assert.equal(out.extracted.length, 3);
  assert.equal(out.extracted[0].source, "document");
  assert.equal(out.extracted[0].confidence, "high");
  assert.equal(out.extracted[1].confidence, "high", "0.9 maps to high");
  assert.equal(out.extracted[2].source, "document", "bare strings take the default source");
  assert.equal(out.extracted[2].confidence, "low");
  assert.equal(out.notice_type, "Section 148");
  assert.equal(out.deadline, "2026-12-31");
  assert.ok(out.draft_reply.length > 0);
  assert.ok(out.ca_brief.length > 0);
});

test("notice parse: malformed output falls back honestly, user facts are added", () => {
  const out = parseNoticeResponse("not json at all", {
    hasImages: false,
    dueDate: "2026-12-15",
    amount: "50000",
  });
  assert.equal(out.draft_reply, "not json at all");
  assert.ok(out.needs_verification.length > 0);
  const facts = out.extracted.map((f) => f.fact);
  assert.ok(facts.some((f) => f.includes("2026-12-15")));
  assert.ok(facts.some((f) => f.includes("50000")));
  assert.ok(out.extracted.every((f) => f.source === "user"));
  assert.ok(out.extracted.every((f) => f.confidence === "high"));
});

test("notice parse: empty verification list gets a default verify item", () => {
  const out = parseNoticeResponse(
    JSON.stringify({ extracted: [], interpretation: [], needs_verification: [], draft_reply: "x", checklist: [], risks: [], ca_brief: "y" }),
    {}
  );
  assert.equal(out.needs_verification.length, 1);
  assert.ok(out.needs_verification[0].includes("Verify"));
});

test("RAG: keyword search returns citations with publisher and date", () => {
  const results = searchRag("gstr-3b due date");
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.ok(typeof r.title === "string" && r.title);
    assert.ok(typeof r.source === "string" && r.source);
    assert.ok(typeof r.date === "string" && r.date);
    assert.ok(typeof r.excerpt === "string" && r.excerpt);
  }
  const cites = citationsFor("income tax slabs rebate");
  assert.ok(cites.length > 0);
  assert.ok(cites[0].publisher);
  assert.ok(cites[0].date);
});

test("RAG: unknown queries return nothing, never invented", () => {
  assert.deepEqual(searchRag("xyzzyqq plugh"), []);
  assert.deepEqual(searchRag(""), []);
});

test("compliance: next due dates from the pack rules", () => {
  const from = new Date("2026-11-16T00:00:00Z");
  const gstr3b = findDueDateEntry("gstr3b");
  assert.equal(nextDue(gstr3b, from).toISOString().slice(0, 10), "2026-11-20");
  const gstr1 = findDueDateEntry("gstr1");
  assert.equal(nextDue(gstr1, from).toISOString().slice(0, 10), "2026-12-11");
  const adv1 = findDueDateEntry("advance_tax_1");
  assert.equal(nextDue(adv1, from).toISOString().slice(0, 10), "2027-06-15");
  const tds = findDueDateEntry("tds_return");
  assert.equal(nextDue(tds, from).toISOString().slice(0, 10), "2027-01-31");
  assert.equal(findDueDateEntry("no_such_key"), null);
});

test("compliance: profile filtering and stored status override", () => {
  const from = new Date("2026-11-16T00:00:00Z");
  const salaried = buildComplianceTasks("salaried", {}, from);
  assert.ok(salaried.length > 0);
  assert.ok(salaried.every((t) => t.key && t.title && t.due && t.category && t.status && t.source && t.note));
  assert.ok(!salaried.some((t) => t.key === "gstr3b"), "salaried profile has no GST tasks");
  const done = buildComplianceTasks("sole_proprietor", { gstr3b: { status: "done", note: "filed" } }, from);
  const task = done.find((t) => t.key === "gstr3b");
  assert.equal(task.status, "done");
  assert.equal(task.user_note, "filed");
});

test("reconcile: match, mismatch, and missing purchase", () => {
  const register = [
    { invoice_no: "INV-1", gstin: "27ABCDE1234F1Z5", vendor: "Vendor A", taxable: 10000, tax: 1800 },
    { invoice_no: "INV-2", gstin: "27ABCDE1234F1Z5", vendor: "Vendor A", taxable: 5000, tax: 900 },
  ];
  const figures = [
    { invoice_no: "INV-1", gstin: "27ABCDE1234F1Z5", taxable: 10000, tax: 1800 },
    { invoice_no: "INV-2", gstin: "27ABCDE1234F1Z5", taxable: 5000, tax: 950 },
    { invoice_no: "INV-3", gstin: "27XXXXX9999X1Z5", taxable: 2000, tax: 360 },
  ];
  const out = reconcilePurchases(register, figures);
  assert.equal(out.summary.matched, 1);
  assert.equal(out.summary.mismatched, 1);
  assert.equal(out.summary.missing, 1);
  assert.equal(out.mismatches[0].invoice_no, "INV-2");
  assert.equal(out.mismatches[0].difference_tax, 50);
  assert.equal(out.missing_purchases[0].invoice_no, "INV-3");
  assert.equal(out.vendor_breakdown.length, 1);
  assert.equal(out.vendor_breakdown[0].tax, 2700);
  assert.ok(out.note.includes("user-entered"));
});

test("expense import: rules categorize, uncertain stays unreviewed", () => {
  assert.equal(categorizeExpense({ vendor: "Indian Oil petrol pump", description: "" }), "fuel");
  assert.equal(categorizeExpense({ vendor: "IRCTC", description: "train ticket" }), "travel");
  assert.equal(categorizeExpense({ vendor: "Mystery Vendor XYZ", description: "" }), "unreviewed");
  const { categorized, duplicates_flagged } = categorizeBatch(
    [
      { date: "2026-11-01", vendor: "Vendor A", amount: 1000 },
      { date: "2026-11-01", vendor: "Vendor A", amount: 1000 },
      { date: "2026-11-02", vendor: "Vendor B", amount: 500 },
    ],
    new Set()
  );
  assert.equal(duplicates_flagged, 1);
  assert.equal(categorized[1].duplicate, true);
  assert.equal(categorized[2].duplicate, false);
  assert.equal(categorized[0].review_status, "unreviewed");
});

test("analytics: email, phone, and GSTIN events are dropped", () => {
  assert.equal(eventContainsPii({ name: "screen_view", props: { screen: "home" } }), false);
  assert.equal(eventContainsPii({ name: "x", props: { contact: "a@example.com" } }), true);
  assert.equal(eventContainsPii({ name: "x", props: { note: "call 9876543210" } }), true);
  assert.equal(eventContainsPii({ name: "x", props: { note: "GSTIN 27ABCDE1234F1Z5" } }), true);
  assert.equal(eventContainsPii({ name: "x", props: { email: "hidden" } }), true);
  assert.equal(eventContainsPii({ name: "x", props: { amount: 12345 } }), false);
  const { kept, dropped } = filterAnalyticsEvents([
    { name: "ok", props: {} },
    { name: "bad", props: { email: "a@example.com" } },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 1);
});
