// TradingView widget configs (from OpenStock). Client-side, no secrets.

export const SYMBOL_INFO = (symbol: string) => ({
  symbol: symbol.toUpperCase(), colorTheme: 'dark', isTransparent: true, locale: 'en', width: '100%', height: 170,
});

export const ADVANCED_CHART = (symbol: string, theme = 'dark') => ({
  allow_symbol_change: false, calendar: false, details: true, hide_side_toolbar: true,
  hide_top_toolbar: false, hide_legend: false, hide_volume: false, interval: 'D', locale: 'en',
  save_image: false, style: 1, symbol: symbol.toUpperCase(), theme,
  backgroundColor: theme === 'dark' ? '#151a20' : '#ffffff', gridColor: 'rgba(127,127,127,0.1)',
  withdateranges: false, width: '100%', height: 460,
});

export const TECHNICAL = (symbol: string, theme = 'dark') => ({
  symbol: symbol.toUpperCase(), colorTheme: theme, isTransparent: true, locale: 'en',
  width: '100%', height: 400, interval: '1D',
});

export const SYMBOL_PROFILE = (symbol: string, theme = 'dark') => ({
  // TradingView's `company-profile` embed 403s now; `symbol-profile` is current.
  symbol: symbol.toUpperCase(), colorTheme: theme, isTransparent: true, locale: 'en', width: '100%', height: 390,
});

export const FINANCIALS = (symbol: string, theme = 'dark') => ({
  symbol: symbol.toUpperCase(), colorTheme: theme, isTransparent: true, locale: 'en',
  width: '100%', height: 440, displayMode: 'regular',
});
