// Orchestrator: keyword routing, then exactly ONE provider call.
// Routing uses keyword and small decision rules only; no extra AI
// call is spent deciding the route. Simple questions go direct with
// one call. Specialists are prompt personas selected by the router,
// not extra calls: every orchestrated answer costs one charged call
// on success, zero on failure (charge-on-success, enforced by the
// route layer, same as /api/ai).
import { citationsFor, ragContext } from "./rag.js";

export const ROUTES = [
  "direct",
  "gst",
  "income_tax",
  "tds",
  "accounting",
  "compliance",
  "payroll",
  "notice",
  "insights",
];

const NO_INVENTION =
  "Do not invent sections, deadlines, penalties, rates, or amounts. " +
  "Use only facts given by the user or in the reference material. " +
  "When you are unsure, say so plainly and tell the user to verify on " +
  "the official portal. Label any interpretation as interpretation, " +
  "and anything needing a check as needs verification.";

const SYSTEM_PROMPTS = {
  direct:
    "You are Meera, a helpful Indian tax and business assistant. Answer the question simply and directly. " +
    NO_INVENTION,
  gst:
    "You are Meera, a GST specialist for Indian small businesses. Explain GST returns, rates, ITC, and invoicing in plain language. " +
    NO_INVENTION,
  income_tax:
    "You are Meera, an income tax specialist for Indian individuals and small businesses. Explain regimes, deductions, and ITR forms in plain language. " +
    NO_INVENTION,
  tds:
    "You are Meera, a TDS specialist. Explain deduction, deposit, returns, and certificates in plain language. " +
    NO_INVENTION,
  accounting:
    "You are Meera, a bookkeeping specialist for Indian small businesses. Explain invoices, registers, expenses, and records in plain language. " +
    NO_INVENTION,
  compliance:
    "You are Meera, a compliance specialist. Explain due dates and filing duties in plain language, and always remind the user to verify the date on the official portal. " +
    NO_INVENTION,
  payroll:
    "You are Meera, a payroll specialist for Indian small businesses. Explain salary, PF, ESI, and professional tax in plain language. " +
    NO_INVENTION,
  notice:
    "You are Meera, a tax notice specialist. Help the user understand a notice calmly: what it asks, what to check, and what to do next. Never guess at a deadline or penalty. " +
    NO_INVENTION,
  insights:
    "You are Meera, a business insights assistant. Summarise patterns and next steps from the figures the user gives, in plain language. Do not invent figures the user did not give. " +
    NO_INVENTION,
};

const RULES = [
  { route: "notice", keywords: ["notice", "notices", "scrutiny", "demand order", "section 148", "section 143", "assessment order", "defective return", "show cause"] },
  { route: "gst", keywords: ["gst", "gstr", "gstr1", "gstr3b", "gstr9", "cgst", "sgst", "igst", "input tax credit", "itc", "place of supply", "hsn", "sac code", "e-invoice", "e-way bill", "composition scheme", "qrmp"] },
  { route: "income_tax", keywords: ["income tax", "itr", "80c", "80d", "regime", "slab", "slabs", "capital gains", "advance tax", "rebate", "standard deduction", "presumptive", "section 44ad", "hra"] },
  { route: "tds", keywords: ["tds", "tcs", "deducted at source", "form 26as", "form 16", "form 16a", "24q", "26q", "withholding"] },
  { route: "payroll", keywords: ["payroll", "salary", "pf", "provident fund", "esi", "professional tax", "bonus", "leave encashment", "gratuity"] },
  { route: "compliance", keywords: ["due date", "deadline", "deadlines", "late fee", "penalty", "penalties", "filing date", "compliance calendar", "when to file", "extension"] },
  { route: "accounting", keywords: ["invoice", "invoices", "register", "ledger", "expense", "expenses", "bookkeeping", "journal", "reconciliation", "2b", "credit note", "debit note", "balance sheet", "profit and loss"] },
  { route: "insights", keywords: ["insight", "trend", "summary of", "report", "how is my business", "sales summary", "compare months"] },
];

// Route from the last user message plus any context text. The first
// matching rule wins; notice beats gst, gst beats compliance, so a
// notice question is never answered as a generic due-date question.
// Single-word keywords match whole words only, so "pf" does not fire
// on "helpful". Phrases match as substrings.
export function routeQuestion(text) {
  const lower = String(text || "").toLowerCase();
  const words = new Set(lower.split(/[^a-z0-9]+/).filter(Boolean));
  for (const rule of RULES) {
    for (const keyword of rule.keywords) {
      if (keyword.includes(" ") || keyword.includes("-")) {
        if (lower.includes(keyword)) return rule.route;
      } else if (words.has(keyword)) {
        return rule.route;
      }
    }
  }
  return "direct";
}

export function systemPromptFor(route) {
  return SYSTEM_PROMPTS[route] || SYSTEM_PROMPTS.direct;
}

export function noInventionRule() {
  return NO_INVENTION;
}

// Build the single call: system prompt, optional context, RAG context,
// then the conversation. Returns {route, messages, sources}.
export function buildOrchestratedCall(messages, context) {
  const lastUser = [...messages].reverse().find((m) => m.role !== "assistant");
  const question = lastUser ? String(lastUser.content || "") : "";
  const contextText = context ? JSON.stringify(context).slice(0, 2000) : "";
  const route = routeQuestion(question + " " + contextText);
  const sources = citationsFor(question, 3);
  const contextBlock = ragContext(question, 3);
  const system = systemPromptFor(route);
  const userPrefix =
    (contextText ? "User context: " + contextText + "\n" : "") +
    (contextBlock ? contextBlock + "\n" : "");
  const callMessages = [{ role: "user", content: system }];
  if (userPrefix) callMessages.push({ role: "user", content: userPrefix });
  for (const m of messages) callMessages.push({ role: m.role, content: m.content });
  return { route, messages: callMessages, sources };
}
