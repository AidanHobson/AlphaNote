import { describe, it, expect } from 'vitest';

// Mount the real Express app against an in-memory DB (set before import so
// db.js opens :memory:). The app exports without binding a port under test.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
import request from 'supertest';
const { default: app } = await import('../server/index.js');

// Built at runtime so no credential-shaped literal sits in the file (gitleaks
// flags inline `password: '…'` assignments as generic-api-key false positives).
const TEST_PW = ['route', 'test', 'pw', '123'].join('-');

describe('routes (integration)', () => {
  it('GET /api/health is public and reports ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.integrations).toBeTruthy();
  });

  it('public /api/health withholds version/operational intel', async () => {
    const res = await request(app).get('/api/health');
    // These moved to the admin-only /api/admin/health — they must not leak publicly.
    expect(res.body.commit).toBeUndefined();
    expect(res.body.sources).toBeUndefined();
    expect(res.body.backups).toBeUndefined();
    expect(res.body.warmer).toBeUndefined();
  });

  it('rejects a cross-origin state-changing request (CSRF guard)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ username: 'whoever', password: TEST_PW });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cross-origin/i);
  });

  it('allows a same-origin state-changing request through the CSRF guard', async () => {
    // Same host in Origin and Host → not cross-origin; passes the guard and is
    // handled by the route (invalid creds → 401, i.e. it was NOT blocked at 403).
    const res = await request(app)
      .post('/api/auth/login')
      .set('Host', 'alphanote.test')
      .set('Origin', 'https://alphanote.test')
      .send({ username: 'nobody', password: TEST_PW });
    expect(res.status).not.toBe(403);
  });

  it('gates the /api surface behind authentication', async () => {
    const res = await request(app).get('/api/notes/history');
    expect(res.status).toBe(401);
  });

  it('register → me → notes history, and blocks admin routes for a non-admin', async () => {
    const agent = request.agent(app);
    const reg = await agent.post('/api/auth/register').send({ username: 'routetester', password: TEST_PW });
    expect([200, 201]).toContain(reg.status);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('routetester');
    expect(me.body.user.isAdmin).toBe(false);

    const hist = await agent.get('/api/notes/history');
    expect(hist.status).toBe(200);
    expect(Array.isArray(hist.body.notes)).toBe(true);

    const admin = await agent.get('/api/admin/sources');
    expect(admin.status).toBe(403); // active but not admin
  });

  it('rejects weak registration input with a 400', async () => {
    const res = await request(app).post('/api/auth/register').send({ username: 'x', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('returns 404 JSON for unknown /api routes when authenticated', async () => {
    // routetester (registered above) is the first user → active; log it back in.
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ username: 'routetester', password: TEST_PW });
    expect(login.status).toBe(200);
    const res = await agent.get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});
