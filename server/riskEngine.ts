import { db, getAutoPilotSettings, getInstruments } from './db.ts';
import type { RiskCheckResult, TechnicalSnapshot } from './types.ts';

function isWithinTradingHours(nowUtc: Date, startHm: string, endHm: string): boolean {
  const [sh, sm] = startHm.split(':').map(Number);
  const [eh, em] = endHm.split(':').map(Number);
  const curMin = nowUtc.getUTCHours() * 60 + nowUtc.getUTCMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin <= endMin) {
    return curMin >= startMin && curMin <= endMin;
  }
  return curMin >= startMin || curMin <= endMin;
}

export function checkActiveHighImpactNews(
  symbol: string,
  bufferMinutes: number
): { blocked: boolean; eventTitle?: string; scheduledAt?: string } {
  const baseCcy = symbol.slice(0, 3).toUpperCase();
  const quoteCcy = symbol.slice(3, 6).toUpperCase();
  const currencies = baseCcy === 'XAU' ? ['USD', 'XAU'] : [baseCcy, quoteCcy];

  const nowMs = Date.now();
  const windowMs = bufferMinutes * 60 * 1000;

  const events = db
    .prepare(`SELECT * FROM economic_events WHERE impact = 'HIGH'`)
    .all() as Array<{
      id: string;
      title: string;
      currency: string;
      scheduled_at: string;
    }>;

  for (const ev of events) {
    if (!currencies.includes(ev.currency.toUpperCase())) continue;
    const evMs = Date.parse(ev.scheduled_at);
    if (Math.abs(evMs - nowMs) <= windowMs) {
      return {
        blocked: true,
        eventTitle: `${ev.currency} ${ev.title}`,
        scheduledAt: ev.scheduled_at,
      };
    }
  }
  return { blocked: false };
}

export function validateOrderRisk(params: {
  userId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  requestedLot?: number;
  snapshot?: TechnicalSnapshot;
  bypassTradingHours?: boolean;
}): RiskCheckResult {
  const {
    userId,
    symbol,
    side,
    entryPrice,
    stopLoss,
    takeProfit,
    requestedLot,
    snapshot,
    bypassTradingHours = false,
  } = params;

  const reasons: string[] = [];
  const settings = getAutoPilotSettings(userId);
  const instrument = getInstruments().find((i) => i.symbol === symbol);

  if (!instrument) {
    return {
      approved: false,
      reasons: [`Instrumen ${symbol} tidak ditemukan dalam konfigurasi sistem.`],
      calculatedLot: 0,
      riskAmountUsd: 0,
      slPips: 0,
      rrRatio: 0,
    };
  }

  if (!instrument.enabled) {
    reasons.push(`Instrumen ${symbol} sedang dinonaktifkan oleh pengguna.`);
  }

  // 1. Broker / MT5 Connection Check
  const mt5 = db.prepare('SELECT * FROM mt5_configs WHERE user_id = ?').get(userId) as
    | { mode: string; status: string; balance: number; equity: number }
    | undefined;

  if (!mt5 || mt5.status !== 'CONNECTED' || mt5.mode === 'disconnected') {
    reasons.push(
      'BROKER_DISCONNECTED: MetaTrader 5 Bridge berstatus NOT CONNECTED. Hubungkan MT5 Bridge atau aktifkan Paper Sandbox untuk menguji eksekusi.'
    );
  }

  const balance = Number(mt5?.balance ?? 0);
  const equity = Number(mt5?.equity ?? 0);

  if (equity <= 0 || balance <= 0) {
    reasons.push('Saldo / Equity akun tidak mencukupi atau belum tersinkronisasi dari broker.');
  }

  // 2. Daily Trading Lock & Max Daily Loss Enforcement
  if (settings.daily_locked) {
    reasons.push(
      `DAILY_TRADING_LOCK: Pembukaan posisi baru terkunci (${settings.daily_lock_reason || 'Batas harian tercapai'}).`
    );
  }

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const closedTodayRow = db
    .prepare(
      `SELECT COALESCE(SUM(profit_loss), 0) as realized FROM trade_history WHERE user_id = ? AND closed_at LIKE ?`
    )
    .get(userId, `${todayPrefix}%`) as { realized: number };

  const openRows = db
    .prepare(`SELECT * FROM positions WHERE user_id = ? AND managed_by_nexora = 1`)
    .all(userId) as Array<{ profit: number; symbol: string }>;

  const floatingPnl = openRows.reduce((s, r) => s + Number(r.profit), 0);
  const totalDailyPnl = Number(closedTodayRow.realized) + floatingPnl;

  if (balance > 0 && totalDailyPnl <= -(balance * (settings.max_daily_loss_pct / 100))) {
    const reason = `Batas kerugian harian (${settings.max_daily_loss_pct}%) tercapai. PnL hari ini: $${totalDailyPnl.toFixed(2)}.`;
    db.prepare(
      `UPDATE autopilot_settings SET daily_locked = 1, daily_lock_reason = ?, engine_running = 0, updated_at = ? WHERE user_id = ?`
    ).run(reason, new Date().toISOString(), userId);
    reasons.push(`DAILY_LOSS_LIMIT: ${reason}`);
  }

  if (balance > 0 && totalDailyPnl >= balance * (settings.daily_profit_target_pct / 100)) {
    reasons.push(
      `DAILY_PROFIT_TARGET: Target profit harian (${settings.daily_profit_target_pct}%) telah tercapai.`
    );
  }

  // 3. Max Drawdown Protection
  const peakRow = db
    .prepare(`SELECT COALESCE(MAX(balance), 0) as peak FROM equity_snapshots WHERE user_id = ?`)
    .get(userId) as { peak: number };
  const peakEquity = Math.max(balance, Number(peakRow.peak));
  if (peakEquity > 0) {
    const drawdownPct = ((peakEquity - equity) / peakEquity) * 100;
    if (drawdownPct >= settings.max_drawdown_pct) {
      reasons.push(
        `MAX_DRAWDOWN_REACHED: Drawdown saat ini ${drawdownPct.toFixed(2)}% melebihi batas ${settings.max_drawdown_pct}%.`
      );
    }
  }

  // 4. Max Open Positions & Overtrading Protection (Max Trades/Day)
  if (openRows.length >= settings.max_open_positions) {
    reasons.push(
      `MAX_OPEN_POSITIONS: Jumlah posisi aktif (${openRows.length}) mencapai batas maksimum (${settings.max_open_positions}).`
    );
  }

  const tradesTodayRow = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM orders_queue WHERE user_id = ? AND created_at LIKE ? AND status IN ('QUEUED', 'DISPATCHED', 'FILLED')`
    )
    .get(userId, `${todayPrefix}%`) as { cnt: number };

  if (Number(tradesTodayRow.cnt) >= settings.max_trades_per_day) {
    reasons.push(
      `OVERTRADING_PROTECTION: Transaksi hari ini (${tradesTodayRow.cnt}) mencapai batas harian (${settings.max_trades_per_day}).`
    );
  }

  // 5. Trading Hours Filter
  if (!bypassTradingHours && !isWithinTradingHours(new Date(), settings.trading_hours_start, settings.trading_hours_end)) {
    reasons.push(
      `OUTSIDE_TRADING_HOURS: Di luar jam trading terjadwal (${settings.trading_hours_start}–${settings.trading_hours_end} UTC).`
    );
  }

  // 6. High Impact News Filter
  if (settings.news_filter_enabled) {
    const newsCheck = checkActiveHighImpactNews(symbol, settings.news_buffer_minutes);
    if (newsCheck.blocked) {
      reasons.push(
        `NEWS_FILTER_ACTIVE: Terdeteksi berita High Impact (${newsCheck.eventTitle}) dalam jendela ±${settings.news_buffer_minutes} menit.`
      );
    }
  }

  // 7. Spread & Extreme Volatility Protection
  if (snapshot) {
    if (settings.spread_protection_enabled && snapshot.spreadPoints > instrument.max_spread_points) {
      reasons.push(
        `SPREAD_TOO_HIGH: Spread ${snapshot.spreadPoints} pts melebihi batas instrumen (${instrument.max_spread_points} pts).`
      );
    }
    if (settings.volatility_protection_enabled && snapshot.volatilityRegime === 'EXTREME') {
      reasons.push('EXTREME_VOLATILITY: Volatilitas ATR ekstrem terdeteksi. Eksekusi diblokir.');
    }
  }

  // 8. Mandatory Stop Loss & Directional Integrity
  if (!stopLoss || stopLoss <= 0) {
    reasons.push('STOP_LOSS_MANDATORY: Setiap order wajib menyertakan Stop Loss yang valid.');
  } else {
    if (side === 'BUY' && stopLoss >= entryPrice) {
      reasons.push('INVALID_SL: Untuk posisi BUY, Stop Loss harus berada di bawah harga Entry.');
    }
    if (side === 'SELL' && stopLoss <= entryPrice) {
      reasons.push('INVALID_SL: Untuk posisi SELL, Stop Loss harus berada di atas harga Entry.');
    }
  }

  // 9. Minimum Risk/Reward Ratio Check (Default >= 1:2)
  const slDist = Math.abs(entryPrice - stopLoss);
  const tpDist = takeProfit > 0 ? Math.abs(takeProfit - entryPrice) : 0;
  const rrRatio = slDist > 0 ? Number((tpDist / slDist).toFixed(2)) : 0;

  if (!takeProfit || takeProfit <= 0) {
    reasons.push('TAKE_PROFIT_REQUIRED: Target Take Profit wajib diisi untuk validasi Risk/Reward.');
  } else {
    if (side === 'BUY' && takeProfit <= entryPrice) {
      reasons.push('INVALID_TP: Untuk posisi BUY, Take Profit harus berada di atas Entry.');
    }
    if (side === 'SELL' && takeProfit >= entryPrice) {
      reasons.push('INVALID_TP: Untuk posisi SELL, Take Profit harus berada di bawah Entry.');
    }
    if (rrRatio < settings.min_rr_ratio) {
      reasons.push(
        `RR_BELOW_MINIMUM: Risk/Reward 1:${rrRatio} berada di bawah batas minimum 1:${settings.min_rr_ratio}.`
      );
    }
  }

  // 10. Risk Percentage Clamping (0.25% - 2.0%) & Automatic Lot Calculation (NO Martingale)
  const clampedRiskPct = Math.min(2.0, Math.max(0.25, settings.risk_per_trade_pct));
  const riskAmountUsd = Number(((equity * clampedRiskPct) / 100).toFixed(2));
  const slPips = Number((slDist / instrument.pip_size).toFixed(1));

  // Approximate USD pip value per 1.00 lot
  const pipValuePerLot = symbol.endsWith('JPY')
    ? (instrument.pip_size * instrument.contract_size) / Math.max(1, entryPrice)
    : symbol === 'XAUUSD'
      ? instrument.pip_size * instrument.contract_size
      : instrument.pip_size * instrument.contract_size;

  let autoLot =
    slPips > 0 && pipValuePerLot > 0 ? riskAmountUsd / (slPips * pipValuePerLot) : instrument.min_lot;
  autoLot = Math.floor(autoLot * 100) / 100;

  const maxAllowedLot = Math.min(instrument.max_lot, settings.max_lot);
  let finalLot = requestedLot && requestedLot > 0 ? Math.min(requestedLot, autoLot) : autoLot;
  finalLot = Math.max(instrument.min_lot, Math.min(maxAllowedLot, Number(finalLot.toFixed(2))));

  return {
    approved: reasons.length === 0,
    reasons,
    calculatedLot: finalLot,
    riskAmountUsd,
    slPips,
    rrRatio,
  };
}
