// Analytical helpers that sharpen raw signals before they reach the AI notes.
// Pure functions — unit-tested directly.

import { formatMarketCapValue } from './utils.js';

const usd = (v) => (Math.abs(v) >= 1e6 ? formatMarketCapValue(Math.abs(v)) : `$${Math.round(Math.abs(v)).toLocaleString('en-US')}`);

// Insider-signal quality. A flat list of Form 4 buys/sells is weak; what carries
// known signal is CLUSTERS of distinct insiders and the ROLE of the buyer
// (officer/director purchases > 10%-owner mechanical moves). Scores a symbol's
// open-market transactions into a labelled summary.
export function scoreInsiderActivity(txns = []) {
  const buys = txns.filter((t) => t.side === 'Buy');
  const sells = txns.filter((t) => t.side === 'Sell');
  const distinct = (rows) => new Set(rows.map((r) => (r.insider || '').toLowerCase()).filter(Boolean)).size;
  const distinctBuyers = distinct(buys);
  const distinctSellers = distinct(sells);
  const officerBuyers = distinct(buys.filter((t) => t.isOfficer || t.isDirector));
  const buyValue = buys.reduce((s, t) => s + (t.value || 0), 0);
  const sellValue = sells.reduce((s, t) => s + (t.value || 0), 0);
  const cluster = distinctBuyers >= 2;

  let label;
  if (distinctBuyers >= 2 && officerBuyers >= 1 && distinctSellers === 0) label = 'strong insider buy cluster';
  else if (distinctBuyers >= 2 && distinctSellers === 0) label = 'insider buy cluster';
  else if (buyValue > sellValue * 2 && distinctBuyers >= 1) label = 'net insider buying';
  else if (sellValue > buyValue * 2 && distinctSellers >= 1) label = 'net insider selling';
  else if (buys.length || sells.length) label = 'mixed insider activity';
  else label = 'no open-market insider activity';

  return {
    count: txns.length,
    buys: buys.length, sells: sells.length,
    distinctBuyers, distinctSellers, officerBuyers,
    buyValue, sellValue, netValue: buyValue - sellValue,
    cluster, label,
  };
}

// Prompt line summarising the scored insider signal (replaces a raw filing dump).
export function insiderScoreLine(score, symbol) {
  if (!score || score.count === 0) return null;
  const parts = [`Insider Form 4 signal for ${symbol}: ${score.label}.`];
  if (score.buys) parts.push(`${score.distinctBuyers} distinct buyer${score.distinctBuyers === 1 ? '' : 's'}${score.officerBuyers ? ` (${score.officerBuyers} officer/director)` : ''} bought ${usd(score.buyValue)}`);
  if (score.sells) parts.push(`${score.distinctSellers} distinct seller${score.distinctSellers === 1 ? '' : 's'} sold ${usd(score.sellValue)}`);
  if (score.cluster) parts.push('— a cluster of insiders acting together is a stronger signal than a single filing');
  return parts.join('; ') + '.';
}

// Peer-comparables prompt block from derived multiples. `rows` is the subject
// first, then peers: { symbol, name, marketCap, pe, ps, evEbitda, fcfYield }.
export function peerCompLines(rows) {
  const valid = rows.filter((r) => r && (r.pe != null || r.ps != null || r.evEbitda != null));
  if (valid.length < 2) return [];
  const lines = ['Peer comparables (derived multiples from market cap + TTM fundamentals; cite as "derived", verify):'];
  for (const r of valid) {
    const m = [];
    if (r.pe != null) m.push(`P/E ${r.pe}x`);
    if (r.ps != null) m.push(`P/S ${r.ps}x`);
    if (r.evEbitda != null) m.push(`EV/EBITDA ${r.evEbitda}x`);
    if (r.fcfYield != null) m.push(`FCF yld ${r.fcfYield}%`);
    lines.push(`- ${r.symbol}${r.subject ? ' (subject)' : ''}${r.name ? ` — ${r.name}` : ''}: ${m.join(', ') || 'n/a'}${r.marketCap ? ` [${usd(r.marketCap)} cap]` : ''}`);
  }
  return lines;
}
