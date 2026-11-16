// RAG: keyword retrieval over local JSON sources, no embeddings.
// Every source carries publisher, date, URL, and version. Only facts
// verified from genuinely known statutory material or live sources go
// into the source files; retrieval never invents a citation.
import fs from "fs";
import path from "path";
import { APP_DIR } from "./config.js";

const SOURCES_DIR = path.join(APP_DIR, "rag", "sources");

let cache = null;

export function loadRagSources() {
  if (cache) return cache;
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(SOURCES_DIR).filter((f) => f.endsWith(".json")).sort();
  } catch {
    files = [];
  }
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, file), "utf8"));
      if (parsed && Array.isArray(parsed.chunks)) out.push(parsed);
    } catch (e) {
      console.error("RAG source failed to load:", file, e.message);
    }
  }
  cache = out;
  return out;
}

export function clearRagCache() {
  cache = null;
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
  "what", "when", "how", "my", "me", "i", "do", "does", "should", "can",
  "please", "tell", "about", "with", "from", "by", "at", "as", "it", "its",
]);

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function scoreChunk(queryTokens, chunk, topics) {
  const hay = (chunk.text + " " + (chunk.section || "") + " " + (topics || []).join(" ")).toLowerCase();
  let score = 0;
  for (const token of new Set(queryTokens)) {
    if (hay.includes(token)) score += token.length >= 6 ? 2 : 1;
  }
  return score;
}

// Returns ranked chunks: {source, chunk, score}. Empty query -> [].
export function searchRagChunks(query, limit) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const ranked = [];
  for (const source of loadRagSources()) {
    for (const chunk of source.chunks) {
      const score = scoreChunk(tokens, chunk, source.topics);
      if (score > 0) ranked.push({ source, chunk, score });
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit || 5);
}

// Contract shape for GET /api/rag/search.
export function searchRag(query, limit) {
  const hits = searchRagChunks(query, limit || 5);
  return hits.map(({ source, chunk }) => ({
    title: source.title,
    source: source.publisher,
    date: source.published_date,
    excerpt: chunk.text.slice(0, 300),
    url: source.url,
  }));
}

// Citations for orchestrated answers: title, publisher, date.
export function citationsFor(query, limit) {
  const hits = searchRagChunks(query, limit || 3);
  const seen = new Set();
  const out = [];
  for (const { source } of hits) {
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    out.push({ title: source.title, publisher: source.publisher, date: source.published_date });
  }
  return out;
}

// Context block prepended to the single orchestrator call.
export function ragContext(query, limit) {
  const hits = searchRagChunks(query, limit || 3);
  if (!hits.length) return "";
  const lines = hits.map(
    ({ source, chunk }) => "- [" + source.title + ", " + source.publisher + "] " + chunk.text
  );
  return "Reference material (use only what is relevant; do not invent beyond it):\n" + lines.join("\n");
}
