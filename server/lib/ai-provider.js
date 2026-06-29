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

// ── Timeout ──────────────────────────────────────────────────────────────────
// A hung provider connection must not hang the request (or an open SSE stream)
// forever — and, crucially, it must surface as an *error* so callAIWithFallback
// switches to the fallback provider. fetch() alone never times out, so we drive
// it with an AbortController. For streaming we treat the budget as an idle
// timeout: each chunk that arrives resets it, so a long-but-healthy generation
// is fine while a silent stall still aborts.
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 45_000;

function withTimeout(ms) {
  const ctrl = new AbortController();
  let timer;
  const arm = () => { timer = setTimeout(() => ctrl.abort(), ms); };
  arm();
  return {
    signal: ctrl.signal,
    kick: () => { clearTimeout(timer); arm(); }, // reset the idle clock (per chunk)
    clear: () => clearTimeout(timer),
    timedOut: () => ctrl.signal.aborted,
  };
}

// ── Streaming helpers ────────────────────────────────────────────────────────

// Pull the incremental text out of one parsed SSE event for each provider.
// Pure + exported so the stream parsing is unit-tested.
export function deltaFromEvent(provider, evt) {
  if (provider === 'gemini') return evt?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  // Anthropic: text arrives as content_block_delta with delta.text.
  return evt?.type === 'content_block_delta' ? (evt.delta?.text || '') : '';
}

// Read an SSE response body, parse `data:` lines, and feed each provider delta
// to onDelta. Returns the full accumulated text.
async function consumeSSE(res, provider, onDelta, onActivity) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity?.(); // a chunk arrived → reset the idle timeout
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }
      const piece = deltaFromEvent(provider, evt);
      if (piece) { text += piece; onDelta(piece); }
    }
  }
  return text;
}

// ── Provider implementations ────────────────────────────────────────────────

async function callClaude(prompt, system, config, opts = {}) {
  if (!config.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const streaming = typeof opts.onDelta === 'function';
  const t = withTimeout(opts.timeoutMs || AI_TIMEOUT_MS);

  try {
    const res = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      signal: t.signal,
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        // 700 suits the short reads; long-form callers (research notes) raise it.
        max_tokens: opts.maxTokens || 700,
        stream: streaming || undefined,
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

    if (streaming) {
      const text = await consumeSSE(res, 'claude', opts.onDelta, t.kick);
      if (!text.trim()) throw new Error('Claude returned empty response');
      return text.trim();
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (!text) throw new Error('Claude returned empty response');
    return text.trim();
  } catch (err) {
    if (t.timedOut()) throw new Error(`Claude timed out after ${opts.timeoutMs || AI_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    t.clear();
  }
}

async function callGemini(prompt, system, config, opts = {}) {
  if (!config.apiKey) throw new Error('GEMINI_API_KEY is not set');
  const streaming = typeof opts.onDelta === 'function';
  const t = withTimeout(opts.timeoutMs || AI_TIMEOUT_MS);

  try {
    const method = streaming ? 'streamGenerateContent' : 'generateContent';
    const url = `${config.baseUrl}/${config.model}:${method}?key=${config.apiKey}${streaming ? '&alt=sse' : ''}`;
    const res = await fetch(url, {
      method: 'POST',
      signal: t.signal,
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

    if (streaming) {
      const text = await consumeSSE(res, 'gemini', opts.onDelta, t.kick);
      if (!text.trim()) throw new Error('Gemini returned empty response');
      return text.trim();
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned empty response');
    return text.trim();
  } catch (err) {
    if (t.timedOut()) throw new Error(`Gemini timed out after ${opts.timeoutMs || AI_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    t.clear();
  }
}

async function callProvider(prompt, system, providerName, opts = {}) {
  const config = getProviderConfig(providerName);
  if (config.name === 'gemini') return callGemini(prompt, system, config, opts);
  return callClaude(prompt, system, config, opts);
}

/**
 * Call the primary provider, falling back automatically on error.
 * @param {{ maxTokens?: number }} [opts] — raise the output budget for long-form callers.
 * @returns {Promise<{ provider: string, text: string, fellBack: boolean }>}
 */
export async function callAIWithFallback(prompt, system, opts = {}) {
  const primary = process.env.AI_PROVIDER || 'claude';
  const fallback = getFallbackName(primary);

  try {
    const text = await callProvider(prompt, system, primary, opts);
    return { provider: primary, text, fellBack: false };
  } catch (primaryError) {
    console.warn(`⚠️  ${primary} failed (${primaryError.message}) — falling back to ${fallback}`);
    try {
      const text = await callProvider(prompt, system, fallback, opts);
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
