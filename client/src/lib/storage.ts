// Local persistence (no DB, consistent with the focused build): watchlist + notes.
// Notes are AlphaNote's signature feature — per-symbol research you can export.

const WL_KEY = 'alphanote:watchlist';
const NOTES_KEY = 'alphanote:notes';

export interface Note { symbol: string; text: string; updatedAt: number; }

function emit() { window.dispatchEvent(new Event('alphanote:storage')); }

// ── Watchlist ────────────────────────────────────────────────────────────────
export function getWatchlist(): string[] {
  try { return JSON.parse(localStorage.getItem(WL_KEY) || '[]'); } catch { return []; }
}
export function isInWatchlist(symbol: string): boolean { return getWatchlist().includes(symbol.toUpperCase()); }
export function toggleWatchlist(symbol: string): boolean {
  const s = symbol.toUpperCase();
  const list = getWatchlist();
  const i = list.indexOf(s);
  let added: boolean;
  if (i >= 0) { list.splice(i, 1); added = false; } else { list.push(s); added = true; }
  localStorage.setItem(WL_KEY, JSON.stringify(list));
  emit();
  return added;
}

// ── Notes ────────────────────────────────────────────────────────────────────
export function getNotes(): Record<string, Note> {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) || '{}'); } catch { return {}; }
}
export function getNote(symbol: string): Note | undefined { return getNotes()[symbol.toUpperCase()]; }
export function saveNote(symbol: string, text: string): void {
  const notes = getNotes();
  const s = symbol.toUpperCase();
  if (text.trim()) notes[s] = { symbol: s, text, updatedAt: Date.now() };
  else delete notes[s];
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  emit();
}
export function deleteNote(symbol: string): void {
  const notes = getNotes();
  delete notes[symbol.toUpperCase()];
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  emit();
}

export function onStorageChange(cb: () => void): () => void {
  window.addEventListener('alphanote:storage', cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener('alphanote:storage', cb); window.removeEventListener('storage', cb); };
}
