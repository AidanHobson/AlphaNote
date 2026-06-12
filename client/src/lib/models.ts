export interface SearchResult { symbol: string; name: string; exchange: string; type: string; }
export interface Quote { c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number; }
export interface Profile { name?: string; ticker?: string; exchange?: string; currency?: string; logo?: string; marketCapitalization?: number; finnhubIndustry?: string; country?: string; weburl?: string; }
export interface MoverItem {
  symbol: string; name: string; price: number; change: number; changePercent: number;
  currency: string; logo: string; exchange: string; marketCap: number;
}
export interface CommodityItem { symbol: string; label: string; price: number; change: number; changePercent: number; }
export interface CommoditiesBoard { items: CommodityItem[]; }
export interface NewsArticle { id: number; headline: string; summary: string; source: string; url: string; datetime: number; }
export interface Regime { label: string; breadth: number; avgChange: number; advancers: number; decliners: number; total: number; }
export interface MarketBrief { generatedAt: string; regime: Regime; provider: string; fellBack: boolean; text: string; movers: MoverItem[]; }
export interface MacroItem { symbol: string; label: string; price: number; change: number; changePercent: number; }
export interface MacroGroup { name: string; items: MacroItem[]; }
export interface MacroTone { tone: string; equities: number; gold: number; tlt: number; hyg: number; dollar: number; oil: number; }
export interface MacroBoard { groups: MacroGroup[]; tone: MacroTone; }
export interface MacroBrief { generatedAt: string; tone: MacroTone; provider: string; fellBack: boolean; text: string; }
export interface FactorItem { symbol: string; label: string; changePercent: number; price: number; }
export interface FactorSpread { label: string; long: string; short: string; value: number; }
export interface FactorBoard { factors: FactorItem[]; spreads: FactorSpread[]; leader: FactorItem; laggard: FactorItem; market: number; }
export interface FactorBrief { generatedAt: string; leader: FactorItem; laggard: FactorItem; provider: string; fellBack: boolean; text: string; }
export interface EarningsItem {
  date: string; symbol: string; hour: string; epsEstimate: number | null; epsActual: number | null;
  revenueEstimate: number | null; quarter: number | null; year: number | null; hasEstimate: boolean; inWatchlist: boolean;
}
export interface EarningsResponse { from: string; days: number; count: number; items: EarningsItem[]; }
export interface AnalystConsensus { label: string; score: number; total: number; }
export interface AnalystPeriod { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; consensus: AnalystConsensus; }
export interface AnalystRatings {
  symbol: string; hasCoverage: boolean; consensus: AnalystConsensus;
  latest: { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
  history: AnalystPeriod[]; priceTargetNote: string;
}
export interface IndicatorPoint { year: string; value: number; }
export interface Indicator { code: string; label: string; unit: string; good: 'low' | 'high' | 'neutral'; country: string; freq?: string; latest: IndicatorPoint | null; prev: IndicatorPoint | null; history: IndicatorPoint[]; }
export interface IndicatorsResponse { country: string; source: string; indicators: Indicator[]; }
export interface YieldPoint { label: string; years: number; value: number; prior: number | null; }
export interface YieldCurve { available: boolean; reason?: string; asOf?: string | null; curve: YieldPoint[]; spread2s10s?: number | null; inverted?: boolean | null; }
export interface EconEvent { date: string; time: string; country: string; event: string; impact: string; actual: number | null; estimate: number | null; prev: number | null; unit: string; }
export interface EconCalendar { days: number; count: number; highCount: number; items: EconEvent[]; }
export interface EconBrief { generatedAt: string; provider: string; fellBack: boolean; text: string; }
export interface ValMetric {
  key: string; label: string; unit: string; description: string; available: boolean; reason?: string;
  asOf: string; asOfDate: string; value: number; mom: number;
  valuePercentile: number; richPercentile: number; richWhen: 'high' | 'low';
  spark: number[]; history: { date: string; value: number }[];
}
export interface MarketValuation { tab: string; generatedAt: string; metrics: ValMetric[]; }
export interface SmartManager { cik: number; name: string; short: string; }
export interface SmartHolding {
  name: string; klass: string; ticker: string | null;
  value: number; shares: number; pct: number;
  change: { type: 'new' | 'add' | 'trim' | 'flat'; sharesPct?: number };
}
export interface SmartBoard {
  available: boolean; reason?: string;
  manager?: { cik: number; name: string };
  period?: string; priorPeriod?: string | null;
  totalValue?: number; positions?: number;
  holdings?: SmartHolding[];
  exits?: { name: string; cusip: string; priorValue: number }[];
  source?: string;
}
export interface SizePeriod { label: string; small: number | null; large: number | null; spread: number | null; }
export interface SizeBoard {
  available: boolean; reason?: string; generatedAt?: string; source?: string;
  small?: { symbol: string; label: string; lastClose: number };
  large?: { symbol: string; label: string; lastClose: number };
  periods?: SizePeriod[];
  ratio?: { date: string; value: number }[];
}
export interface HistoryPoint { date: string; close: number; volume: number | null; }
export interface PriceHistory {
  symbol: string; available: boolean; reason?: string; source?: string;
  points?: HistoryPoint[];
  stats?: { first: string; last: string; lastClose: number; changePercent: number; high: number; low: number };
}
export interface FundamentalLine {
  key: string; label: string; unit: 'usd' | 'perShare'; kind: 'flow' | 'balance';
  latest: number | null;
  current: { value: number; asOf: string; basis: 'ttm' | 'fy' | 'latest' } | null;
  history: { fy: number; val: number }[];
}
export interface FundamentalRatio { label: string; value: number; unit: '%' | 'x'; }
export interface Fundamentals {
  symbol: string; available: boolean; reason?: string;
  source?: string; cik?: string; name?: string; asOfFY?: number; currentThrough?: string | null;
  lineItems?: FundamentalLine[]; ratios?: FundamentalRatio[];
}
export interface RiskMetric extends ValMetric { riskWhen: 'high' | 'low'; changeLabel: string; }
export interface RiskGroup { key: string; name: string; blurb: string; stress: number; label: string; history: number[]; metrics: RiskMetric[]; }
export interface RiskBoard { generatedAt: string; overall: number; label: string; history: number[]; groups: RiskGroup[]; }
export interface RiskBrief { generatedAt: string; overall: number; label: string; provider: string; fellBack: boolean; text: string; }
export interface InsiderTxn {
  id: string; symbol: string; company: string; sector: string; marketCap: number; insider: string;
  title: string; isOfficer: boolean; isDirector: boolean; isTenPercent: boolean; plan: string;
  side: 'Buy' | 'Sell'; code: string; shares: number; price: number; value: number; transactionDate: string; filingDate: string;
}
export interface InsiderResponse { generatedAt: string; source: string; count: number; tickers: number; transactions: InsiderTxn[]; }
export interface Insight {
  symbol: string; provider: string; fellBack: boolean; text: string;
  data: { name: string; price: number; change: number; changePercent: number; currency: string; logo: string };
}
export interface OutlookNote {
  topic: string; mode: 'stock' | 'theme'; speculative: true;
  provider: string; fellBack: boolean; text: string; generatedAt: string; cached: boolean;
  data: {
    name: string; price?: number; change?: number; changePercent?: number; currency?: string; logo?: string;
    social?: string[]; buzz?: { rank: number; mentions: number };
  };
}
export interface BuzzPost { title: string; subreddit: string; score: number; comments: number }
export interface BuzzItem {
  symbol: string; mentions: number; engagement: number; subreddits: string[];
  topPost: BuzzPost | null; posts?: BuzzPost[];
  today?: { mentions: number; engagement: number }; rising?: boolean;
  name?: string; quote?: { price: number; changePercent: number };
}
export interface BuzzBoard {
  generatedAt: string; window: string; subreddits: string[]; postsScanned: number;
  available: boolean; reason?: string; items: BuzzItem[];
}
export interface BuzzBrief {
  provider: string; fellBack: boolean; text: string; generatedAt: string; boardGeneratedAt: string; cached: boolean;
}
export interface ResearchNote {
  symbol: string; provider: string; fellBack: boolean; text: string; generatedAt: string; cached: boolean;
  data: {
    name: string; price: number; change: number; changePercent: number; currency: string; logo: string;
    hasFundamentals: boolean; hasHistory: boolean; insiderCount: number;
    hasValuation?: boolean; managers13F?: number; nextEarnings?: string | null;
  };
}
