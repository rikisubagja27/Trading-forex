import { useEffect, useState } from 'react';
import { Copy, KeyRound, PlugZap, Server, Unplug } from 'lucide-react';
import type { Mt5State } from '../types/trading';
import { apiRequest } from '../services/api';

export function Mt5IntegrationView({ onChanged }: { onChanged: () => void }) {
  const [mt5, setMt5] = useState<Mt5State | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState('');
  const [bridgeToken, setBridgeToken] = useState('');
  const [accountLogin, setAccountLogin] = useState('');
  const [mt5Password, setMt5Password] = useState('');
  const [serverName, setServerName] = useState('');
  const [brokerName, setBrokerName] = useState('');

  const [sandboxBalance, setSandboxBalance] = useState(10000);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [templates, setTemplates] = useState<{ pythonBridge: string; mql5Ea: string } | null>(null);
  const [activeCodeTab, setActiveCodeTab] = useState<'python' | 'mql5'>('python');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = async () => {
    const [sRes, tRes] = await Promise.all([
      apiRequest<{ mt5: Mt5State }>('/api/mt5/state'),
      apiRequest<{ pythonBridge: string; mql5Ea: string }>('/api/mt5/templates'),
    ]);
    setMt5(sRes.mt5);
    setTemplates(tRes);
    if (sRes.mt5.bridgeUrl) setBridgeUrl(sRes.mt5.bridgeUrl);
    if (sRes.mt5.accountLogin && sRes.mt5.accountLogin !== 'PAPER-SANDBOX') {
      setAccountLogin(sRes.mt5.accountLogin);
    }
    if (sRes.mt5.serverName && sRes.mt5.serverName !== 'Nexora-Local-Sandbox') {
      setServerName(sRes.mt5.serverName);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const connectRemote = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiRequest<{ message: string; mt5: Mt5State }>('/api/mt5/connect-remote', {
        method: 'POST',
        body: JSON.stringify({
          bridgeUrl,
          bridgeToken,
          accountLogin,
          mt5Password,
          serverName,
          brokerName,
        }),
      });
      setMt5(res.mt5);
      setMt5Password('');
      setMsg({ type: 'ok', text: res.message });
      onChanged();
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Koneksi gagal.' });
    } finally {
      setBusy(false);
    }
  };

  const generateEaKey = async () => {
    setBusy(true);
    try {
      const res = await apiRequest<{ apiKey: string; masked: string }>('/api/mt5/generate-ea-key', {
        method: 'POST',
      });
      setGeneratedKey(res.apiKey);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const startSandbox = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiRequest<{ mt5: Mt5State }>('/api/mt5/enable-paper-sandbox', {
        method: 'POST',
        body: JSON.stringify({ initialBalance: sandboxBalance }),
      });
      setMt5(res.mt5);
      setMsg({
        type: 'ok',
        text: 'Paper Sandbox diaktifkan untuk pengujian lokal alur Risk Engine & Auto Pilot.',
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await apiRequest<{ mt5: Mt5State }>('/api/mt5/disconnect', { method: 'POST' });
      setMt5(res.mt5);
      setMsg({ type: 'ok', text: 'Koneksi MT5 / Sandbox diputuskan.' });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const copyText = (txt: string) => {
    navigator.clipboard.writeText(txt);
    setMsg({ type: 'ok', text: 'Kode disalin ke clipboard.' });
  };

  return (
    <div className="space-y-6">
      {/* Current Connection Status */}
      <div className="p-5 rounded-lg bg-[#0D1116] border border-[#1F2731] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Server className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-display font-semibold text-white">
              MetaTrader 5 Bridge & VPS Integration
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Status Saat Ini:{' '}
            <strong
              className={`font-mono ${
                mt5?.status === 'CONNECTED' ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {mt5?.status || 'NOT CONNECTED'}
            </strong>{' '}
            {mt5?.status === 'CONNECTED' && `· Mode: ${mt5.mode.toUpperCase()} · ${mt5.brokerName}`}
          </p>
        </div>

        {mt5?.status === 'CONNECTED' && (
          <button
            type="button"
            disabled={busy}
            onClick={disconnect}
            className="px-4 py-2 bg-red-950/60 hover:bg-red-900 border border-red-800/60 text-red-200 text-xs font-semibold rounded-lg flex items-center gap-2 whitespace-nowrap"
          >
            <Unplug className="w-3.5 h-3.5" />
            <span>Putuskan Koneksi</span>
          </button>
        )}
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Option A: Remote Python MT5 Bridge */}
        <form
          onSubmit={connectRemote}
          className="lg:col-span-7 p-5 rounded-lg bg-[#0D1116] border border-[#1F2731] space-y-4"
        >
          <div>
            <h3 className="text-sm font-display font-semibold text-white">
              Opsi 1: Hubungkan Python FastAPI MT5 Bridge (VPS Windows)
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Kredensial MT5 dikirim ke backend server ini dan dienkripsi menggunakan AES-256-GCM. Tidak pernah disimpan di browser.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="sm:col-span-2">
              <label className="block text-slate-400 mb-1">URL Endpoint Bridge VPS</label>
              <input
                type="url"
                required
                placeholder="https://mt5-vps.domain-anda.com:8000"
                value={bridgeUrl}
                onChange={(e) => setBridgeUrl(e.target.value)}
                className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Bridge Bearer Token</label>
              <input
                type="password"
                required
                placeholder="MT5_BRIDGE_TOKEN"
                value={bridgeToken}
                onChange={(e) => setBridgeToken(e.target.value)}
                className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">MT5 Account Login</label>
              <input
                type="text"
                required
                placeholder="50291847"
                value={accountLogin}
                onChange={(e) => setAccountLogin(e.target.value)}
                className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Password Trading MT5</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={mt5Password}
                onChange={(e) => setMt5Password(e.target.value)}
                className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded font-mono text-white"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Server Broker MT5</label>
              <input
                type="text"
                required
                placeholder="MetaQuotes-Demo / Broker-Live"
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                className="w-full px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded text-white"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-2"
          >
            <PlugZap className="w-4 h-4" />
            <span>{busy ? 'Menghubungkan...' : 'Verifikasi & Hubungkan MT5 Bridge'}</span>
          </button>
        </form>

        {/* Option B & C: MQL5 EA Key + Paper Sandbox */}
        <div className="lg:col-span-5 space-y-5">
          <div className="p-5 rounded-lg bg-[#0D1116] border border-[#1F2731] space-y-3">
            <h3 className="text-sm font-display font-semibold text-white">
              Opsi 2: Inbound MQL5 Expert Advisor Push
            </h3>
            <p className="text-xs text-slate-400">
              Jika VPS Windows Anda berada di balik NAT tanpa IP publik, pasang <code className="text-slate-200">NexoraBridge.mq5</code> di terminal MT5 untuk mendorong data akun dan mengambil order tervalidasi.
            </p>
            {mt5?.bridgeApiKeyMasked && (
              <p className="text-xs font-mono text-slate-300">
                Key Aktif: {mt5.bridgeApiKeyMasked}
              </p>
            )}
            {generatedKey && (
              <div className="p-2.5 rounded bg-[#07090B] border border-emerald-700/50 text-[11px] font-mono text-emerald-300 break-all">
                {generatedKey}
              </div>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={generateEaKey}
              className="px-3.5 py-2 bg-[#161C24] hover:bg-[#1E2631] border border-[#2A3441] text-white text-xs font-medium rounded-lg flex items-center gap-2"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Buat / Rotasi Bridge API Key</span>
            </button>
          </div>

          <div className="p-5 rounded-lg bg-[#0D1116] border border-sky-800/40 space-y-3">
            <h3 className="text-sm font-display font-semibold text-white">
              Mode Pengujian: Paper Sandbox Lokal
            </h3>
            <p className="text-xs text-slate-400">
              Gunakan Paper Sandbox untuk menguji validasi Risk Engine, kalkulasi lot, Trailing Stop, Auto Break Even, dan Emergency Close All tanpa akun broker riil.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="500"
                step="500"
                value={sandboxBalance}
                onChange={(e) => setSandboxBalance(Number(e.target.value))}
                className="w-32 px-3 py-2 bg-[#07090B] border border-[#1F2731] rounded text-xs font-mono text-white"
              />
              <button
                type="button"
                disabled={busy}
                onClick={startSandbox}
                className="px-4 py-2 bg-sky-700 hover:bg-sky-600 text-white text-xs font-semibold rounded-lg"
              >
                Aktifkan Paper Sandbox
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Downloadable / Copyable VPS Bridge Templates */}
      {templates && (
        <div className="p-5 rounded-lg bg-[#0D1116] border border-[#1F2731] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveCodeTab('python')}
                className={`px-3 py-1.5 text-xs font-mono rounded ${
                  activeCodeTab === 'python'
                    ? 'bg-[#161C24] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                mt5_bridge.py (Python FastAPI)
              </button>
              <button
                type="button"
                onClick={() => setActiveCodeTab('mql5')}
                className={`px-3 py-1.5 text-xs font-mono rounded ${
                  activeCodeTab === 'mql5'
                    ? 'bg-[#161C24] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                NexoraBridge.mq5 (MQL5 EA)
              </button>
            </div>

            <button
              type="button"
              onClick={() =>
                copyText(activeCodeTab === 'python' ? templates.pythonBridge : templates.mql5Ea)
              }
              className="px-3 py-1.5 bg-[#161C24] hover:bg-[#1E2631] border border-[#2A3441] text-xs text-slate-200 rounded flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Salin Kode</span>
            </button>
          </div>

          <pre className="p-4 bg-[#07090B] border border-[#1F2731] rounded-lg overflow-x-auto text-[11px] font-mono text-slate-300 leading-relaxed max-h-80">
            {activeCodeTab === 'python' ? templates.pythonBridge : templates.mql5Ea}
          </pre>
        </div>
      )}
    </div>
  );
}
