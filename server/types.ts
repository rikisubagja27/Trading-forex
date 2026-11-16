export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';
export type TradingMode = 'MANUAL' | 'SEMI_AUTO' | 'FULL_AUTO';
export type UserRole = 'admin' | 'trader' | 'viewer';
export type ConnectionMode = 'disconnected' | 'remote_bridge' | 'ea_push' | 'paper_sandbox';
export type TradeDirection = 'BUY' | 'SELL' | 'WAIT';
export type MarketCondition = 'BULLISH' | 'BEARISH' | 'SIDEWAYS';

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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

export interface AutoPilotSettings {
  user_id: string;
  trading_mode: TradingMode;
  active_strategy_id: string;
  timeframe: Timeframe;
  risk_per_trade_pct: number; // 0.25 to 2.0, default 0.5
  max_lot: number;
  daily_profit_target_pct: number;
  max_daily_loss_pct: number;
  max_drawdown_pct: number;
  max_open_positions: number;
  max_trades_per_day: number;
  min_rr_ratio: number; // default 2.0 (1:2)
  trading_hours_start: string; // HH:MM UTC
  trading_hours_end: string; // HH:MM UTC
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
  marketCondition: MarketCondition;
  supportLevels: number[];
  resistanceLevels: number[];
  demandZones: Array<{ low: number; high: number }>;
  supplyZones: Array<{ low: number; high: number }>;
  candlestickPatterns: string[];
  breakoutStatus: string;
  multiTimeframeAlignment: {
    primary: MarketCondition;
    higherTimeframe: Timeframe;
    higherTrend: MarketCondition;
    aligned: boolean;
  };
}

export interface DeterministicSignal {
  symbol: string;
  timeframe: Timeframe;
  strategyId: string;
  strategyName: string;
  direction: TradeDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  confidence: number;
  marketCondition: MarketCondition;
  reasons: string[];
  snapshot: TechnicalSnapshot;
}

export interface RiskCheckResult {
  approved: boolean;
  reasons: string[];
  calculatedLot: number;
  riskAmountUsd: number;
  slPips: number;
  rrRatio: number;
}
