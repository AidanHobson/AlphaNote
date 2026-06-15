// Scraper / external-source health tracking. Every keyless data source the app
// depends on (Reddit, Hacker News, Polymarket, FINRA, web search, EDGAR) wraps
// its fetch in track(name, fn): we record the last success, last failure, and a
// short rolling outcome so the Admin page can answer "is anything silently
// broken?" — third-party markup or IP blocks can degrade a source with no other
// signal. In-memory: this is live operational state, not history.

const sources = new Map();

function entry(name) {
  let e = sources.get(name);
  if (!e) {
    e = { name, lastOkAt: null, lastFailAt: null, lastError: null, recent: [], ok: 0, fail: 0 };
    sources.set(name, e);
  }
  return e;
}

export function recordOutcome(name, ok, errMessage) {
  const e = entry(name);
  const now = Date.now();
  if (ok) { e.lastOkAt = now; e.ok += 1; } else { e.lastFailAt = now; e.fail += 1; e.lastError = String(errMessage || '').slice(0, 200); }
  e.recent.push(ok ? 1 : 0);
  if (e.recent.length > 20) e.recent.shift();
}

// Wrap an async source call so its outcome is tracked. A thrown error AND a
// null/empty result both count as failures (silent degradation is the point).
export async function track(name, fn, { emptyIsFailure = false } = {}) {
  try {
    const result = await fn();
    const empty = emptyIsFailure && (result == null || (Array.isArray(result) && result.length === 0));
    recordOutcome(name, !empty, empty ? 'empty result' : null);
    return result;
  } catch (err) {
    recordOutcome(name, false, err?.message);
    throw err;
  }
}

const STALE_MS = 24 * 3600_000;

export function listSourceHealth() {
  const now = Date.now();
  return [...sources.values()]
    .map((e) => {
      const recentFails = e.recent.filter((x) => x === 0).length;
      let status;
      if (e.recent.length === 0) status = 'unknown'; // never exercised
      else if (e.recent.length >= 3 && recentFails === e.recent.length) status = 'failing';
      else if (e.lastOkAt && now - e.lastOkAt > STALE_MS) status = 'stale';
      else if (recentFails > 0) status = 'degraded';
      else status = 'ok';
      return {
        name: e.name, status,
        lastOkAt: e.lastOkAt, lastFailAt: e.lastFailAt, lastError: e.lastError,
        successes: e.ok, failures: e.fail,
        recentFailRate: e.recent.length ? Number((recentFails / e.recent.length).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
