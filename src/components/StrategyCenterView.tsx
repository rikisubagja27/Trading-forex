import { useEffect, useState } from 'react';
import { Save, SlidersHorizontal } from 'lucide-react';
import type { Strategy, Timeframe } from '../types/trading';
import { apiRequest } from '../services/api';

const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

export function StrategyCenterView() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ strategies: Strategy[] }>('/api/strategies').then((res) => {
      setStrategies(res.strategies);
      if (res.strategies.length > 0) setSelectedId(res.strategies[0].id);
    });
  }, []);

  const selected = strategies.find((s) => s.id === selectedId);

  const updateField = <K extends keyof Strategy>(field: K, value: Strategy[K]) => {
    setStrategies((prev) =>
      prev.map((s) => (s.id === selectedId ? { ...s, [field]: value } : s))
    );
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiRequest<{ strategies: Strategy[] }>(
        `/api/strategies/${selected.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            timeframe: selected.timeframe,
            sl_atr_mult: selected.sl_atr_mult,
            tp_rr_ratio: selected.tp_rr_ratio,
            trailing_stop_pips: selected.trailing_stop_pips,
            params: selected.params,
            enabled: selected.enabled,
            entry_rules: selected.entry_rules,
            exit_rules: selected.exit_rules,
          }),
        }
      );
      setStrategies(res.strategies);
      setMsg(`Strategi "${selected.name}" disimpan.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Gagal menyimpan strategi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-display font-semibold text-white">
            Strategy Center — Isolasi 8 Strategi Terpisah
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Setiap strategi memiliki aturan entry, exit, Stop Loss, Take Profit, dan parameter terpisah dan wajib diuji secara independen sebelum dipakai di Auto Pilot.
          </p>
        </div>
        <span className="text-xs font-mono text-emerald-400 whitespace-nowrap">
          {strategies.filter((s) => s.enabled).length}/{strategies.length} Aktif
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-4 space-y-2">
          {strategies.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSelectedId(s.id);
                setMsg(null);
              }}
              className={`w-full text-left p-3.5 rounded-lg border transition-colors ${
                s.id === selectedId
                  ? 'bg-[#121820] border-emerald-600/70'
                  : 'bg-[#0D1116] border-[#1F2731] hover:border-[#2E3947]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">{s.name}</span>
                <span
                  className={`text-[11px] font-mono ${
                    s.enabled ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {s.enabled ? 'AKTIF' : 'NONAKTIF'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 font-mono">
                TF {s.timeframe} · SL {s.sl_atr_mult}x ATR · TP 1:{s.tp_rr_ratio}
              </p>
            </button>
          ))}
        </div>

        <div className="lg:col-span-8">
          {selected && (
            <div className="p-5 rounded-lg bg-[#0D1116] border border-[#1F2731] space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#1F2731] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-base font-display font-semibold text-white">
                      {selected.name}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                    {selected.description}
                  </p>
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.enabled}
                    onChange={(e) => updateField('enabled', e.target.checked)}
                    className="accent-emerald-500 w-4 h-4"
                  />
                  <span>Aktifkan Strategi</span>
                </label>
              </div>

              {msg && (
                <div className="p-2.5 rounded bg-emerald-950/40 border border-emerald-700/50 text-xs text-emerald-200">
                  {msg}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Timeframe</label>
                  <select
                    value={selected.timeframe}
                    onChange={(e) => updateField('timeframe', e.target.value as Timeframe)}
                    className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded text-xs font-mono text-white"
                  >
                    {TIMEFRAMES.map((tf) => (
                      <option key={tf} value={tf}>
                        {tf}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Stop Loss (ATR Mult)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="5"
                    value={selected.sl_atr_mult}
                    onChange={(e) => updateField('sl_atr_mult', Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Take Profit (R:R)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="1.5"
                    max="8"
                    value={selected.tp_rr_ratio}
                    onChange={(e) => updateField('tp_rr_ratio', Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    Trailing Stop (Pips)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="150"
                    value={selected.trailing_stop_pips}
                    onChange={(e) => updateField('trailing_stop_pips', Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded text-xs font-mono text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3.5 bg-[#090C10] border border-[#1A212B] rounded-lg space-y-2">
                  <p className="text-xs font-semibold text-emerald-400">Aturan Entry</p>
                  <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                    {selected.entry_rules.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>

                <div className="p-3.5 bg-[#090C10] border border-[#1A212B] rounded-lg space-y-2">
                  <p className="text-xs font-semibold text-sky-400">Aturan Exit & Proteksi</p>
                  <ul className="space-y-1.5 text-xs text-slate-300 list-disc list-inside">
                    {selected.exit_rules.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-300 mb-2">
                  Parameter Kuantitatif Strategi
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(selected.params).map(([k, v]) => (
                    <div key={k} className="p-2.5 bg-[#090C10] border border-[#1A212B] rounded">
                      <label className="block text-[11px] text-slate-400 mb-1">{k}</label>
                      {typeof v === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={v}
                          onChange={(e) =>
                            updateField('params', { ...selected.params, [k]: e.target.checked })
                          }
                          className="accent-emerald-500"
                        />
                      ) : (
                        <input
                          type={typeof v === 'number' ? 'number' : 'text'}
                          step="any"
                          value={String(v)}
                          onChange={(e) =>
                            updateField('params', {
                              ...selected.params,
                              [k]: typeof v === 'number' ? Number(e.target.value) : e.target.value,
                            })
                          }
                          className="w-full px-2 py-1 bg-[#07090B] border border-[#1F2731] rounded text-xs font-mono text-white"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-2"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Menyimpan...' : 'Simpan Konfigurasi Strategi'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
