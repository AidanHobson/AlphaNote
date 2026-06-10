// Server-side helpers ported from the original OpenStock `lib/utils.ts`.

// Cap an in-memory Map cache so user-supplied keys (symbols, CIKs, queries) can't
// grow it without bound — evicts the oldest entry (Maps keep insertion order).
export function boundedSet(map, key, value, max) {
  if (!map.has(key) && map.size >= max) map.delete(map.keys().next().value);
  map.set(key, value);
}

export const getDateRange = (days) => {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(toDate.getDate() - days);
  return {
    to: toDate.toISOString().split('T')[0],
    from: fromDate.toISOString().split('T')[0],
  };
};

// Check for required article fields.
export const validateArticle = (article) =>
  Boolean(article && article.headline && article.summary && article.url && article.datetime);

export const formatArticle = (article, isCompanyNews, symbol, index = 0) => ({
  id: isCompanyNews ? Date.now() + Math.random() : article.id + index,
  headline: article.headline.trim(),
  summary: article.summary.trim().substring(0, isCompanyNews ? 200 : 150) + '…',
  source: article.source || (isCompanyNews ? 'Company News' : 'Market News'),
  url: article.url,
  datetime: article.datetime,
  image: article.image || '',
  category: isCompanyNews ? 'company' : article.category || 'general',
  related: isCompanyNews ? symbol : article.related || '',
});

export function formatMarketCapValue(marketCapUsd) {
  if (!Number.isFinite(marketCapUsd) || marketCapUsd <= 0) return 'N/A';
  if (marketCapUsd >= 1e12) return `$${(marketCapUsd / 1e12).toFixed(2)}T`;
  if (marketCapUsd >= 1e9) return `$${(marketCapUsd / 1e9).toFixed(2)}B`;
  if (marketCapUsd >= 1e6) return `$${(marketCapUsd / 1e6).toFixed(2)}M`;
  return `$${marketCapUsd.toFixed(2)}`;
}
