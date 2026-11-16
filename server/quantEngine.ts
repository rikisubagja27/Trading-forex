import type {
  Candle,
  DeterministicSignal,
  Instrument,
  MarketCondition,
  Strategy,
  TechnicalSnapshot,
  Timeframe,
} from './types.ts';

export function calcEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function calcSMA(values: number[], period: number): number[] {
  const res: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = values.slice(start, i + 1);
    res.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return res;
}

export function calcRSI(closes: number[], period = 14): number[] {
  if (closes.length < 2) return closes.map(() => 50);
  const rsi: number[] = [50];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i < period) {
        rsi.push(50);
        continue;
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - 100 / (1 + rs));
    }
  }
  return rsi;
}

export function calcMACD(closes: number[]) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const signalLine = calcEMA(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

export function calcBollinger(closes: number[], period = 20, mult = 2) {
  const middle = calcSMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const bandwidthPct: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = closes.slice(start, i + 1);
    const mean = middle[i];
    const variance =
      slice.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / slice.length;
    const std = Math.sqrt(variance);
    const up = mean + mult * std;
    const lo = mean - mult * std;
    upper.push(up);
    lower.push(lo);
    bandwidthPct.push(mean > 0 ? ((up - lo) / mean) * 100 : 0);
  }
  return { upper, middle, lower, bandwidthPct };
}

export function calcATR(candles: Candle[], period = 14): number[] {
  if (candles.length === 0) return [];
  const trs: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    trs.push(tr);
  }

  const atr: number[] = [];
  let sum = 0;
  for (let i = 0; i < trs.length; i++) {
    if (i < period) {
      sum += trs[i];
      atr.push(sum / (i + 1));
    } else {
      atr.push((atr[i - 1] * (period - 1) + trs[i]) / period);
    }
  }
  return atr;
}

export function detectCandlestickPatterns(candles: Candle[]): string[] {
  if (candles.length < 3) return [];
  const c = candles[candles.length - 1];
  const p = candles[candles.length - 2];
  const patterns: string[] = [];

  const body = Math.abs(c.close - c.open);
  const range = Math.max(1e-9, c.high - c.low);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  const pBody = Math.abs(p.close - p.open);
  const isBull = c.close > c.open;
  const isBear = c.close < c.open;
  const pIsBull = p.close > p.open;
  const pIsBear = p.close < p.open;

  if (body / range < 0.12) {
    patterns.push('Doji Indecision');
  }
  if (isBull && pIsBear && c.close > p.open && c.open <= p.close && body > pBody * 1.05) {
    patterns.push('Bullish Engulfing');
  }
  if (isBear && pIsBull && c.close < p.open && c.open >= p.close && body > pBody * 1.05) {
    patterns.push('Bearish Engulfing');
  }
  if (lowerWick > body * 2.1 && upperWick < body * 0.8) {
    patterns.push('Bullish Pin Bar / Hammer');
  }
  if (upperWick > body * 2.1 && lowerWick < body * 0.8) {
    patterns.push('Bearish Pin Bar / Shooting Star');
  }
  if (c.high <= p.high && c.low >= p.low) {
    patterns.push('Inside Bar Consolidation');
  }

  return patterns;
}

export function findSupportResistance(candles: Candle[], atr: number) {
  const slice = candles.slice(-120);
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = 2; i < slice.length - 2; i++) {
    const cur = slice[i];
    if (
      cur.high >= slice[i - 1].high &&
      cur.high >= slice[i - 2].high &&
      cur.high >= slice[i + 1].high &&
      cur.high >= slice[i + 2].high
    ) {
      swingHighs.push(cur.high);
    }
    if (
      cur.low <= slice[i - 1].low &&
      cur.low <= slice[i - 2].low &&
      cur.low <= slice[i + 1].low &&
      cur.low <= slice[i + 2].low
    ) {
      swingLows.push(cur.low);
    }
  }

  const cluster = (levels: number[]) => {
    const clustered: number[] = [];
    const sorted = [...levels].sort((a, b) => a - b);
    for (const lvl of sorted) {
      const existing = clustered.find((c) => Math.abs(c - lvl) < atr * 0.7);
      if (!existing) clustered.push(lvl);
    }
    return clustered;
  };

  const last = candles[candles.length - 1].close;
  const resistanceLevels = cluster(swingHighs)
    .filter((l) => l >= last - atr * 0.3)
    .slice(0, 3);
  const supportLevels = cluster(swingLows)
    .filter((l) => l <= last + atr * 0.3)
    .slice(-3);

  return { supportLevels, resistanceLevels };
}

export function findSupplyDemandZones(candles: Candle[], atr: number) {
  const slice = candles.slice(-80);
  const demandZones: Array<{ low: number; high: number }> = [];
  const supplyZones: Array<{ low: number; high: number }> = [];

  for (let i = 1; i < slice.length - 2; i++) {
    const base = slice[i];
    const impulse = slice[i + 1];
    const impulseBody = Math.abs(impulse.close - impulse.open);
    if (impulseBody > atr * 1.45) {
      if (impulse.close > impulse.open) {
        demandZones.push({ low: base.low, high: Math.max(base.open, base.close) });
      } else {
        supplyZones.push({ low: Math.min(base.open, base.close), high: base.high });
      }
    }
  }

  return {
    demandZones: demandZones.slice(-2),
    supplyZones: supplyZones.slice(-2),
  };
}

function getHigherTimeframe(tf: Timeframe): Timeframe {
  const map: Record<Timeframe, Timeframe> = {
    M1: 'M15',
    M5: 'M30',
    M15: 'H1',
    M30: 'H4',
    H1: 'H4',
    H4: 'D1',
    D1: 'D1',
  };
  return map[tf];
}

export function buildTechnicalSnapshot(params: {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  higherCandles?: Candle[];
  dataSource: 'MT5_LIVE_FEED' | 'PUBLIC_SPOT_BENCHMARK';
  spreadPoints: number;
  instrument: Instrument;
}): TechnicalSnapshot {
  const { symbol, timeframe, candles, higherCandles, dataSource, spreadPoints, instrument } = params;
  const closes = candles.map((c) => c.close);
  const ema20Arr = calcEMA(closes, 20);
  const ema50Arr = calcEMA(closes, 50);
  const ema200Arr = calcEMA(closes, 200);
  const rsiArr = calcRSI(closes, 14);
  const macd = calcMACD(closes);
  const bb = calcBollinger(closes, 20, 2);
  const atrArr = calcATR(candles, 14);

  const idx = candles.length - 1;
  const lastPrice = closes[idx];
  const ema20 = ema20Arr[idx];
  const ema50 = ema50Arr[idx];
  const ema200 = ema200Arr[idx];
  const rsi14 = rsiArr[idx];
  const atr14 = atrArr[idx];
  const atrSlice = atrArr.slice(-50);
  const atrAvg50 = atrSlice.reduce((a, b) => a + b, 0) / Math.max(1, atrSlice.length);

  const atrRatio = atrAvg50 > 0 ? atr14 / atrAvg50 : 1;
  let volatilityRegime: TechnicalSnapshot['volatilityRegime'] = 'NORMAL';
  if (atrRatio < 0.7) volatilityRegime = 'LOW';
  else if (atrRatio > 2.6) volatilityRegime = 'EXTREME';
  else if (atrRatio > 1.45) volatilityRegime = 'HIGH';

  let marketCondition: MarketCondition = 'SIDEWAYS';
  if (ema20 > ema50 && lastPrice > ema200 && ema50 >= ema200 * 0.998) {
    marketCondition = 'BULLISH';
  } else if (ema20 < ema50 && lastPrice < ema200 && ema50 <= ema200 * 1.002) {
    marketCondition = 'BEARISH';
  }

  const { supportLevels, resistanceLevels } = findSupportResistance(candles, atr14);
  const { demandZones, supplyZones } = findSupplyDemandZones(candles, atr14);
  const candlestickPatterns = detectCandlestickPatterns(candles);

  // Breakout & Retest check
  const recent20 = candles.slice(-21, -1);
  const high20 = Math.max(...recent20.map((c) => c.high));
  const low20 = Math.min(...recent20.map((c) => c.low));
  let breakoutStatus = 'Consolidation Inside Range';
  if (lastPrice > high20) {
    breakoutStatus = 'Bullish Resistance Breakout';
  } else if (lastPrice < low20) {
    breakoutStatus = 'Bearish Support Breakdown';
  } else if (
    candles[idx - 1]?.close > high20 &&
    candles[idx].low <= high20 + atr14 * 0.25 &&
    candles[idx].close >= high20
  ) {
    breakoutStatus = 'Bullish Breakout Retest Confirmed';
  } else if (
    candles[idx - 1]?.close < low20 &&
    candles[idx].high >= low20 - atr14 * 0.25 &&
    candles[idx].close <= low20
  ) {
    breakoutStatus = 'Bearish Breakdown Retest Confirmed';
  }

  // Higher Timeframe Trend Bias
  const htf = getHigherTimeframe(timeframe);
  let higherTrend: MarketCondition = marketCondition;
  if (higherCandles && higherCandles.length >= 60) {
    const hCloses = higherCandles.map((c) => c.close);
    const hEma20 = calcEMA(hCloses, 20).pop()!;
    const hEma50 = calcEMA(hCloses, 50).pop()!;
    const hLast = hCloses[hCloses.length - 1];
    if (hEma20 > hEma50 && hLast > hEma50) higherTrend = 'BULLISH';
    else if (hEma20 < hEma50 && hLast < hEma50) higherTrend = 'BEARISH';
    else higherTrend = 'SIDEWAYS';
  }

  const pointSize = Math.pow(10, -instrument.digits);
  const halfSpread = (spreadPoints * pointSize) / 2;

  return {
    symbol,
    timeframe,
    dataSource,
    lastPrice,
    bid: Number((lastPrice - halfSpread).toFixed(instrument.digits)),
    ask: Number((lastPrice + halfSpread).toFixed(instrument.digits)),
    spreadPoints,
    ema20: Number(ema20.toFixed(instrument.digits)),
    ema50: Number(ema50.toFixed(instrument.digits)),
    ema200: Number(ema200.toFixed(instrument.digits)),
    rsi14: Number(rsi14.toFixed(2)),
    macd: {
      line: Number(macd.macdLine[idx].toFixed(instrument.digits + 2)),
      signal: Number(macd.signalLine[idx].toFixed(instrument.digits + 2)),
      histogram: Number(macd.histogram[idx].toFixed(instrument.digits + 2)),
    },
    bollinger: {
      upper: Number(bb.upper[idx].toFixed(instrument.digits)),
      middle: Number(bb.middle[idx].toFixed(instrument.digits)),
      lower: Number(bb.lower[idx].toFixed(instrument.digits)),
      bandwidthPct: Number(bb.bandwidthPct[idx].toFixed(3)),
    },
    atr14: Number(atr14.toFixed(instrument.digits)),
    atrAvg50: Number(atrAvg50.toFixed(instrument.digits)),
    volatilityRegime,
    marketCondition,
    supportLevels: supportLevels.map((v) => Number(v.toFixed(instrument.digits))),
    resistanceLevels: resistanceLevels.map((v) => Number(v.toFixed(instrument.digits))),
    demandZones: demandZones.map((z) => ({
      low: Number(z.low.toFixed(instrument.digits)),
      high: Number(z.high.toFixed(instrument.digits)),
    })),
    supplyZones: supplyZones.map((z) => ({
      low: Number(z.low.toFixed(instrument.digits)),
      high: Number(z.high.toFixed(instrument.digits)),
    })),
    candlestickPatterns,
    breakoutStatus,
    multiTimeframeAlignment: {
      primary: marketCondition,
      higherTimeframe: htf,
      higherTrend,
      aligned: marketCondition !== 'SIDEWAYS' && marketCondition === higherTrend,
    },
  };
}

export function evaluateStrategySignal(params: {
  candles: Candle[];
  snapshot: TechnicalSnapshot;
  strategy: Strategy;
  instrument: Instrument;
  minRrRatio: number;
}): DeterministicSignal {
  const { candles, snapshot, strategy, instrument, minRrRatio } = params;
  const idx = candles.length - 1;
  const last = candles[idx];
  const prev = candles[idx - 1];
  const { ema20, ema50, ema200, rsi14, macd, bollinger, atr14 } = snapshot;

  let direction: 'BUY' | 'SELL' | 'WAIT' = 'WAIT';
  let confidence = 45;
  const reasons: string[] = [];

  switch (strategy.slug) {
    case 'trend-following': {
      if (ema20 > ema50 && ema50 > ema200 && macd.histogram > 0 && rsi14 >= 46 && rsi14 <= 68) {
        direction = 'BUY';
        confidence = 76;
        reasons.push('Susunan tren bullish valid: EMA 20 > EMA 50 > EMA 200.');
        reasons.push(`Momentum MACD histogram positif (${macd.histogram}) dengan RSI ${rsi14} masih di zona sehat.`);
      } else if (ema20 < ema50 && ema50 < ema200 && macd.histogram < 0 && rsi14 >= 32 && rsi14 <= 54) {
        direction = 'SELL';
        confidence = 76;
        reasons.push('Susunan tren bearish valid: EMA 20 < EMA 50 < EMA 200.');
        reasons.push(`Momentum MACD histogram negatif (${macd.histogram}) dengan RSI ${rsi14} mendukung kelanjutan turun.`);
      } else {
        reasons.push('Struktur EMA 20/50/200 atau momentum MACD belum sinkron untuk Trend Following.');
      }
      break;
    }

    case 'breakout-trading': {
      const lookback = candles.slice(-21, -1);
      const resLevel = Math.max(...lookback.map((c) => c.high));
      const supLevel = Math.min(...lookback.map((c) => c.low));
      const bodyRatio = Math.abs(last.close - last.open) / Math.max(1e-9, last.high - last.low);

      if (last.close > resLevel && bodyRatio >= 0.45 && atr14 >= snapshot.atrAvg50 * 0.92) {
        direction = 'BUY';
        confidence = 74;
        reasons.push(`Breakout tegas di atas resistance 20-bar (${resLevel.toFixed(instrument.digits)}).`);
        reasons.push('Rasio body candle kuat dan ATR mendukung ekspansi.');
      } else if (last.close < supLevel && bodyRatio >= 0.45 && atr14 >= snapshot.atrAvg50 * 0.92) {
        direction = 'SELL';
        confidence = 74;
        reasons.push(`Breakdown tegas di bawah support 20-bar (${supLevel.toFixed(instrument.digits)}).`);
        reasons.push('Ekspansi bearish terkonfirmasi tanpa wick penolakan dominan.');
      } else {
        reasons.push('Belum ada penembusan struktur 20-bar dengan rasio body candle yang valid.');
      }
      break;
    }

    case 'pullback-trading': {
      const distEma20 = Math.abs(last.low - ema20);
      const distEma20High = Math.abs(last.high - ema20);
      if (ema50 > ema200 && distEma20 <= atr14 * 0.65 && last.close > ema20 && last.close > last.open) {
        direction = 'BUY';
        confidence = 75;
        reasons.push('Tren mayor bullish (EMA 50 > EMA 200) dengan pullback menyentuh zona dinamis EMA 20.');
        reasons.push('Candle penutupan memantul bullish dari area pullback.');
      } else if (ema50 < ema200 && distEma20High <= atr14 * 0.65 && last.close < ema20 && last.close < last.open) {
        direction = 'SELL';
        confidence = 75;
        reasons.push('Tren mayor bearish (EMA 50 < EMA 200) dengan koreksi naik terhenti di EMA 20.');
        reasons.push('Harga kembali menekan turun searah tren utama.');
      } else {
        reasons.push('Harga tidak berada pada titik koreksi ideal di sekitar EMA 20/50.');
      }
      break;
    }

    case 'support-resistance': {
      const nearSup = snapshot.supportLevels.find((s) => Math.abs(last.low - s) <= atr14 * 0.6);
      const nearRes = snapshot.resistanceLevels.find((r) => Math.abs(last.high - r) <= atr14 * 0.6);
      if (nearSup !== undefined && rsi14 <= 44 && last.close > last.open) {
        direction = 'BUY';
        confidence = 72;
        reasons.push(`Harga menguji Support kunci ${nearSup} dan memantul bullish.`);
        reasons.push(`RSI (${rsi14}) mendukung pembalikan dari area jenuh jual.`);
      } else if (nearRes !== undefined && rsi14 >= 56 && last.close < last.open) {
        direction = 'SELL';
        confidence = 72;
        reasons.push(`Harga menguji Resistance kunci ${nearRes} dengan penolakan bearish.`);
        reasons.push(`RSI (${rsi14}) menunjukkan kejenuhan beli di area suplai.`);
      } else {
        reasons.push('Harga berada di tengah rentang, jauh dari level Support/Resistance signifikan.');
      }
      break;
    }

    case 'price-action': {
      const patterns = snapshot.candlestickPatterns;
      const hasBullPattern = patterns.some((p) => p.includes('Bullish'));
      const hasBearPattern = patterns.some((p) => p.includes('Bearish'));
      if (hasBullPattern && last.close >= ema50 - atr14 * 0.5) {
        direction = 'BUY';
        confidence = 73;
        reasons.push(`Pola candlestick terdeteksi: ${patterns.join(', ')}.`);
        reasons.push('Penolakan bawah mengindikasikan akumulasi buyer.');
      } else if (hasBearPattern && last.close <= ema50 + atr14 * 0.5) {
        direction = 'SELL';
        confidence = 73;
        reasons.push(`Pola candlestick terdeteksi: ${patterns.join(', ')}.`);
        reasons.push('Tekanan jual dominan pada penutupan candle terakhir.');
      } else {
        reasons.push('Tidak ditemukan pola Price Action valid (Pin Bar / Engulfing) pada candle penutupan.');
      }
      break;
    }

    case 'scalping': {
      if (ema20 > ema50 && macd.histogram > 0 && last.close > prev.high && rsi14 < 70) {
        direction = 'BUY';
        confidence = 71;
        reasons.push('Momentum mikro bullish: EMA 20 > EMA 50 & tembus high bar sebelumnya.');
      } else if (ema20 < ema50 && macd.histogram < 0 && last.close < prev.low && rsi14 > 30) {
        direction = 'SELL';
        confidence = 71;
        reasons.push('Momentum mikro bearish: EMA 20 < EMA 50 & tembus low bar sebelumnya.');
      } else {
        reasons.push('Tidak ada pemicu momentum scalping yang bersih; menunggu ekspansi mikro.');
      }
      break;
    }

    case 'intraday-trading': {
      if (snapshot.multiTimeframeAlignment.aligned && snapshot.marketCondition === 'BULLISH' && last.close > bollinger.middle && rsi14 < 68) {
        direction = 'BUY';
        confidence = 78;
        reasons.push(`Multi-Timeframe sinkron BULLISH (${snapshot.timeframe} & ${snapshot.multiTimeframeAlignment.higherTimeframe}).`);
        reasons.push('Harga bertahan di atas garis tengah Bollinger (20).');
      } else if (snapshot.multiTimeframeAlignment.aligned && snapshot.marketCondition === 'BEARISH' && last.close < bollinger.middle && rsi14 > 32) {
        direction = 'SELL';
        confidence = 78;
        reasons.push(`Multi-Timeframe sinkron BEARISH (${snapshot.timeframe} & ${snapshot.multiTimeframeAlignment.higherTimeframe}).`);
        reasons.push('Harga tertekan di bawah median Bollinger (20).');
      } else {
        reasons.push('Timeframe primer dan timeframe lebih tinggi belum selaras untuk Intraday Trading.');
      }
      break;
    }

    case 'swing-trading': {
      const nearDemand = snapshot.demandZones.some((z) => last.low <= z.high + atr14 * 0.4 && last.close > z.low);
      const nearSupply = snapshot.supplyZones.some((z) => last.high >= z.low - atr14 * 0.4 && last.close < z.high);
      if (ema50 > ema200 && (nearDemand || snapshot.marketCondition === 'BULLISH') && macd.line > macd.signal) {
        direction = 'BUY';
        confidence = 77;
        reasons.push('Struktur Swing Bullish: EMA 50 > EMA 200 dengan persilangan MACD bullish.');
      } else if (ema50 < ema200 && (nearSupply || snapshot.marketCondition === 'BEARISH') && macd.line < macd.signal) {
        direction = 'SELL';
        confidence = 77;
        reasons.push('Struktur Swing Bearish: EMA 50 < EMA 200 dengan momentum MACD bearish.');
      } else {
        reasons.push('Struktur swing multi-sesi belum memenuhi konfluensi zona & MACD.');
      }
      break;
    }
  }

  // Enforce Volatility Extreme Protection -> WAIT
  if (snapshot.volatilityRegime === 'EXTREME') {
    direction = 'WAIT';
    confidence = 30;
    reasons.unshift('Volatilitas pasar ekstrem (ATR > 2.6x rata-rata). Sistem memilih WAIT.');
  }

  const effectiveRr = Math.max(minRrRatio, strategy.tp_rr_ratio);
  const slDist = Math.max(atr14 * strategy.sl_atr_mult, instrument.pip_size * 8);
  const tpDist = slDist * effectiveRr;

  const entryPrice =
    direction === 'BUY'
      ? snapshot.ask
      : direction === 'SELL'
        ? snapshot.bid
        : snapshot.lastPrice;

  const stopLoss =
    direction === 'BUY'
      ? Number((entryPrice - slDist).toFixed(instrument.digits))
      : direction === 'SELL'
        ? Number((entryPrice + slDist).toFixed(instrument.digits))
        : 0;

  const takeProfit =
    direction === 'BUY'
      ? Number((entryPrice + tpDist).toFixed(instrument.digits))
      : direction === 'SELL'
        ? Number((entryPrice - tpDist).toFixed(instrument.digits))
        : 0;

  if (snapshot.multiTimeframeAlignment.aligned && direction !== 'WAIT') {
    confidence = Math.min(92, confidence + 6);
  }

  return {
    symbol: snapshot.symbol,
    timeframe: snapshot.timeframe,
    strategyId: strategy.id,
    strategyName: strategy.name,
    direction,
    entryPrice,
    stopLoss,
    takeProfit,
    riskRewardRatio: direction === 'WAIT' ? 0 : Number(effectiveRr.toFixed(2)),
    confidence,
    marketCondition: snapshot.marketCondition,
    reasons,
    snapshot,
  };
}
