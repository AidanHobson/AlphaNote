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
      ? Math.max(queue[0].queuedAt + maxWaitMs - Date.now(), 25)
      : refillDelay;
    timer = setTimeout(() => { timer = null; drain(); }, Math.min(refillDelay, expiryDelay));
    timer.unref?.(); // never keep the process alive just for the queue
  };

  const drain = () => {
    refill();
    while (queue.length && tokens > 0) {
      tokens -= 1;
      queue.shift().resolve();
    }
    const now = Date.now();
    while (queue.length && now - queue[0].queuedAt >= maxWaitMs) {
      queue.shift().reject(new Error(`rate-limit queue timeout after ${maxWaitMs}ms`));
    }
    if (queue.length) schedule();
  };

  return {
    take() {
      refill();
      if (tokens > 0) {
        tokens -= 1;
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        queue.push({ resolve, reject, queuedAt: Date.now() });
        schedule();
      });
    },
    stats() {
      refill();
      return { tokens, queued: queue.length };
    },
  };
}
