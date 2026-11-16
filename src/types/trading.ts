export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';
export type TradingMode = 'MANUAL' | 'SEMI_AUTO' | 'FULL_AUTO';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'trader' | 'viewer';
}

export interface Mt5State {
  mode: 'disconnected' | 'remote_bridge' | 'ea_push' | 'paper_sandbox';
  status: 'NOT CONNECTED' | 'CONNECTED' | 'ERROR';
  bridgeUrl: string;
  accountLogin: string;
  serverName: string;
  brokerName: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  currency: string;
  leverage: number;
  lastHeartbeat: string | null;
  bridgeApiKeyMasked: string;
}

export interface AutoPilotSettings {
  user_id: string;
  trading_mode: TradingMode;
  active_strategy_id: string;
  timeframe: Timeframe;
  risk_per_trade_pct: number;
  max_lot: number;
  daily_profit_target_pct: number;
  max_daily_loss_pct: number;
  max_drawdown_pct: number;
  max_open_positions: number;
  max_trades_per_day: number;
  min_rr_ratio: number;
  trading_hours_start: string;
  trading_hours_end: string;
  news_filter_enabled: boolean;
  news_buffer_minutes: number;
  trailing_stop_enabled: boolean;
  trailing_stop_pips: number;
  auto_break_even_enabled: boolean;
  break_even_trigger_pips: number;
  spread_protection_enabled: boolean;
  volatility_protection_enabled: boolean;
  engine_running: boolean;
  daily_locked: boolean;
  daily_lock_reason: string | null;
  updated_at: string;
}

export interface OpenPosition {
  ticket_id: string;
  source: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  open_price: number;
  current_price: number;
  sl: number;
  tp: number;
  profit: number;
  strategy_id: string;
  entry_reason: string;
  managed_by_nexora: number;
  break_even_applied: number;
  opened_at: string;
}

export interface PendingSignal {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  strategy_id: string;
  strategy_name: string;
  direction: 'BUY' | 'SELL' | 'WAIT';
  entry_price: number;
  sl: number;
  tp: number;
  rr_ratio: number;
  confidence: number;
  market_condition: string;
  reasoning: string;
  status: 'PENDING_APPROVAL' | 'BLOCKED' | 'EXECUTED' | 'REJECTED';
  block_reason: string | null;
  created_at: string;
}

export interface DashboardPayload {
  mt5: Mt5State;
  aiEngineStatus: 'READY' | 'DETERMINISTIC_ONLY';
  autoPilotStatus: 'RUNNING' | 'STOPPED' | 'LOCKED';
  tradingMode: TradingMode;
  metrics: {
    totalBalance: number | null;
    equity: number | null;
    floatingPnl: number | null;
    todayProfit: number | null;
    monthlyProfit: number | null;
    winRate: number | null;
    totalTransactions: number;
    openBuyCount: number;
    openSellCount: number;
  };
  openPositions: OpenPosition[];
  pendingSignals: PendingSignal[];
  equityCurve: Array<{ balance: number; equity: number; timestamp: string; source: string }>;
  settings: AutoPilotSettings;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalSnapshot {
  symbol: string;
  timeframe: Timeframe;
  dataSource: 'MT5_LIVE_FEED' | 'PUBLIC_SPOT_BENCHMARK';
  lastPrice: number;
  bid: number;
  ask: number;
  spreadPoints: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  macd: { line: number; signal: number; histogram: number };
  bollinger: { upper: number; middle: number; lower: number; bandwidthPct: number };
  atr14: number;
  atrAvg50: number;
  volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  marketCondition: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  supportLevels: number[];
  resistanceLevels: number[];
  demandZones: Array<{ low: number; high: number }>;
  supplyZones: Array<{ low: number; high: number }>;
  candlestickPatterns: string[];
  breakoutStatus: string;
  multiTimeframeAlignment: {
    primary: string;
    higherTimeframe: Timeframe;
    higherTrend: string;
    aligned: boolean;
  };
}

export interface Instrument {
  symbol: string;
  enabled: boolean;
  digits: number;
  contract_size: number;
  pip_size: number;
  min_lot: number;
  max_lot: number;
  max_spread_points: number;
  category: string;
}

export interface Strategy {
  id: string;
  name: string;
  slug: string;
  description: string;
  timeframe: Timeframe;
  entry_rules: string[];
  exit_rules: string[];
  sl_atr_mult: number;
  tp_rr_ratio: number;
  trailing_stop_pips: number;
  params: Record<string, number | boolean | string>;
  enabled: boolean;
  updated_at: string;
}

export interface EconomicEvent {
  id: string;
  title: string;
  currency: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  scheduled_at: string;
  forecast: string;
  previous: string;
  actual: string;
}

export interface TradeHistoryRow {
  id: string;
  ticket_id: string;
  source: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  entry_price: number;
  exit_price: number;
  sl: number;
  tp: number;
  profit_loss: number;
  commission: number;
  swap: number;
  strategy_name: string;
  entry_reason: string;
  exit_reason: string;
  opened_at: string;
  closed_at: string;
}
