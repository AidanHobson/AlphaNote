// AI provider abstraction — ported from the original OpenStock `lib/ai-provider.ts`
// and EXTENDED with Anthropic Claude as a first-class provider.
//
//   AI_PROVIDER=claude (default)  → Anthropic Messages API
//   AI_PROVIDER=gemini            → Google Gemini REST API
//
// callAIWithFallback() tries the primary provider, and on ANY error
// (rate limit, outage, missing key, insufficient credits) transparently
// switches to AI_FALLBACK_PROVIDER. It returns BOTH the text and the name of
// the provider that actually answered, so the UI can show provenance.

export function getProviderConfig(provider) {
  const name = provider || process.env.AI_PROVIDER || 'claude';

  switch (name) {
    case 'gemini':
      return {
        name: 'gemini',
        apiKey: process.env.GEMINI_API_KEY || '',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      };
    case 'claude':
    default:
      return {
        name: 'claude',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        baseUrl: 'https://api.anthropic.com/v1',
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      };
  }
}

export function isProviderConfigured(provider) {
  return Boolean(getProviderConfig(provider).apiKey);
}

function getFallbackName(primary) {
  const configured = process.env.AI_FALLBACK_PROVIDER;
  if (configured && configured !== primary) return configured;
  return primary === 'claude' ? 'gemini' : 'claude';
}

// ── Provider implementations ────────────────────────────────────────────────

async function callClaude(prompt, system, config) {
  if (!config.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const res = await fetch(`${config.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 700,
      // System prompt is marked cacheable (prompt caching) since it's reused
      // across every insight request — cheaper + faster on repeat calls.
      system: system
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : undefined,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API error: ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Claude returned empty response');
  return text.trim();
}

async function callGemini(prompt, system, config) {
  if (!config.apiKey) throw new Error('GEMINI_API_KEY is not set');

  const url = `${config.baseUrl}/${config.model}:generateContent?key=${config.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini API error: ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty response');
  return text.trim();
}

async function callProvider(prompt, system, providerName) {
  const config = getProviderConfig(providerName);
  if (config.name === 'gemini') return callGemini(prompt, system, config);
  return callClaude(prompt, system, config);
}

/**
 * Call the primary provider, falling back automatically on error.
 * @returns {Promise<{ provider: string, text: string, fellBack: boolean }>}
 */
export async function callAIWithFallback(prompt, system) {
  const primary = process.env.AI_PROVIDER || 'claude';
  const fallback = getFallbackName(primary);

  try {
    const text = await callProvider(prompt, system, primary);
    return { provider: primary, text, fellBack: false };
  } catch (primaryError) {
    console.warn(`⚠️  ${primary} failed (${primaryError.message}) — falling back to ${fallback}`);
    try {
      const text = await callProvider(prompt, system, fallback);
      return { provider: fallback, text, fellBack: true };
    } catch (fallbackError) {
      const err = new Error(
        `Both AI providers failed. ${primary}: ${primaryError.message} | ${fallback}: ${fallbackError.message}`
      );
      err.primaryError = primaryError.message;
      err.fallbackError = fallbackError.message;
      throw err;
    }
  }
}
