// Detects ticker mentions inside AI note text so they can render as clickable
// chips. High-precision by design: only parenthesised forms count — "(HEI)",
// "(MOG.A)", "(TER:NASDAQ)", "(COHR, NYSE)" — the way the prompts format
// exposure lists and radar candidates. Bare uppercase words never match.

// Acronyms that appear in parens in finance prose but are never tickers here.
// An exchange-suffixed form ("(XXX:NYSE)") bypasses this list.
const NOT_TICKERS = new Set([
  'AI', 'AFFO', 'API', 'ARR', 'ASP', 'CAGR', 'CAP', 'CEO', 'CFO', 'COO', 'CPU', 'CTO',
  'DCF', 'DD', 'EBIT', 'EBITDA', 'EPS', 'ESG', 'ETF', 'EU', 'EUV', 'EV', 'FAA', 'FCC',
  'FCF', 'FDA', 'FY', 'GDP', 'GPU', 'HBM', 'IPO', 'IV', 'KPI', 'LTE', 'ML', 'NAV',
  'NRC', 'OCF', 'OEM', 'OTC', 'PB', 'PE', 'PS', 'QOQ', 'REIT', 'ROE', 'ROIC', 'SAM',
  'SEC', 'SOM', 'TAM', 'TBV', 'TTM', 'UK', 'US', 'USA', 'USD', 'WACC', 'WSB', 'YOY',
  'NYSE', 'NASDAQ', 'AMEX', 'LSE', 'TSX', 'ASX',
]);

export type TickerSegment =
  | { type: 'text'; value: string }
  | { type: 'ticker'; symbol: string; inner: string }; // inner = full text inside the parens

const PATTERN = /\(([A-Z][A-Z0-9.\-]{1,5})((?::\s*|,\s*)[A-Za-z .]{2,14})?\)/g;

export function splitTickerSegments(text: string): TickerSegment[] {
  const out: TickerSegment[] = [];
  let last = 0;
  for (const m of String(text).matchAll(PATTERN)) {
    const [full, symbol, suffix] = m;
    const hasExchange = Boolean(suffix);
    if (!hasExchange && NOT_TICKERS.has(symbol)) continue;
    if (m.index! > last) out.push({ type: 'text', value: text.slice(last, m.index) });
    out.push({ type: 'ticker', symbol, inner: full.slice(1, -1) });
    last = m.index! + full.length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out.length ? out : [{ type: 'text', value: text }];
}
