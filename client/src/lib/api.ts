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
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Network error — is the API server running?');
  }
  return parse<T>(res, path);
}

async function parse<T>(res: Response, path: string): Promise<T> {
  let data: any = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error((data && data.error) || `${path} → ${res.status}`);
  return data as T;
}
