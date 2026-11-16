import { useState } from 'react';
import { Lock, ShieldCheck, ArrowRight } from 'lucide-react';
import { apiRequest } from '../services/api';
import type { User } from '../types/trading';
import { PWAInstallButton } from './PWAInstallButton';

interface AuthGateProps {
  onAuthenticated: (user: User) => void;
}

export function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'login' ? { email, password } : { name, email, password };
      const res = await apiRequest<{ user: User; token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      localStorage.setItem('nexora_token', res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Autentikasi gagal.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07090B] text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 border border-[#1F2731] bg-[#0D1116] rounded-xl overflow-hidden">
        <div className="lg:col-span-5 p-8 bg-[#0A0D11] border-b lg:border-b-0 lg:border-r border-[#1F2731] flex flex-col justify-between gap-8">
          <div>
            <div className="flex items-center gap-2.5 text-emerald-400 font-display font-bold tracking-tight text-xl">
              <ShieldCheck className="w-6 h-6 shrink-0" />
              <span>NEXORA AI</span>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Intelligent Forex Auto Pilot · Institutional Execution Terminal
            </p>
            <h1 className="mt-8 text-2xl font-display font-semibold text-white leading-snug text-balance">
              Kontrol Penuh atas Strategi, Risiko, dan Eksekusi MetaTrader 5.
            </h1>
            <p className="mt-3 text-sm text-slate-400 leading-relaxed">
              Setiap sesi dilindungi enkripsi kredensial AES-256-GCM, password hashing scrypt, audit log lengkap, dan validasi Risk Management wajib sebelum order dikirim ke broker.
            </p>
          </div>

          <div className="space-y-2.5 text-xs text-slate-400 border-t border-[#1F2731] pt-5">
            <div className="flex items-center justify-between">
              <span>Risk Gatekeeper</span>
              <span className="font-mono text-emerald-400">0.25% – 2.00%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Minimum R:R Default</span>
              <span className="font-mono text-slate-200">1 : 2.0</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Bridge Architecture</span>
              <span className="font-mono text-slate-200">MT5 Python / MQL5 EA</span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 p-8 flex flex-col justify-center">
          <div className="flex items-center gap-2 p-1 bg-[#07090B] border border-[#1F2731] rounded-lg w-fit mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-[#161C24] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Masuk Terminal
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'register'
                  ? 'bg-[#161C24] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Daftar Akun Baru
            </button>
          </div>

          <h2 className="text-lg font-display font-semibold text-white">
            {mode === 'login' ? 'Autentikasi Operator' : 'Registrasi Akun Operator'}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {mode === 'login'
              ? 'Masukkan kredensial terenkripsi Anda untuk mengakses terminal.'
              : 'Akun pertama yang terdaftar otomatis mendapat hak akses Admin.'}
          </p>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-red-950/50 border border-red-800/60 text-xs text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Nama Lengkap
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Riki Pratama"
                  className="w-full px-3.5 py-2.5 bg-[#07090B] border border-[#1F2731] rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Email Operator
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@domain.com"
                className="w-full px-3.5 py-2.5 bg-[#07090B] border border-[#1F2731] rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Password (minimal 8 karakter)
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2.5 bg-[#07090B] border border-[#1F2731] rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              <span>
                {loading
                  ? 'Memverifikasi...'
                  : mode === 'login'
                    ? 'Masuk ke NEXORA Terminal'
                    : 'Buat Akun & Masuk'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
          <div className="mt-4">
            <PWAInstallButton />
          </div>
        </div>
      </div>
    </div>
  );
}
