import { describe, it, expect, beforeAll } from 'vitest';

// Use an isolated in-memory database for the auth module (must be set before the
// dynamic import below, since db.js reads DB_PATH at load).
process.env.DB_PATH = ':memory:';
let A;
beforeAll(async () => { A = await import('../server/lib/auth.js'); });

describe('validateCredentials', () => {
  it('rejects bad usernames and short passwords, accepts valid ones', () => {
    expect(A.validateCredentials('ab', 'longenough1')).toMatch(/Username/);
    expect(A.validateCredentials('has space', 'longenough1')).toMatch(/Username/);
    expect(A.validateCredentials('good_user', 'short')).toMatch(/Password/);
    expect(A.validateCredentials('good_user', 'longenough1')).toBeNull();
  });
});

describe('cookies', () => {
  it('parses a cookie header', () => {
    expect(A.parseCookies('a=1; ag_session=tok123; b=2').ag_session).toBe('tok123');
    expect(A.parseCookies('')).toEqual({});
  });
  it('does not throw on a malformed percent-encoded cookie (no 500 on the auth gate)', () => {
    expect(() => A.parseCookies('ag_session=%')).not.toThrow();
    expect(A.parseCookies('ag_session=%').ag_session).toBe('%'); // kept raw
  });
  it('builds a hardened session cookie (HttpOnly, SameSite, Secure only when asked)', () => {
    const secure = A.sessionCookie('TOK', { secure: true });
    expect(secure).toContain('ag_session=TOK');
    expect(secure).toContain('HttpOnly');
    expect(secure).toContain('SameSite=Lax');
    expect(secure).toContain('Secure');
    expect(A.sessionCookie('TOK', { secure: false })).not.toContain('Secure');
    expect(A.clearCookie()).toContain('Max-Age=0');
  });
});

describe('register / login / sessions / state', () => {
  it('hashes passwords and round-trips login; is enumeration-resistant', async () => {
    const u = await A.registerUser('alice', 'correcthorse9');
    expect(u.username).toBe('alice');
    expect(await A.verifyLogin('alice', 'correcthorse9')).toMatchObject({ username: 'alice' });
    expect(await A.verifyLogin('alice', 'wrongpass1')).toBeNull(); // wrong password
    expect(await A.verifyLogin('ghost', 'whatever12')).toBeNull(); // unknown user
  }, 20000);

  it('issues and revokes sessions', async () => {
    const u = await A.registerUser('bob', 'correcthorse9');
    A.setUserStatus(u.id, 'active'); // bob is pending by default (not the first user); approve to use a session
    const tok = A.createSession(u.id);
    expect(A.userForToken(tok)).toMatchObject({ username: 'bob' });
    A.destroySession(tok);
    expect(A.userForToken(tok)).toBeNull();
    expect(A.userForToken('not-a-real-token')).toBeNull();
  }, 20000);

  it('stores and reads back per-user state', async () => {
    const u = await A.registerUser('carol', 'correcthorse9');
    A.putUserState(u.id, ['AAPL', 'NVDA'], { AAPL: { symbol: 'AAPL', text: 'cheap', updatedAt: 1 } });
    const s = A.getUserState(u.id);
    expect(s.watchlist).toEqual(['AAPL', 'NVDA']);
    expect(s.notes.AAPL.text).toBe('cheap');
  }, 20000);

  it('rejects duplicate usernames', async () => {
    await A.registerUser('dave', 'correcthorse9');
    await expect(A.registerUser('dave', 'correcthorse9')).rejects.toThrow(/taken/i);
  }, 20000);
});

describe('changePassword / destroyAllSessions', () => {
  it('requires the current password, rotates the hash, and revokes sessions', async () => {
    const u = await A.registerUser('rotator', 'originalpass1');
    A.setUserStatus(u.id, 'active');
    const tok1 = A.createSession(u.id);
    const tok2 = A.createSession(u.id);

    expect(await A.changePassword(u.id, 'WRONG-current', 'newpassword1')).toBe(false);
    expect(await A.verifyLogin('rotator', 'originalpass1')).toBeTruthy(); // unchanged

    expect(await A.changePassword(u.id, 'originalpass1', 'newpassword1')).toBe(true);
    expect(await A.verifyLogin('rotator', 'newpassword1')).toBeTruthy();
    expect(await A.verifyLogin('rotator', 'originalpass1')).toBeNull();
    expect(A.userForToken(tok1)).toBeNull(); // all sessions revoked
    expect(A.userForToken(tok2)).toBeNull();
  }, 30000);

  it('destroyAllSessions revokes every session for the user', async () => {
    const u = await A.registerUser('multisess', 'correcthorse9');
    A.setUserStatus(u.id, 'active');
    const toks = [A.createSession(u.id), A.createSession(u.id), A.createSession(u.id)];
    expect(A.destroyAllSessions(u.id)).toBe(3);
    toks.forEach((t) => expect(A.userForToken(t)).toBeNull());
  }, 20000);

  it('purgeExpiredSessions sweeps only sessions past their expiry', async () => {
    const u = await A.registerUser('sweeper', 'correcthorse9');
    A.setUserStatus(u.id, 'active');
    const tok = A.createSession(u.id);
    expect(A.userForToken(tok)).toMatchObject({ username: 'sweeper' });
    // Nothing is expired "now", so a present-time sweep removes nothing of his.
    const tooEarly = A.purgeExpiredSessions(Date.now() - 1);
    expect(A.userForToken(tok)).toMatchObject({ username: 'sweeper' });
    // Sweep with a clock past the 7-day TTL → the stale row is removed.
    const removed = A.purgeExpiredSessions(Date.now() + 8 * 24 * 3600 * 1000);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(A.userForToken(tok)).toBeNull();
    expect(tooEarly).toBeLessThan(removed);
  }, 20000);
});

describe('approval flow', () => {
  it('auto-activates the first user, leaves later sign-ups pending', async () => {
    // alice (registered first, above) was auto-activated:
    expect((await A.verifyLogin('alice', 'correcthorse9'))?.status).toBe('active');
    const later = await A.registerUser('needsapproval', 'correcthorse9');
    expect(later.status).toBe('pending');
  }, 20000);

  it('auto-activates env-designated admins', async () => {
    process.env.ADMIN_USERNAMES = 'autoadmin';
    const u = await A.registerUser('autoadmin', 'correcthorse9');
    expect(u.status).toBe('active');
    process.env.ADMIN_USERNAMES = '';
  }, 20000);

  it('userForToken blocks pending/disabled users (and restores on approve)', async () => {
    const u = await A.registerUser('blockme', 'correcthorse9'); // pending
    const tok = A.createSession(u.id);
    expect(A.userForToken(tok)).toBeNull();            // pending → no access
    A.setUserStatus(u.id, 'active');
    expect(A.userForToken(tok)).toMatchObject({ username: 'blockme' });
    A.setUserStatus(u.id, 'disabled');
    expect(A.userForToken(tok)).toBeNull();            // disabled → access revoked
  }, 20000);
});

describe('admin role (env-driven, never self-service)', () => {
  it('derives admin status from ADMIN_USERNAMES, case-insensitively', () => {
    process.env.ADMIN_USERNAMES = 'TheAdmin, root';
    expect(A.isAdminUsername('theadmin')).toBe(true);
    expect(A.isAdminUsername('THEADMIN')).toBe(true);
    expect(A.isAdminUsername('root')).toBe(true);
    expect(A.isAdminUsername('regular_member')).toBe(false);
    expect(A.publicUser({ username: 'TheAdmin' })).toEqual({ username: 'TheAdmin', isAdmin: true });
    process.env.ADMIN_USERNAMES = '';
    expect(A.isAdminUsername('theadmin')).toBe(false);
  });
});
