import { useEffect, useState } from 'react';
import { CalendarClock, Plus, ShieldCheck } from 'lucide-react';
import type { EconomicEvent } from '../types/trading';
import { apiRequest } from '../services/api';

interface CalendarPayload {
  events: EconomicEvent[];
  newsFilterEnabled: boolean;
  bufferMinutes: number;
  blockedPairs: Array<{ symbol: string; blocked: boolean; eventTitle?: string }>;
}

export function CalendarView() {
  const [data, setData] = useState<CalendarPayload | null>(null);
  const [impactFilter, setImpactFilter] = useState<'ALL' | 'HIGH' | 'MEDIUM' | 'LOW'>('ALL');
  const [showAdd, setShowAdd] = useState(false);

  const [title, setTitle] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [impact, setImpact] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('HIGH');
  const [scheduledAt, setScheduledAt] = useState('');
  const [forecast, setForecast] = useState('');
  const [previous, setPrevious] = useState('');

  const load = async () => {
    const q = impactFilter === 'ALL' ? '' : `?impact=${impactFilter}`;
    const res = await apiRequest<CalendarPayload>(`/api/calendar${q}`);
    setData(res);
  };

  useEffect(() => {
    load();
  }, [impactFilter]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiRequest('/api/calendar', {
      method: 'POST',
      body: JSON.stringify({
        title,
        currency,
        impact,
        scheduled_at: new Date(scheduledAt).toISOString(),
        forecast,
        previous,
      }),
    });
    setTitle('');
    setForecast('');
    setPrevious('');
    setShowAdd(false);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-display font-semibold text-white">
              Kalender Ekonomi & News Filter Otomatis
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Status News Filter:{' '}
            <strong className={data?.newsFilterEnabled ? 'text-emerald-400' : 'text-amber-400'}>
              {data?.newsFilterEnabled
                ? `AKTIF (±${data.bufferMinutes} menit sebelum & sesudah High Impact News)`
                : 'NONAKTIF'}
            </strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-[#07090B] border border-[#1F2731] rounded-lg">
            {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setImpactFilter(lvl)}
                className={`px-3 py-1 text-xs font-medium rounded ${
                  impactFilter === lvl
                    ? 'bg-[#161C24] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowAdd(!showAdd)}
            className="px-3.5 py-2 bg-[#161C24] hover:bg-[#1E2631] border border-[#2A3441] text-white text-xs rounded-lg flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah Jadwal</span>
          </button>
        </div>
      </div>

      {data && data.blockedPairs.length > 0 && (
        <div className="p-3.5 rounded-lg bg-red-950/30 border border-red-800/50 text-xs text-red-200 flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
          <div>
            <p className="font-semibold">News Filter Sedang Memblokir Pembukaan Posisi Baru:</p>
            <p className="mt-0.5">
              {data.blockedPairs.map((b) => `${b.symbol} (${b.eventTitle})`).join(' · ')}
            </p>
          </div>
        </div>
      )}

      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="p-4 rounded-lg bg-[#0D1116] border border-[#1F2731] grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs"
        >
          <input
            type="text"
            required
            placeholder="Judul Berita (cth: US NFP)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="lg:col-span-2 px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded text-white"
          />
          <input
            type="text"
            required
            maxLength={3}
            placeholder="CCY (USD)"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className="px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
          />
          <select
            value={impact}
            onChange={(e) => setImpact(e.target.value as 'HIGH' | 'MEDIUM' | 'LOW')}
            className="px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded text-white"
          >
            <option value="HIGH">HIGH IMPACT</option>
            <option value="MEDIUM">MEDIUM IMPACT</option>
            <option value="LOW">LOW IMPACT</option>
          </select>
          <input
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded text-white"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded"
          >
            Simpan Event
          </button>
        </form>
      )}

      <div className="overflow-x-auto border border-[#1F2731] rounded-lg bg-[#0D1116]">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#1F2731] bg-[#0A0D11] text-slate-400">
              <th className="py-2.5 px-3 font-medium">Waktu Rilis</th>
              <th className="py-2.5 px-3 font-medium">Mata Uang</th>
              <th className="py-2.5 px-3 font-medium">Dampak</th>
              <th className="py-2.5 px-3 font-medium">Agenda Data Ekonomi</th>
              <th className="py-2.5 px-3 font-medium text-right">Forecast</th>
              <th className="py-2.5 px-3 font-medium text-right">Previous</th>
              <th className="py-2.5 px-3 font-medium text-right">Actual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1F2731]">
            {(data?.events ?? []).map((ev) => (
              <tr key={ev.id} className="hover:bg-[#12171E]">
                <td className="py-2.5 px-3 font-mono text-slate-300 tabular-nums whitespace-nowrap">
                  {new Date(ev.scheduled_at).toLocaleString()}
                </td>
                <td className="py-2.5 px-3 font-mono font-semibold text-white">{ev.currency}</td>
                <td
                  className={`py-2.5 px-3 font-mono font-semibold ${
                    ev.impact === 'HIGH'
                      ? 'text-red-400'
                      : ev.impact === 'MEDIUM'
                        ? 'text-amber-400'
                        : 'text-slate-400'
                  }`}
                >
                  {ev.impact}
                </td>
                <td className="py-2.5 px-3 text-slate-200">{ev.title}</td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-300">{ev.forecast || '—'}</td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-400">{ev.previous || '—'}</td>
                <td className="py-2.5 px-3 text-right font-mono text-emerald-400">{ev.actual || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
