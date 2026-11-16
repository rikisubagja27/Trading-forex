import { useMemo } from 'react';

interface EquityPoint {
  label: string;
  equity: number;
  phase?: string;
}

interface EquityCurveChartProps {
  points: EquityPoint[];
  heightClass?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function EquityCurveChart({
  points,
  heightClass = 'h-64',
  emptyTitle = 'Belum ada data pertumbuhan akun',
  emptyDescription = 'Hubungkan MetaTrader 5 Bridge atau jalankan Backtest untuk melihat kurva ekuitas.',
}: EquityCurveChartProps) {
  const width = 820;
  const height = 240;
  const padTop = 16;
  const padBottom = 24;
  const padLeft = 16;
  const padRight = 72;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const { minEq, maxEq } = useMemo(() => {
    if (points.length === 0) return { minEq: 0, maxEq: 100 };
    const vals = points.map((p) => p.equity);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || Math.max(50, hi * 0.02);
    return { minEq: lo - pad, maxEq: hi + pad };
  }, [points]);

  if (points.length === 0) {
    return (
      <div
        className={`${heightClass} flex flex-col items-center justify-center text-center px-6 border border-[#1F2731] rounded-lg bg-[#090C10]`}
      >
        <p className="text-sm font-medium text-slate-200">{emptyTitle}</p>
        <p className="text-xs text-slate-400 mt-1 max-w-md">{emptyDescription}</p>
      </div>
    );
  }

  const normalized =
    points.length === 1 ? [points[0], { ...points[0], label: 'Now' }] : points;

  const toX = (i: number) => padLeft + (i / (normalized.length - 1)) * plotW;
  const toY = (val: number) =>
    padTop + plotH - ((val - minEq) / Math.max(1e-6, maxEq - minEq)) * plotH;

  const linePath = normalized
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.equity).toFixed(1)}`)
    .join(' ');

  const areaPath = `${linePath} L ${toX(normalized.length - 1).toFixed(1)} ${(
    padTop + plotH
  ).toFixed(1)} L ${toX(0).toFixed(1)} ${(padTop + plotH).toFixed(1)} Z`;

  const startVal = normalized[0].equity;
  const endVal = normalized[normalized.length - 1].equity;
  const isPositive = endVal >= startVal;
  const strokeColor = isPositive ? '#10B981' : '#EF4444';

  return (
    <div className="bg-[#090C10] border border-[#1F2731] rounded-lg p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className={`w-full ${heightClass}`}>
        <defs>
          <linearGradient id="nexoraEqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const val = maxEq - f * (maxEq - minEq);
          const y = padTop + f * plotH;
          return (
            <g key={f}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="#171E27"
                strokeWidth="1"
              />
              <text
                x={width - padRight + 8}
                y={y + 4}
                fill="#64748B"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                ${val.toFixed(0)}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#nexoraEqFill)" />
        <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="2" />

        {normalized.map((p, i) => {
          if (normalized.length > 40 && i % Math.ceil(normalized.length / 30) !== 0 && i !== normalized.length - 1) {
            return null;
          }
          return (
            <circle
              key={i}
              cx={toX(i)}
              cy={toY(p.equity)}
              r="2.5"
              fill={
                p.phase === 'OUT_OF_SAMPLE'
                  ? '#38BDF8'
                  : p.phase === 'VALIDATION'
                    ? '#FBBF24'
                    : strokeColor
              }
            />
          );
        })}
      </svg>
    </div>
  );
}
