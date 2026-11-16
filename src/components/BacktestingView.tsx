import { useEffect, useState } from 'react';
import { FlaskConical, Upload } from 'lucide-react';
import type { Instrument, Strategy, Timeframe } from '../types/trading';
import { apiRequest } from '../services/api';
import { EquityCurveChart } from './EquityCurveChart';

const TIMEFRAMES: Timeframe[] = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

interface BacktestRunResponse {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  strategyName: string;
  dataSource: string;
  totalBars: number;
  splitBreakdown: {
    train: { trades: number; winRate: number; netProfit: number; profitFactor: number };
    validation: { trades: number; winRate: number; netProfit: number; profitFactor: number };
    outOfSample: { trades: number; winRate: number; netProfit: number; profitFactor: number };
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
  trades: Array<{
    id: number;
    phase: string;
    side: string;
    lot: number;
    entryPrice: number;
    exitPrice: number;
    netPnl: number;
    cost: number;
    exitReason: string;
  }>;
}

export function BacktestingView() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [symbol, setSymbol] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('H1');
  const [strategyId, setStrategyId] = useState('strat-trend');
  const [initialBalance, setInitialBalance] = useState(10000);
  const [riskPct, setRiskPct] = useState(0.5);
  const [spreadPoints, setSpreadPoints] = useState(12);
  const [commission, setCommission] = useState(7);
  const [slippagePoints, setSlippagePoints] = useState(2);
  const [bars, setBars] = useState(600);
  const [csvContent, setCsvContent] = useState('');
  const [csvName, setCsvName] = useState('');

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestRunResponse | null>(null);

  useEffect(() => {
    Promise.all([
      apiRequest<{ instruments: Instrument[] }>('/api/instruments'),
      apiRequest<{ strategies: Strategy[] }>('/api/strategies'),
    ]).then(([iRes, sRes]) => {
      setInstruments(iRes.instruments);
      setStrategies(sRes.strategies);
    });
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsvContent(String(reader.result || ''));
    reader.readAsText(file);
  };

  const runBacktest = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setError(null);
    try {
      const res = await apiRequest<BacktestRunResponse>('/api/backtest/run', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          timeframe,
          strategyId,
          initialBalance,
          riskPerTradePct: riskPct,
          spreadPoints,
          commissionPerLot: commission,
          slippagePoints,
          bars,
          csvContent: csvContent || undefined,
        }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest gagal.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={runBacktest}
        className="p-5 rounded-lg bg-[#0D1116] border border-[#1F2731] space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-display font-semibold text-white">
              Walk-Forward Backtesting Engine (Anti-Overfitting)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Menguji 1 strategi secara terisolasi dengan pemisahan data Training (60%), Validation (20%), dan Out-of-Sample (20%), termasuk spread, komisi, dan slippage.
            </p>
          </div>
          <label className="px-3 py-1.5 bg-[#161C24] hover:bg-[#1E2631] border border-[#2A3441] rounded-lg text-xs text-slate-200 cursor-pointer flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" />
            <span>{csvName ? `CSV: ${csvName}` : 'Unggah CSV OHLCV (Opsional)'}</span>
            <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>

        {error && (
          <div className="p-3 rounded bg-red-950/40 border border-red-700/50 text-xs text-red-200">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-xs">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Pair</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full px-2.5 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            >
              {instruments.map((i) => (
                <option key={i.symbol} value={i.symbol}>
                  {i.symbol}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Timeframe</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              className="w-full px-2.5 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] text-slate-400 mb-1">Strategi Tunggal</label>
            <select
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
              className="w-full px-2.5 py-2 bg-[#07090B] border border-[#1F2731] rounded text-white"
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Modal ($)</label>
            <input
              type="number"
              min="500"
              value={initialBalance}
              onChange={(e) => setInitialBalance(Number(e.target.value))}
              className="w-full px-2.5 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Risiko (%)</label>
            <input
              type="number"
              step="0.05"
              min="0.25"
              max="2"
              value={riskPct}
              onChange={(e) => setRiskPct(Number(e.target.value))}
              className="w-full px-2.5 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Spread (pts)</label>
            <input
              type="number"
              min="0"
              value={spreadPoints}
              onChange={(e) => setSpreadPoints(Number(e.target.value))}
              className="w-full px-2.5 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Komisi/Lot ($)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={commission}
              onChange={(e) => setCommission(Number(e.target.value))}
              className="w-full px-2.5 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <label className="flex items-center gap-2">
              <span>Slippage (pts):</span>
              <input
                type="number"
                min="0"
                value={slippagePoints}
                onChange={(e) => setSlippagePoints(Number(e.target.value))}
                className="w-16 px-2 py-1 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
              />
            </label>
            {!csvContent && (
              <label className="flex items-center gap-2">
                <span>Jumlah Bar Historis:</span>
                <input
                  type="number"
                  min="250"
                  max="1200"
                  step="50"
                  value={bars}
                  onChange={(e) => setBars(Number(e.target.value))}
                  className="w-20 px-2 py-1 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
                />
              </label>
            )}
          </div>

          <button
            type="submit"
            disabled={running}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-2"
          >
            <FlaskConical className="w-4 h-4" />
            <span>{running ? 'Menjalankan Simulasi Historis...' : 'Jalankan Backtest'}</span>
          </button>
        </div>
      </form>

      {result && (
        <div className="space-y-5">
          {/* 8 Mandatory Backtest Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-lg bg-[#0D1116] border border-[#1F2731]">
              <p className="text-xs text-slate-400">Total Trades</p>
              <p className="mt-1 text-lg font-mono font-semibold text-white tabular-nums">
                {result.metrics.totalTrades}
              </p>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0D1116] border border-[#1F2731]">
              <p className="text-xs text-slate-400">Win Rate</p>
              <p className="mt-1 text-lg font-mono font-semibold text-white tabular-nums">
                {result.metrics.winRate}%
              </p>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0D1116] border border-[#1F2731]">
              <p className="text-xs text-slate-400">Profit Factor</p>
              <p className="mt-1 text-lg font-mono font-semibold text-emerald-400 tabular-nums">
                {result.metrics.profitFactor}
              </p>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0D1116] border border-[#1F2731]">
              <p className="text-xs text-slate-400">Net Profit</p>
              <p
                className={`mt-1 text-lg font-mono font-semibold tabular-nums ${
                  result.metrics.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                ${result.metrics.netProfit.toFixed(2)}
              </p>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0D1116] border border-[#1F2731]">
              <p className="text-xs text-slate-400">Maximum Drawdown</p>
              <p className="mt-1 text-lg font-mono font-semibold text-red-400 tabular-nums">
                {result.metrics.maxDrawdownPct}%
              </p>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0D1116] border border-[#1F2731]">
              <p className="text-xs text-slate-400">Average Risk/Reward</p>
              <p className="mt-1 text-lg font-mono font-semibold text-white tabular-nums">
                1 : {result.metrics.averageRr}
              </p>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0D1116] border border-[#1F2731]">
              <p className="text-xs text-slate-400">Consecutive Losses</p>
              <p className="mt-1 text-lg font-mono font-semibold text-amber-400 tabular-nums">
                {result.metrics.consecutiveLosses}
              </p>
            </div>
            <div className="p-3.5 rounded-lg bg-[#0D1116] border border-[#1F2731]">
              <p className="text-xs text-slate-400">Final Balance</p>
              <p className="mt-1 text-lg font-mono font-semibold text-white tabular-nums">
                ${result.metrics.finalBalance.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Train / Validation / Out-Of-Sample Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            {[
              { title: 'Training Split (60%)', data: result.splitBreakdown.train },
              { title: 'Validation Split (20%)', data: result.splitBreakdown.validation },
              { title: 'Out-of-Sample Split (20%)', data: result.splitBreakdown.outOfSample },
            ].map((phase) => (
              <div
                key={phase.title}
                className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731] space-y-2"
              >
                <p className="font-semibold text-white">{phase.title}</p>
                <div className="grid grid-cols-2 gap-2 font-mono text-slate-300 tabular-nums">
                  <span>Trades: {phase.data.trades}</span>
                  <span>Win Rate: {phase.data.winRate}%</span>
                  <span>PF: {phase.data.profitFactor}</span>
                  <span className={phase.data.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    PnL: ${phase.data.netProfit}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Backtest Equity Curve */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <h3 className="font-display font-semibold text-white">
                Backtest Equity Curve ({result.symbol} · {result.timeframe} · {result.strategyName})
              </h3>
              <span className="font-mono text-slate-400">
                Data: {result.dataSource} ({result.totalBars} bars)
              </span>
            </div>
            <EquityCurveChart
              points={result.equityCurve.map((pt) => ({
                label: `Bar ${pt.bar}`,
                equity: pt.equity,
                phase: pt.phase,
              }))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
