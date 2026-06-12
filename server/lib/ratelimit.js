// Shared token bucket with a FIFO wait queue. Callers `await bucket.take()`
// before an upstream request: bursts are absorbed by queueing briefly instead
// of failing with a 429 — the main source of user-visible flakes on the
// Finnhub free tier (60 req/min shared between the warmer and interactive use).

export function createBucket({ perMinute = 54, burst = 6, maxWaitMs = 15_000 } = {}) {
  const refillMs = 60_000 / perMinute;
  let tokens = burst;
  let lastRefill = Date.now();
  const queue = [];
  let timer = null;

  const refill = () => {
    const now = Date.now();
    const add = Math.floor((now - lastRefill) / refillMs);
    if (add > 0) {
      tokens = Math.min(burst, tokens + add);
      lastRefill += add * refillMs;
    }
  };

  const schedule = () => {
    if (timer) return;
    // Wake for whichever comes first: the next token refill, or the first
    // waiter's deadline (so slow buckets still reject timed-out waiters promptly).
    const refillDelay = Math.max(refillMs / 2, 25);
    const expiryDelay = queue.length
      ? Math.max(Math.min(...queue.map((w) => w.deadline)) - Date.now(), 25)
      : refillDelay;
    timer = setTimeout(() => { timer = null; drain(); }, Math.min(refillDelay, expiryDelay));
    timer.unref?.(); // never keep the process alive just for the queue
  };

  const drain = () => {
    refill();
    // Expire first so a timed-out bulk waiter never consumes a token a more
    // patient interactive waiter could use (each waiter has its own deadline).
    const now = Date.now();
    for (let i = queue.length - 1; i >= 0; i--) {
      if (now >= queue[i].deadline) {
        const w = queue.splice(i, 1)[0];
        w.reject(new Error(`rate-limit queue timeout after ${w.deadline - w.queuedAt}ms`));
      }
    }
    while (queue.length && tokens > 0) {
      tokens -= 1;
      queue.shift().resolve();
    }
    if (queue.length) schedule();
  };

  return {
    // patienceMs: per-call wait budget — bulk basket fetches pass a short one
    // (fail fast, don't clog the queue); interactive singles use the default.
    take(patienceMs = maxWaitMs) {
      refill();
      if (tokens > 0) {
        tokens -= 1;
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        queue.push({ resolve, reject, queuedAt: Date.now(), deadline: Date.now() + patienceMs });
        schedule();
      });
    },
    stats() {
      refill();
      return { tokens, queued: queue.length };
    },
  };
}
