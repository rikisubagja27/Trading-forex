import crypto from 'node:crypto';
import { db, getAutoPilotSettings, getInstruments, getStrategies, writeAuditLog } from './db.ts';
import { getMarketCandles } from './marketData.ts';
import { buildTechnicalSnapshot, evaluateStrategySignal } from './quantEngine.ts';
import { validateOrderRisk } from './riskEngine.ts';
import { dispatchOrderToBridge, getMt5State } from './mt5Bridge.ts';

type BroadcastFn = (userId: string, event: string, payload: unknown) => void;
let broadcastCallback: BroadcastFn = () => {};

export function registerWsBroadcaster(fn: BroadcastFn) {
  broadcastCallback = fn;
}

function getInstrumentPriceDeltaPnl(params: {
  symbol: string;
  side: string;
  volume: number;
  openPrice: number;
  currentPrice: number;
  pipSize: number;
  contractSize: number;
}) {
  const { symbol, side, volume, openPrice, currentPrice, pipSize, contractSize } = params;
  const diff = side === 'BUY' ? currentPrice - openPrice : openPrice - currentPrice;
  const pips = diff / pipSize;
  const pipValuePerLot = symbol.endsWith('JPY')
    ? (pipSize * contractSize) / Math.max(1, currentPrice)
    : pipSize * contractSize;
  return Number((pips * pipValuePerLot * volume).toFixed(2));
}

export async function closeManagedPosition(params: {
  userId: string;
  actorEmail: string;
  ticketId: string;
  exitPrice: number;
  exitReason: string;
}) {
  const { userId, actorEmail, ticketId, exitPrice, exitReason } = params;
  const pos = db
    .prepare(`SELECT * FROM positions WHERE ticket_id = ? AND user_id = ?`)
    .get(ticketId, userId) as Record<string, unknown> | undefined;

  if (!pos) return { ok: false, message: 'Posisi tidak ditemukan.' };
  if (!pos.managed_by_nexora) {
    return { ok: false, message: 'Posisi ini tidak dikelola oleh sistem NEXORA.' };
  }

  const inst = getInstruments().find((i) => i.symbol === String(pos.symbol));
  const pipSize = inst?.pip_size ?? 0.0001;
  const contractSize = inst?.contract_size ?? 100000;
  const pnl = getInstrumentPriceDeltaPnl({
    symbol: String(pos.symbol),
    side: String(pos.side),
    volume: Number(pos.volume),
    openPrice: Number(pos.open_price),
    currentPrice: exitPrice,
    pipSize,
    contractSize,
  });

  const strategy = getStrategies().find((s) => s.id === String(pos.strategy_id));
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO trade_history (id, ticket_id, user_id, source, symbol, side, volume, entry_price, exit_price, sl, tp, profit_loss, commission, swap, strategy_name, entry_reason, exit_reason, opened_at, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    ticketId,
    userId,
    String(pos.source),
    String(pos.symbol),
    String(pos.side),
    Number(pos.volume),
    Number(pos.open_price),
    exitPrice,
    Number(pos.sl),
    Number(pos.tp),
    pnl,
    Number(pos.commission ?? 0),
    Number(pos.swap ?? 0),
    strategy?.name ?? 'Manual Execution',
    String(pos.entry_reason ?? 'Manual / Auto Pilot'),
    exitReason,
    String(pos.opened_at),
    now
  );

  db.prepare(`DELETE FROM positions WHERE ticket_id = ?`).run(ticketId);

  if (String(pos.source) === 'paper_sandbox') {
    const mt5 = db.prepare('SELECT balance FROM mt5_configs WHERE user_id = ?').get(userId) as
      | { balance: number }
      | undefined;
    const newBalance = Number(((mt5?.balance ?? 10000) + pnl + Number(pos.commission ?? 0)).toFixed(2));
    db.prepare(`
      UPDATE mt5_configs SET balance = ?, equity = ?, free_margin = ?, updated_at = ? WHERE user_id = ?
    `).run(newBalance, newBalance, newBalance, now, userId);

    db.prepare(`
      INSERT INTO equity_snapshots (user_id, source, balance, equity, timestamp)
      VALUES (?, 'paper_sandbox', ?, ?, ?)
    `).run(userId, newBalance, newBalance, now);
  }

  writeAuditLog({
    userId,
    actorEmail,
    action: 'POSITION_CLOSED',
    category: 'EXECUTION',
    details: { ticketId, symbol: pos.symbol, exitPrice, pnl, exitReason },
    status: 'SUCCESS',
  });

  return { ok: true, pnl, message: `Posisi #${ticketId} ditutup (${exitReason}) PnL $${pnl.toFixed(2)}.` };
}

export async function emergencyCloseAllManaged(userId: string, actorEmail: string) {
  const now = new Date().toISOString();
  // Immediately halt Auto Pilot and cancel queued orders
  db.prepare(`UPDATE autopilot_settings SET engine_running = 0, updated_at = ? WHERE user_id = ?`).run(
    now,
    userId
  );
  db.prepare(
    `UPDATE orders_queue SET status = 'REJECTED', error_message = 'EMERGENCY_STOP', updated_at = ? WHERE user_id = ? AND status IN ('QUEUED', 'DISPATCHED')`
  ).run(now, userId);

  const managedPositions = db
    .prepare(`SELECT * FROM positions WHERE user_id = ? AND managed_by_nexora = 1`)
    .all(userId) as Array<Record<string, unknown>>;

  let closedCount = 0;
  let totalPnl = 0;

  for (const pos of managedPositions) {
    const exitPrice = Number(pos.current_price || pos.open_price);
    const res = await closeManagedPosition({
      userId,
      actorEmail,
      ticketId: String(pos.ticket_id),
      exitPrice,
      exitReason: 'EMERGENCY_CLOSE_ALL',
    });
    if (res.ok) {
      closedCount++;
      totalPnl += res.pnl ?? 0;
    }
  }

  writeAuditLog({
    userId,
    actorEmail,
    action: 'EMERGENCY_CLOSE_ALL',
    category: 'EXECUTION',
    details: { closedCount, totalPnl: Number(totalPnl.toFixed(2)) },
    status: 'SUCCESS',
  });

  broadcastCallback(userId, 'dashboard:update', { reason: 'EMERGENCY_CLOSE_ALL' });
  return {
    ok: true,
    closedCount,
    totalPnl: Number(totalPnl.toFixed(2)),
    message: `Auto Pilot dihentikan. ${closedCount} posisi kelolaan NEXORA ditutup.`,
  };
}

let workerTimer: NodeJS.Timeout | null = null;
let lastCycleTick = 0;

export function startAutoPilotLoop() {
  if (workerTimer) return;
  workerTimer = setInterval(async () => {
    const nowMs = Date.now();
    try {
      // 1. Update open positions valuation, Break Even, Trailing Stop, & Sandbox SL/TP
      const openPositions = db.prepare(`SELECT * FROM positions`).all() as Array<Record<string, unknown>>;
      const instruments = getInstruments();

      const positionsByUser = new Map<string, number>();

      for (const pos of openPositions) {
        const userId = String(pos.user_id);
        const symbol = String(pos.symbol);
        const inst = instruments.find((i) => i.symbol === symbol);
        if (!inst) continue;

        const mkt = await getMarketCandles(userId, symbol, 'M5', 70);
        const latestPrice = mkt.candles[mkt.candles.length - 1]?.close ?? Number(pos.current_price);
        const side = String(pos.side) as 'BUY' | 'SELL';
        const openPrice = Number(pos.open_price);
        let sl = Number(pos.sl);
        const tp = Number(pos.tp);
        const volume = Number(pos.volume);

        // In Paper Sandbox, evaluate SL/TP hits realistically
        if (String(pos.source) === 'paper_sandbox') {
          if (side === 'BUY' && sl > 0 && latestPrice <= sl) {
            await closeManagedPosition({
              userId,
              actorEmail: 'autopilot@nexora.system',
              ticketId: String(pos.ticket_id),
              exitPrice: sl,
              exitReason: 'STOP_LOSS_HIT',
            });
            continue;
          }
          if (side === 'BUY' && tp > 0 && latestPrice >= tp) {
            await closeManagedPosition({
              userId,
              actorEmail: 'autopilot@nexora.system',
              ticketId: String(pos.ticket_id),
              exitPrice: tp,
              exitReason: 'TAKE_PROFIT_HIT',
            });
            continue;
          }
          if (side === 'SELL' && sl > 0 && latestPrice >= sl) {
            await closeManagedPosition({
              userId,
              actorEmail: 'autopilot@nexora.system',
              ticketId: String(pos.ticket_id),
              exitPrice: sl,
              exitReason: 'STOP_LOSS_HIT',
            });
            continue;
          }
          if (side === 'SELL' && tp > 0 && latestPrice <= tp) {
            await closeManagedPosition({
              userId,
              actorEmail: 'autopilot@nexora.system',
              ticketId: String(pos.ticket_id),
              exitPrice: tp,
              exitReason: 'TAKE_PROFIT_HIT',
            });
            continue;
          }
        }

        const settings = getAutoPilotSettings(userId);
        const profitPips =
          side === 'BUY'
            ? (latestPrice - openPrice) / inst.pip_size
            : (openPrice - latestPrice) / inst.pip_size;

        let breakEvenApplied = Boolean(pos.break_even_applied);

        // Auto Break Even
        if (
          settings.auto_break_even_enabled &&
          !breakEvenApplied &&
          profitPips >= settings.break_even_trigger_pips
        ) {
          sl = openPrice;
          breakEvenApplied = true;
        }

        // Trailing Stop
        if (settings.trailing_stop_enabled && profitPips > settings.trailing_stop_pips) {
          const trailDist = settings.trailing_stop_pips * inst.pip_size;
          if (side === 'BUY') {
            const candidate = Number((latestPrice - trailDist).toFixed(inst.digits));
            if (candidate > sl) sl = candidate;
          } else {
            const candidate = Number((latestPrice + trailDist).toFixed(inst.digits));
            if (sl === 0 || candidate < sl) sl = candidate;
          }
        }

        const pnl = getInstrumentPriceDeltaPnl({
          symbol,
          side,
          volume,
          openPrice,
          currentPrice: latestPrice,
          pipSize: inst.pip_size,
          contractSize: inst.contract_size,
        });

        db.prepare(
          `UPDATE positions SET current_price = ?, sl = ?, profit = ?, break_even_applied = ? WHERE ticket_id = ?`
        ).run(latestPrice, sl, pnl, breakEvenApplied ? 1 : 0, String(pos.ticket_id));

        positionsByUser.set(userId, (positionsByUser.get(userId) ?? 0) + pnl);
      }

      for (const [userId, floating] of positionsByUser.entries()) {
        const cfg = db.prepare('SELECT balance, mode FROM mt5_configs WHERE user_id = ?').get(userId) as
          | { balance: number; mode: string }
          | undefined;
        if (cfg && cfg.mode === 'paper_sandbox') {
          const equity = Number((cfg.balance + floating).toFixed(2));
          db.prepare(`UPDATE mt5_configs SET equity = ?, free_margin = ? WHERE user_id = ?`).run(
            equity,
            equity,
            userId
          );
        }
        broadcastCallback(userId, 'positions:tick', { floating });
      }

      // 2. Auto Pilot Signal Scan every 24 seconds for active running engines
      if (nowMs - lastCycleTick < 24_000) return;
      lastCycleTick = nowMs;

      const activeUsers = db
        .prepare(`SELECT user_id FROM autopilot_settings WHERE engine_running = 1`)
        .all() as Array<{ user_id: string }>;

      const strategies = getStrategies();
      const enabledInsts = instruments.filter((i) => i.enabled);

      for (const { user_id: userId } of activeUsers) {
        const mt5 = getMt5State(userId);
        if (mt5.status !== 'CONNECTED' || mt5.mode === 'disconnected') continue;

        const settings = getAutoPilotSettings(userId);
        if (settings.trading_mode === 'MANUAL' || settings.daily_locked) continue;

        const strategy = strategies.find((s) => s.id === settings.active_strategy_id && s.enabled);
        if (!strategy) continue;

        for (const inst of enabledInsts) {
          // Skip if already holding a position in this symbol
          const existingPos = db
            .prepare(`SELECT ticket_id FROM positions WHERE user_id = ? AND symbol = ?`)
            .get(userId, inst.symbol);
          if (existingPos) continue;

          const { candles, source, spreadPoints } = await getMarketCandles(
            userId,
            inst.symbol,
            settings.timeframe,
            240
          );
          const higherTf = settings.timeframe === 'H1' ? 'H4' : settings.timeframe === 'M15' ? 'H1' : 'D1';
          const higherData = await getMarketCandles(userId, inst.symbol, higherTf, 120);

          const snapshot = buildTechnicalSnapshot({
            symbol: inst.symbol,
            timeframe: settings.timeframe,
            candles,
            higherCandles: higherData.candles,
            dataSource: source,
            spreadPoints,
            instrument: inst,
          });

          const signal = evaluateStrategySignal({
            candles,
            snapshot,
            strategy,
            instrument: inst,
            minRrRatio: settings.min_rr_ratio,
          });

          if (signal.direction === 'WAIT') continue;

          const risk = validateOrderRisk({
            userId,
            symbol: inst.symbol,
            side: signal.direction,
            entryPrice: signal.entryPrice,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            snapshot,
          });

          if (settings.trading_mode === 'SEMI_AUTO') {
            // Avoid flooding duplicate pending signals for same symbol within 15 mins
            const recentSig = db
              .prepare(
                `SELECT id FROM pending_signals WHERE user_id = ? AND symbol = ? AND status = 'PENDING_APPROVAL'`
              )
              .get(userId, inst.symbol);
            if (!recentSig) {
              db.prepare(`
                INSERT INTO pending_signals (id, user_id, symbol, timeframe, strategy_id, strategy_name, direction, entry_price, sl, tp, rr_ratio, confidence, market_condition, reasoning, indicators_json, status, block_reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                crypto.randomUUID(),
                userId,
                inst.symbol,
                settings.timeframe,
                strategy.id,
                strategy.name,
                signal.direction,
                signal.entryPrice,
                signal.stopLoss,
                signal.takeProfit,
                signal.riskRewardRatio,
                signal.confidence,
                signal.marketCondition,
                signal.reasons.join(' '),
                JSON.stringify({ rsi14: snapshot.rsi14, ema20: snapshot.ema20, ema50: snapshot.ema50, atr14: snapshot.atr14 }),
                risk.approved ? 'PENDING_APPROVAL' : 'BLOCKED',
                risk.approved ? null : risk.reasons.join(' | '),
                new Date().toISOString()
              );
              broadcastCallback(userId, 'signal:new', { symbol: inst.symbol, direction: signal.direction });
            }
          } else if (settings.trading_mode === 'FULL_AUTO') {
            if (!risk.approved) {
              writeAuditLog({
                userId,
                actorEmail: 'autopilot@nexora.system',
                action: 'AUTOPILOT_ORDER_BLOCKED_BY_RISK',
                category: 'RISK',
                details: { symbol: inst.symbol, reasons: risk.reasons },
                status: 'BLOCKED',
              });
              continue;
            }

            const barTime = candles[candles.length - 1]?.time ?? Math.floor(Date.now() / 60000);
            const idempotencyKey = `auto_${userId}_${inst.symbol}_${strategy.id}_${barTime}`;
            const exec = await dispatchOrderToBridge({
              userId,
              idempotencyKey,
              symbol: inst.symbol,
              side: signal.direction,
              volume: risk.calculatedLot,
              price: signal.entryPrice,
              sl: signal.stopLoss,
              tp: signal.takeProfit,
              strategyId: strategy.id,
              entryReason: signal.reasons.join(' '),
            });

            writeAuditLog({
              userId,
              actorEmail: 'autopilot@nexora.system',
              action: exec.ok ? 'AUTOPILOT_ORDER_EXECUTED' : 'AUTOPILOT_ORDER_FAILED',
              category: 'EXECUTION',
              details: { symbol: inst.symbol, side: signal.direction, lot: risk.calculatedLot, message: exec.message },
              status: exec.ok ? 'SUCCESS' : 'FAILED',
            });
            broadcastCallback(userId, 'dashboard:update', { reason: 'AUTOPILOT_TRADE' });
          }
        }
      }
    } catch (err) {
      console.error('[AutoPilotLoop] Error:', err);
    }
  }, 5000);
}
