// Notice analysis. The prompt forbids inventing sections, deadlines,
// penalties, or amounts, and requires every extracted fact to be
// traceable to the brief or the images. The parser normalizes any
// provider output into the contract shape; when the provider does not
// return clean JSON, the raw text is preserved as the draft reply and
// the shape is filled honestly instead of guessed.
export const NOTICE_SYSTEM_PROMPT =
  "You are Meera, a tax notice assistant. Analyse the notice described " +
  "in the brief and shown in any attached images. Do not invent sections, " +
  "deadlines, penalties, or amounts. Only use facts present in the brief " +
  "or visible in the images. Label every extracted fact with its source " +
  "(document or user) and a confidence of high, medium, or low. Put " +
  "anything uncertain in needs_verification. Never state a deadline, " +
  "section, penalty, or amount unless it appears in the input. " +
  "Respond with JSON only, using exactly these keys: extracted (array " +
  "of {fact, source, confidence}), interpretation (array of strings), " +
  "needs_verification (array of strings), draft_reply (string), " +
  "checklist (array of strings), risks (array of strings), ca_brief " +
  "(string), notice_type (string or null), authority (string or null), " +
  "period (string or null), deadline (string or null). The draft reply " +
  "must be a polite, factual draft the user can edit, with placeholders " +
  "in square brackets for anything unknown. The ca_brief must be a short " +
  "summary a chartered accountant can act on, listing only known facts.";

export function buildNoticeMessages({ brief, dueDate, amount }) {
  const userLines = ["Brief from the user:", String(brief || "")];
  if (dueDate) userLines.push("Due date given by the user: " + dueDate);
  if (amount !== undefined && amount !== null && amount !== "") {
    userLines.push("Amount given by the user: " + amount);
  }
  userLines.push("Return the JSON analysis described in the instructions.");
  return [
    { role: "user", content: NOTICE_SYSTEM_PROMPT },
    { role: "user", content: userLines.join("\n") },
  ];
}

function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => x.trim().slice(0, 2000));
}

function normalizeConfidence(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v >= 0.8 ? "high" : v >= 0.5 ? "medium" : "low";
  }
  const s = String(v || "").toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return "low";
}

function normalizeExtracted(v, defaultSource) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const item of v) {
    if (typeof item === "string" && item.trim()) {
      out.push({ fact: item.trim().slice(0, 1000), source: defaultSource, confidence: "low" });
    } else if (item && typeof item === "object" && typeof item.fact === "string" && item.fact.trim()) {
      out.push({
        fact: item.fact.trim().slice(0, 1000),
        source: item.source === "document" ? "document" : "user",
        confidence: normalizeConfidence(item.confidence),
      });
    }
  }
  return out;
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Normalize provider output into the contract shape. User-supplied
// due date and amount are added as user-sourced facts when the
// provider did not already include them, so the response always
// traces back to the input.
export function parseNoticeResponse(text, { hasImages, dueDate, amount } = {}) {
  const defaultSource = hasImages ? "document" : "user";
  const parsed = extractJson(String(text || ""));
  if (!parsed || typeof parsed !== "object") {
    const fallback = {
      extracted: [],
      interpretation: [],
      needs_verification: [
        "The analysis could not be structured. Verify the notice details against the original document before acting.",
      ],
      draft_reply: String(text || "").slice(0, 4000),
      checklist: [],
      risks: [],
      ca_brief: "Unstructured analysis output. See the draft reply text.",
    };
    addUserFacts(fallback, { dueDate, amount });
    return fallback;
  }
  const out = {
    extracted: normalizeExtracted(parsed.extracted, defaultSource),
    interpretation: asStringArray(parsed.interpretation),
    needs_verification: asStringArray(parsed.needs_verification),
    draft_reply: typeof parsed.draft_reply === "string" ? parsed.draft_reply.slice(0, 4000) : "",
    checklist: asStringArray(parsed.checklist),
    risks: asStringArray(parsed.risks),
    ca_brief: typeof parsed.ca_brief === "string" ? parsed.ca_brief.slice(0, 4000) : "",
  };
  for (const key of ["notice_type", "authority", "period", "deadline"]) {
    if (typeof parsed[key] === "string" && parsed[key].trim()) {
      out[key] = parsed[key].trim().slice(0, 500);
    }
  }
  if (!out.needs_verification.length) {
    out.needs_verification = [
      "Verify the deadline, section, and amount against the original notice or the official portal before acting.",
    ];
  }
  addUserFacts(out, { dueDate, amount });
  return out;
}

function addUserFacts(out, { dueDate, amount }) {
  const facts = out.extracted.map((f) => f.fact.toLowerCase());
  if (dueDate && !facts.some((f) => f.includes(String(dueDate).toLowerCase()))) {
    out.extracted.push({
      fact: "Due date given by the user: " + dueDate,
      source: "user",
      confidence: "high",
    });
  }
  if (amount !== undefined && amount !== null && amount !== "") {
    const amountText = String(amount);
    if (!facts.some((f) => f.includes(amountText.toLowerCase()))) {
      out.extracted.push({
        fact: "Amount given by the user: " + amountText,
        source: "user",
        confidence: "high",
      });
    }
  }
}
