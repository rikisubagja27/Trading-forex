import crypto from 'node:crypto';
import type { Candle, Instrument, Strategy, Timeframe } from './types.ts';
import { buildTechnicalSnapshot, evaluateStrategySignal } from './quantEngine.ts';

export interface BacktestConfig {
  symbol: string;
  timeframe: Timeframe;
  strategy: Strategy;
  instrument: Instrument;
  candles: Candle[];
  dataSource: string;
  initialBalance: number;
  riskPerTradePct: number;
  spreadPoints: number;
  commissionPerLot: number;
  slippagePoints: number;
  minRrRatio: number;
}

export interface BacktestTrade {
  id: number;
  phase: 'TRAIN' | 'VALIDATION' | 'OUT_OF_SAMPLE';
  side: 'BUY' | 'SELL';
  lot: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  sl: number;
  tp: number;
  rr: number;
  grossPnl: number;
  cost: number;
  netPnl: number;
  exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'END_OF_SAMPLE';
}

export interface PhaseMetrics {
  trades: number;
  winRate: number;
  netProfit: number;
  profitFactor: number;
}

export interface BacktestResult {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  strategyId: string;
  strategyName: string;
  dataSource: string;
  totalBars: number;
  splitBreakdown: {
    train: PhaseMetrics;
    validation: PhaseMetrics;
    outOfSample: PhaseMetrics;
  };
  metrics: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    netProfit: number;
    maxDrawdownPct: number;
    averageRr: number;
    consecutiveLosses: number;
    finalBalance: number;
  };
  equityCurve: Array<{ bar: number; time: number; equity: number; phase: string }>;
  trades: BacktestTrade[];
}

function computePhaseMetrics(trades: BacktestTrade[]): PhaseMetrics {
  if (trades.length === 0) {
    return { trades: 0, winRate: 0, netProfit: 0, profitFactor: 0 };
  }
  const wins = trades.filter((t) => t.netPnl > 0);
  const grossWin = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(
    trades.filter((t) => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0)
  );
  const netProfit = trades.reduce((s, t) => s + t.netPnl, 0);
  return {
    trades: trades.length,
    winRate: Number(((wins.length / trades.length) * 100).toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : 0,
  };
}

export function runWalkForwardBacktest(cfg: BacktestConfig): BacktestResult {
  const {
    symbol,
    timeframe,
    strategy,
    instrument,
    candles,
    dataSource,
    initialBalance,
    riskPerTradePct,
    spreadPoints,
    commissionPerLot,
    slippagePoints,
    minRrRatio,
  } = cfg;

  const warmup = 65;
  const totalBars = candles.length;
  const trainEnd = Math.floor(warmup + (totalBars - warmup) * 0.6);
  const valEnd = Math.floor(warmup + (totalBars - warmup) * 0.8);

  const pointSize = Math.pow(10, -instrument.digits);
  const halfSpread = (spreadPoints * pointSize) / 2;
  const slippagePrice = slippagePoints * pointSize;

  let balance = initialBalance;
  let peakBalance = initialBalance;
  let maxDrawdownPct = 0;

  let activeTrade: {
    side: 'BUY' | 'SELL';
    lot: number;
    entryTime: number;
    entryPrice: number;
    sl: number;
    tp: number;
    rr: number;
    phase: 'TRAIN' | 'VALIDATION' | 'OUT_OF_SAMPLE';
  } | null = null;

  const trades: BacktestTrade[] = [];
  const equityCurve: Array<{ bar: number; time: number; equity: number; phase: string }> = [
    { bar: warmup, time: candles[warmup]?.time ?? 0, equity: initialBalance, phase: 'TRAIN' },
  ];

  const pipValuePerLot = symbol.endsWith('JPY')
    ? (instrument.pip_size * instrument.contract_size) / Math.max(1, candles[warmup]?.close ?? 150)
    : instrument.pip_size * instrument.contract_size;

  for (let i = warmup; i < totalBars; i++) {
    const bar = candles[i];
    const phase: 'TRAIN' | 'VALIDATION' | 'OUT_OF_SAMPLE' =
      i < trainEnd ? 'TRAIN' : i < valEnd ? 'VALIDATION' : 'OUT_OF_SAMPLE';

    // Check open position exit on current bar
    if (activeTrade) {
      let exitPrice: number | null = null;
      let exitReason: BacktestTrade['exitReason'] | null = null;

      if (activeTrade.side === 'BUY') {
        if (bar.low <= activeTrade.sl) {
          exitPrice = activeTrade.sl - slippagePrice;
          exitReason = 'STOP_LOSS';
        } else if (bar.high >= activeTrade.tp) {
          exitPrice = activeTrade.tp - slippagePrice * 0.5;
          exitReason = 'TAKE_PROFIT';
        }
      } else {
        if (bar.high >= activeTrade.sl) {
          exitPrice = activeTrade.sl + slippagePrice;
          exitReason = 'STOP_LOSS';
        } else if (bar.low <= activeTrade.tp) {
          exitPrice = activeTrade.tp + slippagePrice * 0.5;
          exitReason = 'TAKE_PROFIT';
        }
      }

      if (i === totalBars - 1 && exitPrice === null) {
        exitPrice = bar.close;
        exitReason = 'END_OF_SAMPLE';
      }

      if (exitPrice !== null && exitReason !== null) {
        const priceDiff =
          activeTrade.side === 'BUY'
            ? exitPrice - activeTrade.entryPrice
            : activeTrade.entryPrice - exitPrice;
        const pips = priceDiff / instrument.pip_size;
        const grossPnl = pips * pipValuePerLot * activeTrade.lot;
        const cost = commissionPerLot * activeTrade.lot;
        const netPnl = grossPnl - cost;

        balance += netPnl;
        peakBalance = Math.max(peakBalance, balance);
        const dd = peakBalance > 0 ? ((peakBalance - balance) / peakBalance) * 100 : 0;
        maxDrawdownPct = Math.max(maxDrawdownPct, dd);

        trades.push({
          id: trades.length + 1,
          phase: activeTrade.phase,
          side: activeTrade.side,
          lot: activeTrade.lot,
          entryTime: activeTrade.entryTime,
          exitTime: bar.time,
          entryPrice: Number(activeTrade.entryPrice.toFixed(instrument.digits)),
          exitPrice: Number(exitPrice.toFixed(instrument.digits)),
          sl: activeTrade.sl,
          tp: activeTrade.tp,
          rr: activeTrade.rr,
          grossPnl: Number(grossPnl.toFixed(2)),
          cost: Number(cost.toFixed(2)),
          netPnl: Number(netPnl.toFixed(2)),
          exitReason,
        });

        equityCurve.push({
          bar: i,
          time: bar.time,
          equity: Number(balance.toFixed(2)),
          phase,
        });

        activeTrade = null;
      }
      continue;
    }

    // Evaluate deterministic signal on closed window [0..i]
    if (i >= totalBars - 2) continue;
    const windowSlice = candles.slice(Math.max(0, i - 205), i + 1);
    const snapshot = buildTechnicalSnapshot({
      symbol,
      timeframe,
      candles: windowSlice,
      dataSource: 'PUBLIC_SPOT_BENCHMARK',
      spreadPoints,
      instrument,
    });

    const sig = evaluateStrategySignal({
      candles: windowSlice,
      snapshot,
      strategy,
      instrument,
      minRrRatio,
    });

    if (sig.direction === 'BUY' || sig.direction === 'SELL') {
      const nextOpen = candles[i + 1].open;
      const fillPrice =
        sig.direction === 'BUY'
          ? nextOpen + halfSpread + slippagePrice
          : nextOpen - halfSpread - slippagePrice;

      const slDist = Math.abs(sig.entryPrice - sig.stopLoss);
      const tpDist = Math.abs(sig.takeProfit - sig.entryPrice);
      const sl =
        sig.direction === 'BUY'
          ? Number((fillPrice - slDist).toFixed(instrument.digits))
          : Number((fillPrice + slDist).toFixed(instrument.digits));
      const tp =
        sig.direction === 'BUY'
          ? Number((fillPrice + tpDist).toFixed(instrument.digits))
          : Number((fillPrice - tpDist).toFixed(instrument.digits));

      const slPips = Math.max(5, slDist / instrument.pip_size);
      const riskUsd = balance * (Math.min(2, Math.max(0.25, riskPerTradePct)) / 100);
      const rawLot = riskUsd / (slPips * pipValuePerLot);
      const lot = Math.max(instrument.min_lot, Math.min(instrument.max_lot, Math.floor(rawLot * 100) / 100));

      activeTrade = {
        side: sig.direction,
        lot,
        entryTime: candles[i + 1].time,
        entryPrice: fillPrice,
        sl,
        tp,
        rr: sig.riskRewardRatio,
        phase,
      };
    }
  }

  let consecutiveLosses = 0;
  let curStreak = 0;
  for (const t of trades) {
    if (t.netPnl < 0) {
      curStreak++;
      consecutiveLosses = Math.max(consecutiveLosses, curStreak);
    } else {
      curStreak = 0;
    }
  }

  const wins = trades.filter((t) => t.netPnl > 0);
  const grossWin = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(
    trades.filter((t) => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0)
  );
  const avgRr =
    trades.length > 0
      ? trades.reduce((s, t) => s + t.rr, 0) / trades.length
      : 0;

  return {
    id: crypto.randomUUID(),
    symbol,
    timeframe,
    strategyId: strategy.id,
    strategyName: strategy.name,
    dataSource,
    totalBars,
    splitBreakdown: {
      train: computePhaseMetrics(trades.filter((t) => t.phase === 'TRAIN')),
      validation: computePhaseMetrics(trades.filter((t) => t.phase === 'VALIDATION')),
      outOfSample: computePhaseMetrics(trades.filter((t) => t.phase === 'OUT_OF_SAMPLE')),
    },
    metrics: {
      totalTrades: trades.length,
      winRate: trades.length > 0 ? Number(((wins.length / trades.length) * 100).toFixed(2)) : 0,
      profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : 0,
      netProfit: Number((balance - initialBalance).toFixed(2)),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      averageRr: Number(avgRr.toFixed(2)),
      consecutiveLosses,
      finalBalance: Number(balance.toFixed(2)),
    },
    equityCurve,
    trades,
  };
}
