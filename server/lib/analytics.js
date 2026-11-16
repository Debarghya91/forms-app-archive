// Analytics PII guard. Any event whose serialized content contains
// an email address, a phone number, or a GSTIN is dropped entirely:
// it is never stored and never forwarded. The endpoint still returns
// {ok: true} so a single bad event cannot break the batch.

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
// GSTIN: 2 digits, 5 letters, 4 digits, 1 letter, 1 alphanumeric, Z,
// 1 alphanumeric.
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/;
// Phone: +91 or 0 prefix with a 10-digit Indian mobile, or a bare
// 10-digit mobile starting 6-9, bounded so invoice numbers and
// amounts do not false-positive.
const PHONE_RE = /(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}\b/;

const SENSITIVE_KEYS = new Set([
  "email",
  "email_address",
  "phone",
  "phone_number",
  "mobile",
  "mobile_number",
  "gstin",
  "gst_number",
]);

function containsSensitiveKey(value, depth) {
  if (depth > 4 || value === null || typeof value !== "object") return false;
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(String(k).toLowerCase())) return true;
    if (containsSensitiveKey(v, depth + 1)) return true;
  }
  return false;
}

export function eventContainsPii(event) {
  if (!event || typeof event !== "object") return true;
  if (containsSensitiveKey(event.props || {}, 0)) return true;
  let serialized = "";
  try {
    serialized = JSON.stringify(event);
  } catch {
    return true;
  }
  return EMAIL_RE.test(serialized) || GSTIN_RE.test(serialized) || PHONE_RE.test(serialized);
}

// Split a batch into storable events and dropped ones.
export function filterAnalyticsEvents(events) {
  const kept = [];
  const dropped = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (eventContainsPii(event)) dropped.push(event);
    else kept.push(event);
  }
  return { kept, dropped };
}
