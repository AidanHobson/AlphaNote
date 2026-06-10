// Tiny in-memory TTL cache for expensive (AI) endpoint results, so repeated
// requests for the same thing don't re-hit Claude/Gemini within the window.
import { boundedSet } from './utils.js';

const store = new Map();

export async function cached(key, ttlMs, producer) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await producer();
  boundedSet(store, key, { t: Date.now(), v }, 400); // cap: keys include user symbols
  return v;
}
