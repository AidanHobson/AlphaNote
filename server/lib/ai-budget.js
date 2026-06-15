// Per-user daily AI budget. The express-rate-limit on /api/ai is per-IP, which
// doesn't isolate users sharing the (paid) Claude/Gemini budget — one heavy
// user could exhaust it for everyone. This caps each user's AI generations per
// UTC day. In-memory: a budget is soft, day-scoped state, not something to
// persist across restarts.

const DAILY_CAP = Number(process.env.AI_DAILY_CAP_PER_USER) || 75;
const usage = new Map(); // `${userId}:${YYYY-MM-DD}` → count

const dayKey = (userId, now = Date.now()) => `${userId}:${new Date(now).toISOString().slice(0, 10)}`;

export function checkAndConsume(userId, { cap = DAILY_CAP, now = Date.now() } = {}) {
  if (!userId) return { ok: true, remaining: cap }; // unauthenticated paths handled elsewhere
  const key = dayKey(userId, now);
  const used = usage.get(key) || 0;
  if (used >= cap) return { ok: false, remaining: 0, cap, used };
  usage.set(key, used + 1);
  // Opportunistic cleanup of yesterday's keys so the map can't grow unbounded.
  if (usage.size > 5000) {
    const today = new Date(now).toISOString().slice(0, 10);
    for (const k of usage.keys()) if (!k.endsWith(today)) usage.delete(k);
  }
  return { ok: true, remaining: cap - used - 1, cap, used: used + 1 };
}

// Express middleware for /api/ai/* — 429s when the caller is over budget.
export function aiBudget(req, res, next) {
  const { ok, cap } = checkAndConsume(req.user?.id);
  if (!ok) {
    return res.status(429).json({ error: `Daily AI limit reached (${cap} generations/day). It resets at midnight UTC.` });
  }
  next();
}
