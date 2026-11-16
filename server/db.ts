import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AutoPilotSettings, Instrument, Strategy, Timeframe } from './types.ts';

const DB_PATH = path.resolve(process.cwd(), 'nexora.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'trader',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS mt5_configs (
    user_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'disconnected',
    bridge_url TEXT DEFAULT '',
    encrypted_credentials TEXT DEFAULT '',
    bridge_api_key_hash TEXT DEFAULT '',
    bridge_api_key_masked TEXT DEFAULT '',
    account_login TEXT DEFAULT '',
    server_name TEXT DEFAULT '',
    broker_name TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'NOT CONNECTED',
    last_heartbeat TEXT,
    balance REAL NOT NULL DEFAULT 0,
    equity REAL NOT NULL DEFAULT 0,
    margin REAL NOT NULL DEFAULT 0,
    free_margin REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    leverage INTEGER NOT NULL DEFAULT 100,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS instruments (
    symbol TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    digits INTEGER NOT NULL,
    contract_size REAL NOT NULL,
    pip_size REAL NOT NULL,
    min_lot REAL NOT NULL DEFAULT 0.01,
    max_lot REAL NOT NULL DEFAULT 10.0,
    max_spread_points INTEGER NOT NULL DEFAULT 25,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS strategies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    entry_rules_json TEXT NOT NULL,
    exit_rules_json TEXT NOT NULL,
    sl_atr_mult REAL NOT NULL,
    tp_rr_ratio REAL NOT NULL,
    trailing_stop_pips REAL NOT NULL,
    params_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS autopilot_settings (
    user_id TEXT PRIMARY KEY,
    trading_mode TEXT NOT NULL DEFAULT 'SEMI_AUTO',
    active_strategy_id TEXT NOT NULL DEFAULT 'strat-trend',
    timeframe TEXT NOT NULL DEFAULT 'H1',
    risk_per_trade_pct REAL NOT NULL DEFAULT 0.5,
    max_lot REAL NOT NULL DEFAULT 1.0,
    daily_profit_target_pct REAL NOT NULL DEFAULT 3.0,
    max_daily_loss_pct REAL NOT NULL DEFAULT 2.0,
    max_drawdown_pct REAL NOT NULL DEFAULT 8.0,
    max_open_positions INTEGER NOT NULL DEFAULT 3,
    max_trades_per_day INTEGER NOT NULL DEFAULT 6,
    min_rr_ratio REAL NOT NULL DEFAULT 2.0,
    trading_hours_start TEXT NOT NULL DEFAULT '07:00',
    trading_hours_end TEXT NOT NULL DEFAULT '20:00',
    news_filter_enabled INTEGER NOT NULL DEFAULT 1,
    news_buffer_minutes INTEGER NOT NULL DEFAULT 30,
    trailing_stop_enabled INTEGER NOT NULL DEFAULT 1,
    trailing_stop_pips REAL NOT NULL DEFAULT 20,
    auto_break_even_enabled INTEGER NOT NULL DEFAULT 1,
    break_even_trigger_pips REAL NOT NULL DEFAULT 15,
    spread_protection_enabled INTEGER NOT NULL DEFAULT 1,
    volatility_protection_enabled INTEGER NOT NULL DEFAULT 1,
    engine_running INTEGER NOT NULL DEFAULT 0,
    daily_locked INTEGER NOT NULL DEFAULT 0,
    daily_lock_reason TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS positions (
    ticket_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    volume REAL NOT NULL,
    open_price REAL NOT NULL,
    current_price REAL NOT NULL,
    sl REAL NOT NULL,
    tp REAL NOT NULL,
    profit REAL NOT NULL DEFAULT 0,
    swap REAL NOT NULL DEFAULT 0,
    commission REAL NOT NULL DEFAULT 0,
    strategy_id TEXT,
    entry_reason TEXT,
    managed_by_nexora INTEGER NOT NULL DEFAULT 1,
    break_even_applied INTEGER NOT NULL DEFAULT 0,
    opened_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pending_signals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    strategy_name TEXT NOT NULL,
    direction TEXT NOT NULL,
    entry_price REAL NOT NULL,
    sl REAL NOT NULL,
    tp REAL NOT NULL,
    rr_ratio REAL NOT NULL,
    confidence REAL NOT NULL,
    market_condition TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    indicators_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    block_reason TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS orders_queue (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    volume REAL NOT NULL,
    price REAL NOT NULL,
    sl REAL NOT NULL,
    tp REAL NOT NULL,
    strategy_id TEXT,
    entry_reason TEXT,
    status TEXT NOT NULL DEFAULT 'QUEUED',
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trade_history (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    volume REAL NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL NOT NULL,
    sl REAL NOT NULL,
    tp REAL NOT NULL,
    profit_loss REAL NOT NULL,
    commission REAL NOT NULL DEFAULT 0,
    swap REAL NOT NULL DEFAULT 0,
    strategy_name TEXT NOT NULL,
    entry_reason TEXT NOT NULL,
    exit_reason TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS equity_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    balance REAL NOT NULL,
    equity REAL NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS economic_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    currency TEXT NOT NULL,
    impact TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    forecast TEXT,
    previous TEXT,
    actual TEXT
  );

  CREATE TABLE IF NOT EXISTS backtest_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    strategy_name TEXT NOT NULL,
    data_source TEXT NOT NULL,
    total_bars INTEGER NOT NULL,
    spread_points REAL NOT NULL,
    commission_per_lot REAL NOT NULL,
    slippage_points REAL NOT NULL,
    metrics_json TEXT NOT NULL,
    equity_curve_json TEXT NOT NULL,
    trades_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    category TEXT NOT NULL,
    details_json TEXT NOT NULL,
    status TEXT NOT NULL,
    ip TEXT,
    created_at TEXT NOT NULL
  );
`);

function seedDefaults() {
  const now = new Date().toISOString();

  const defaultInstruments: Instrument[] = [
    { symbol: 'EURUSD', enabled: true, digits: 5, contract_size: 100000, pip_size: 0.0001, min_lot: 0.01, max_lot: 10, max_spread_points: 18, category: 'Major' },
    { symbol: 'GBPUSD', enabled: true, digits: 5, contract_size: 100000, pip_size: 0.0001, min_lot: 0.01, max_lot: 10, max_spread_points: 22, category: 'Major' },
    { symbol: 'USDJPY', enabled: true, digits: 3, contract_size: 100000, pip_size: 0.01, min_lot: 0.01, max_lot: 10, max_spread_points: 20, category: 'Major' },
    { symbol: 'AUDUSD', enabled: true, digits: 5, contract_size: 100000, pip_size: 0.0001, min_lot: 0.01, max_lot: 10, max_spread_points: 22, category: 'Major' },
    { symbol: 'NZDUSD', enabled: false, digits: 5, contract_size: 100000, pip_size: 0.0001, min_lot: 0.01, max_lot: 10, max_spread_points: 25, category: 'Major' },
    { symbol: 'USDCAD', enabled: true, digits: 5, contract_size: 100000, pip_size: 0.0001, min_lot: 0.01, max_lot: 10, max_spread_points: 22, category: 'Major' },
    { symbol: 'USDCHF', enabled: false, digits: 5, contract_size: 100000, pip_size: 0.0001, min_lot: 0.01, max_lot: 10, max_spread_points: 22, category: 'Major' },
    { symbol: 'XAUUSD', enabled: true, digits: 2, contract_size: 100, pip_size: 0.1, min_lot: 0.01, max_lot: 5, max_spread_points: 35, category: 'Metals' },
  ];

  const insertInst = db.prepare(`
    INSERT OR IGNORE INTO instruments (symbol, enabled, digits, contract_size, pip_size, min_lot, max_lot, max_spread_points, category)
    VALUES (@symbol, @enabled, @digits, @contract_size, @pip_size, @min_lot, @max_lot, @max_spread_points, @category)
  `);
  for (const inst of defaultInstruments) {
    insertInst.run({ ...inst, enabled: inst.enabled ? 1 : 0 });
  }

  const defaultStrategies: Array<Omit<Strategy, 'updated_at'>> = [
    {
      id: 'strat-trend',
      name: 'Trend Following',
      slug: 'trend-following',
      description: 'Mengikuti arah tren primer menggunakan susunan EMA 20 > EMA 50 > EMA 200 dengan konfirmasi momentum MACD dan filter ADX/RSI.',
      timeframe: 'H1',
      entry_rules: [
        'EMA 20 berada di atas EMA 50 dan EMA 50 di atas EMA 200 (BUY) atau sebaliknya (SELL)',
        'Harga penutupan searah tren utama dengan MACD histogram positif/negatif menguat',
        'RSI(14) berada di zona sehat (48–68 untuk BUY, 32–52 untuk SELL) tanpa overbought ekstrem',
      ],
      exit_rules: [
        'Take Profit tetap minimal 1:2.2 Risk/Reward berbasis ATR',
        'Stop Loss di luar swing terakhir atau 1.5x ATR(14)',
        'Trailing Stop aktif setelah harga bergerak +1R',
      ],
      sl_atr_mult: 1.5,
      tp_rr_ratio: 2.2,
      trailing_stop_pips: 20,
      params: { emaFast: 20, emaMid: 50, emaSlow: 200, rsiMin: 45, rsiMax: 68 },
      enabled: true,
    },
    {
      id: 'strat-breakout',
      name: 'Breakout Trading',
      slug: 'breakout-trading',
      description: 'Menangkap penembusan struktur Support/Resistance atau Bollinger Band squeeze yang terkonfirmasi ekspansi ATR dan retest.',
      timeframe: 'M30',
      entry_rules: [
        'Candle menutup tegas di atas Resistance 20-bar (BUY) atau di bawah Support 20-bar (SELL)',
        'Bandwidth Bollinger mengembang dengan ATR saat ini di atas rata-rata ATR 20-bar',
        'Volume tick dan body candle > 55% range untuk menyaring false breakout',
      ],
      exit_rules: [
        'Stop Loss ditempatkan di dalam zona breakout / 1.4x ATR',
        'Take Profit 2.5x jarak risiko (R:R 1:2.5)',
      ],
      sl_atr_mult: 1.4,
      tp_rr_ratio: 2.5,
      trailing_stop_pips: 18,
      params: { lookbackBars: 20, minBodyRatio: 0.55, atrExpansionFactor: 1.05 },
      enabled: true,
    },
    {
      id: 'strat-pullback',
      name: 'Pullback Trading',
      slug: 'pullback-trading',
      description: 'Masuk posisi saat harga melakukan koreksi sehat ke area EMA 20/50 atau Demand/Supply Zone dalam tren dominan.',
      timeframe: 'H1',
      entry_rules: [
        'Tren jangka menengah valid (EMA 50 vs EMA 200)',
        'Harga menyentuh atau menguji zona dinamis EMA 20–50 lalu memantul searah tren',
        'Konfirmasi candle penolakan atau RSI keluar dari koreksi jangka pendek',
      ],
      exit_rules: [
        'Stop Loss di bawah low pullback + 0.5x ATR',
        'Take Profit pada swing high/low baru dengan R:R minimal 1:2.3',
      ],
      sl_atr_mult: 1.3,
      tp_rr_ratio: 2.3,
      trailing_stop_pips: 16,
      params: { pullbackEma: 20, trendEma: 200, zoneToleranceAtr: 0.45 },
      enabled: true,
    },
    {
      id: 'strat-sr',
      name: 'Support Resistance',
      slug: 'support-resistance',
      description: 'Strategi reaksi harga murni pada level struktural Support & Resistance historis dengan konfirmasi osilator RSI & Bollinger.',
      timeframe: 'H4',
      entry_rules: [
        'Harga berada dalam radius 0.4x ATR dari level Support atau Resistance mayor',
        'RSI menunjukkan kejenuhan (< 36 di Support, > 64 di Resistance)',
        'Candle membentuk pola penolakan atau pembalikan terkonfirmasi',
      ],
      exit_rules: [
        'Stop Loss di balik struktur S/R (1.4x ATR)',
        'Take Profit menuju level struktur berlawanan (minimal R:R 1:2.0)',
      ],
      sl_atr_mult: 1.4,
      tp_rr_ratio: 2.0,
      trailing_stop_pips: 25,
      params: { srSensitivity: 0.4, rsiOversold: 36, rsiOverbought: 64 },
      enabled: true,
    },
    {
      id: 'strat-price-action',
      name: 'Price Action',
      slug: 'price-action',
      description: 'Mendeteksi pola candlestick institusional (Bullish/Bearish Engulfing, Pin Bar) pada zona Supply/Demand tanpa lag berlebih.',
      timeframe: 'H1',
      entry_rules: [
        'Terdeteksi pola Pin Bar atau Engulfing yang jelas pada penutupan candle',
        'Pola terbentuk selaras dengan zona Supply/Demand atau level kunci',
        'Ukuran wick penolakan atau engulfing memenuhi rasio minimum',
      ],
      exit_rules: [
        'Stop Loss di ekor pola candlestick + buffer ATR',
        'Take Profit minimal 1:2.2 Risk/Reward',
      ],
      sl_atr_mult: 1.25,
      tp_rr_ratio: 2.2,
      trailing_stop_pips: 18,
      params: { requireZoneConfluence: true, minWickRatio: 2.0 },
      enabled: true,
    },
    {
      id: 'strat-scalping',
      name: 'Scalping',
      slug: 'scalping',
      description: 'Eksekusi frekuensi terukur pada timeframe M5/M15 saat spread ketat dengan target cepat dan Stop Loss disiplin.',
      timeframe: 'M5',
      entry_rules: [
        'Spread instrumen di bawah ambang ketat',
        'Persilangan momentum cepat EMA 20 & MACD Histogram pada arah EMA 50',
        'Volatilitas cukup (ATR tidak datar) dan di luar jendela berita High Impact',
      ],
      exit_rules: [
        'Stop Loss ketat 1.1x ATR',
        'Take Profit 1:2.0 dengan Auto Break Even cepat',
      ],
      sl_atr_mult: 1.1,
      tp_rr_ratio: 2.0,
      trailing_stop_pips: 8,
      params: { maxSpreadMultiplier: 0.75, quickBreakEvenPips: 8 },
      enabled: true,
    },
    {
      id: 'strat-intraday',
      name: 'Intraday Trading',
      slug: 'intraday-trading',
      description: 'Menangkap pergerakan sesi London & New York pada M15/M30 dengan konfluensi Multi-Timeframe H1/H4.',
      timeframe: 'M15',
      entry_rules: [
        'Arah M15 selaras dengan tren H1 (Multi-Timeframe alignment)',
        'Harga berada di sisi benar EMA 50 dengan dorongan MACD',
        'Eksekusi hanya dalam jam likuiditas sesi utama',
      ],
      exit_rules: [
        'Stop Loss 1.5x ATR M15',
        'Take Profit 1:2.2 sebelum penutupan sesi harian',
      ],
      sl_atr_mult: 1.5,
      tp_rr_ratio: 2.2,
      trailing_stop_pips: 15,
      params: { requireMtfAlignment: true, sessionOnly: true },
      enabled: true,
    },
    {
      id: 'strat-swing',
      name: 'Swing Trading',
      slug: 'swing-trading',
      description: 'Menahan posisi multi-hari berbasis struktur H4/D1 dengan konfluensi EMA 200, zona Demand/Supply, dan target R:R lebar.',
      timeframe: 'H4',
      entry_rules: [
        'Struktur tren H4 & D1 terkonfirmasi oleh EMA 50 vs EMA 200',
        'Retest zona Demand/Supply atau level Fibonacci/S&R utama',
        'Volatilitas stabil tanpa noise jangka pendek',
      ],
      exit_rules: [
        'Stop Loss lebar 1.8x ATR H4',
        'Take Profit 1:3.0 dengan Trailing Stop bertahap',
      ],
      sl_atr_mult: 1.8,
      tp_rr_ratio: 3.0,
      trailing_stop_pips: 35,
      params: { minHoldHours: 12, targetRr: 3.0 },
      enabled: true,
    },
  ];

  const insertStrat = db.prepare(`
    INSERT OR IGNORE INTO strategies (id, name, slug, description, timeframe, entry_rules_json, exit_rules_json, sl_atr_mult, tp_rr_ratio, trailing_stop_pips, params_json, enabled, updated_at)
    VALUES (@id, @name, @slug, @description, @timeframe, @entry_rules_json, @exit_rules_json, @sl_atr_mult, @tp_rr_ratio, @trailing_stop_pips, @params_json, @enabled, @updated_at)
  `);

  for (const s of defaultStrategies) {
    insertStrat.run({
      id: s.id,
      name: s.name,
      slug: s.slug,
      description: s.description,
      timeframe: s.timeframe,
      entry_rules_json: JSON.stringify(s.entry_rules),
      exit_rules_json: JSON.stringify(s.exit_rules),
      sl_atr_mult: s.sl_atr_mult,
      tp_rr_ratio: s.tp_rr_ratio,
      trailing_stop_pips: s.trailing_stop_pips,
      params_json: JSON.stringify(s.params),
      enabled: s.enabled ? 1 : 0,
      updated_at: now,
    });
  }

  const eventCount = (db.prepare('SELECT COUNT(*) as c FROM economic_events').get() as { c: number }).c;
  if (eventCount === 0) {
    const base = Date.now();
    const hour = 3600 * 1000;
    const events = [
      { id: 'ev-1', title: 'US Core CPI (MoM)', currency: 'USD', impact: 'HIGH', offsetHours: 3.5, forecast: '0.3%', previous: '0.3%', actual: '' },
      { id: 'ev-2', title: 'ECB Monetary Policy Statement', currency: 'EUR', impact: 'HIGH', offsetHours: 6, forecast: '3.25%', previous: '3.25%', actual: '' },
      { id: 'ev-3', title: 'UK Claimant Count Change', currency: 'GBP', impact: 'MEDIUM', offsetHours: 10, forecast: '14.2K', previous: '12.9K', actual: '' },
      { id: 'ev-4', title: 'US Retail Sales (MoM)', currency: 'USD', impact: 'HIGH', offsetHours: 22, forecast: '0.4%', previous: '0.2%', actual: '' },
      { id: 'ev-5', title: 'BoJ Policy Rate Decision', currency: 'JPY', impact: 'HIGH', offsetHours: 28, forecast: '0.25%', previous: '0.25%', actual: '' },
      { id: 'ev-6', title: 'Australia Employment Change', currency: 'AUD', impact: 'MEDIUM', offsetHours: 34, forecast: '25.0K', previous: '21.4K', actual: '' },
      { id: 'ev-7', title: 'Canada Core Retail Sales', currency: 'CAD', impact: 'MEDIUM', offsetHours: 42, forecast: '0.2%', previous: '-0.1%', actual: '' },
      { id: 'ev-8', title: 'Swiss CPI (MoM)', currency: 'CHF', impact: 'LOW', offsetHours: 48, forecast: '0.1%', previous: '0.1%', actual: '' },
      { id: 'ev-9', title: 'German ZEW Economic Sentiment', currency: 'EUR', impact: 'MEDIUM', offsetHours: -4, forecast: '18.5', previous: '15.2', actual: '19.1' },
      { id: 'ev-10', title: 'US Initial Jobless Claims', currency: 'USD', impact: 'LOW', offsetHours: -12, forecast: '218K', previous: '221K', actual: '215K' },
    ];
    const insEv = db.prepare(`
      INSERT INTO economic_events (id, title, currency, impact, scheduled_at, forecast, previous, actual)
      VALUES (@id, @title, @currency, @impact, @scheduled_at, @forecast, @previous, @actual)
    `);
    for (const ev of events) {
      insEv.run({
        id: ev.id,
        title: ev.title,
        currency: ev.currency,
        impact: ev.impact,
        scheduled_at: new Date(base + ev.offsetHours * hour).toISOString(),
        forecast: ev.forecast,
        previous: ev.previous,
        actual: ev.actual,
      });
    }
  }
}

seedDefaults();

export function ensureUserResources(userId: string) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO mt5_configs (user_id, mode, status, updated_at)
    VALUES (?, 'disconnected', 'NOT CONNECTED', ?)
  `).run(userId, now);

  db.prepare(`
    INSERT OR IGNORE INTO autopilot_settings (user_id, updated_at)
    VALUES (?, ?)
  `).run(userId, now);
}

export function getAutoPilotSettings(userId: string): AutoPilotSettings {
  ensureUserResources(userId);
  const row = db.prepare('SELECT * FROM autopilot_settings WHERE user_id = ?').get(userId) as Record<string, unknown>;
  return {
    user_id: String(row.user_id),
    trading_mode: row.trading_mode as AutoPilotSettings['trading_mode'],
    active_strategy_id: String(row.active_strategy_id),
    timeframe: row.timeframe as Timeframe,
    risk_per_trade_pct: Number(row.risk_per_trade_pct),
    max_lot: Number(row.max_lot),
    daily_profit_target_pct: Number(row.daily_profit_target_pct),
    max_daily_loss_pct: Number(row.max_daily_loss_pct),
    max_drawdown_pct: Number(row.max_drawdown_pct),
    max_open_positions: Number(row.max_open_positions),
    max_trades_per_day: Number(row.max_trades_per_day),
    min_rr_ratio: Number(row.min_rr_ratio),
    trading_hours_start: String(row.trading_hours_start),
    trading_hours_end: String(row.trading_hours_end),
    news_filter_enabled: Boolean(row.news_filter_enabled),
    news_buffer_minutes: Number(row.news_buffer_minutes),
    trailing_stop_enabled: Boolean(row.trailing_stop_enabled),
    trailing_stop_pips: Number(row.trailing_stop_pips),
    auto_break_even_enabled: Boolean(row.auto_break_even_enabled),
    break_even_trigger_pips: Number(row.break_even_trigger_pips),
    spread_protection_enabled: Boolean(row.spread_protection_enabled),
    volatility_protection_enabled: Boolean(row.volatility_protection_enabled),
    engine_running: Boolean(row.engine_running),
    daily_locked: Boolean(row.daily_locked),
    daily_lock_reason: row.daily_lock_reason ? String(row.daily_lock_reason) : null,
    updated_at: String(row.updated_at),
  };
}

export function getStrategies(): Strategy[] {
  const rows = db.prepare('SELECT * FROM strategies ORDER BY rowid ASC').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    description: String(r.description),
    timeframe: r.timeframe as Timeframe,
    entry_rules: JSON.parse(String(r.entry_rules_json)),
    exit_rules: JSON.parse(String(r.exit_rules_json)),
    sl_atr_mult: Number(r.sl_atr_mult),
    tp_rr_ratio: Number(r.tp_rr_ratio),
    trailing_stop_pips: Number(r.trailing_stop_pips),
    params: JSON.parse(String(r.params_json)),
    enabled: Boolean(r.enabled),
    updated_at: String(r.updated_at),
  }));
}

export function getInstruments(): Instrument[] {
  const rows = db.prepare('SELECT * FROM instruments ORDER BY rowid ASC').all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    symbol: String(r.symbol),
    enabled: Boolean(r.enabled),
    digits: Number(r.digits),
    contract_size: Number(r.contract_size),
    pip_size: Number(r.pip_size),
    min_lot: Number(r.min_lot),
    max_lot: Number(r.max_lot),
    max_spread_points: Number(r.max_spread_points),
    category: String(r.category),
  }));
}

export function writeAuditLog(params: {
  userId?: string | null;
  actorEmail: string;
  action: string;
  category: 'AUTH' | 'MT5' | 'RISK' | 'EXECUTION' | 'STRATEGY' | 'SETTINGS' | 'SYSTEM';
  details: Record<string, unknown>;
  status: 'SUCCESS' | 'BLOCKED' | 'FAILED';
  ip?: string;
}) {
  db.prepare(`
    INSERT INTO audit_logs (id, user_id, actor_email, action, category, details_json, status, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    params.userId ?? null,
    params.actorEmail,
    params.action,
    params.category,
    JSON.stringify(params.details),
    params.status,
    params.ip ?? 'internal',
    new Date().toISOString()
  );
}
