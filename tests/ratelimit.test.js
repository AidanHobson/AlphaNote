import { describe, it, expect } from 'vitest';
import { createBucket } from '../server/lib/ratelimit.js';

const elapsed = async (p) => { const t0 = Date.now(); await p; return Date.now() - t0; };

describe('createBucket', () => {
  it('grants the burst immediately', async () => {
    const b = createBucket({ perMinute: 600, burst: 3, maxWaitMs: 1000 });
    const ms = await elapsed(Promise.all([b.take(), b.take(), b.take()]));
    expect(ms).toBeLessThan(50);
    expect(b.stats().tokens).toBe(0);
  });

  it('queues beyond the burst and grants on refill', async () => {
    // 600/min = one token per 100ms
    const b = createBucket({ perMinute: 600, burst: 1, maxWaitMs: 2000 });
    await b.take(); // burst spent
    const ms = await elapsed(b.take()); // must wait ~1 refill
    expect(ms).toBeGreaterThanOrEqual(50);
    expect(ms).toBeLessThan(1000);
  });

  it('rejects waiters that exceed maxWaitMs', async () => {
    // 1/min refill = effectively never within the test window
    const b = createBucket({ perMinute: 1, burst: 1, maxWaitMs: 120 });
    await b.take();
    await expect(b.take()).rejects.toThrow(/queue timeout/);
  });

  it('per-call patience: a fail-fast waiter times out while a patient one survives', async () => {
    // refill every 200ms; burst spent → both waiters queue behind one refill
    const b = createBucket({ perMinute: 300, burst: 1, maxWaitMs: 2000 });
    await b.take();
    const fast = b.take(50);    // bulk-style: gives up before the refill
    const patient = b.take();   // default patience: outlives it
    await expect(fast).rejects.toThrow(/timeout after 50ms/);
    await expect(patient).resolves.toBeUndefined();
  });

  it('serves queued waiters in FIFO order', async () => {
    const b = createBucket({ perMinute: 1200, burst: 1, maxWaitMs: 2000 }); // refill every 50ms
    await b.take();
    const order = [];
    await Promise.all([
      b.take().then(() => order.push('first')),
      b.take().then(() => order.push('second')),
    ]);
    expect(order).toEqual(['first', 'second']);
  });
});
