// AI providers: Groq (text) plus Gemini (vision) ONLY, with
// cross-provider fallback. No other provider is called from anywhere
// in this server. Credit is charged only after a successful provider
// response, never before the call. Callers own charging; this module
// only runs the chain and reports success or failure.
import { config } from "./config.js";
import { isPlainObject } from "./validation.js";

export function normalizeMessages(messages, images) {
  const m = messages.map((x) => {
    if (!isPlainObject(x) || typeof x.content !== "string") {
      throw new Error("invalid message");
    }
    return {
      role: x.role === "assistant" ? "assistant" : "user",
      content: x.content.slice(0, 20000),
    };
  });
  const imgs = (Array.isArray(images) ? images : [])
    .slice(0, 5)
    .filter((i) => i && typeof i.data === "string" && i.data.length > 0)
    .map((i) => ({ media_type: i.media_type || "image/jpeg", data: i.data }));
  return { m, imgs };
}

async function callGroq(model, m, imgs) {
  const key = config.groqApiKey;
  if (!key) throw new Error("groq key missing");
  const messages = m.map((x, i) => {
    if (i === m.length - 1 && imgs.length) {
      return {
        role: x.role,
        content: [
          ...imgs.map((im) => ({
            type: "image_url",
            image_url: { url: "data:" + im.media_type + ";base64," + im.data },
          })),
          { type: "text", text: x.content },
        ],
      };
    }
    return { role: x.role, content: x.content };
  });
  const r = await fetch(config.groqBase + "/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: config.maxTokens }),
    signal: AbortSignal.timeout(config.aiTimeoutMs),
  });
  if (!r.ok) throw new Error("groq http " + r.status);
  const j = await r.json();
  const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (typeof text !== "string" || !text) throw new Error("groq empty response");
  return text;
}

async function callGemini(model, m, imgs) {
  const key = config.geminiApiKey;
  if (!key) throw new Error("gemini key missing");
  // Gemini roles are "user"/"model" and must alternate, starting with "user".
  const contents = [];
  for (const x of m) {
    const role = x.role === "assistant" ? "model" : "user";
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n\n" + x.content;
    else contents.push({ role, parts: [{ text: x.content }] });
  }
  if (!contents.length || contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "Continue." }] });
  }
  if (imgs.length) {
    const last = contents[contents.length - 1];
    last.parts = [
      ...imgs.map((im) => ({ inlineData: { mimeType: im.media_type, data: im.data } })),
      ...last.parts,
    ];
  }
  const r = await fetch(config.geminiBase + "/models/" + model + ":generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: config.maxTokens } }),
    signal: AbortSignal.timeout(config.aiTimeoutMs),
  });
  if (!r.ok) throw new Error("gemini http " + r.status);
  const j = await r.json();
  const parts =
    j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
  const text = Array.isArray(parts)
    ? parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("")
    : "";
  if (!text) throw new Error("gemini empty response");
  return text;
}

// Ordered attempts: primary provider models first, then the other
// provider. Tier "quick" tries the lighter model first. Duplicate
// provider+model pairs are dropped.
export function chain(hasImages, tier) {
  const quick = tier === "quick";
  const list = hasImages
    ? quick
      ? [["gemini", config.geminiFallback], ["gemini", config.geminiMain], ["groq", config.groqVision]]
      : [["gemini", config.geminiMain], ["gemini", config.geminiFallback], ["groq", config.groqVision]]
    : quick
      ? [
          ["groq", config.groqTextFallback],
          ["groq", config.groqText],
          ["gemini", config.geminiFallback],
          ["gemini", config.geminiMain],
        ]
      : [
          ["groq", config.groqText],
          ["groq", config.groqTextFallback],
          ["gemini", config.geminiMain],
          ["gemini", config.geminiFallback],
        ];
  const seen = new Set();
  return list.filter(([p, m]) => {
    const k = p + ":" + m;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Run the provider chain once. Returns {text, provider, model,
// attempts} on success, or throws the last error when every attempt
// fails. Fallback attempts are retries of the same single logical
// call, not extra charged calls: callers charge at most once.
export async function runAiChain(messages, images, tier) {
  const { m, imgs } = normalizeMessages(messages, images);
  let lastError = null;
  let attempts = 0;
  for (const [provider, model] of chain(imgs.length > 0, tier)) {
    attempts++;
    try {
      const text = provider === "groq" ? await callGroq(model, m, imgs) : await callGemini(model, m, imgs);
      return { text, provider, model, attempts };
    } catch (e) {
      lastError = e;
      console.error("AI attempt failed:", provider, model, e.message);
    }
  }
  throw lastError || new Error("all providers failed");
}
