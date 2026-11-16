import { useCallback, useEffect, useState } from 'react';
import { BrainCircuit, RefreshCw, ShieldAlert, Send } from 'lucide-react';
import type {
  Candle,
  Instrument,
  Strategy,
  TechnicalSnapshot,
  Timeframe,
} from '../types/trading';
import { apiRequest } from '../services/api';
import { CandlestickChart } from './CandlestickChart';

const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

interface AnalysisResult {
  deterministic: {
    direction: 'BUY' | 'SELL' | 'WAIT';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    riskRewardRatio: number;
    confidence: number;
    marketCondition: string;
    reasons: string[];
    snapshot: TechnicalSnapshot;
  };
  ai: {
    aiPowered: boolean;
    model: string;
    direction: 'BUY' | 'SELL' | 'WAIT';
    marketCondition: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    riskRewardRatio: number;
    confidence: number;
    reasoning: string;
    keyLevelsSummary: string;
    invalidationCriteria: string;
    probabilisticWarning: string;
    error?: string;
  };
  riskPreview: {
    approved: boolean;
    reasons: string[];
    calculatedLot: number;
    riskAmountUsd: number;
    slPips: number;
    rrRatio: number;
  } | null;
}

export function AnalysisView({ onOrderExecuted }: { onOrderExecuted: () => void }) {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [symbol, setSymbol] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState<Timeframe>('H1');
  const [strategyId, setStrategyId] = useState('strat-trend');

  const [candles, setCandles] = useState<Candle[]>([]);
  const [snapshot, setSnapshot] = useState<TechnicalSnapshot | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [runningAi, setRunningAi] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [orderMsg, setOrderMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Manual ticket override inputs
  const [manualSide, setManualSide] = useState<'BUY' | 'SELL'>('BUY');
  const [manualSl, setManualSl] = useState('');
  const [manualTp, setManualTp] = useState('');

  useEffect(() => {
    Promise.all([
      apiRequest<{ instruments: Instrument[] }>('/api/instruments'),
      apiRequest<{ strategies: Strategy[] }>('/api/strategies'),
    ]).then(([iRes, sRes]) => {
      setInstruments(iRes.instruments);
      setStrategies(sRes.strategies);
    });
  }, []);

  const loadMarket = useCallback(async () => {
    setLoadingChart(true);
    try {
      const res = await apiRequest<{ candles: Candle[]; snapshot: TechnicalSnapshot }>(
        `/api/market/candles?symbol=${symbol}&timeframe=${timeframe}`
      );
      setCandles(res.candles);
      setSnapshot(res.snapshot);
    } finally {
      setLoadingChart(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    loadMarket();
  }, [loadMarket]);

  const runAnalysis = async () => {
    setRunningAi(true);
    setOrderMsg(null);
    try {
      const res = await apiRequest<AnalysisResult>('/api/analysis/run', {
        method: 'POST',
        body: JSON.stringify({ symbol, timeframe, strategyId }),
      });
      setAnalysis(res);
      setSnapshot(res.deterministic.snapshot);
      if (res.ai.direction === 'BUY' || res.ai.direction === 'SELL') {
        setManualSide(res.ai.direction);
        setManualSl(String(res.ai.stopLoss));
        setManualTp(String(res.ai.takeProfit));
      }
    } catch (err) {
      setOrderMsg({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menjalankan analisis.' });
    } finally {
      setRunningAi(false);
    }
  };

  const executeOrder = async (side: 'BUY' | 'SELL', sl: number, tp: number, entry?: number) => {
    setExecuting(true);
    setOrderMsg(null);
    try {
      const res = await apiRequest<{ message: string }>('/api/orders/execute', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          side,
          entryPrice: entry ?? 0,
          stopLoss: sl,
          takeProfit: tp,
          strategyId,
          entryReason: analysis?.ai.reasoning || `Manual execution on ${symbol} ${timeframe}`,
          idempotencyKey: `ui_${symbol}_${side}_${Math.floor(Date.now() / 5000)}`,
        }),
      });
      setOrderMsg({ type: 'ok', text: res.message });
      onOrderExecuted();
    } catch (err) {
      setOrderMsg({ type: 'err', text: err instanceof Error ? err.message : 'Order ditolak.' });
    } finally {
      setExecuting(false);
    }
  };

  const activeInst = instruments.find((i) => i.symbol === symbol);
  const digits = activeInst?.digits ?? (symbol.includes('JPY') ? 3 : symbol === 'XAUUSD' ? 2 : 5);

  return (
    <div className="space-y-6">
      {/* Control Toolbar */}
      <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731] flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={symbol}
            onChange={(e) => {
              setSymbol(e.target.value);
              setAnalysis(null);
            }}
            className="px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded-lg text-xs font-mono text-white"
          >
            {(instruments.length ? instruments : [{ symbol: 'EURUSD' }]).map((inst) => (
              <option key={inst.symbol} value={inst.symbol}>
                {inst.symbol}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 p-1 bg-[#07090B] border border-[#1F2731] rounded-lg overflow-x-auto">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  setTimeframe(tf);
                  setAnalysis(null);
                }}
                className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-emerald-600 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <select
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
            className="px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded-lg text-xs text-white"
          >
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                Strategi: {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadMarket}
            disabled={loadingChart}
            className="px-3 py-2 bg-[#161C24] hover:bg-[#1E2631] border border-[#2A3441] text-slate-200 text-xs rounded-lg flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingChart ? 'animate-spin' : ''}`} />
            <span>Segarkan</span>
          </button>
          <button
            type="button"
            onClick={runAnalysis}
            disabled={runningAi}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-2 whitespace-nowrap"
          >
            <BrainCircuit className="w-4 h-4" />
            <span>{runningAi ? 'Menganalisis Pasar...' : 'Jalankan AI Market Analysis'}</span>
          </button>
        </div>
      </div>

      {/* Main Split: Chart + Technical Matrix & AI Output */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8 space-y-4">
          <CandlestickChart
            candles={candles}
            symbol={symbol}
            digits={digits}
            entryPrice={analysis?.ai.entryPrice}
            stopLoss={analysis?.ai.stopLoss}
            takeProfit={analysis?.ai.takeProfit}
            supportLevels={snapshot?.supportLevels}
            resistanceLevels={snapshot?.resistanceLevels}
          />

          {/* Technical Indicator Matrix */}
          {snapshot && (
            <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-display font-semibold text-white">
                  Matriks Indikator Teknikal & Struktur Harga
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  Feed: {snapshot.dataSource} · Spread: {snapshot.spreadPoints} pts
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-2.5 bg-[#090C10] border border-[#1A212B] rounded">
                  <p className="text-slate-400">EMA 20 / 50 / 200</p>
                  <p className="mt-1 font-mono text-white tabular-nums">
                    {snapshot.ema20} / {snapshot.ema50} / {snapshot.ema200}
                  </p>
                </div>
                <div className="p-2.5 bg-[#090C10] border border-[#1A212B] rounded">
                  <p className="text-slate-400">RSI (14) & MACD Hist</p>
                  <p className="mt-1 font-mono text-white tabular-nums">
                    RSI {snapshot.rsi14} · {snapshot.macd.histogram}
                  </p>
                </div>
                <div className="p-2.5 bg-[#090C10] border border-[#1A212B] rounded">
                  <p className="text-slate-400">ATR (14) & Volatilitas</p>
                  <p className="mt-1 font-mono text-white tabular-nums">
                    {snapshot.atr14} · {snapshot.volatilityRegime}
                  </p>
                </div>
                <div className="p-2.5 bg-[#090C10] border border-[#1A212B] rounded">
                  <p className="text-slate-400">Multi-Timeframe ({snapshot.multiTimeframeAlignment.higherTimeframe})</p>
                  <p
                    className={`mt-1 font-mono font-semibold ${
                      snapshot.multiTimeframeAlignment.aligned ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {snapshot.multiTimeframeAlignment.higherTrend} (
                    {snapshot.multiTimeframeAlignment.aligned ? 'Selaras' : 'Divergen'})
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
                <div className="space-y-1">
                  <p className="text-slate-400">
                    Pola Candlestick:{' '}
                    <span className="text-slate-200">
                      {snapshot.candlestickPatterns.join(', ') || 'Tidak ada pola dominan'}
                    </span>
                  </p>
                  <p className="text-slate-400">
                    Breakout & Retest:{' '}
                    <span className="text-slate-200">{snapshot.breakoutStatus}</span>
                  </p>
                </div>
                <div className="space-y-1 font-mono">
                  <p className="text-slate-400">
                    Support:{' '}
                    <span className="text-emerald-400">
                      {snapshot.supportLevels.join(' · ') || '—'}
                    </span>
                  </p>
                  <p className="text-slate-400">
                    Resistance:{' '}
                    <span className="text-red-400">
                      {snapshot.resistanceLevels.join(' · ') || '—'}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel: AI Signal Output + Risk-Validated Order Ticket */}
        <div className="xl:col-span-4 space-y-4">
          <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-display font-semibold text-white">
                Keputusan Analisis AI
              </h3>
              {analysis && (
                <span className="text-[11px] font-mono text-slate-400">
                  {analysis.ai.aiPowered ? analysis.ai.model : 'Deterministic'}
                </span>
              )}
            </div>

            {!analysis ? (
              <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                <p>Klik "Jalankan AI Market Analysis" untuk mengevaluasi struktur pasar, indikator, dan sinyal strategi saat ini.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-3 rounded-lg bg-[#090C10] border border-[#1F2731] flex items-center justify-between">
                  <div>
                    <p className="text-[11px] text-slate-400">Rekomendasi Arah</p>
                    <p
                      className={`text-xl font-mono font-bold ${
                        analysis.ai.direction === 'BUY'
                          ? 'text-emerald-400'
                          : analysis.ai.direction === 'SELL'
                            ? 'text-red-400'
                            : 'text-amber-400'
                      }`}
                    >
                      {analysis.ai.direction === 'WAIT' ? 'WAIT / NO TRADE' : analysis.ai.direction}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-400">Kondisi · Keyakinan</p>
                    <p className="text-sm font-mono text-white">
                      {analysis.ai.marketCondition} · {analysis.ai.confidence}%
                    </p>
                  </div>
                </div>

                {analysis.ai.direction !== 'WAIT' && (
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                    <div className="p-2.5 bg-[#090C10] border border-[#1A212B] rounded">
                      <span className="text-slate-400 block text-[11px]">Entry</span>
                      <span className="text-white font-semibold">{analysis.ai.entryPrice}</span>
                    </div>
                    <div className="p-2.5 bg-[#090C10] border border-[#1A212B] rounded">
                      <span className="text-slate-400 block text-[11px]">Risk / Reward</span>
                      <span className="text-emerald-400 font-semibold">
                        1 : {analysis.ai.riskRewardRatio}
                      </span>
                    </div>
                    <div className="p-2.5 bg-[#090C10] border border-[#1A212B] rounded">
                      <span className="text-slate-400 block text-[11px]">Stop Loss (Wajib)</span>
                      <span className="text-red-400 font-semibold">{analysis.ai.stopLoss}</span>
                    </div>
                    <div className="p-2.5 bg-[#090C10] border border-[#1A212B] rounded">
                      <span className="text-slate-400 block text-[11px]">Take Profit</span>
                      <span className="text-emerald-400 font-semibold">{analysis.ai.takeProfit}</span>
                    </div>
                  </div>
                )}

                <div className="text-xs text-slate-300 leading-relaxed bg-[#090C10] p-3 rounded border border-[#1A212B]">
                  <p className="font-semibold text-white mb-1">Alasan Analisis:</p>
                  <p>{analysis.ai.reasoning}</p>
                  <p className="text-slate-400 mt-2">
                    <strong className="text-slate-300">Invalidasi:</strong> {analysis.ai.invalidationCriteria}
                  </p>
                </div>

                <p className="text-[11px] text-amber-300/90 flex items-start gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{analysis.ai.probabilisticWarning}</span>
                </p>

                {analysis.riskPreview && (
                  <div
                    className={`p-3 rounded border text-xs ${
                      analysis.riskPreview.approved
                        ? 'bg-emerald-950/30 border-emerald-700/50 text-emerald-200'
                        : 'bg-red-950/30 border-red-700/50 text-red-200'
                    }`}
                  >
                    <p className="font-semibold">
                      Validasi Risk Engine:{' '}
                      {analysis.riskPreview.approved
                        ? `LOLOS (Auto Lot ${analysis.riskPreview.calculatedLot})`
                        : 'DIBLOKIR'}
                    </p>
                    {!analysis.riskPreview.approved && (
                      <ul className="mt-1 list-disc list-inside space-y-0.5 text-[11px]">
                        {analysis.riskPreview.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {analysis.ai.direction !== 'WAIT' && (
                  <button
                    type="button"
                    disabled={executing || !analysis.riskPreview?.approved}
                    onClick={() =>
                      executeOrder(
                        analysis.ai.direction as 'BUY' | 'SELL',
                        analysis.ai.stopLoss,
                        analysis.ai.takeProfit,
                        analysis.ai.entryPrice
                      )
                    }
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>
                      {executing
                        ? 'Mengirim Order...'
                        : `Eksekusi Sinyal ${analysis.ai.direction} (Lot Otomatis)`}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Manual Execution Ticket (Mode 1) */}
          <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731] space-y-3">
            <h3 className="text-sm font-display font-semibold text-white">
              Eksekusi Manual (Tervalidasi Risiko)
            </h3>
            <p className="text-[11px] text-slate-400">
              Lot dihitung otomatis oleh Risk Engine (0.25%–2% equity) dan Stop Loss wajib diisi.
            </p>

            {orderMsg && (
              <div
                className={`p-2.5 rounded text-xs border ${
                  orderMsg.type === 'ok'
                    ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-200'
                    : 'bg-red-950/40 border-red-700/50 text-red-200'
                }`}
              >
                {orderMsg.text}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setManualSide('BUY')}
                className={`py-2 text-xs font-mono font-semibold rounded-lg border ${
                  manualSide === 'BUY'
                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300'
                    : 'bg-[#090C10] border-[#1F2731] text-slate-400'
                }`}
              >
                BUY {snapshot ? snapshot.ask.toFixed(digits) : ''}
              </button>
              <button
                type="button"
                onClick={() => setManualSide('SELL')}
                className={`py-2 text-xs font-mono font-semibold rounded-lg border ${
                  manualSide === 'SELL'
                    ? 'bg-red-600/20 border-red-500 text-red-300'
                    : 'bg-[#090C10] border-[#1F2731] text-slate-400'
                }`}
              >
                SELL {snapshot ? snapshot.bid.toFixed(digits) : ''}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Stop Loss (Wajib)</label>
                <input
                  type="number"
                  step="any"
                  value={manualSl}
                  onChange={(e) => setManualSl(e.target.value)}
                  placeholder="Contoh: 1.0800"
                  className="w-full px-2.5 py-2 bg-[#07090B] border border-[#1F2731] rounded text-xs font-mono text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Take Profit (Min 1:2)</label>
                <input
                  type="number"
                  step="any"
                  value={manualTp}
                  onChange={(e) => setManualTp(e.target.value)}
                  placeholder="Contoh: 1.0935"
                  className="w-full px-2.5 py-2 bg-[#07090B] border border-[#1F2731] rounded text-xs font-mono text-white"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={executing}
              onClick={() => executeOrder(manualSide, Number(manualSl), Number(manualTp))}
              className="w-full py-2.5 bg-[#161C24] hover:bg-[#1E2631] border border-[#2A3441] text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Kirim Order {manualSide} {symbol}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
