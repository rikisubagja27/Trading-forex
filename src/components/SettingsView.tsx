import { useEffect, useState } from 'react';
import { Save, ShieldCheck, Unlock } from 'lucide-react';
import type { AutoPilotSettings, Instrument, Strategy, Timeframe, TradingMode } from '../types/trading';
import { apiRequest } from '../services/api';

const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

export function SettingsView({ onUpdated }: { onUpdated: () => void }) {
  const [settings, setSettings] = useState<AutoPilotSettings | null>(null);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    Promise.all([
      apiRequest<{ settings: AutoPilotSettings }>('/api/settings'),
      apiRequest<{ instruments: Instrument[] }>('/api/instruments'),
      apiRequest<{ strategies: Strategy[] }>('/api/strategies'),
    ]).then(([setRes, instRes, stratRes]) => {
      setSettings(setRes.settings);
      setInstruments(instRes.instruments);
      setStrategies(stratRes.strategies);
    });
  }, []);

  const saveSettings = async (unlockDaily = false) => {
    if (!settings) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiRequest<{ settings: AutoPilotSettings }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ ...settings, unlock_daily_lock: unlockDaily }),
      });
      setSettings(res.settings);
      setMsg({
        type: 'ok',
        text: unlockDaily
          ? 'Daily Trading Lock dibuka dan pengaturan disimpan.'
          : 'Pengaturan Auto Pilot & Risk Management berhasil disimpan.',
      });
      onUpdated();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Gagal menyimpan.' });
    } finally {
      setSaving(false);
    }
  };

  const toggleInstrument = async (inst: Instrument, nextEnabled: boolean, nextSpread?: number) => {
    try {
      const res = await apiRequest<{ instruments: Instrument[] }>(
        `/api/instruments/${inst.symbol}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            enabled: nextEnabled,
            max_spread_points: nextSpread ?? inst.max_spread_points,
          }),
        }
      );
      setInstruments(res.instruments);
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Gagal memperbarui pair.' });
    }
  };

  if (!settings) {
    return <div className="h-64 rounded-lg bg-[#0D1116] border border-[#1F2731] animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      {msg && (
        <div
          className={`p-3 rounded-lg border text-xs ${
            msg.type === 'ok'
              ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-200'
              : 'bg-red-950/40 border-red-700/50 text-red-200'
          }`}
        >
          {msg.text}
        </div>
      )}

      {settings.daily_locked && (
        <div className="p-4 rounded-lg bg-red-950/30 border border-red-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-red-300">Daily Trading Lock Sedang Aktif</p>
            <p className="text-xs text-red-200/80 mt-0.5">{settings.daily_lock_reason}</p>
          </div>
          <button
            type="button"
            onClick={() => saveSettings(true)}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 whitespace-nowrap"
          >
            <Unlock className="w-3.5 h-3.5" />
            <span>Reset Daily Lock</span>
          </button>
        </div>
      )}

      {/* Auto Pilot & Risk Management Form */}
      <div className="p-5 rounded-lg bg-[#0D1116] border border-[#1F2731] space-y-5">
        <div className="flex items-center justify-between border-b border-[#1F2731] pb-3">
          <div>
            <h2 className="text-sm font-display font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Pengaturan Auto Pilot & Manajemen Risiko Ketat</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Tidak menggunakan Martingale, Grid berisiko tinggi, atau Lot Doubling. Stop Loss wajib pada setiap order.
            </p>
          </div>
        </div>

        {/* 3 Trading Modes */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-2">
            Mode Operasi Trading
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(
              [
                {
                  id: 'MANUAL',
                  title: 'MODE 1 — MANUAL',
                  desc: 'Pengguna menganalisis sinyal dan mengeksekusi transaksi sendiri.',
                },
                {
                  id: 'SEMI_AUTO',
                  title: 'MODE 2 — SEMI AUTO',
                  desc: 'AI memberikan sinyal BUY/SELL; pengguna menyetujui sebelum eksekusi.',
                },
                {
                  id: 'FULL_AUTO',
                  title: 'MODE 3 — FULL AUTO PILOT',
                  desc: 'Robot melakukan analisis, validasi risiko, hitung lot, dan eksekusi otomatis.',
                },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSettings({ ...settings, trading_mode: m.id as TradingMode })}
                className={`p-3.5 rounded-lg border text-left transition-colors ${
                  settings.trading_mode === m.id
                    ? 'bg-[#121820] border-emerald-500'
                    : 'bg-[#090C10] border-[#1F2731] hover:border-[#2E3947]'
                }`}
              >
                <p className="text-xs font-mono font-semibold text-white">{m.title}</p>
                <p className="text-[11px] text-slate-400 mt-1">{m.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Core Parameters Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Strategi Aktif</label>
            <select
              value={settings.active_strategy_id}
              onChange={(e) => setSettings({ ...settings, active_strategy_id: e.target.value })}
              className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded text-white"
            >
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Timeframe Utama</label>
            <select
              value={settings.timeframe}
              onChange={(e) => setSettings({ ...settings, timeframe: e.target.value as Timeframe })}
              className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Risiko per Transaksi (0.25%–2%)</label>
            <input
              type="number"
              step="0.05"
              min="0.25"
              max="2.0"
              value={settings.risk_per_trade_pct}
              onChange={(e) =>
                setSettings({ ...settings, risk_per_trade_pct: Number(e.target.value) })
              }
              className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Lot Maksimum</label>
            <input
              type="number"
              step="0.05"
              min="0.01"
              max="50"
              value={settings.max_lot}
              onChange={(e) => setSettings({ ...settings, max_lot: Number(e.target.value) })}
              className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Target Profit Harian (%)</label>
            <input
              type="number"
              step="0.25"
              min="0.5"
              max="20"
              value={settings.daily_profit_target_pct}
              onChange={(e) =>
                setSettings({ ...settings, daily_profit_target_pct: Number(e.target.value) })
              }
              className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Batas Kerugian Harian (%)</label>
            <input
              type="number"
              step="0.25"
              min="0.5"
              max="10"
              value={settings.max_daily_loss_pct}
              onChange={(e) =>
                setSettings({ ...settings, max_daily_loss_pct: Number(e.target.value) })
              }
              className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Maximum Drawdown (%)</label>
            <input
              type="number"
              step="0.5"
              min="1"
              max="30"
              value={settings.max_drawdown_pct}
              onChange={(e) =>
                setSettings({ ...settings, max_drawdown_pct: Number(e.target.value) })
              }
              className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Min Risk/Reward (1:X)</label>
            <input
              type="number"
              step="0.1"
              min="1.5"
              max="5"
              value={settings.min_rr_ratio}
              onChange={(e) => setSettings({ ...settings, min_rr_ratio: Number(e.target.value) })}
              className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Max Posisi Terbuka</label>
            <input
              type="number"
              min="1"
              max="15"
              value={settings.max_open_positions}
              onChange={(e) =>
                setSettings({ ...settings, max_open_positions: Number(e.target.value) })
              }
              className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Max Transaksi / Hari</label>
            <input
              type="number"
              min="1"
              max="30"
              value={settings.max_trades_per_day}
              onChange={(e) =>
                setSettings({ ...settings, max_trades_per_day: Number(e.target.value) })
              }
              className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Jam Trading Mulai (UTC)</label>
            <input
              type="time"
              value={settings.trading_hours_start}
              onChange={(e) =>
                setSettings({ ...settings, trading_hours_start: e.target.value })
              }
              className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Jam Trading Selesai (UTC)</label>
            <input
              type="time"
              value={settings.trading_hours_end}
              onChange={(e) => setSettings({ ...settings, trading_hours_end: e.target.value })}
              className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
            />
          </div>
        </div>

        {/* Protection & Automation Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs pt-2">
          <div className="p-3 bg-[#090C10] border border-[#1A212B] rounded-lg flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-slate-200">
              <input
                type="checkbox"
                checked={settings.news_filter_enabled}
                onChange={(e) =>
                  setSettings({ ...settings, news_filter_enabled: e.target.checked })
                }
                className="accent-emerald-500"
              />
              <span>News Filter (Menit Buffer)</span>
            </label>
            <input
              type="number"
              min="5"
              max="120"
              value={settings.news_buffer_minutes}
              onChange={(e) =>
                setSettings({ ...settings, news_buffer_minutes: Number(e.target.value) })
              }
              className="w-16 px-2 py-1 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white text-right"
            />
          </div>

          <div className="p-3 bg-[#090C10] border border-[#1A212B] rounded-lg flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-slate-200">
              <input
                type="checkbox"
                checked={settings.trailing_stop_enabled}
                onChange={(e) =>
                  setSettings({ ...settings, trailing_stop_enabled: e.target.checked })
                }
                className="accent-emerald-500"
              />
              <span>Trailing Stop (Pips)</span>
            </label>
            <input
              type="number"
              min="5"
              max="150"
              value={settings.trailing_stop_pips}
              onChange={(e) =>
                setSettings({ ...settings, trailing_stop_pips: Number(e.target.value) })
              }
              className="w-16 px-2 py-1 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white text-right"
            />
          </div>

          <div className="p-3 bg-[#090C10] border border-[#1A212B] rounded-lg flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-slate-200">
              <input
                type="checkbox"
                checked={settings.auto_break_even_enabled}
                onChange={(e) =>
                  setSettings({ ...settings, auto_break_even_enabled: e.target.checked })
                }
                className="accent-emerald-500"
              />
              <span>Auto Break Even (Pips)</span>
            </label>
            <input
              type="number"
              min="5"
              max="100"
              value={settings.break_even_trigger_pips}
              onChange={(e) =>
                setSettings({ ...settings, break_even_trigger_pips: Number(e.target.value) })
              }
              className="w-16 px-2 py-1 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white text-right"
            />
          </div>

          <label className="p-3 bg-[#090C10] border border-[#1A212B] rounded-lg flex items-center gap-2.5 cursor-pointer text-slate-200">
            <input
              type="checkbox"
              checked={settings.spread_protection_enabled}
              onChange={(e) =>
                setSettings({ ...settings, spread_protection_enabled: e.target.checked })
              }
              className="accent-emerald-500"
            />
            <span>Proteksi Spread Terlalu Tinggi</span>
          </label>

          <label className="p-3 bg-[#090C10] border border-[#1A212B] rounded-lg flex items-center gap-2.5 cursor-pointer text-slate-200">
            <input
              type="checkbox"
              checked={settings.volatility_protection_enabled}
              onChange={(e) =>
                setSettings({ ...settings, volatility_protection_enabled: e.target.checked })
              }
              className="accent-emerald-500"
            />
            <span>Proteksi Volatilitas Ekstrem</span>
          </label>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => saveSettings(false)}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-2"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Menyimpan...' : 'Simpan Pengaturan Auto Pilot'}</span>
          </button>
        </div>
      </div>

      {/* 8 Forex Pairs Configuration */}
      <div className="p-5 rounded-lg bg-[#0D1116] border border-[#1F2731] space-y-4">
        <div>
          <h3 className="text-sm font-display font-semibold text-white">
            Instrumen Pair Forex & Batas Spread
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Aktifkan atau nonaktifkan instrumen yang diizinkan untuk dianalisis dan dieksekusi oleh Auto Pilot.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {instruments.map((inst) => (
            <div
              key={inst.symbol}
              className={`p-3.5 rounded-lg border space-y-2.5 ${
                inst.enabled
                  ? 'bg-[#090C10] border-emerald-700/50'
                  : 'bg-[#090C10] border-[#1F2731] opacity-70'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-sm text-white">{inst.symbol}</span>
                <input
                  type="checkbox"
                  checked={inst.enabled}
                  onChange={(e) => toggleInstrument(inst, e.target.checked)}
                  className="accent-emerald-500 w-4 h-4 cursor-pointer"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Max Spread (pts)</span>
                <input
                  type="number"
                  min="5"
                  max="150"
                  value={inst.max_spread_points}
                  onChange={(e) =>
                    toggleInstrument(inst, inst.enabled, Number(e.target.value))
                  }
                  className="w-16 px-2 py-0.5 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white text-right"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
