import { useMemo, useState } from 'react';
import type { Candle } from '../types/trading';

interface CandlestickChartProps {
  candles: Candle[];
  symbol: string;
  digits?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  supportLevels?: number[];
  resistanceLevels?: number[];
}

function calcEmaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function CandlestickChart({
  candles,
  symbol,
  digits = 5,
  entryPrice,
  stopLoss,
  takeProfit,
  supportLevels = [],
  resistanceLevels = [],
}: CandlestickChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const visible = useMemo(() => candles.slice(-90), [candles]);
  const closes = useMemo(() => visible.map((c) => c.close), [visible]);
  const ema20 = useMemo(() => calcEmaSeries(closes, 20), [closes]);
  const ema50 = useMemo(() => calcEmaSeries(closes, 50), [closes]);

  const width = 900;
  const height = 360;
  const padTop = 18;
  const padBottom = 26;
  const padLeft = 12;
  const padRight = 76;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const { minPrice, maxPrice } = useMemo(() => {
    if (visible.length === 0) return { minPrice: 0, maxPrice: 1 };
    let lo = Math.min(...visible.map((c) => c.low));
    let hi = Math.max(...visible.map((c) => c.high));
    const extras = [entryPrice, stopLoss, takeProfit, ...supportLevels, ...resistanceLevels].filter(
      (v): v is number => typeof v === 'number' && v > 0
    );
    for (const ex of extras) {
      if (ex < lo) lo = ex;
      if (ex > hi) hi = ex;
    }
    const pad = (hi - lo) * 0.08 || 0.001;
    return { minPrice: lo - pad, maxPrice: hi + pad };
  }, [visible, entryPrice, stopLoss, takeProfit, supportLevels, resistanceLevels]);

  const priceToY = (price: number) => {
    const ratio = (price - minPrice) / Math.max(1e-9, maxPrice - minPrice);
    return padTop + plotH - ratio * plotH;
  };

  if (visible.length === 0) {
    return (
      <div className="h-[340px] flex items-center justify-center text-xs text-slate-500 border border-[#1F2731] rounded-lg bg-[#090C10]">
        Memuat data candlestick {symbol}...
      </div>
    );
  }

  const stepX = plotW / visible.length;
  const candleW = Math.max(3, Math.min(8, stepX * 0.64));

  const buildLinePath = (series: number[]) =>
    series
      .map((val, i) => {
        const x = padLeft + i * stepX + stepX / 2;
        const y = priceToY(val);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

  const hovered = hoverIdx !== null ? visible[hoverIdx] : visible[visible.length - 1];
  const gridSteps = 5;

  return (
    <div className="bg-[#090C10] border border-[#1F2731] rounded-lg p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs">
        <div className="flex items-center gap-3 font-mono text-slate-300 tabular-nums">
          <span className="font-semibold text-white">{symbol}</span>
          <span>O {hovered.open.toFixed(digits)}</span>
          <span>H {hovered.high.toFixed(digits)}</span>
          <span>L {hovered.low.toFixed(digits)}</span>
          <span className={hovered.close >= hovered.open ? 'text-emerald-400' : 'text-red-400'}>
            C {hovered.close.toFixed(digits)}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-400 inline-block" /> EMA 20
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-sky-400 inline-block" /> EMA 50
          </span>
          {stopLoss && stopLoss > 0 ? (
            <span className="text-red-400 font-mono">SL {stopLoss.toFixed(digits)}</span>
          ) : null}
          {takeProfit && takeProfit > 0 ? (
            <span className="text-emerald-400 font-mono">TP {takeProfit.toFixed(digits)}</span>
          ) : null}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[300px] sm:h-[340px] select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Horizontal price grid */}
        {Array.from({ length: gridSteps + 1 }).map((_, idx) => {
          const frac = idx / gridSteps;
          const p = maxPrice - frac * (maxPrice - minPrice);
          const y = padTop + frac * plotH;
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#18202A"
                strokeWidth="1"
              />
              <text
                x={width - padRight + 8}
                y={y + 4}
                fill="#64748B"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {p.toFixed(digits)}
              </text>
            </g>
          );
        })}

        {/* Support & Resistance Lines */}
        {supportLevels.map((lvl, i) => (
          <line
            key={`s-${i}`}
            x1={padLeft}
            y1={priceToY(lvl)}
            x2={width - padRight}
            y2={priceToY(lvl)}
            stroke="#059669"
            strokeOpacity="0.35"
            strokeDasharray="4 4"
          />
        ))}
        {resistanceLevels.map((lvl, i) => (
          <line
            key={`r-${i}`}
            x1={padLeft}
            y1={priceToY(lvl)}
            x2={width - padRight}
            y2={priceToY(lvl)}
            stroke="#DC2626"
            strokeOpacity="0.35"
            strokeDasharray="4 4"
          />
        ))}

        {/* Entry / SL / TP Lines */}
        {entryPrice && entryPrice > 0 ? (
          <line
            x1={padLeft}
            y1={priceToY(entryPrice)}
            x2={width - padRight}
            y2={priceToY(entryPrice)}
            stroke="#E2E8F0"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        ) : null}
        {stopLoss && stopLoss > 0 ? (
          <line
            x1={padLeft}
            y1={priceToY(stopLoss)}
            x2={width - padRight}
            y2={priceToY(stopLoss)}
            stroke="#EF4444"
            strokeWidth="1.25"
            strokeDasharray="5 3"
          />
        ) : null}
        {takeProfit && takeProfit > 0 ? (
          <line
            x1={padLeft}
            y1={priceToY(takeProfit)}
            x2={width - padRight}
            y2={priceToY(takeProfit)}
            stroke="#10B981"
            strokeWidth="1.25"
            strokeDasharray="5 3"
          />
        ) : null}

        {/* Candlesticks */}
        {visible.map((c, i) => {
          const xCenter = padLeft + i * stepX + stepX / 2;
          const isUp = c.close >= c.open;
          const color = isUp ? '#10B981' : '#EF4444';
          const yHigh = priceToY(c.high);
          const yLow = priceToY(c.low);
          const yOpen = priceToY(c.open);
          const yClose = priceToY(c.close);
          const bodyTop = Math.min(yOpen, yClose);
          const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));

          return (
            <g
              key={c.time}
              onMouseEnter={() => setHoverIdx(i)}
              className="cursor-crosshair"
            >
              <rect
                x={padLeft + i * stepX}
                y={padTop}
                width={stepX}
                height={plotH}
                fill="transparent"
              />
              <line
                x1={xCenter}
                y1={yHigh}
                x2={xCenter}
                y2={yLow}
                stroke={color}
                strokeWidth="1.1"
              />
              <rect
                x={xCenter - candleW / 2}
                y={bodyTop}
                width={candleW}
                height={bodyH}
                fill={color}
                rx="0.5"
              />
            </g>
          );
        })}

        {/* EMA Overlays */}
        <path d={buildLinePath(ema20)} fill="none" stroke="#FBBF24" strokeWidth="1.3" />
        <path d={buildLinePath(ema50)} fill="none" stroke="#38BDF8" strokeWidth="1.3" />

        {/* Hover Crosshair */}
        {hoverIdx !== null && (
          <line
            x1={padLeft + hoverIdx * stepX + stepX / 2}
            y1={padTop}
            x2={padLeft + hoverIdx * stepX + stepX / 2}
            y2={padTop + plotH}
            stroke="#475569"
            strokeDasharray="2 2"
          />
        )}
      </svg>
    </div>
  );
}
