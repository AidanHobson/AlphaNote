import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getProviderConfig, isProviderConfigured, callAIWithFallback } from '../server/lib/ai-provider.js';

describe('getProviderConfig', () => {
  beforeEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.GEMINI_MODEL;
    delete process.env.ANTHROPIC_MODEL;
  });

  it('defaults to Claude with the anthropic endpoint', () => {
    const c = getProviderConfig();
    expect(c.name).toBe('claude');
    expect(c.baseUrl).toBe('https://api.anthropic.com/v1');
    expect(c.model).toBe('claude-sonnet-4-6');
  });

  it('resolves gemini with its default model', () => {
    const g = getProviderConfig('gemini');
    expect(g.name).toBe('gemini');
    expect(g.model).toBe('gemini-2.5-flash-lite');
    expect(g.baseUrl).toMatch(/generativelanguage\.googleapis\.com/);
  });

  it('honours the AI_PROVIDER env default', () => {
    process.env.AI_PROVIDER = 'gemini';
    expect(getProviderConfig().name).toBe('gemini');
  });
});

describe('isProviderConfigured', () => {
  it('reflects whether the key is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(isProviderConfigured('claude')).toBe(true);
    process.env.ANTHROPIC_API_KEY = '';
    expect(isProviderConfigured('claude')).toBe(false);
  });
});

describe('callAIWithFallback — timeout & fallback', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.AI_PROVIDER = 'claude';
    process.env.AI_FALLBACK_PROVIDER = 'gemini';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    process.env.GEMINI_API_KEY = 'gm-test';
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.AI_PROVIDER;
    delete process.env.AI_FALLBACK_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  // A connection that never responds, but honours abort — like a stalled provider.
  const hang = (init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const geminiOk = (text) => Promise.resolve({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  });

  // Route by exact host (not a substring match — that trips CodeQL's
  // incomplete-URL-sanitization rule and is the wrong way to compare URLs).
  const isAnthropic = (url) => { try { return new URL(url).hostname === 'api.anthropic.com'; } catch { return false; } };

  it('aborts a hung primary and transparently falls back to the secondary', async () => {
    global.fetch = vi.fn((url, init) =>
      (isAnthropic(url) ? hang(init) : geminiOk('fallback answer')));

    const out = await callAIWithFallback('hi', 'sys', { timeoutMs: 50 });
    expect(out.provider).toBe('gemini');
    expect(out.fellBack).toBe(true);
    expect(out.text).toBe('fallback answer');
  });

  it('reports a clear timeout error when both providers stall', async () => {
    global.fetch = vi.fn((url, init) => hang(init));
    await expect(callAIWithFallback('hi', 'sys', { timeoutMs: 30 }))
      .rejects.toThrow(/timed out/);
  });
});
