import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BrainCircuit,
  CalendarClock,
  FlaskConical,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  PlugZap,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { DashboardPayload, User } from './types/trading';
import { apiRequest, createTradingSocket } from './services/api';
import { AuthGate } from './components/AuthGate';
import { DashboardView } from './components/DashboardView';
import { AnalysisView } from './components/AnalysisView';
import { StrategyCenterView } from './components/StrategyCenterView';
import { BacktestingView } from './components/BacktestingView';
import { CalendarView } from './components/CalendarView';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import { Mt5IntegrationView } from './components/Mt5IntegrationView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';

type TabKey =
  | 'dashboard'
  | 'analysis'
  | 'strategies'
  | 'backtesting'
  | 'calendar'
  | 'history'
  | 'settings'
  | 'mt5';

const NAV_ITEMS: Array<{ id: TabKey; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'analysis', label: 'AI Analysis', icon: BrainCircuit },
  { id: 'strategies', label: 'Strategy Center', icon: SlidersHorizontal },
  { id: 'backtesting', label: 'Backtesting', icon: FlaskConical },
  { id: 'calendar', label: 'Economic Calendar', icon: CalendarClock },
  { id: 'history', label: 'History & Audit', icon: History },
  { id: 'settings', label: 'Risk & Auto Pilot', icon: Settings },
  { id: 'mt5', label: 'MT5 Bridge', icon: PlugZap },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loadingDash, setLoadingDash] = useState(false);

  useEffect(() => {
    apiRequest<{ authenticated: boolean; user: User }>('/api/auth/me')
      .then((res) => {
        if (res.authenticated) setUser(res.user);
      })
      .catch(() => {
        localStorage.removeItem('nexora_token');
      })
      .finally(() => setCheckingAuth(false));
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!user) return;
    setLoadingDash((prev) => (dashboard === null ? true : prev));
    try {
      const res = await apiRequest<DashboardPayload>('/api/dashboard');
      setDashboard(res);
    } finally {
      setLoadingDash(false);
    }
  }, [user, dashboard]);

  useEffect(() => {
    if (!user) return;
    loadDashboard();
    const disconnectWs = createTradingSocket((event) => {
      if (
        event === 'dashboard:update' ||
        event === 'positions:tick' ||
        event === 'signal:new' ||
        event === 'mt5:heartbeat'
      ) {
        loadDashboard();
      }
    });
    const poll = window.setInterval(loadDashboard, 15000);
    return () => {
      disconnectWs();
      window.clearInterval(poll);
    };
  }, [user]);

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore logout network error
    }
    localStorage.removeItem('nexora_token');
    setUser(null);
    setDashboard(null);
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[#07090B] flex items-center justify-center text-xs font-mono text-slate-400">
        Memuat sesi NEXORA AI...
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <AuthGate onAuthenticated={(u) => setUser(u)} />
        <OfflineIndicator />
      </>
    );
  }

  const currentNav = NAV_ITEMS.find((n) => n.id === activeTab)!;

  return (
    <div className="min-h-screen bg-[#07090B] text-slate-100 flex">
      {/* Desktop Sidebar (256px) */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0A0D11] border-r border-[#1F2731]">
        <div className="h-14 px-5 border-b border-[#1F2731] flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="font-display font-bold text-base tracking-tight text-white whitespace-nowrap">
            NEXORA AI
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#141B23] text-emerald-400 border border-[#232E3B]'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-[#0F141A]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#1F2731] space-y-2 text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span>MT5 Bridge</span>
            <span
              className={`font-mono font-semibold ${
                dashboard?.mt5.status === 'CONNECTED' ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {dashboard?.mt5.status || 'NOT CONNECTED'}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>Auto Pilot</span>
            <span
              className={`font-mono font-semibold ${
                dashboard?.autoPilotStatus === 'RUNNING' ? 'text-emerald-400' : 'text-slate-300'
              }`}
            >
              {dashboard?.autoPilotStatus || 'STOPPED'}
            </span>
          </div>
          <div className="pt-2 border-t border-[#1A212B] space-y-3">
            <PWAInstallButton compact />
            <div className="flex items-center justify-between">
              <div className="truncate">
                <p className="text-slate-200 font-medium truncate">{user.name}</p>
                <p className="text-[11px] text-slate-500 font-mono">{user.role}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title="Keluar"
                className="p-2 text-slate-400 hover:text-red-400 rounded-lg hover:bg-[#141A22]"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-[#0A0D11] border-r border-[#1F2731] flex flex-col z-10">
            <div className="h-14 px-4 border-b border-[#1F2731] flex items-center justify-between">
              <span className="font-display font-bold text-base text-white">NEXORA AI</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-xs font-medium ${
                      active ? 'bg-[#141B23] text-emerald-400' : 'text-slate-300'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-[#1F2731] space-y-3 text-xs">
              <PWAInstallButton compact />
              <div className="flex items-center justify-between">
                <span className="text-slate-300 truncate">{user.email}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-2.5 py-1.5 text-red-400 hover:bg-red-950/40 rounded"
                >
                  Keluar
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb on left, 1 primary action on right */}
        <header className="h-14 sticky top-0 z-30 bg-[#07090B]/95 backdrop-blur border-b border-[#1F2731] px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-300 hover:text-white"
              aria-label="Buka Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs truncate">
              <span className="text-slate-500 hidden sm:inline">NEXORA Terminal</span>
              <span className="text-slate-600 hidden sm:inline">/</span>
              <h1 className="font-display font-semibold text-sm text-white truncate">
                {currentNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'analysis' ? 'mt5' : 'analysis')}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{activeTab === 'analysis' ? 'MT5 Bridge' : 'AI Market Scan'}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1380px] w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              data={dashboard}
              loading={loadingDash}
              onRefresh={loadDashboard}
              onNavigate={(tab) => setActiveTab(tab as TabKey)}
            />
          )}
          {activeTab === 'analysis' && <AnalysisView onOrderExecuted={loadDashboard} />}
          {activeTab === 'strategies' && <StrategyCenterView />}
          {activeTab === 'backtesting' && <BacktestingView />}
          {activeTab === 'calendar' && <CalendarView />}
          {activeTab === 'history' && <HistoryView />}
          {activeTab === 'settings' && <SettingsView onUpdated={loadDashboard} />}
          {activeTab === 'mt5' && <Mt5IntegrationView onChanged={loadDashboard} />}
        </main>
      </div>
      <OfflineIndicator />
    </div>
  );
}
