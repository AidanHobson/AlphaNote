// Same-origin JSON fetch wrapper (from the ReturnSignal guide), hardened with
// friendly error messages from the API's `{ error }` envelope.

export async function getJSON<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin' });
  } catch {
    throw new Error('Network error — is the API server running?');
  }
  return parse<T>(res, path);
}

export async function postJSON<T>(path: string, body: unknown): Promise<T> {
  return sendJSON<T>('POST', path, body);
}
export async function putJSON<T>(path: string, body: unknown): Promise<T> {
  return sendJSON<T>('PUT', path, body);
}
export async function deleteJSON<T>(path: string): Promise<T> {
  return sendJSON<T>('DELETE', path, undefined);
}

async function sendJSON<T>(method: string, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Network error — is the API server running?');
  }
  return parse<T>(res, path);
}

export interface StreamHandlers<T> {
  onDelta: (chunk: string) => void;
  onDone: (note: T) => void;
  onError: (message: string) => void;
  onStatus?: (message: string) => void;
}

// POST + consume a Server-Sent-Events stream of an AI note: `delta` chunks as
// the text generates, a final `done` carrying the full note, or `error`.
export async function streamJSON<T>(path: string, body: unknown, h: StreamHandlers<T>): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch { h.onError('Network error — is the API server running?'); return; }

  if (!res.ok || !res.body) {
    let msg = `${path} → ${res.status}`;
    try { const d = await res.json(); if (d?.error) msg = d.error; } catch { /* non-JSON */ }
    if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('alphanote:unauthorized'));
    h.onError(msg); return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split('\n\n');
    buf = events.pop() ?? '';
    for (const ev of events) {
      const dataLine = ev.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      let payload: { delta?: string; done?: boolean; note?: T; error?: string; status?: string };
      try { payload = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
      if (payload.error) h.onError(payload.error);
      else if (payload.done && payload.note) h.onDone(payload.note);
      else if (payload.delta) h.onDelta(payload.delta);
      else if (payload.status) h.onStatus?.(payload.status);
    }
  }
}

async function parse<T>(res: Response, path: string): Promise<T> {
  let data: any = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    // A 401 on any non-auth call means the session lapsed — let the app drop to login.
    if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('alphanote:unauthorized'));
    throw new Error((data && data.error) || `${path} → ${res.status}`);
  }
  return data as T;
}
