import crypto from 'node:crypto';
import { db, writeAuditLog } from './db.ts';
import { decryptSecret, encryptSecret, generateToken, hashToken } from './security.ts';

export interface Mt5AccountState {
  mode: 'disconnected' | 'remote_bridge' | 'ea_push' | 'paper_sandbox';
  status: 'NOT CONNECTED' | 'CONNECTED' | 'ERROR';
  bridgeUrl: string;
  accountLogin: string;
  serverName: string;
  brokerName: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  currency: string;
  leverage: number;
  lastHeartbeat: string | null;
  bridgeApiKeyMasked: string;
}

export function getMt5State(userId: string): Mt5AccountState {
  const row = db.prepare('SELECT * FROM mt5_configs WHERE user_id = ?').get(userId) as
    | Record<string, unknown>
    | undefined;

  if (!row) {
    return {
      mode: 'disconnected',
      status: 'NOT CONNECTED',
      bridgeUrl: '',
      accountLogin: '',
      serverName: '',
      brokerName: '',
      balance: 0,
      equity: 0,
      margin: 0,
      freeMargin: 0,
      currency: 'USD',
      leverage: 100,
      lastHeartbeat: null,
      bridgeApiKeyMasked: '',
    };
  }

  // Heartbeat staleness check for ea_push / remote_bridge (disconnect if > 60s stale)
  let status = String(row.status) as Mt5AccountState['status'];
  const mode = String(row.mode) as Mt5AccountState['mode'];
  const lastHb = row.last_heartbeat ? String(row.last_heartbeat) : null;

  if ((mode === 'ea_push' || mode === 'remote_bridge') && status === 'CONNECTED' && lastHb) {
    const ageMs = Date.now() - Date.parse(lastHb);
    if (ageMs > 120_000) {
      status = 'NOT CONNECTED';
      db.prepare(`UPDATE mt5_configs SET status = 'NOT CONNECTED' WHERE user_id = ?`).run(userId);
    }
  }

  return {
    mode,
    status,
    bridgeUrl: String(row.bridge_url ?? ''),
    accountLogin: String(row.account_login ?? ''),
    serverName: String(row.server_name ?? ''),
    brokerName: String(row.broker_name ?? ''),
    balance: Number(row.balance ?? 0),
    equity: Number(row.equity ?? 0),
    margin: Number(row.margin ?? 0),
    freeMargin: Number(row.free_margin ?? 0),
    currency: String(row.currency ?? 'USD'),
    leverage: Number(row.leverage ?? 100),
    lastHeartbeat: lastHb,
    bridgeApiKeyMasked: String(row.bridge_api_key_masked ?? ''),
  };
}

export async function connectRemoteMt5Bridge(params: {
  userId: string;
  actorEmail: string;
  bridgeUrl: string;
  bridgeToken: string;
  accountLogin: string;
  mt5Password: string;
  serverName: string;
  brokerName: string;
}): Promise<{ ok: boolean; message: string; state: Mt5AccountState }> {
  const { userId, actorEmail, bridgeUrl, bridgeToken, accountLogin, mt5Password, serverName, brokerName } =
    params;

  const cleanUrl = bridgeUrl.trim().replace(/\/$/, '');
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    return {
      ok: false,
      message: 'URL Bridge MT5 harus diawali http:// atau https:// (contoh: https://vps-anda.domain:8000).',
      state: getMt5State(userId),
    };
  }

  const encrypted = encryptSecret(
    JSON.stringify({ bridgeToken, accountLogin, mt5Password, serverName })
  );

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${cleanUrl}/account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bridgeToken}`,
      },
      body: JSON.stringify({
        login: Number(accountLogin) || accountLogin,
        password: mt5Password,
        server: serverName,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const errText = await resp.text();
      writeAuditLog({
        userId,
        actorEmail,
        action: 'MT5_REMOTE_CONNECT_FAILED',
        category: 'MT5',
        details: { bridgeUrl: cleanUrl, status: resp.status, error: errText },
        status: 'FAILED',
      });
      return {
        ok: false,
        message: `Bridge merespons HTTP ${resp.status}: ${errText || 'Gagal terhubung ke terminal MT5'}.`,
        state: getMt5State(userId),
      };
    }

    const acct = (await resp.json()) as {
      balance?: number;
      equity?: number;
      margin?: number;
      margin_free?: number;
      currency?: string;
      leverage?: number;
      company?: string;
    };

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE mt5_configs
      SET mode = 'remote_bridge',
          bridge_url = ?,
          encrypted_credentials = ?,
          account_login = ?,
          server_name = ?,
          broker_name = ?,
          status = 'CONNECTED',
          last_heartbeat = ?,
          balance = ?,
          equity = ?,
          margin = ?,
          free_margin = ?,
          currency = ?,
          leverage = ?,
          updated_at = ?
      WHERE user_id = ?
    `).run(
      cleanUrl,
      encrypted,
      accountLogin,
      serverName,
      acct.company || brokerName || 'MetaTrader 5 Broker',
      now,
      Number(acct.balance ?? 0),
      Number(acct.equity ?? 0),
      Number(acct.margin ?? 0),
      Number(acct.margin_free ?? 0),
      acct.currency || 'USD',
      Number(acct.leverage ?? 100),
      now,
      userId
    );

    db.prepare(`
      INSERT INTO equity_snapshots (user_id, source, balance, equity, timestamp)
      VALUES (?, 'mt5', ?, ?, ?)
    `).run(userId, Number(acct.balance ?? 0), Number(acct.equity ?? 0), now);

    writeAuditLog({
      userId,
      actorEmail,
      action: 'MT5_REMOTE_CONNECTED',
      category: 'MT5',
      details: { bridgeUrl: cleanUrl, accountLogin, serverName },
      status: 'SUCCESS',
    });

    return {
      ok: true,
      message: 'Berhasil terhubung ke MetaTrader 5 Bridge.',
      state: getMt5State(userId),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Network error';
    writeAuditLog({
      userId,
      actorEmail,
      action: 'MT5_REMOTE_CONNECT_ERROR',
      category: 'MT5',
      details: { bridgeUrl: cleanUrl, error: errMsg },
      status: 'FAILED',
    });
    return {
      ok: false,
      message: `Tidak dapat menjangkau MT5 Bridge di ${cleanUrl} (${errMsg}). Pastikan FastAPI mt5_bridge.py berjalan di VPS Windows dan dapat diakses via HTTPS.`,
      state: getMt5State(userId),
    };
  }
}

export function generateEaBridgeKey(userId: string, actorEmail: string): { apiKey: string; masked: string } {
  const rawKey = `nxr_mt5_${generateToken().slice(0, 40)}`;
  const keyHash = hashToken(rawKey);
  const masked = `${rawKey.slice(0, 12)}••••••••${rawKey.slice(-6)}`;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE mt5_configs
    SET bridge_api_key_hash = ?, bridge_api_key_masked = ?, updated_at = ?
    WHERE user_id = ?
  `).run(keyHash, masked, now, userId);

  writeAuditLog({
    userId,
    actorEmail,
    action: 'MT5_EA_KEY_GENERATED',
    category: 'MT5',
    details: { masked },
    status: 'SUCCESS',
  });

  return { apiKey: rawKey, masked };
}

export function enablePaperSandbox(params: {
  userId: string;
  actorEmail: string;
  initialBalance?: number;
}) {
  const { userId, actorEmail, initialBalance = 10000 } = params;
  const bal = Math.max(500, Math.min(1_000_000, Number(initialBalance) || 10000));
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE mt5_configs
    SET mode = 'paper_sandbox',
        status = 'CONNECTED',
        account_login = 'PAPER-SANDBOX',
        server_name = 'Nexora-Local-Sandbox',
        broker_name = 'PAPER SANDBOX (Simulasi Lokal)',
        balance = ?,
        equity = ?,
        margin = 0,
        free_margin = ?,
        currency = 'USD',
        leverage = 100,
        last_heartbeat = ?,
        updated_at = ?
    WHERE user_id = ?
  `).run(bal, bal, bal, now, now, userId);

  db.prepare(`
    INSERT INTO equity_snapshots (user_id, source, balance, equity, timestamp)
    VALUES (?, 'paper_sandbox', ?, ?, ?)
  `).run(userId, bal, bal, now);

  writeAuditLog({
    userId,
    actorEmail,
    action: 'PAPER_SANDBOX_ENABLED',
    category: 'MT5',
    details: { initialBalance: bal },
    status: 'SUCCESS',
  });

  return getMt5State(userId);
}

export function disconnectMt5(userId: string, actorEmail: string) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE mt5_configs
    SET mode = 'disconnected',
        status = 'NOT CONNECTED',
        balance = 0,
        equity = 0,
        margin = 0,
        free_margin = 0,
        updated_at = ?
    WHERE user_id = ?
  `).run(now, userId);

  db.prepare(`UPDATE autopilot_settings SET engine_running = 0, updated_at = ? WHERE user_id = ?`).run(
    now,
    userId
  );

  writeAuditLog({
    userId,
    actorEmail,
    action: 'MT5_DISCONNECTED',
    category: 'MT5',
    details: {},
    status: 'SUCCESS',
  });

  return getMt5State(userId);
}

export async function dispatchOrderToBridge(params: {
  userId: string;
  idempotencyKey: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  volume: number;
  price: number;
  sl: number;
  tp: number;
  strategyId: string;
  entryReason: string;
}): Promise<{ ok: boolean; ticketId?: string; message: string }> {
  const { userId, idempotencyKey, symbol, side, volume, price, sl, tp, strategyId, entryReason } =
    params;

  // Idempotency protection: never duplicate orders on reconnect/retry
  const existingOrder = db
    .prepare('SELECT id, status FROM orders_queue WHERE idempotency_key = ?')
    .get(idempotencyKey) as { id: string; status: string } | undefined;

  if (existingOrder) {
    return {
      ok: false,
      message: `DUPLICATE_REQUEST_BLOCKED: Order dengan idempotency key ${idempotencyKey} sudah diproses (${existingOrder.status}).`,
    };
  }

  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO orders_queue (id, idempotency_key, user_id, symbol, side, volume, price, sl, tp, strategy_id, entry_reason, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)
  `).run(orderId, idempotencyKey, userId, symbol, side, volume, price, sl, tp, strategyId, entryReason, now, now);

  const cfg = db.prepare('SELECT * FROM mt5_configs WHERE user_id = ?').get(userId) as
    | Record<string, unknown>
    | undefined;

  const mode = String(cfg?.mode ?? 'disconnected');

  if (mode === 'paper_sandbox') {
    const ticketId = `SBX-${Math.floor(100000 + Math.random() * 899999)}`;
    db.prepare(`
      INSERT INTO positions (ticket_id, user_id, source, symbol, side, volume, open_price, current_price, sl, tp, profit, swap, commission, strategy_id, entry_reason, managed_by_nexora, opened_at)
      VALUES (?, ?, 'paper_sandbox', ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 1, ?)
    `).run(ticketId, userId, symbol, side, volume, price, price, sl, tp, -(volume * 3.5), strategyId, entryReason, now);

    db.prepare(`UPDATE orders_queue SET status = 'FILLED', updated_at = ? WHERE id = ?`).run(now, orderId);
    return { ok: true, ticketId, message: `Order dieksekusi di Paper Sandbox (#${ticketId}).` };
  }

  if (mode === 'ea_push') {
    db.prepare(`UPDATE orders_queue SET status = 'DISPATCHED', updated_at = ? WHERE id = ?`).run(now, orderId);
    return {
      ok: true,
      ticketId: orderId,
      message: `Order masuk antrean MQL5 EA (${orderId}) untuk dieksekusi terminal MT5.`,
    };
  }

  if (mode === 'remote_bridge' && cfg?.bridge_url) {
    try {
      const creds = cfg.encrypted_credentials
        ? JSON.parse(decryptSecret(String(cfg.encrypted_credentials)))
        : {};
      const resp = await fetch(`${String(cfg.bridge_url).replace(/\/$/, '')}/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.bridgeToken ?? ''}`,
        },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          symbol,
          side,
          volume,
          sl,
          tp,
          comment: `NEXORA_${strategyId}`,
        }),
      });
      if (!resp.ok) {
        const errTxt = await resp.text();
        db.prepare(`UPDATE orders_queue SET status = 'REJECTED', error_message = ?, updated_at = ? WHERE id = ?`).run(
          errTxt,
          now,
          orderId
        );
        return { ok: false, message: `MT5 Bridge menolak order: ${errTxt}` };
      }
      const resJson = (await resp.json()) as { ticket?: string | number; price?: number };
      const ticketId = String(resJson.ticket ?? orderId);
      const fillPrice = Number(resJson.price ?? price);
      db.prepare(`
        INSERT INTO positions (ticket_id, user_id, source, symbol, side, volume, open_price, current_price, sl, tp, profit, strategy_id, entry_reason, managed_by_nexora, opened_at)
        VALUES (?, ?, 'mt5', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?)
      `).run(ticketId, userId, symbol, side, volume, fillPrice, fillPrice, sl, tp, strategyId, entryReason, now);
      db.prepare(`UPDATE orders_queue SET status = 'FILLED', updated_at = ? WHERE id = ?`).run(now, orderId);
      return { ok: true, ticketId, message: `Order dieksekusi di MT5 (#${ticketId}).` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bridge error';
      db.prepare(`UPDATE orders_queue SET status = 'REJECTED', error_message = ?, updated_at = ? WHERE id = ?`).run(
        msg,
        now,
        orderId
      );
      return { ok: false, message: `Gagal mengirim order ke MT5 Bridge: ${msg}` };
    }
  }

  db.prepare(`UPDATE orders_queue SET status = 'REJECTED', error_message = 'NOT CONNECTED', updated_at = ? WHERE id = ?`).run(
    now,
    orderId
  );
  return { ok: false, message: 'MT5 Bridge berstatus NOT CONNECTED.' };
}

export const PYTHON_MT5_BRIDGE_TEMPLATE = `"""
NEXORA AI — Python FastAPI MetaTrader 5 Bridge (Windows VPS)
Jalankan di VPS Windows yang sudah terinstal terminal MetaTrader 5.
Install: pip install fastapi uvicorn MetaTrader5 pydantic
Run: uvicorn mt5_bridge:app --host 0.0.0.0 --port 8000
"""
import os
import MetaTrader5 as mt5
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI(title="NEXORA MT5 Bridge")
BRIDGE_TOKEN = os.environ.get("MT5_BRIDGE_TOKEN", "CHANGE_THIS_STRONG_TOKEN")
PROCESSED_KEYS = set()

def check_auth(authorization: str = Header(default="")):
    if not authorization.startswith("Bearer ") or authorization[7:] != BRIDGE_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid bridge token")

class AccountConnectReq(BaseModel):
    login: int
    password: str
    server: str

class OrderReq(BaseModel):
    idempotency_key: str
    symbol: str
    side: str
    volume: float
    sl: float
    tp: float
    comment: str = "NEXORA_AI"

@app.post("/account")
def connect_account(req: AccountConnectReq, authorization: str = Header(default="")):
    check_auth(authorization)
    if not mt5.initialize():
        raise HTTPException(status_code=500, detail=f"MT5 init failed: {mt5.last_error()}")
    if not mt5.login(req.login, password=req.password, server=req.server):
        raise HTTPException(status_code=401, detail=f"MT5 login failed: {mt5.last_error()}")
    info = mt5.account_info()
    return {
        "balance": info.balance,
        "equity": info.equity,
        "margin": info.margin,
        "margin_free": info.margin_free,
        "currency": info.currency,
        "leverage": info.leverage,
        "company": info.company,
    }

@app.get("/candles")
def get_candles(symbol: str, timeframe: str = "H1", count: int = 250, authorization: str = Header(default="")):
    check_auth(authorization)
    tf_map = {
        "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5, "M15": mt5.TIMEFRAME_M15,
        "M30": mt5.TIMEFRAME_M30, "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1,
    }
    rates = mt5.copy_rates_from_pos(symbol, tf_map.get(timeframe, mt5.TIMEFRAME_H1), 0, count)
    if rates is None:
        raise HTTPException(status_code=404, detail="No rates returned")
    tick = mt5.symbol_info_tick(symbol)
    sym_info = mt5.symbol_info(symbol)
    candles = [
        {"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]),
         "low": float(r["low"]), "close": float(r["close"]), "volume": int(r["tick_volume"])}
        for r in rates
    ]
    return {"candles": candles, "spread_points": sym_info.spread if sym_info else 15, "bid": tick.bid if tick else 0}

@app.post("/order")
def send_order(req: OrderReq, authorization: str = Header(default="")):
    check_auth(authorization)
    if req.idempotency_key in PROCESSED_KEYS:
        raise HTTPException(status_code=409, detail="Duplicate idempotency_key")
    if req.sl <= 0:
        raise HTTPException(status_code=400, detail="Stop Loss is mandatory")
    tick = mt5.symbol_info_tick(req.symbol)
    order_type = mt5.ORDER_TYPE_BUY if req.side == "BUY" else mt5.ORDER_TYPE_SELL
    price = tick.ask if req.side == "BUY" else tick.bid
    result = mt5.order_send({
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": req.symbol,
        "volume": req.volume,
        "type": order_type,
        "price": price,
        "sl": req.sl,
        "tp": req.tp,
        "deviation": 15,
        "magic": 202601,
        "comment": req.comment[:31],
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    })
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        raise HTTPException(status_code=400, detail=f"Order rejected retcode={result.retcode}")
    PROCESSED_KEYS.add(req.idempotency_key)
    return {"ticket": result.order, "price": result.price}
`;

export const MQL5_EA_TEMPLATE = `//+------------------------------------------------------------------+
//|                                                 NexoraBridge.mq5 |
//|   Expert Advisor Penghubung Terminal MT5 ke NEXORA AI Backend    |
//|   Tambahkan URL server NEXORA ke Tools -> Options -> Expert Advisors -> Allow WebRequest
//+------------------------------------------------------------------+
#property copyright "NEXORA AI"
#property strict
#include <Trade\\Trade.mqh>
CTrade trade;

input string InpServerUrl = "https://YOUR_NEXORA_HOST";
input string InpBridgeApiKey = "PASTE_BRIDGE_API_KEY_HERE";
input int    InpMagicNumber = 202601;

int OnInit() {
   trade.SetExpertMagicNumber(InpMagicNumber);
   EventSetTimer(5);
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason) { EventKillTimer(); }

void OnTimer() {
   string headers = "Content-Type: application/json\\r\\nAuthorization: Bearer " + InpBridgeApiKey + "\\r\\n";
   string body = StringFormat(
      "{\\"login\\":\\"%I64d\\",\\"server\\":\\"%s\\",\\"broker\\":\\"%s\\",\\"balance\\":%.2f,\\"equity\\":%.2f,\\"margin\\":%.2f,\\"free_margin\\":%.2f}",
      AccountInfoInteger(ACCOUNT_LOGIN), AccountInfoString(ACCOUNT_SERVER), AccountInfoString(ACCOUNT_COMPANY),
      AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN), AccountInfoDouble(ACCOUNT_MARGIN_FREE)
   );
   char post[], result[];
   string resHeaders;
   StringToCharArray(body, post, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(post, ArraySize(post) - 1);
   WebRequest("POST", InpServerUrl + "/api/mt5/bridge/heartbeat", headers, 3000, post, result, resHeaders);
}
`;
