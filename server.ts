import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  db,
  ensureUserResources,
  getAutoPilotSettings,
  getInstruments,
  getStrategies,
  writeAuditLog,
} from './server/db.ts';
import {
  extractToken,
  generateToken,
  hashPassword,
  hashToken,
  requireRole,
  verifyPassword,
  type AuthenticatedRequest,
} from './server/security.ts';
import { getMarketCandles, parseCsvCandles } from './server/marketData.ts';
import { buildTechnicalSnapshot, evaluateStrategySignal } from './server/quantEngine.ts';
import { checkActiveHighImpactNews, validateOrderRisk } from './server/riskEngine.ts';
import { runWalkForwardBacktest } from './server/backtestEngine.ts';
import { generateAiMarketAnalysis } from './server/aiAnalyst.ts';
import {
  connectRemoteMt5Bridge,
  disconnectMt5,
  dispatchOrderToBridge,
  enablePaperSandbox,
  generateEaBridgeKey,
  getMt5State,
  MQL5_EA_TEMPLATE,
  PYTHON_MT5_BRIDGE_TEMPLATE,
} from './server/mt5Bridge.ts';
import {
  closeManagedPosition,
  emergencyCloseAllManaged,
  registerWsBroadcaster,
  startAutoPilotLoop,
} from './server/autopilotWorker.ts';
import type { Timeframe } from './server/types.ts';

const PORT = 3000;
const app = express();
app.use(express.json({ limit: '5mb' }));

// Attach user session if present
app.use((req: AuthenticatedRequest, _res, next) => {
  const token = extractToken(req);
  if (token) {
    const tokenHash = hashToken(token);
    const session = db
      .prepare(
        `SELECT s.token_hash, s.expires_at, u.id, u.email, u.name, u.role
         FROM sessions s JOIN users u ON s.user_id = u.id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash) as
      | {
          token_hash: string;
          expires_at: string;
          id: string;
          email: string;
          name: string;
          role: 'admin' | 'trader' | 'viewer';
        }
      | undefined;

    if (session && Date.parse(session.expires_at) > Date.now()) {
      req.user = {
        id: session.id,
        email: session.email,
        name: session.name,
        role: session.role,
      };
      req.sessionTokenHash = session.token_hash;
    }
  }
  next();
});

function requireAuth(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Sesi tidak valid atau belum login.' });
    return;
  }
  next();
}

function getClientIp(req: express.Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

// ==================== AUTH & SECURITY ====================
app.post('/api/auth/register', (req, res) => {
  const { email, name, password } = req.body as {
    email?: string;
    name?: string;
    password?: string;
  };
  if (!email || !name || !password || password.length < 8) {
    res.status(400).json({ error: 'Email, nama, dan password minimal 8 karakter wajib diisi.' });
    return;
  }

  const cleanEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    res.status(409).json({ error: 'Email sudah terdaftar.' });
    return;
  }

  const userCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
  const role = userCount === 0 ? 'admin' : 'trader';
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, cleanEmail, name.trim(), hashPassword(password), role, now);

  ensureUserResources(id);

  const rawToken = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(hashToken(rawToken), id, expiresAt, getClientIp(req), req.headers['user-agent'] ?? '', now);

  writeAuditLog({
    userId: id,
    actorEmail: cleanEmail,
    action: 'USER_REGISTERED',
    category: 'AUTH',
    details: { role },
    status: 'SUCCESS',
    ip: getClientIp(req),
  });

  res.cookie('nexora_session', rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000,
  });
  res.json({ user: { id, email: cleanEmail, name: name.trim(), role }, token: rawToken });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'Email dan password wajib diisi.' });
    return;
  }

  const cleanEmail = email.trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail) as
    | { id: string; email: string; name: string; password_hash: string; role: string }
    | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    writeAuditLog({
      actorEmail: cleanEmail,
      action: 'LOGIN_FAILED',
      category: 'AUTH',
      details: { reason: 'Invalid credentials' },
      status: 'FAILED',
      ip: getClientIp(req),
    });
    res.status(401).json({ error: 'Email atau password salah.' });
    return;
  }

  ensureUserResources(user.id);
  const rawToken = generateToken();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(hashToken(rawToken), user.id, expiresAt, getClientIp(req), req.headers['user-agent'] ?? '', now);

  writeAuditLog({
    userId: user.id,
    actorEmail: user.email,
    action: 'USER_LOGIN',
    category: 'AUTH',
    details: {},
    status: 'SUCCESS',
    ip: getClientIp(req),
  });

  res.cookie('nexora_session', rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000,
  });
  res.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token: rawToken,
  });
});

app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.sessionTokenHash) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionTokenHash);
  }
  writeAuditLog({
    userId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'USER_LOGOUT',
    category: 'AUTH',
    details: {},
    status: 'SUCCESS',
    ip: getClientIp(req),
  });
  res.clearCookie('nexora_session');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, user: req.user });
});

app.get('/api/audit-logs', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM audit_logs WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC LIMIT 150`
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;
  res.json({
    logs: rows.map((r) => ({
      id: r.id,
      actorEmail: r.actor_email,
      action: r.action,
      category: r.category,
      details: JSON.parse(String(r.details_json || '{}')),
      status: r.status,
      ip: r.ip,
      createdAt: r.created_at,
    })),
  });
});

// ==================== DASHBOARD ====================
app.get('/api/dashboard', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.id;
  const mt5 = getMt5State(userId);
  const settings = getAutoPilotSettings(userId);

  const openPositions = db
    .prepare(`SELECT * FROM positions WHERE user_id = ? ORDER BY opened_at DESC`)
    .all(userId) as Array<Record<string, unknown>>;

  const buyCount = openPositions.filter((p) => p.side === 'BUY').length;
  const sellCount = openPositions.filter((p) => p.side === 'SELL').length;
  const floatingPnl = Number(
    openPositions.reduce((sum, p) => sum + Number(p.profit ?? 0), 0).toFixed(2)
  );

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const monthPrefix = new Date().toISOString().slice(0, 7);

  // Filter trade history to current source mode (never mix old sandbox with live MT5)
  const activeSource = mt5.mode === 'paper_sandbox' ? 'paper_sandbox' : 'mt5';

  const historyRows = db
    .prepare(`SELECT * FROM trade_history WHERE user_id = ? AND source = ? ORDER BY closed_at DESC`)
    .all(userId, activeSource) as Array<Record<string, unknown>>;

  const todayRealized = historyRows
    .filter((h) => String(h.closed_at).startsWith(todayPrefix))
    .reduce((s, h) => s + Number(h.profit_loss ?? 0), 0);
  const monthRealized = historyRows
    .filter((h) => String(h.closed_at).startsWith(monthPrefix))
    .reduce((s, h) => s + Number(h.profit_loss ?? 0), 0);

  const wins = historyRows.filter((h) => Number(h.profit_loss ?? 0) > 0).length;
  const totalTransactions = historyRows.length;
  const winRate =
    totalTransactions > 0 ? Number(((wins / totalTransactions) * 100).toFixed(1)) : 0;

  const equityCurve = db
    .prepare(
      `SELECT balance, equity, timestamp, source FROM equity_snapshots WHERE user_id = ? AND source = ? ORDER BY id ASC LIMIT 200`
    )
    .all(userId, activeSource);

  const pendingSignals = db
    .prepare(
      `SELECT * FROM pending_signals WHERE user_id = ? AND status IN ('PENDING_APPROVAL', 'BLOCKED') ORDER BY created_at DESC LIMIT 20`
    )
    .all(userId);

  res.json({
    mt5,
    aiEngineStatus: process.env.GEMINI_API_KEY ? 'READY' : 'DETERMINISTIC_ONLY',
    autoPilotStatus: settings.daily_locked
      ? 'LOCKED'
      : settings.engine_running
        ? 'RUNNING'
        : 'STOPPED',
    tradingMode: settings.trading_mode,
    metrics: {
      totalBalance: mt5.status === 'CONNECTED' ? mt5.balance : null,
      equity: mt5.status === 'CONNECTED' ? mt5.equity : null,
      floatingPnl: mt5.status === 'CONNECTED' ? floatingPnl : null,
      todayProfit: mt5.status === 'CONNECTED' ? Number((todayRealized + floatingPnl).toFixed(2)) : null,
      monthlyProfit: mt5.status === 'CONNECTED' ? Number(monthRealized.toFixed(2)) : null,
      winRate: mt5.status === 'CONNECTED' ? winRate : null,
      totalTransactions: mt5.status === 'CONNECTED' ? totalTransactions : 0,
      openBuyCount: buyCount,
      openSellCount: sellCount,
    },
    openPositions,
    pendingSignals,
    equityCurve,
    settings,
  });
});

// ==================== MARKET DATA & AI ANALYSIS ====================
app.get('/api/market/candles', requireAuth, async (req: AuthenticatedRequest, res) => {
  const symbol = String(req.query.symbol || 'EURUSD').toUpperCase();
  const timeframe = (String(req.query.timeframe || 'H1').toUpperCase() as Timeframe) || 'H1';
  const inst = getInstruments().find((i) => i.symbol === symbol);
  if (!inst) {
    res.status(404).json({ error: 'Instrumen tidak ditemukan.' });
    return;
  }

  const primary = await getMarketCandles(req.user!.id, symbol, timeframe, 240);
  const higherTf: Timeframe =
    timeframe === 'M1'
      ? 'M15'
      : timeframe === 'M5'
        ? 'M30'
        : timeframe === 'M15'
          ? 'H1'
          : timeframe === 'M30'
            ? 'H4'
            : timeframe === 'H1'
              ? 'H4'
              : 'D1';
  const higher = await getMarketCandles(req.user!.id, symbol, higherTf, 120);

  const snapshot = buildTechnicalSnapshot({
    symbol,
    timeframe,
    candles: primary.candles,
    higherCandles: higher.candles,
    dataSource: primary.source,
    spreadPoints: primary.spreadPoints,
    instrument: inst,
  });

  res.json({ candles: primary.candles, snapshot });
});

app.post('/api/analysis/run', requireAuth, async (req: AuthenticatedRequest, res) => {
  const { symbol = 'EURUSD', timeframe = 'H1', strategyId } = req.body as {
    symbol?: string;
    timeframe?: Timeframe;
    strategyId?: string;
  };

  const userId = req.user!.id;
  const inst = getInstruments().find((i) => i.symbol === symbol);
  if (!inst) {
    res.status(404).json({ error: 'Instrumen tidak valid.' });
    return;
  }

  const settings = getAutoPilotSettings(userId);
  const strategies = getStrategies();
  const strategy =
    strategies.find((s) => s.id === (strategyId || settings.active_strategy_id)) ?? strategies[0];

  const primary = await getMarketCandles(userId, symbol, timeframe, 240);
  const higherTf: Timeframe =
    timeframe === 'H1' ? 'H4' : timeframe === 'M15' ? 'H1' : timeframe === 'H4' ? 'D1' : 'H4';
  const higher = await getMarketCandles(userId, symbol, higherTf, 120);

  const snapshot = buildTechnicalSnapshot({
    symbol,
    timeframe,
    candles: primary.candles,
    higherCandles: higher.candles,
    dataSource: primary.source,
    spreadPoints: primary.spreadPoints,
    instrument: inst,
  });

  const deterministic = evaluateStrategySignal({
    candles: primary.candles,
    snapshot,
    strategy,
    instrument: inst,
    minRrRatio: settings.min_rr_ratio,
  });

  const ai = await generateAiMarketAnalysis(deterministic);

  // Also pre-evaluate Risk Management eligibility for transparency
  const riskPreview =
    ai.direction === 'BUY' || ai.direction === 'SELL'
      ? validateOrderRisk({
          userId,
          symbol,
          side: ai.direction,
          entryPrice: ai.entryPrice,
          stopLoss: ai.stopLoss,
          takeProfit: ai.takeProfit,
          snapshot,
          bypassTradingHours: true,
        })
      : null;

  writeAuditLog({
    userId,
    actorEmail: req.user!.email,
    action: 'AI_ANALYSIS_EXECUTED',
    category: 'SYSTEM',
    details: { symbol, timeframe, strategy: strategy.name, direction: ai.direction, aiPowered: ai.aiPowered },
    status: 'SUCCESS',
    ip: getClientIp(req),
  });

  res.json({ deterministic, ai, riskPreview, candles: primary.candles.slice(-120) });
});

// ==================== AUTO PILOT & EXECUTION ====================
app.post(
  '/api/autopilot/start',
  requireAuth,
  requireRole(['admin', 'trader']),
  (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const mt5 = getMt5State(userId);
    if (mt5.status !== 'CONNECTED' || mt5.mode === 'disconnected') {
      res.status(400).json({
        error:
          'Tidak dapat menyalakan Auto Pilot saat MT5 berstatus NOT CONNECTED. Hubungkan MT5 Bridge atau aktifkan Paper Sandbox terlebih dahulu.',
      });
      return;
    }

    const settings = getAutoPilotSettings(userId);
    if (settings.daily_locked) {
      res.status(400).json({
        error: `Auto Pilot terkunci oleh Daily Trading Lock: ${settings.daily_lock_reason}`,
      });
      return;
    }

    db.prepare(`UPDATE autopilot_settings SET engine_running = 1, updated_at = ? WHERE user_id = ?`).run(
      new Date().toISOString(),
      userId
    );

    writeAuditLog({
      userId,
      actorEmail: req.user!.email,
      action: 'AUTOPILOT_STARTED',
      category: 'EXECUTION',
      details: { mode: settings.trading_mode, strategyId: settings.active_strategy_id },
      status: 'SUCCESS',
      ip: getClientIp(req),
    });

    broadcastToUser(userId, 'dashboard:update', { reason: 'AUTOPILOT_STARTED' });
    res.json({ ok: true, engine_running: true });
  }
);

app.post(
  '/api/autopilot/stop',
  requireAuth,
  requireRole(['admin', 'trader']),
  (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    db.prepare(`UPDATE autopilot_settings SET engine_running = 0, updated_at = ? WHERE user_id = ?`).run(
      new Date().toISOString(),
      userId
    );
    writeAuditLog({
      userId,
      actorEmail: req.user!.email,
      action: 'AUTOPILOT_STOPPED',
      category: 'EXECUTION',
      details: {},
      status: 'SUCCESS',
      ip: getClientIp(req),
    });
    broadcastToUser(userId, 'dashboard:update', { reason: 'AUTOPILOT_STOPPED' });
    res.json({ ok: true, engine_running: false });
  }
);

app.post(
  '/api/autopilot/emergency-close-all',
  requireAuth,
  requireRole(['admin', 'trader']),
  async (req: AuthenticatedRequest, res) => {
    const result = await emergencyCloseAllManaged(req.user!.id, req.user!.email);
    res.json(result);
  }
);

app.post(
  '/api/orders/execute',
  requireAuth,
  requireRole(['admin', 'trader']),
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const { symbol, side, entryPrice, stopLoss, takeProfit, requestedLot, strategyId, entryReason, idempotencyKey } =
      req.body as {
        symbol: string;
        side: 'BUY' | 'SELL';
        entryPrice: number;
        stopLoss: number;
        takeProfit: number;
        requestedLot?: number;
        strategyId?: string;
        entryReason?: string;
        idempotencyKey?: string;
      };

    if (!symbol || (side !== 'BUY' && side !== 'SELL')) {
      res.status(400).json({ error: 'Symbol dan arah BUY/SELL wajib valid.' });
      return;
    }

    const inst = getInstruments().find((i) => i.symbol === symbol);
    if (!inst) {
      res.status(404).json({ error: 'Instrumen tidak ditemukan.' });
      return;
    }

    const mkt = await getMarketCandles(userId, symbol, 'M15', 100);
    const snapshot = buildTechnicalSnapshot({
      symbol,
      timeframe: 'M15',
      candles: mkt.candles,
      dataSource: mkt.source,
      spreadPoints: mkt.spreadPoints,
      instrument: inst,
    });

    const execEntry =
      entryPrice && entryPrice > 0
        ? Number(entryPrice)
        : side === 'BUY'
          ? snapshot.ask
          : snapshot.bid;

    const risk = validateOrderRisk({
      userId,
      symbol,
      side,
      entryPrice: execEntry,
      stopLoss: Number(stopLoss),
      takeProfit: Number(takeProfit),
      requestedLot: requestedLot ? Number(requestedLot) : undefined,
      snapshot,
      bypassTradingHours: true,
    });

    if (!risk.approved) {
      writeAuditLog({
        userId,
        actorEmail: req.user!.email,
        action: 'ORDER_REJECTED_BY_RISK_ENGINE',
        category: 'RISK',
        details: { symbol, side, reasons: risk.reasons },
        status: 'BLOCKED',
        ip: getClientIp(req),
      });
      res.status(400).json({ error: risk.reasons.join(' '), risk });
      return;
    }

    const key = idempotencyKey || `manual_${userId}_${symbol}_${side}_${Date.now()}`;
    const dispatch = await dispatchOrderToBridge({
      userId,
      idempotencyKey: key,
      symbol,
      side,
      volume: risk.calculatedLot,
      price: execEntry,
      sl: Number(stopLoss),
      tp: Number(takeProfit),
      strategyId: strategyId || 'manual',
      entryReason: entryReason || 'Manual / Semi-Auto Execution after Risk Validation',
    });

    writeAuditLog({
      userId,
      actorEmail: req.user!.email,
      action: dispatch.ok ? 'ORDER_EXECUTED' : 'ORDER_EXECUTION_FAILED',
      category: 'EXECUTION',
      details: { symbol, side, lot: risk.calculatedLot, sl: stopLoss, tp: takeProfit, message: dispatch.message },
      status: dispatch.ok ? 'SUCCESS' : 'FAILED',
      ip: getClientIp(req),
    });

    broadcastToUser(userId, 'dashboard:update', { reason: 'ORDER_EXECUTED' });
    if (!dispatch.ok) {
      res.status(400).json({ error: dispatch.message, risk });
      return;
    }
    res.json({ ok: true, ticketId: dispatch.ticketId, lot: risk.calculatedLot, message: dispatch.message, risk });
  }
);

app.post(
  '/api/signals/:id/approve',
  requireAuth,
  requireRole(['admin', 'trader']),
  async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const sig = db
      .prepare(`SELECT * FROM pending_signals WHERE id = ? AND user_id = ?`)
      .get(req.params.id, userId) as Record<string, unknown> | undefined;

    if (!sig) {
      res.status(404).json({ error: 'Sinyal tidak ditemukan.' });
      return;
    }

    const inst = getInstruments().find((i) => i.symbol === String(sig.symbol));
    if (!inst) {
      res.status(404).json({ error: 'Instrumen tidak valid.' });
      return;
    }

    const mkt = await getMarketCandles(userId, String(sig.symbol), 'M15', 100);
    const snapshot = buildTechnicalSnapshot({
      symbol: String(sig.symbol),
      timeframe: 'M15',
      candles: mkt.candles,
      dataSource: mkt.source,
      spreadPoints: mkt.spreadPoints,
      instrument: inst,
    });

    const risk = validateOrderRisk({
      userId,
      symbol: String(sig.symbol),
      side: String(sig.direction) as 'BUY' | 'SELL',
      entryPrice: Number(sig.entry_price),
      stopLoss: Number(sig.sl),
      takeProfit: Number(sig.tp),
      snapshot,
      bypassTradingHours: true,
    });

    if (!risk.approved) {
      db.prepare(`UPDATE pending_signals SET status = 'BLOCKED', block_reason = ? WHERE id = ?`).run(
        risk.reasons.join(' | '),
        sig.id
      );
      res.status(400).json({ error: risk.reasons.join(' ') });
      return;
    }

    const exec = await dispatchOrderToBridge({
      userId,
      idempotencyKey: `sig_${sig.id}`,
      symbol: String(sig.symbol),
      side: String(sig.direction) as 'BUY' | 'SELL',
      volume: risk.calculatedLot,
      price: Number(sig.entry_price),
      sl: Number(sig.sl),
      tp: Number(sig.tp),
      strategyId: String(sig.strategy_id),
      entryReason: String(sig.reasoning),
    });

    if (!exec.ok) {
      res.status(400).json({ error: exec.message });
      return;
    }

    db.prepare(`UPDATE pending_signals SET status = 'EXECUTED' WHERE id = ?`).run(sig.id);
    broadcastToUser(userId, 'dashboard:update', { reason: 'SIGNAL_APPROVED' });
    res.json({ ok: true, message: exec.message });
  }
);

app.post(
  '/api/signals/:id/reject',
  requireAuth,
  requireRole(['admin', 'trader']),
  (req: AuthenticatedRequest, res) => {
    db.prepare(`UPDATE pending_signals SET status = 'REJECTED' WHERE id = ? AND user_id = ?`).run(
      req.params.id,
      req.user!.id
    );
    broadcastToUser(req.user!.id, 'dashboard:update', { reason: 'SIGNAL_REJECTED' });
    res.json({ ok: true });
  }
);

app.post(
  '/api/positions/:ticketId/close',
  requireAuth,
  requireRole(['admin', 'trader']),
  async (req: AuthenticatedRequest, res) => {
    const pos = db
      .prepare(`SELECT * FROM positions WHERE ticket_id = ? AND user_id = ?`)
      .get(req.params.ticketId, req.user!.id) as Record<string, unknown> | undefined;

    if (!pos) {
      res.status(404).json({ error: 'Posisi tidak ditemukan.' });
      return;
    }

    const result = await closeManagedPosition({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      ticketId: String(pos.ticket_id),
      exitPrice: Number(pos.current_price || pos.open_price),
      exitReason: 'MANUAL_CLOSE',
    });

    broadcastToUser(req.user!.id, 'dashboard:update', { reason: 'POSITION_CLOSED' });
    res.json(result);
  }
);

// ==================== INSTRUMENTS ====================
app.get('/api/instruments', requireAuth, (_req, res) => {
  res.json({ instruments: getInstruments() });
});

app.patch(
  '/api/instruments/:symbol',
  requireAuth,
  requireRole(['admin', 'trader']),
  (req: AuthenticatedRequest, res) => {
    const symbol = req.params.symbol.toUpperCase();
    const { enabled, max_spread_points } = req.body as {
      enabled?: boolean;
      max_spread_points?: number;
    };

    const existing = getInstruments().find((i) => i.symbol === symbol);
    if (!existing) {
      res.status(404).json({ error: 'Instrumen tidak ditemukan.' });
      return;
    }

    const nextEnabled = typeof enabled === 'boolean' ? (enabled ? 1 : 0) : existing.enabled ? 1 : 0;
    const nextSpread =
      typeof max_spread_points === 'number'
        ? Math.max(5, Math.min(200, max_spread_points))
        : existing.max_spread_points;

    db.prepare(`UPDATE instruments SET enabled = ?, max_spread_points = ? WHERE symbol = ?`).run(
      nextEnabled,
      nextSpread,
      symbol
    );

    writeAuditLog({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'INSTRUMENT_UPDATED',
      category: 'SETTINGS',
      details: { symbol, enabled: Boolean(nextEnabled), max_spread_points: nextSpread },
      status: 'SUCCESS',
      ip: getClientIp(req),
    });

    res.json({ instruments: getInstruments() });
  }
);

// ==================== STRATEGY CENTER ====================
app.get('/api/strategies', requireAuth, (_req, res) => {
  res.json({ strategies: getStrategies() });
});

app.patch(
  '/api/strategies/:id',
  requireAuth,
  requireRole(['admin', 'trader']),
  (req: AuthenticatedRequest, res) => {
    const existing = getStrategies().find((s) => s.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Strategi tidak ditemukan.' });
      return;
    }

    const { timeframe, sl_atr_mult, tp_rr_ratio, trailing_stop_pips, params, enabled, entry_rules, exit_rules } =
      req.body as Partial<{
        timeframe: Timeframe;
        sl_atr_mult: number;
        tp_rr_ratio: number;
        trailing_stop_pips: number;
        params: Record<string, number | boolean | string>;
        enabled: boolean;
        entry_rules: string[];
        exit_rules: string[];
      }>;

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE strategies
      SET timeframe = ?,
          sl_atr_mult = ?,
          tp_rr_ratio = ?,
          trailing_stop_pips = ?,
          params_json = ?,
          entry_rules_json = ?,
          exit_rules_json = ?,
          enabled = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      timeframe ?? existing.timeframe,
      sl_atr_mult ? Math.max(0.5, Math.min(5, Number(sl_atr_mult))) : existing.sl_atr_mult,
      tp_rr_ratio ? Math.max(1.5, Math.min(8, Number(tp_rr_ratio))) : existing.tp_rr_ratio,
      trailing_stop_pips !== undefined
        ? Math.max(5, Math.min(150, Number(trailing_stop_pips)))
        : existing.trailing_stop_pips,
      JSON.stringify(params ?? existing.params),
      JSON.stringify(entry_rules ?? existing.entry_rules),
      JSON.stringify(exit_rules ?? existing.exit_rules),
      typeof enabled === 'boolean' ? (enabled ? 1 : 0) : existing.enabled ? 1 : 0,
      now,
      existing.id
    );

    writeAuditLog({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'STRATEGY_UPDATED',
      category: 'STRATEGY',
      details: { strategyId: existing.id, name: existing.name },
      status: 'SUCCESS',
      ip: getClientIp(req),
    });

    res.json({ strategies: getStrategies() });
  }
);

// ==================== BACKTESTING ENGINE ====================
app.post('/api/backtest/run', requireAuth, async (req: AuthenticatedRequest, res) => {
  const {
    symbol = 'EURUSD',
    timeframe = 'H1',
    strategyId = 'strat-trend',
    initialBalance = 10000,
    riskPerTradePct = 0.5,
    spreadPoints = 12,
    commissionPerLot = 7,
    slippagePoints = 2,
    bars = 500,
    csvContent,
  } = req.body as {
    symbol?: string;
    timeframe?: Timeframe;
    strategyId?: string;
    initialBalance?: number;
    riskPerTradePct?: number;
    spreadPoints?: number;
    commissionPerLot?: number;
    slippagePoints?: number;
    bars?: number;
    csvContent?: string;
  };

  const inst = getInstruments().find((i) => i.symbol === symbol);
  const strategy = getStrategies().find((s) => s.id === strategyId);
  if (!inst || !strategy) {
    res.status(400).json({ error: 'Instrumen atau strategi tidak valid.' });
    return;
  }

  let candles = csvContent ? parseCsvCandles(csvContent) : [];
  let dataSource = 'CUSTOM_HISTORICAL_CSV';
  if (candles.length < 120) {
    if (csvContent) {
      res.status(400).json({ error: 'File CSV membutuhkan minimal 120 baris OHLCV yang valid.' });
      return;
    }
    const fetched = await getMarketCandles(
      req.user!.id,
      symbol,
      timeframe,
      Math.max(250, Math.min(1200, Number(bars) || 500))
    );
    candles = fetched.candles;
    dataSource = fetched.source;
  }

  const result = runWalkForwardBacktest({
    symbol,
    timeframe,
    strategy,
    instrument: inst,
    candles,
    dataSource,
    initialBalance: Math.max(500, Number(initialBalance) || 10000),
    riskPerTradePct: Math.min(2.0, Math.max(0.25, Number(riskPerTradePct) || 0.5)),
    spreadPoints: Math.max(0, Number(spreadPoints) || 12),
    commissionPerLot: Math.max(0, Number(commissionPerLot) || 7),
    slippagePoints: Math.max(0, Number(slippagePoints) || 2),
    minRrRatio: Math.max(1.5, strategy.tp_rr_ratio),
  });

  db.prepare(`
    INSERT INTO backtest_runs (id, user_id, symbol, timeframe, strategy_id, strategy_name, data_source, total_bars, spread_points, commission_per_lot, slippage_points, metrics_json, equity_curve_json, trades_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    result.id,
    req.user!.id,
    symbol,
    timeframe,
    strategy.id,
    strategy.name,
    dataSource,
    result.totalBars,
    spreadPoints,
    commissionPerLot,
    slippagePoints,
    JSON.stringify({ ...result.metrics, splitBreakdown: result.splitBreakdown }),
    JSON.stringify(result.equityCurve),
    JSON.stringify(result.trades.slice(-100)),
    new Date().toISOString()
  );

  writeAuditLog({
    userId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'BACKTEST_EXECUTED',
    category: 'STRATEGY',
    details: { symbol, timeframe, strategy: strategy.name, totalTrades: result.metrics.totalTrades, netProfit: result.metrics.netProfit },
    status: 'SUCCESS',
    ip: getClientIp(req),
  });

  res.json(result);
});

app.get('/api/backtest/history', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT id, symbol, timeframe, strategy_name, data_source, total_bars, spread_points, commission_per_lot, slippage_points, metrics_json, created_at
       FROM backtest_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;
  res.json({
    runs: rows.map((r) => ({
      ...r,
      metrics: JSON.parse(String(r.metrics_json)),
    })),
  });
});

// ==================== ECONOMIC CALENDAR ====================
app.get('/api/calendar', requireAuth, (req: AuthenticatedRequest, res) => {
  const impact = req.query.impact ? String(req.query.impact).toUpperCase() : null;
  const rows = impact
    ? db
        .prepare(`SELECT * FROM economic_events WHERE impact = ? ORDER BY scheduled_at ASC`)
        .all(impact)
    : db.prepare(`SELECT * FROM economic_events ORDER BY scheduled_at ASC`).all();

  const settings = getAutoPilotSettings(req.user!.id);
  const enabledPairs = getInstruments().filter((i) => i.enabled);
  const blockedPairs = settings.news_filter_enabled
    ? enabledPairs
        .map((p) => ({
          symbol: p.symbol,
          ...checkActiveHighImpactNews(p.symbol, settings.news_buffer_minutes),
        }))
        .filter((x) => x.blocked)
    : [];

  res.json({ events: rows, newsFilterEnabled: settings.news_filter_enabled, bufferMinutes: settings.news_buffer_minutes, blockedPairs });
});

app.post(
  '/api/calendar',
  requireAuth,
  requireRole(['admin', 'trader']),
  (req: AuthenticatedRequest, res) => {
    const { title, currency, impact, scheduled_at, forecast, previous } = req.body as {
      title?: string;
      currency?: string;
      impact?: string;
      scheduled_at?: string;
      forecast?: string;
      previous?: string;
    };
    if (!title || !currency || !scheduled_at) {
      res.status(400).json({ error: 'Judul, mata uang, dan jadwal berita wajib diisi.' });
      return;
    }
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO economic_events (id, title, currency, impact, scheduled_at, forecast, previous, actual)
      VALUES (?, ?, ?, ?, ?, ?, ?, '')
    `).run(id, title, currency.toUpperCase().slice(0, 3), impact || 'HIGH', scheduled_at, forecast || '', previous || '');
    res.json({ ok: true, id });
  }
);

// ==================== TRADING HISTORY & CSV EXPORT ====================
app.get('/api/history', requireAuth, (req: AuthenticatedRequest, res) => {
  const { startDate, endDate, symbol } = req.query as {
    startDate?: string;
    endDate?: string;
    symbol?: string;
  };
  let sql = `SELECT * FROM trade_history WHERE user_id = ?`;
  const params: unknown[] = [req.user!.id];

  if (symbol && symbol !== 'ALL') {
    sql += ` AND symbol = ?`;
    params.push(symbol.toUpperCase());
  }
  if (startDate) {
    sql += ` AND closed_at >= ?`;
    params.push(`${startDate}T00:00:00.000Z`);
  }
  if (endDate) {
    sql += ` AND closed_at <= ?`;
    params.push(`${endDate}T23:59:59.999Z`);
  }
  sql += ` ORDER BY closed_at DESC LIMIT 300`;

  const trades = db.prepare(sql).all(...params);
  res.json({ trades });
});

app.get('/api/history/export.csv', requireAuth, (req: AuthenticatedRequest, res) => {
  const trades = db
    .prepare(`SELECT * FROM trade_history WHERE user_id = ? ORDER BY closed_at DESC`)
    .all(req.user!.id) as Array<Record<string, unknown>>;

  const headers = [
    'Opened At',
    'Closed At',
    'Ticket ID',
    'Source',
    'Pair',
    'Side',
    'Lot',
    'Entry Price',
    'Exit Price',
    'Stop Loss',
    'Take Profit',
    'Profit/Loss',
    'Strategy',
    'Entry Reason',
    'Exit Reason',
  ];

  const escapeCsv = (val: unknown) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.join(',')];
  for (const t of trades) {
    lines.push(
      [
        t.opened_at,
        t.closed_at,
        t.ticket_id,
        t.source,
        t.symbol,
        t.side,
        t.volume,
        t.entry_price,
        t.exit_price,
        t.sl,
        t.tp,
        t.profit_loss,
        t.strategy_name,
        t.entry_reason,
        t.exit_reason,
      ]
        .map(escapeCsv)
        .join(',')
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="nexora-trading-history.csv"');
  res.send(lines.join('\n'));
});

// ==================== SETTINGS ====================
app.get('/api/settings', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ settings: getAutoPilotSettings(req.user!.id) });
});

app.put(
  '/api/settings',
  requireAuth,
  requireRole(['admin', 'trader']),
  (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const cur = getAutoPilotSettings(userId);
    const body = req.body as Partial<typeof cur> & { unlock_daily_lock?: boolean };

    const riskPct = Math.min(
      2.0,
      Math.max(0.25, Number(body.risk_per_trade_pct ?? cur.risk_per_trade_pct))
    );
    const minRr = Math.max(1.5, Math.min(5.0, Number(body.min_rr_ratio ?? cur.min_rr_ratio)));
    const maxLot = Math.max(0.01, Math.min(50, Number(body.max_lot ?? cur.max_lot)));
    const maxDailyLoss = Math.max(0.5, Math.min(10, Number(body.max_daily_loss_pct ?? cur.max_daily_loss_pct)));
    const maxDrawdown = Math.max(1, Math.min(30, Number(body.max_drawdown_pct ?? cur.max_drawdown_pct)));
    const dailyProfitTarget = Math.max(0.5, Math.min(20, Number(body.daily_profit_target_pct ?? cur.daily_profit_target_pct)));
    const maxOpenPos = Math.max(1, Math.min(15, Math.round(Number(body.max_open_positions ?? cur.max_open_positions))));
    const maxTradesDay = Math.max(1, Math.min(30, Math.round(Number(body.max_trades_per_day ?? cur.max_trades_per_day))));

    const dailyLocked = body.unlock_daily_lock ? 0 : cur.daily_locked ? 1 : 0;
    const lockReason = body.unlock_daily_lock ? null : cur.daily_lock_reason;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE autopilot_settings
      SET trading_mode = ?,
          active_strategy_id = ?,
          timeframe = ?,
          risk_per_trade_pct = ?,
          max_lot = ?,
          daily_profit_target_pct = ?,
          max_daily_loss_pct = ?,
          max_drawdown_pct = ?,
          max_open_positions = ?,
          max_trades_per_day = ?,
          min_rr_ratio = ?,
          trading_hours_start = ?,
          trading_hours_end = ?,
          news_filter_enabled = ?,
          news_buffer_minutes = ?,
          trailing_stop_enabled = ?,
          trailing_stop_pips = ?,
          auto_break_even_enabled = ?,
          break_even_trigger_pips = ?,
          spread_protection_enabled = ?,
          volatility_protection_enabled = ?,
          daily_locked = ?,
          daily_lock_reason = ?,
          updated_at = ?
      WHERE user_id = ?
    `).run(
      body.trading_mode ?? cur.trading_mode,
      body.active_strategy_id ?? cur.active_strategy_id,
      body.timeframe ?? cur.timeframe,
      riskPct,
      maxLot,
      dailyProfitTarget,
      maxDailyLoss,
      maxDrawdown,
      maxOpenPos,
      maxTradesDay,
      minRr,
      body.trading_hours_start ?? cur.trading_hours_start,
      body.trading_hours_end ?? cur.trading_hours_end,
      typeof body.news_filter_enabled === 'boolean'
        ? body.news_filter_enabled
          ? 1
          : 0
        : cur.news_filter_enabled
          ? 1
          : 0,
      Number(body.news_buffer_minutes ?? cur.news_buffer_minutes),
      typeof body.trailing_stop_enabled === 'boolean'
        ? body.trailing_stop_enabled
          ? 1
          : 0
        : cur.trailing_stop_enabled
          ? 1
          : 0,
      Number(body.trailing_stop_pips ?? cur.trailing_stop_pips),
      typeof body.auto_break_even_enabled === 'boolean'
        ? body.auto_break_even_enabled
          ? 1
          : 0
        : cur.auto_break_even_enabled
          ? 1
          : 0,
      Number(body.break_even_trigger_pips ?? cur.break_even_trigger_pips),
      typeof body.spread_protection_enabled === 'boolean'
        ? body.spread_protection_enabled
          ? 1
          : 0
        : cur.spread_protection_enabled
          ? 1
          : 0,
      typeof body.volatility_protection_enabled === 'boolean'
        ? body.volatility_protection_enabled
          ? 1
          : 0
        : cur.volatility_protection_enabled
          ? 1
          : 0,
      dailyLocked,
      lockReason,
      now,
      userId
    );

    writeAuditLog({
      userId,
      actorEmail: req.user!.email,
      action: 'AUTOPILOT_SETTINGS_UPDATED',
      category: 'SETTINGS',
      details: { trading_mode: body.trading_mode ?? cur.trading_mode, riskPct, minRr },
      status: 'SUCCESS',
      ip: getClientIp(req),
    });

    broadcastToUser(userId, 'dashboard:update', { reason: 'SETTINGS_UPDATED' });
    res.json({ settings: getAutoPilotSettings(userId) });
  }
);

// ==================== METATRADER 5 INTEGRATION ====================
app.get('/api/mt5/state', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ mt5: getMt5State(req.user!.id) });
});

app.post(
  '/api/mt5/connect-remote',
  requireAuth,
  requireRole(['admin', 'trader']),
  async (req: AuthenticatedRequest, res) => {
    const { bridgeUrl, bridgeToken, accountLogin, mt5Password, serverName, brokerName } =
      req.body as {
        bridgeUrl?: string;
        bridgeToken?: string;
        accountLogin?: string;
        mt5Password?: string;
        serverName?: string;
        brokerName?: string;
      };

    if (!bridgeUrl || !accountLogin || !mt5Password || !serverName) {
      res.status(400).json({ error: 'URL Bridge, Account Login, Password MT5, dan Server Broker wajib diisi.' });
      return;
    }

    const result = await connectRemoteMt5Bridge({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      bridgeUrl,
      bridgeToken: bridgeToken || '',
      accountLogin,
      mt5Password,
      serverName,
      brokerName: brokerName || '',
    });

    broadcastToUser(req.user!.id, 'dashboard:update', { reason: 'MT5_CONFIG_CHANGED' });
    if (!result.ok) {
      res.status(400).json({ error: result.message, mt5: result.state });
      return;
    }
    res.json({ ok: true, message: result.message, mt5: result.state });
  }
);

app.post(
  '/api/mt5/generate-ea-key',
  requireAuth,
  requireRole(['admin', 'trader']),
  (req: AuthenticatedRequest, res) => {
    const keyInfo = generateEaBridgeKey(req.user!.id, req.user!.email);
    res.json(keyInfo);
  }
);

app.post(
  '/api/mt5/enable-paper-sandbox',
  requireAuth,
  requireRole(['admin', 'trader']),
  (req: AuthenticatedRequest, res) => {
    const { initialBalance } = req.body as { initialBalance?: number };
    const state = enablePaperSandbox({
      userId: req.user!.id,
      actorEmail: req.user!.email,
      initialBalance,
    });
    broadcastToUser(req.user!.id, 'dashboard:update', { reason: 'SANDBOX_ENABLED' });
    res.json({ ok: true, mt5: state });
  }
);

app.post(
  '/api/mt5/disconnect',
  requireAuth,
  requireRole(['admin', 'trader']),
  (req: AuthenticatedRequest, res) => {
    const state = disconnectMt5(req.user!.id, req.user!.email);
    broadcastToUser(req.user!.id, 'dashboard:update', { reason: 'MT5_DISCONNECTED' });
    res.json({ ok: true, mt5: state });
  }
);

app.get('/api/mt5/templates', requireAuth, (_req, res) => {
  res.json({
    pythonBridge: PYTHON_MT5_BRIDGE_TEMPLATE,
    mql5Ea: MQL5_EA_TEMPLATE,
  });
});

// Inbound authenticated EA / VPS Push Endpoints
function authenticateBridgeKey(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const raw = auth.slice(7).trim();
  const keyHash = hashToken(raw);
  const cfg = db
    .prepare(`SELECT user_id FROM mt5_configs WHERE bridge_api_key_hash = ?`)
    .get(keyHash) as { user_id: string } | undefined;
  return cfg?.user_id ?? null;
}

app.post('/api/mt5/bridge/heartbeat', (req, res) => {
  const userId = authenticateBridgeKey(req);
  if (!userId) {
    res.status(401).json({ error: 'Invalid Bridge API Key' });
    return;
  }

  const { login, server, broker, balance, equity, margin, free_margin } = req.body as {
    login?: string;
    server?: string;
    broker?: string;
    balance?: number;
    equity?: number;
    margin?: number;
    free_margin?: number;
  };
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE mt5_configs
    SET mode = 'ea_push',
        status = 'CONNECTED',
        account_login = COALESCE(?, account_login),
        server_name = COALESCE(?, server_name),
        broker_name = COALESCE(?, broker_name),
        balance = ?,
        equity = ?,
        margin = ?,
        free_margin = ?,
        last_heartbeat = ?,
        updated_at = ?
    WHERE user_id = ?
  `).run(
    login ?? null,
    server ?? null,
    broker ?? null,
    Number(balance ?? 0),
    Number(equity ?? 0),
    Number(margin ?? 0),
    Number(free_margin ?? 0),
    now,
    now,
    userId
  );

  db.prepare(`
    INSERT INTO equity_snapshots (user_id, source, balance, equity, timestamp)
    VALUES (?, 'mt5', ?, ?, ?)
  `).run(userId, Number(balance ?? 0), Number(equity ?? 0), now);

  broadcastToUser(userId, 'mt5:heartbeat', { balance, equity, timestamp: now });
  res.json({ ok: true });
});

app.get('/api/mt5/bridge/pending-orders', (req, res) => {
  const userId = authenticateBridgeKey(req);
  if (!userId) {
    res.status(401).json({ error: 'Invalid Bridge API Key' });
    return;
  }
  const orders = db
    .prepare(`SELECT * FROM orders_queue WHERE user_id = ? AND status = 'DISPATCHED' ORDER BY created_at ASC`)
    .all(userId);
  res.json({ orders });
});

app.post('/api/mt5/bridge/order-result', (req, res) => {
  const userId = authenticateBridgeKey(req);
  if (!userId) {
    res.status(401).json({ error: 'Invalid Bridge API Key' });
    return;
  }
  const { orderId, status, ticketId, fillPrice, errorMessage } = req.body as {
    orderId: string;
    status: 'FILLED' | 'REJECTED';
    ticketId?: string;
    fillPrice?: number;
    errorMessage?: string;
  };
  const now = new Date().toISOString();
  const order = db
    .prepare(`SELECT * FROM orders_queue WHERE id = ? AND user_id = ?`)
    .get(orderId, userId) as Record<string, unknown> | undefined;

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  db.prepare(`UPDATE orders_queue SET status = ?, error_message = ?, updated_at = ? WHERE id = ?`).run(
    status,
    errorMessage ?? null,
    now,
    orderId
  );

  if (status === 'FILLED') {
    db.prepare(`
      INSERT OR REPLACE INTO positions (ticket_id, user_id, source, symbol, side, volume, open_price, current_price, sl, tp, profit, strategy_id, entry_reason, managed_by_nexora, opened_at)
      VALUES (?, ?, 'mt5', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?)
    `).run(
      ticketId || orderId,
      userId,
      order.symbol,
      order.side,
      order.volume,
      fillPrice ?? order.price,
      fillPrice ?? order.price,
      order.sl,
      order.tp,
      order.strategy_id,
      order.entry_reason,
      now
    );
  }
  broadcastToUser(userId, 'dashboard:update', { reason: 'EA_ORDER_RESULT' });
  res.json({ ok: true });
});

// ==================== HTTP + WEBSOCKET + VITE ====================
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const userSockets = new Map<string, Set<WebSocket>>();

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(
    request.url || '/',
    `http://${request.headers.host || 'localhost'}`
  ).pathname;

  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

function broadcastToUser(userId: string, event: string, payload: unknown) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const msg = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

registerWsBroadcaster(broadcastToUser);

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/ws', `http://${req.headers.host}`);
  let token = url.searchParams.get('token');
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('nexora_session='));
    if (match) token = decodeURIComponent(match.slice('nexora_session='.length));
  }

  if (!token) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  const session = db
    .prepare(
      `SELECT u.id FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = ?`
    )
    .get(hashToken(token)) as { id: string } | undefined;

  if (!session) {
    ws.close(4001, 'Invalid session');
    return;
  }

  if (!userSockets.has(session.id)) {
    userSockets.set(session.id, new Set());
  }
  userSockets.get(session.id)!.add(ws);

  ws.send(JSON.stringify({ event: 'ws:connected', payload: { userId: session.id } }));

  ws.on('close', () => {
    userSockets.get(session.id)?.delete(ws);
  });
});

async function bootstrap() {
  startAutoPilotLoop();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`NEXORA AI Server listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrap();
