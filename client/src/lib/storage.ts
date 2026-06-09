// Per-user persistence for watchlist + notes. Backed by the server (SQLite) and
// scoped to the logged-in account. An in-memory cache keeps the read API
// synchronous (so components are unchanged); writes update the cache, emit a
// change event, and debounce-sync to the server.

import { getJSON, putJSON } from './api';

export interface Note { symbol: string; text: string; updatedAt: number; }

let state: { watchlist: string[]; notes: Record<string, Note> } = { watchlist: [], notes: {} };

function emit() { window.dispatchEvent(new Event('alphanote:storage')); }

let syncTimer: number | undefined;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    putJSON('/api/user/state', { watchlist: state.watchlist, notes: state.notes }).catch(() => {
      /* transient — the next change re-sends the full state */
    });
  }, 400);
}

// Called by the auth layer after sign-in; loads this user's saved state.
export async function hydrateUserState(): Promise<void> {
  try {
    const d = await getJSON<{ watchlist: string[]; notes: Record<string, Note> }>('/api/user/state');
    state = { watchlist: Array.isArray(d.watchlist) ? d.watchlist : [], notes: d.notes || {} };
    emit();
  } catch { /* unauth handled by the auth layer */ }
}
export function resetUserState(): void { state = { watchlist: [], notes: {} }; emit(); }

// ── Watchlist ────────────────────────────────────────────────────────────────
export function getWatchlist(): string[] { return state.watchlist; }
export function isInWatchlist(symbol: string): boolean { return state.watchlist.includes(symbol.toUpperCase()); }
export function toggleWatchlist(symbol: string): boolean {
  const s = symbol.toUpperCase();
  const i = state.watchlist.indexOf(s);
  const added = i < 0;
  state.watchlist = added ? [...state.watchlist, s] : state.watchlist.filter((x) => x !== s);
  emit(); scheduleSync();
  return added;
}

// ── Notes ────────────────────────────────────────────────────────────────────
export function getNotes(): Record<string, Note> { return state.notes; }
export function getNote(symbol: string): Note | undefined { return state.notes[symbol.toUpperCase()]; }
export function saveNote(symbol: string, text: string): void {
  const s = symbol.toUpperCase();
  const notes = { ...state.notes };
  if (text.trim()) notes[s] = { symbol: s, text, updatedAt: Date.now() };
  else delete notes[s];
  state.notes = notes; emit(); scheduleSync();
}
export function deleteNote(symbol: string): void {
  const notes = { ...state.notes };
  delete notes[symbol.toUpperCase()];
  state.notes = notes; emit(); scheduleSync();
}

export function onStorageChange(cb: () => void): () => void {
  window.addEventListener('alphanote:storage', cb);
  return () => window.removeEventListener('alphanote:storage', cb);
}
