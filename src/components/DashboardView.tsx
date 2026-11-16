import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Play,
  Square,
  X,
  ArrowUpRight,
  ArrowDownRight,
  PlugZap,
} from 'lucide-react';
import type { DashboardPayload } from '../types/trading';
import { apiRequest } from '../services/api';
import { EquityCurveChart } from './EquityCurveChart';

interface DashboardViewProps {
  data: DashboardPayload | null;
  loading: boolean;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
}

function fmtUsd(val: number | null) {
  if (val === null) return '—';
  const sign = val < 0 ? '-' : '';
  return `${sign}$${Math.abs(val).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function DashboardView({ data, loading, onRefresh, onNavigate }: DashboardViewProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmEmergency, setConfirmEmergency] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-[#0D1116] border border-[#1F2731] animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-lg bg-[#0D1116] border border-[#1F2731] animate-pulse" />
      </div>
    );
  }

  const { mt5, metrics, openPositions, pendingSignals, equityCurve, autoPilotStatus, aiEngineStatus, tradingMode, settings } = data;
  const isConnected = mt5.status === 'CONNECTED';

  const runAction = async (key: string, fn: () => Promise<string>) => {
    setBusyAction(key);
    setFeedback(null);
    try {
      const msg = await fn();
      setFeedback({ type: 'ok', text: msg });
      onRefresh();
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Operasi gagal.' });
    } finally {
      setBusyAction(null);
    }
  };

  const equityPoints = equityCurve.map((pt) => ({
    label: new Date(pt.timestamp).toLocaleTimeString(),
    equity: pt.equity,
  }));

  return (
    <div className="space-y-6">
      {/* Unconnected Honest Advisory Banner */}
      {!isConnected && (
        <div className="p-4 rounded-lg border border-amber-700/50 bg-amber-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-amber-300">
              MetaTrader 5 Bridge: NOT CONNECTED
            </p>
            <p className="text-xs text-slate-300 mt-1">
              Seluruh metrik akun menampilkan status belum terhubung (bukan angka simulasi palsu). Hubungkan Python FastAPI MT5 Bridge / MQL5 EA di VPS Windows Anda atau aktifkan Paper Sandbox untuk menguji eksekusi.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('mt5')}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-2"
          >
            <PlugZap className="w-4 h-4" />
            <span>Konfigurasi MT5 Bridge</span>
          </button>
        </div>
      )}

      {mt5.mode === 'paper_sandbox' && isConnected && (
        <div className="p-3.5 rounded-lg border border-sky-700/50 bg-sky-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="text-sky-200">
            <span className="font-semibold">Mode Pengujian Paper Sandbox Aktif</span> — Saldo dan eksekusi berjalan di sandbox lokal server untuk memverifikasi alur Risk Management, Trailing Stop, dan Auto Pilot sebelum menghubungkan akun MT5 riil.
          </div>
          <button
            type="button"
            onClick={() => onNavigate('mt5')}
            className="text-sky-300 hover:text-white underline whitespace-nowrap shrink-0"
          >
            Kelola Koneksi
          </button>
        </div>
      )}

      {settings.daily_locked && (
        <div className="p-4 rounded-lg border border-red-700/60 bg-red-950/30 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-red-300">Daily Trading Lock Aktif</p>
            <p className="text-xs text-red-200/80 mt-0.5">{settings.daily_lock_reason}</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="px-3 py-1.5 text-xs bg-red-900/60 hover:bg-red-800 text-white rounded-md whitespace-nowrap shrink-0"
          >
            Tinjau Risk Settings
          </button>
        </div>
      )}

      {feedback && (
        <div
          className={`p-3 rounded-lg border text-xs ${
            feedback.type === 'ok'
              ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-200'
              : 'bg-red-950/40 border-red-700/50 text-red-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Auto Pilot Primary Control Strip */}
      <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span>
              Mode: <strong className="text-white">{tradingMode}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Timeframe: <strong className="font-mono text-white">{settings.timeframe}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Risk/Trade: <strong className="font-mono text-emerald-400">{settings.risk_per_trade_pct}%</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Min R:R: <strong className="font-mono text-white">1:{settings.min_rr_ratio}</strong>
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {mt5.mode === 'paper_sandbox'
              ? 'Broker: Paper Sandbox Lokal'
              : isConnected
                ? `Broker: ${mt5.brokerName} (${mt5.serverName} · Login ${mt5.accountLogin})`
                : 'Menunggu koneksi MetaTrader 5 Bridge'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={busyAction !== null || autoPilotStatus === 'RUNNING' || !isConnected}
            onClick={() =>
              runAction('start', async () => {
                await apiRequest('/api/autopilot/start', { method: 'POST' });
                return 'Auto Pilot Trading Engine diaktifkan.';
              })
            }
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            <span>START AUTO PILOT</span>
          </button>

          <button
            type="button"
            disabled={busyAction !== null || autoPilotStatus !== 'RUNNING'}
            onClick={() =>
              runAction('stop', async () => {
                await apiRequest('/api/autopilot/stop', { method: 'POST' });
                return 'Auto Pilot Trading Engine dihentikan.';
              })
            }
            className="px-4 py-2 bg-[#161C24] hover:bg-[#1E2631] disabled:opacity-40 border border-[#2A3441] text-slate-100 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <Square className="w-3.5 h-3.5" />
            <span>STOP AUTO PILOT</span>
          </button>

          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => setConfirmEmergency(true)}
            className="px-4 py-2 bg-red-600/90 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>EMERGENCY CLOSE ALL</span>
          </button>
        </div>
      </div>

      {/* 12 Mandatory Dashboard Telemetry Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731]">
          <p className="text-xs text-slate-400">1. Total Balance</p>
          <p className="mt-1.5 text-xl font-mono font-semibold text-white tabular-nums">
            {fmtUsd(metrics.totalBalance)}
          </p>
        </div>

        <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731]">
          <p className="text-xs text-slate-400">2. Equity</p>
          <p className="mt-1.5 text-xl font-mono font-semibold text-white tabular-nums">
            {fmtUsd(metrics.equity)}
          </p>
        </div>

        <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731]">
          <p className="text-xs text-slate-400">3. Floating Profit/Loss</p>
          <p
            className={`mt-1.5 text-xl font-mono font-semibold tabular-nums ${
              metrics.floatingPnl === null
                ? 'text-slate-400'
                : metrics.floatingPnl >= 0
                  ? 'text-emerald-400'
                  : 'text-red-400'
            }`}
          >
            {fmtUsd(metrics.floatingPnl)}
          </p>
        </div>

        <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731]">
          <p className="text-xs text-slate-400">4. Total Profit Hari Ini</p>
          <p
            className={`mt-1.5 text-xl font-mono font-semibold tabular-nums ${
              metrics.todayProfit === null
                ? 'text-slate-400'
                : metrics.todayProfit >= 0
                  ? 'text-emerald-400'
                  : 'text-red-400'
            }`}
          >
            {fmtUsd(metrics.todayProfit)}
          </p>
        </div>

        <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731]">
          <p className="text-xs text-slate-400">5. Total Profit Bulanan</p>
          <p
            className={`mt-1.5 text-xl font-mono font-semibold tabular-nums ${
              metrics.monthlyProfit === null
                ? 'text-slate-400'
                : metrics.monthlyProfit >= 0
                  ? 'text-emerald-400'
                  : 'text-red-400'
            }`}
          >
            {fmtUsd(metrics.monthlyProfit)}
          </p>
        </div>

        <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731]">
          <p className="text-xs text-slate-400">6. Win Rate</p>
          <p className="mt-1.5 text-xl font-mono font-semibold text-white tabular-nums">
            {metrics.winRate === null ? '—' : `${metrics.winRate}%`}
          </p>
        </div>

        <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731]">
          <p className="text-xs text-slate-400">7. Total Transaksi</p>
          <p className="mt-1.5 text-xl font-mono font-semibold text-white tabular-nums">
            {metrics.totalTransactions}
          </p>
        </div>

        <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731]">
          <p className="text-xs text-slate-400">8 & 9. Posisi BUY / SELL</p>
          <div className="mt-1.5 flex items-center gap-4 font-mono text-lg font-semibold tabular-nums">
            <span className="text-emerald-400 flex items-center gap-1">
              <ArrowUpRight className="w-4 h-4" />
              {metrics.openBuyCount} BUY
            </span>
            <span className="text-red-400 flex items-center gap-1">
              <ArrowDownRight className="w-4 h-4" />
              {metrics.openSellCount} SELL
            </span>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731]">
          <p className="text-xs text-slate-400">10. Status Koneksi MT5</p>
          <p
            className={`mt-1.5 text-sm font-mono font-semibold ${
              isConnected ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {mt5.status}
          </p>
        </div>

        <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731]">
          <p className="text-xs text-slate-400">11. Status AI Engine</p>
          <p
            className={`mt-1.5 text-sm font-mono font-semibold ${
              aiEngineStatus === 'READY' ? 'text-emerald-400' : 'text-sky-400'
            }`}
          >
            {aiEngineStatus === 'READY' ? 'GEMINI AI READY' : 'QUANT DETERMINISTIC'}
          </p>
        </div>

        <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731] col-span-2">
          <p className="text-xs text-slate-400">12. Status Auto Pilot</p>
          <div className="mt-1.5 flex items-center justify-between">
            <span
              className={`text-sm font-mono font-semibold ${
                autoPilotStatus === 'RUNNING'
                  ? 'text-emerald-400'
                  : autoPilotStatus === 'LOCKED'
                    ? 'text-red-400'
                    : 'text-slate-300'
              }`}
            >
              {autoPilotStatus}
            </span>
            <span className="text-xs text-slate-400">
              Max Open: {openPositions.length}/{settings.max_open_positions}
            </span>
          </div>
        </div>
      </div>

      {/* Equity Curve */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-display font-semibold text-white">
            Grafik Pertumbuhan Saldo & Ekuitas Akun (Equity Curve)
          </h2>
          <span className="text-xs text-slate-400">
            {isConnected ? `Sumber: ${mt5.mode.toUpperCase()}` : 'Status: NOT CONNECTED'}
          </span>
        </div>
        <EquityCurveChart
          points={equityPoints}
          emptyTitle="Equity Curve Menunggu Koneksi Data Aktual"
          emptyDescription="Hubungkan MetaTrader 5 Bridge atau jalankan Paper Sandbox agar sistem dapat merekam pertumbuhan Balance dan Equity secara real-time."
        />
      </section>

      {/* Semi-Auto Pending Signals */}
      {pendingSignals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-display font-semibold text-white">
            Antrean Persetujuan Sinyal (Semi-Auto)
          </h2>
          <div className="border border-[#1F2731] rounded-lg overflow-hidden bg-[#0D1116] divide-y divide-[#1F2731]">
            {pendingSignals.map((sig) => (
              <div
                key={sig.id}
                className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5 text-sm">
                    <span className="font-mono font-semibold text-white">{sig.symbol}</span>
                    <span
                      className={`font-mono font-semibold ${
                        sig.direction === 'BUY' ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {sig.direction}
                    </span>
                    <span className="text-xs text-slate-400">
                      {sig.timeframe} · {sig.strategy_name} · Keyakinan {sig.confidence}% · R:R 1:{sig.rr_ratio}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-300 tabular-nums">
                    Entry: {sig.entry_price} · SL: {sig.sl} · TP: {sig.tp}
                  </p>
                  <p className="text-xs text-slate-400">{sig.reasoning}</p>
                  {sig.block_reason && (
                    <p className="text-xs text-red-400">Diblokir Risk Engine: {sig.block_reason}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busyAction !== null || sig.status === 'BLOCKED'}
                    onClick={() =>
                      runAction(`app-${sig.id}`, async () => {
                        const r = await apiRequest<{ message: string }>(
                          `/api/signals/${sig.id}/approve`,
                          { method: 'POST' }
                        );
                        return r.message;
                      })
                    }
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Setujui & Eksekusi</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() =>
                      runAction(`rej-${sig.id}`, async () => {
                        await apiRequest(`/api/signals/${sig.id}/reject`, { method: 'POST' });
                        return 'Sinyal ditolak.';
                      })
                    }
                    className="px-3 py-2 bg-[#161C24] hover:bg-[#1E2631] border border-[#2A3441] text-slate-300 text-xs font-medium rounded-lg flex items-center gap-1.5"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Tolak</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Open Positions Table */}
      <section className="space-y-3">
        <h2 className="text-sm font-display font-semibold text-white">
          Posisi Terbuka Aktif ({openPositions.length})
        </h2>
        {openPositions.length === 0 ? (
          <div className="p-6 text-center border border-[#1F2731] rounded-lg bg-[#0D1116] text-xs text-slate-400">
            Tidak ada posisi terbuka saat ini. Buka tab Analisis AI untuk mencari setup berkualitas atau jalankan Auto Pilot.
          </div>
        ) : (
          <div className="overflow-x-auto border border-[#1F2731] rounded-lg bg-[#0D1116]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#1F2731] text-slate-400 bg-[#0A0D11]">
                  <th className="py-2.5 px-3 font-medium">Ticket</th>
                  <th className="py-2.5 px-3 font-medium">Pair</th>
                  <th className="py-2.5 px-3 font-medium">Arah</th>
                  <th className="py-2.5 px-3 font-medium text-right">Lot</th>
                  <th className="py-2.5 px-3 font-medium text-right">Entry</th>
                  <th className="py-2.5 px-3 font-medium text-right">Harga Kini</th>
                  <th className="py-2.5 px-3 font-medium text-right">SL</th>
                  <th className="py-2.5 px-3 font-medium text-right">TP</th>
                  <th className="py-2.5 px-3 font-medium text-right">Floating P/L</th>
                  <th className="py-2.5 px-3 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2731] font-mono tabular-nums">
                {openPositions.map((p) => (
                  <tr key={p.ticket_id} className="hover:bg-[#12171E]">
                    <td className="py-2.5 px-3 text-slate-300">#{p.ticket_id}</td>
                    <td className="py-2.5 px-3 font-semibold text-white">{p.symbol}</td>
                    <td
                      className={`py-2.5 px-3 font-semibold ${
                        p.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {p.side}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200">{p.volume.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-300">{p.open_price}</td>
                    <td className="py-2.5 px-3 text-right text-white">{p.current_price}</td>
                    <td className="py-2.5 px-3 text-right text-red-400">{p.sl}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-400">{p.tp}</td>
                    <td
                      className={`py-2.5 px-3 text-right font-semibold ${
                        p.profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {fmtUsd(p.profit)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-sans">
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() =>
                          runAction(`close-${p.ticket_id}`, async () => {
                            const r = await apiRequest<{ message: string }>(
                              `/api/positions/${p.ticket_id}/close`,
                              { method: 'POST' }
                            );
                            return r.message;
                          })
                        }
                        className="px-2.5 py-1 bg-[#161C24] hover:bg-red-950/60 border border-[#2A3441] hover:border-red-700 text-slate-200 rounded text-[11px]"
                      >
                        Tutup
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Emergency Close All Confirmation Modal */}
      {confirmEmergency && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#0D1116] border border-red-800/70 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-base font-display font-semibold text-white">
                Konfirmasi Emergency Close All
              </h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Tindakan ini akan segera menghentikan Auto Pilot, membatalkan order tertunda di antrean, dan menutup <strong>hanya posisi yang dikelola oleh sistem NEXORA</strong>. Posisi manual di luar NEXORA tidak akan disentuh.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmEmergency(false)}
                className="px-4 py-2 text-xs font-medium text-slate-300 bg-[#161C24] hover:bg-[#1E2631] rounded-lg"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmEmergency(false);
                  runAction('emergency', async () => {
                    const r = await apiRequest<{ message: string }>(
                      '/api/autopilot/emergency-close-all',
                      { method: 'POST' }
                    );
                    return r.message;
                  });
                }}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg"
              >
                Ya, Hentikan & Tutup Posisi NEXORA
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
