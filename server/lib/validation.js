// Small request validation helpers. The server never trusts
// client-supplied user ids: every write and read is scoped to the
// authenticated user id set by the auth middleware.
export function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function asString(v, maxLen) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, maxLen || 2000);
}

export function asNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function asStringArray(v, maxItems) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => x.trim().slice(0, 2000))
    .slice(0, maxItems || 50);
}

// Every chat message must be an object with string content. Rejects
// null, strings, numbers, and objects without content, so a malformed
// body gets a 400 instead of reaching the provider chain.
export function validMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return false;
  return messages.every((m) => isPlainObject(m) && typeof m.content === "string");
}

// Copy only whitelisted fields from a client body. Unknown fields are
// dropped, and user_id / id can never be set this way.
export function pickFields(body, allowed) {
  const out = {};
  if (!isPlainObject(body)) return out;
  for (const key of allowed) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

export function errorBody(message) {
  return { error: message };
}
