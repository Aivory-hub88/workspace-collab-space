/**
 * Embedding provider (Fase 4c2) — OpenAI-compatible /v1/embeddings endpoint.
 *
 * Graceful by design: without a key (OPENROUTER_EMBEDDING_KEY or
 * OPENROUTER_API_KEY) or on any failure, embed() resolves null and callers
 * fall back to lexical ranking. Semantic search is an enhancement layer,
 * never a hard dependency.
 */

const ENDPOINT = process.env.OPENROUTER_EMBEDDINGS_URL || "https://openrouter.ai/v1/embeddings";
const MODEL = process.env.EMBEDDING_MODEL || "qwen/qwen3-embedding-8b";
const TIMEOUT_MS = 15000;

function apiKey(): string | null {
  return process.env.OPENROUTER_EMBEDDING_KEY || process.env.OPENROUTER_API_KEY || null;
}

export function embeddingsConfigured(): boolean {
  return apiKey() !== null;
}

/** Embed one text → float array, or null when unconfigured/failing. */
export async function embed(text: string): Promise<number[] | null> {
  const key = apiKey();
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 4000);
  if (!key || !clean) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, input: clean }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = j.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length < 32 || !vec.every((n) => Number.isFinite(n))) return null;
    return vec;
  } catch {
    return null;
  }
}

/** Cosine similarity for equal-length vectors (0 when incomparable). */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
