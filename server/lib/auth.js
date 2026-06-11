// Authentication — registration, login, server-side revocable sessions, and the
// per-user state store. Security controls follow the AthenaGuard guide §5:
//   • passwords hashed with bcrypt (cost 12) — never stored or compared in plaintext
//   • login is enumeration-resistant: identical generic errors + a constant-time
//     compare against a dummy hash when the user doesn't exist
//   • sessions are 32-byte random tokens stored server-side (revocable), delivered
//     in an httpOnly, SameSite=Lax cookie (Secure when over HTTPS), with expiry
//   • (rate limiting on the auth routes is applied in index.js)

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import db from './db.js';

const BCRYPT_COST = 12;
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days
export const COOKIE_NAME = 'ag_session';

// A real bcrypt hash of a random value, compared against when a username is not
// found so login takes ~the same time either way (no timing-based enumeration).
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_COST);

const q = {
  userByName: db.prepare('SELECT id, username, password_hash, status FROM users WHERE username = ?'),
  userById: db.prepare('SELECT id, username, status FROM users WHERE id = ?'),
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
  insertUser: db.prepare('INSERT INTO users (username, password_hash, created_at, status) VALUES (?, ?, ?, ?)'),
  setStatus: db.prepare('UPDATE users SET status = ? WHERE id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
  sessionByToken: db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  initState: db.prepare(`INSERT OR IGNORE INTO user_state (user_id, watchlist, notes, updated_at) VALUES (?, '[]', '{}', ?)`),
  getState: db.prepare('SELECT watchlist, notes FROM user_state WHERE user_id = ?'),
  putState: db.prepare(`INSERT INTO user_state (user_id, watchlist, notes, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET watchlist = excluded.watchlist, notes = excluded.notes, updated_at = excluded.updated_at`),
};

// ── validation ───────────────────────────────────────────────────────────────
export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return 'Username must be 3–32 characters: letters, digits, dot, underscore or hyphen.';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return 'Password must be at least 8 characters.';
  }
  return null;
}

// ── accounts ─────────────────────────────────────────────────────────────────
export async function registerUser(username, password) {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  // The very first account and any env-designated admin are auto-active (so you
  // can't lock yourself out); everyone else starts 'pending' until an admin approves.
  const status = q.countUsers.get().n === 0 || isAdminUsername(username) ? 'active' : 'pending';
  try {
    const info = q.insertUser.run(username, hash, Date.now(), status);
    q.initState.run(info.lastInsertRowid, Date.now());
    return { id: Number(info.lastInsertRowid), username, status };
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) { const err = new Error('That username is already taken.'); err.code = 'TAKEN'; throw err; }
    throw e;
  }
}

export async function verifyLogin(username, password) {
  const user = typeof username === 'string' ? q.userByName.get(username) : null;
  // Always run a bcrypt compare (real or dummy) so timing doesn't reveal existence.
  const ok = await bcrypt.compare(typeof password === 'string' ? password : '', user ? user.password_hash : DUMMY_HASH);
  return user && ok ? { id: user.id, username: user.username, status: user.status } : null;
}

export function setUserStatus(id, status) {
  if (!['pending', 'active', 'disabled'].includes(status)) throw new Error('invalid status');
  return q.setStatus.run(status, id).changes > 0;
}

// Change password: verify the CURRENT password first (so a hijacked browser
// session alone can't take over the account), then rotate the hash and revoke
// every existing session — the caller gets a fresh one.
const qSetHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const qDeleteUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');
export async function changePassword(userId, currentPassword, newPassword) {
  const user = q.userById.get(userId);
  const row = user ? q.userByName.get(user.username) : null;
  const ok = await bcrypt.compare(typeof currentPassword === 'string' ? currentPassword : '', row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) return false;
  qSetHash.run(await bcrypt.hash(newPassword, BCRYPT_COST), userId);
  qDeleteUserSessions.run(userId); // log out everywhere; caller re-issues one session
  return true;
}
export function destroyAllSessions(userId) {
  return qDeleteUserSessions.run(userId).changes;
}

// ── sessions ─────────────────────────────────────────────────────────────────
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  q.insertSession.run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}
export function destroySession(token) { if (token) q.deleteSession.run(token); }

export function userForToken(token) {
  if (!token) return null;
  const s = q.sessionByToken.get(token);
  if (!s) return null;
  if (s.expires_at < Date.now()) { q.deleteSession.run(token); return null; }
  const user = q.userById.get(s.user_id);
  if (!user) return null;
  // A user disabled/un-approved mid-session loses access immediately (env-admins exempt).
  if (user.status !== 'active' && !isAdminUsername(user.username)) return null;
  return user;
}

// ── cookies ──────────────────────────────────────────────────────────────────
export function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i <= 0) return;
    const raw = part.slice(i + 1).trim();
    // A malformed percent-encoding (e.g. a stray "%") makes decodeURIComponent
    // throw — don't let a crafted cookie 500 the auth gate; keep the raw value.
    let value = raw;
    try { value = decodeURIComponent(raw); } catch { /* keep raw */ }
    out[part.slice(0, i).trim()] = value;
  });
  return out;
}
export function sessionCookie(token, { secure }) {
  const attrs = [`${COOKIE_NAME}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}
export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
export function isSecureRequest(req) {
  return Boolean(req.secure); // honors `trust proxy`; not a spoofable raw header
}

// ── express middleware ───────────────────────────────────────────────────────
export function attachUser(req) {
  req.sessionToken = parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
  req.user = userForToken(req.sessionToken);
  return req.user;
}
export function requireAuth(req, res, next) {
  if (!req.user) attachUser(req);
  if (!req.user) return res.status(401).json({ error: 'Authentication required. Please log in.' });
  next();
}

// ── admin role (env-driven, never self-service) ──────────────────────────────
// Admin status is derived from the ADMIN_USERNAMES env var (comma-separated,
// case-insensitive) — so it can only be granted by someone with server config
// access, never by a user calling the API. Read lazily so it always reflects env.
function adminSet() {
  return new Set((process.env.ADMIN_USERNAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}
export function isAdminUsername(username) {
  return typeof username === 'string' && adminSet().has(username.toLowerCase());
}
// Shape sent to the client — never includes the hash or internal id.
export function publicUser(user) {
  return user ? { username: user.username, isAdmin: isAdminUsername(user.username) } : null;
}
export function requireAdmin(req, res, next) {
  if (!req.user) attachUser(req);
  if (!req.user) return res.status(401).json({ error: 'Authentication required. Please log in.' });
  if (!isAdminUsername(req.user.username)) return res.status(403).json({ error: 'Admin access required.' });
  next();
}
const qListUsers = db.prepare('SELECT id, username, created_at, status FROM users ORDER BY id');
export function listUsers() {
  return qListUsers.all().map((u) => ({
    id: u.id, username: u.username, createdAt: u.created_at, status: u.status, isAdmin: isAdminUsername(u.username),
  }));
}

// ── per-user state ───────────────────────────────────────────────────────────
export function getUserState(userId) {
  const row = q.getState.get(userId) || { watchlist: '[]', notes: '{}' };
  let watchlist = [], notes = {};
  try { watchlist = JSON.parse(row.watchlist); } catch { /* default */ }
  try { notes = JSON.parse(row.notes); } catch { /* default */ }
  return { watchlist: Array.isArray(watchlist) ? watchlist : [], notes: notes && typeof notes === 'object' ? notes : {} };
}
export function putUserState(userId, watchlist, notes) {
  const wl = Array.isArray(watchlist) ? watchlist.filter((s) => typeof s === 'string').slice(0, 500) : [];
  const nt = notes && typeof notes === 'object' ? notes : {};
  q.putState.run(userId, JSON.stringify(wl), JSON.stringify(nt), Date.now());
}
