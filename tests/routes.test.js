import { describe, it, expect } from 'vitest';

// Mount the real Express app against an in-memory DB (set before import so
// db.js opens :memory:). The app exports without binding a port under test.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
import request from 'supertest';
const { default: app } = await import('../server/index.js');

describe('routes (integration)', () => {
  it('GET /api/health is public and reports ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.integrations).toBeTruthy();
  });

  it('gates the /api surface behind authentication', async () => {
    const res = await request(app).get('/api/notes/history');
    expect(res.status).toBe(401);
  });

  it('register → me → notes history, and blocks admin routes for a non-admin', async () => {
    const agent = request.agent(app);
    const reg = await agent.post('/api/auth/register').send({ username: 'routetester', password: 'route-pass123' });
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
    const login = await agent.post('/api/auth/login').send({ username: 'routetester', password: 'route-pass123' });
    expect(login.status).toBe(200);
    const res = await agent.get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});
