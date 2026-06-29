export function formatPrice(price?: number, currency = 'USD'): string {
  if (price == null || Number.isNaN(price)) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(price);
  } catch {
    return `$${price.toFixed(2)}`;
  }
}

export function formatPct(dp?: number): string {
  if (dp == null || Number.isNaN(dp)) return '—';
  return `${dp > 0 ? '+' : ''}${dp.toFixed(2)}%`;
}

export function changeDir(dp?: number): 'up' | 'down' | 'flat' {
  if (!dp) return 'flat';
  return dp > 0 ? 'up' : 'down';
}

export function arrow(dp?: number): string {
  if (!dp) return '→';
  return dp > 0 ? '▲' : '▼';
}

export function formatMarketCap(millions?: number): string {
  if (!millions) return '—';
  const v = millions * 1e6;
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(0)}`;
}

export function timeAgo(unixSeconds: number): string {
  const mins = Math.floor((Date.now() - unixSeconds * 1000) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// The UI is model-agnostic — it never surfaces the underlying model's name.
export const providerLabel = (_p: string): string => 'AI';
