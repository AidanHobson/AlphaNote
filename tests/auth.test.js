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
