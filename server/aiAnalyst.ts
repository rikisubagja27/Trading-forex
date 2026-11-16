import { GoogleGenAI, Type } from '@google/genai';
import type { DeterministicSignal } from './types.ts';

const aiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

export interface AiAnalysisResponse {
  aiPowered: boolean;
  model: string;
  direction: 'BUY' | 'SELL' | 'WAIT';
  marketCondition: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  confidence: number;
  reasoning: string;
  keyLevelsSummary: string;
  invalidationCriteria: string;
  probabilisticWarning: string;
  error?: string;
}

export async function generateAiMarketAnalysis(
  signal: DeterministicSignal
): Promise<AiAnalysisResponse> {
  const { snapshot } = signal;

  if (!aiClient) {
    return {
      aiPowered: false,
      model: 'deterministic-quant-fallback',
      direction: signal.direction,
      marketCondition: signal.marketCondition,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      riskRewardRatio: signal.riskRewardRatio,
      confidence: signal.confidence,
      reasoning:
        signal.reasons.join(' ') +
        ' (Catatan: GEMINI_API_KEY belum terkonfigurasi di environment server sehingga analisis menggunakan mesin deterministik.)',
      keyLevelsSummary: `Support: ${snapshot.supportLevels.join(', ') || '—'} | Resistance: ${snapshot.resistanceLevels.join(', ') || '—'}`,
      invalidationCriteria:
        signal.direction === 'WAIT'
          ? 'Menunggu konfluensi tren, struktur harga, dan rasio Risk/Reward memenuhi syarat minimum.'
          : `Setup tidak valid apabila harga menembus Stop Loss di ${signal.stopLoss}.`,
      probabilisticWarning:
        'Analisis bersifat probabilistik, bukan kepastian. Eksekusi wajib melalui validasi Risk Management.',
    };
  }

  const prompt = `
Anda adalah Quantitative Forex Analyst untuk sistem institusional NEXORA AI.
Evaluasi data teknikal aktual berikut untuk ${signal.symbol} pada timeframe ${signal.timeframe} dengan strategi terisolasi "${signal.strategyName}":

Data Kuantitatif:
- Sumber Data: ${snapshot.dataSource}
- Harga Terakhir: ${snapshot.lastPrice} (Bid: ${snapshot.bid}, Ask: ${snapshot.ask}, Spread: ${snapshot.spreadPoints} pts)
- EMA 20: ${snapshot.ema20}, EMA 50: ${snapshot.ema50}, EMA 200: ${snapshot.ema200}
- RSI (14): ${snapshot.rsi14}
- MACD (12,26,9): Line=${snapshot.macd.line}, Signal=${snapshot.macd.signal}, Hist=${snapshot.macd.histogram}
- Bollinger Bands (20,2): Upper=${snapshot.bollinger.upper}, Mid=${snapshot.bollinger.middle}, Lower=${snapshot.bollinger.lower}, Bandwidth=${snapshot.bollinger.bandwidthPct}%
- ATR (14): ${snapshot.atr14} (Avg50=${snapshot.atrAvg50}, Rezim Volatilitas=${snapshot.volatilityRegime})
- Struktur S/R: Support=[${snapshot.supportLevels.join(', ')}], Resistance=[${snapshot.resistanceLevels.join(', ')}]
- Supply Zones: ${JSON.stringify(snapshot.supplyZones)}
- Demand Zones: ${JSON.stringify(snapshot.demandZones)}
- Pola Candlestick: ${snapshot.candlestickPatterns.join(', ') || 'Tidak ada pola dominan'}
- Breakout/Retest: ${snapshot.breakoutStatus}
- Multi-Timeframe: Primary(${snapshot.timeframe})=${snapshot.multiTimeframeAlignment.primary}, Higher(${snapshot.multiTimeframeAlignment.higherTimeframe})=${snapshot.multiTimeframeAlignment.higherTrend}, Aligned=${snapshot.multiTimeframeAlignment.aligned}
- Evaluasi Mesin Strategi Deterministik: Direction=${signal.direction}, Entry=${signal.entryPrice}, SL=${signal.stopLoss}, TP=${signal.takeProfit}, R:R=1:${signal.riskRewardRatio}, Confidence=${signal.confidence}%
- Alasan Deterministik: ${signal.reasons.join(' | ')}

Aturan Ketat:
1. Jangan pernah menjanjikan kepastian profit atau menganggap prediksi 100% pasti.
2. Jika setup berkualitas rendah, volatilitas ekstrem, atau R:R tidak memadai, rekomendasikan WAIT.
3. Jelaskan alasan secara profesional, ringkas, dan objektif dalam Bahasa Indonesia.
4. Anda tidak mengirim order langsung; output ini hanya layer analisis sebelum validasi Risk Management.
`;

  try {
    const response = await aiClient.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a strict, risk-averse institutional Forex quantitative analyst. Never guarantee profits. Prefer WAIT when setups are ambiguous.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            direction: { type: Type.STRING, description: 'BUY, SELL, or WAIT' },
            marketCondition: { type: Type.STRING, description: 'BULLISH, BEARISH, or SIDEWAYS' },
            confidence: { type: Type.NUMBER, description: 'Calibrated confidence 0-95' },
            reasoning: { type: Type.STRING, description: 'Clear quantitative explanation in Indonesian' },
            keyLevelsSummary: { type: Type.STRING, description: 'Key support/resistance/zone summary' },
            invalidationCriteria: { type: Type.STRING, description: 'Exact condition that invalidates the setup' },
          },
          required: [
            'direction',
            'marketCondition',
            'confidence',
            'reasoning',
            'keyLevelsSummary',
            'invalidationCriteria',
          ],
        },
      },
    });

    const raw = (response.text ?? '{}').trim();
    const parsed = JSON.parse(raw) as {
      direction?: string;
      marketCondition?: string;
      confidence?: number;
      reasoning?: string;
      keyLevelsSummary?: string;
      invalidationCriteria?: string;
    };

    const dir =
      parsed.direction === 'BUY' || parsed.direction === 'SELL' || parsed.direction === 'WAIT'
        ? parsed.direction
        : signal.direction;

    // If deterministic engine says WAIT, keep WAIT for safety unless aligned
    const safeDirection = signal.direction === 'WAIT' ? 'WAIT' : dir;
    const cond =
      parsed.marketCondition === 'BULLISH' ||
      parsed.marketCondition === 'BEARISH' ||
      parsed.marketCondition === 'SIDEWAYS'
        ? parsed.marketCondition
        : signal.marketCondition;

    return {
      aiPowered: true,
      model: 'gemini-4-hydrogen',
      direction: safeDirection,
      marketCondition: cond,
      entryPrice: safeDirection === 'WAIT' ? snapshot.lastPrice : signal.entryPrice,
      stopLoss: safeDirection === 'WAIT' ? 0 : signal.stopLoss,
      takeProfit: safeDirection === 'WAIT' ? 0 : signal.takeProfit,
      riskRewardRatio: safeDirection === 'WAIT' ? 0 : signal.riskRewardRatio,
      confidence: Math.min(93, Math.max(15, Number(parsed.confidence ?? signal.confidence))),
      reasoning: parsed.reasoning || signal.reasons.join(' '),
      keyLevelsSummary:
        parsed.keyLevelsSummary ||
        `Support: ${snapshot.supportLevels.join(', ') || '—'} | Resistance: ${snapshot.resistanceLevels.join(', ') || '—'}`,
      invalidationCriteria:
        parsed.invalidationCriteria ||
        `Setup batal jika harga menyentuh Stop Loss ${signal.stopLoss}.`,
      probabilisticWarning:
        'Analisis AI bersifat probabilistik dan bukan kepastian. Order tetap wajib lolos validasi Risk Management.',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Gemini API request failed';
    return {
      aiPowered: false,
      model: 'deterministic-quant-fallback',
      direction: signal.direction,
      marketCondition: signal.marketCondition,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      riskRewardRatio: signal.riskRewardRatio,
      confidence: signal.confidence,
      reasoning: signal.reasons.join(' '),
      keyLevelsSummary: `Support: ${snapshot.supportLevels.join(', ') || '—'} | Resistance: ${snapshot.resistanceLevels.join(', ') || '—'}`,
      invalidationCriteria: `Setup batal jika harga menyentuh Stop Loss ${signal.stopLoss}.`,
      probabilisticWarning:
        'Analisis bersifat probabilistik. Eksekusi wajib melalui validasi Risk Management.',
      error: `Gemini API Error: ${msg}`,
    };
  }
}
