// Tiny in-memory TTL cache for expensive (AI) endpoint results, so repeated
// requests for the same thing don't re-hit Claude/Gemini within the window.
const store = new Map();

export async function cached(key, ttlMs, producer) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await producer();
  store.set(key, { t: Date.now(), v });
  return v;
}
