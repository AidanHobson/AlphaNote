import { describe, it, expect, beforeEach } from 'vitest';
import { getProviderConfig, isProviderConfigured } from '../server/lib/ai-provider.js';

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
