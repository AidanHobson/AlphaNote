// Backend constants ported from the original OpenStock `lib/constants.ts`.
// (TradingView widget configs live in /public/js/tradingview-configs.js because
// the widgets render client-side and contain no secrets.)

export const POPULAR_STOCK_SYMBOLS = [
  // Tech Giants
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'NFLX', 'ORCL', 'CRM',
  // Growing tech
  'ADBE', 'INTC', 'AMD', 'PYPL', 'UBER', 'SPOT', 'SHOP', 'ROKU',
  // Newer tech
  'SNOW', 'PLTR', 'COIN', 'RBLX', 'DDOG', 'CRWD', 'NET', 'OKTA', 'TWLO',
  // Consumer
  'PINS', 'SNAP', 'LYFT', 'DASH', 'ABNB', 'RIVN', 'LCID', 'NIO',
  // International
  'XPEV', 'LI', 'BABA', 'JD', 'PDD', 'TME', 'BILI', 'SE',
];

// Finnhub uses a dot-suffix convention for non-US exchanges (e.g. "2330.TW").
export const FINNHUB_EXCHANGE_SUFFIXES = new Set([
  'AS', 'AT', 'AX', 'BA', 'BK', 'BO', 'BR', 'CO', 'DE', 'F', 'HE', 'HK',
  'IL', 'IS', 'JK', 'JO', 'KL', 'KQ', 'KS', 'L', 'LS', 'MC', 'MI', 'MX',
  'NS', 'NZ', 'OL', 'PA', 'PR', 'SA', 'SI', 'SS', 'ST', 'SW', 'SZ', 'T',
  'TA', 'TO', 'TW', 'TWO', 'V', 'VI', 'WA',
]);
