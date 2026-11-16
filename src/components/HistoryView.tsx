import { useEffect, useState } from 'react';
import { Download, Shield } from 'lucide-react';
import type { TradeHistoryRow } from '../types/trading';
import { apiRequest } from '../services/api';

interface AuditRow {
  id: string;
  actorEmail: string;
  action: string;
  category: string;
  details: Record<string, unknown>;
  status: string;
  ip: string;
  createdAt: string;
}

export function HistoryView() {
  const [tab, setTab] = useState<'trades' | 'audit'>('trades');
  const [trades, setTrades] = useState<TradeHistoryRow[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [symbol, setSymbol] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const loadTrades = async () => {
    const params = new URLSearchParams();
    if (symbol !== 'ALL') params.set('symbol', symbol);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const res = await apiRequest<{ trades: TradeHistoryRow[] }>(`/api/history?${params.toString()}`);
    setTrades(res.trades);
  };

  const loadAudits = async () => {
    const res = await apiRequest<{ logs: AuditRow[] }>('/api/audit-logs');
    setAudits(res.logs);
  };

  useEffect(() => {
    if (tab === 'trades') loadTrades();
    else loadAudits();
  }, [tab, symbol, startDate, endDate]);

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-[#07090B] border border-[#1F2731] rounded-lg">
          <button
            type="button"
            onClick={() => setTab('trades')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded ${
              tab === 'trades' ? 'bg-[#161C24] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Riwayat Transaksi
          </button>
          <button
            type="button"
            onClick={() => setTab('audit')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded flex items-center gap-1.5 ${
              tab === 'audit' ? 'bg-[#161C24] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Security Audit Log</span>
          </button>
        </div>

        {tab === 'trades' && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="px-2.5 py-1.5 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            >
              <option value="ALL">Semua Pair</option>
              {['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'XAUUSD'].map(
                (p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                )
              )}
            </select>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-2.5 py-1.5 bg-[#07090B] border border-[#1F2731] rounded text-white"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-2.5 py-1.5 bg-[#07090B] border border-[#1F2731] rounded text-white"
            />
            <a
              href="/api/history/export.csv"
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Ekspor CSV</span>
            </a>
          </div>
        )}
      </div>

      {tab === 'trades' ? (
        trades.length === 0 ? (
          <div className="p-8 text-center border border-[#1F2731] rounded-lg bg-[#0D1116] text-xs text-slate-400">
            Belum ada transaksi tertutup yang tercatat. Transaksi yang dieksekusi melalui MT5 Bridge atau Paper Sandbox akan muncul lengkap dengan alasan entry dan exit.
          </div>
        ) : (
          <div className="overflow-x-auto border border-[#1F2731] rounded-lg bg-[#0D1116]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#1F2731] bg-[#0A0D11] text-slate-400">
                  <th className="py-2.5 px-3 font-medium">Waktu Tutup</th>
                  <th className="py-2.5 px-3 font-medium">Pair</th>
                  <th className="py-2.5 px-3 font-medium">Arah</th>
                  <th className="py-2.5 px-3 font-medium text-right">Lot</th>
                  <th className="py-2.5 px-3 font-medium text-right">Entry</th>
                  <th className="py-2.5 px-3 font-medium text-right">Exit</th>
                  <th className="py-2.5 px-3 font-medium text-right">SL / TP</th>
                  <th className="py-2.5 px-3 font-medium text-right">Profit/Loss</th>
                  <th className="py-2.5 px-3 font-medium">Strategi</th>
                  <th className="py-2.5 px-3 font-medium">Alasan Entry / Exit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2731]">
                {trades.map((t) => (
                  <tr key={t.id} className="hover:bg-[#12171E]">
                    <td className="py-2.5 px-3 font-mono text-slate-300 tabular-nums whitespace-nowrap">
                      {new Date(t.closed_at).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-white">{t.symbol}</td>
                    <td
                      className={`py-2.5 px-3 font-mono font-semibold ${
                        t.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {t.side}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{t.volume.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{t.entry_price}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{t.exit_price}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-400 tabular-nums">
                      {t.sl} / {t.tp}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${
                        t.profit_loss >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      ${t.profit_loss.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-200">{t.strategy_name}</td>
                    <td className="py-2.5 px-3 text-slate-400 max-w-xs truncate" title={`${t.entry_reason} → ${t.exit_reason}`}>
                      {t.entry_reason} · <strong className="text-slate-300">{t.exit_reason}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="overflow-x-auto border border-[#1F2731] rounded-lg bg-[#0D1116]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#1F2731] bg-[#0A0D11] text-slate-400">
                <th className="py-2.5 px-3 font-medium">Waktu</th>
                <th className="py-2.5 px-3 font-medium">Kategori</th>
                <th className="py-2.5 px-3 font-medium">Aksi</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium">Operator</th>
                <th className="py-2.5 px-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2731]">
              {audits.map((a) => (
                <tr key={a.id} className="hover:bg-[#12171E]">
                  <td className="py-2.5 px-3 font-mono text-slate-300 whitespace-nowrap">
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-300">{a.category}</td>
                  <td className="py-2.5 px-3 font-mono text-white">{a.action}</td>
                  <td
                    className={`py-2.5 px-3 font-mono font-semibold ${
                      a.status === 'SUCCESS'
                        ? 'text-emerald-400'
                        : a.status === 'BLOCKED'
                          ? 'text-amber-400'
                          : 'text-red-400'
                    }`}
                  >
                    {a.status}
                  </td>
                  <td className="py-2.5 px-3 text-slate-300">{a.actorEmail}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-400 max-w-md truncate">
                    {JSON.stringify(a.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
