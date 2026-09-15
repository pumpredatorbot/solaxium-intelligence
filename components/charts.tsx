'use client';

import { useMemo, useRef, useState } from 'react';

/**
 * Charts.
 *
 * Hand-rolled SVG: a charting library would add ~150KB to every console page
 * for what is a polyline and a hover layer.
 *
 * Colour rules (see docs/DESIGN.md):
 *  - Data marks use the validated `--viz-*` roles, never the interface neons.
 *    The neons sit outside the readable lightness band and fail CVD separation.
 *  - A single series needs no legend — the panel title names it.
 *  - Values, labels and axes wear ink tokens, never the series colour.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Number formatting is passed as a plain object, never a callback.
 *
 * These charts are client components rendered from server components, and a
 * function prop cannot cross that boundary — so the spec is data.
 */
export interface NumberFormat {
  decimals?: number;
  signed?: boolean;
  prefix?: string;
  suffix?: string;
}

export function formatNumber(value: number, spec: NumberFormat = {}): string {
  const { decimals = 2, signed = false, prefix = '', suffix = '' } = spec;
  const sign = signed && value > 0 ? '+' : '';
  return `${prefix}${sign}${value.toFixed(decimals)}${suffix}`;
}

const PAD = { top: 8, right: 8, bottom: 18, left: 8 };

function useScale(points: Point[], width: number, height: number, zeroBased: boolean) {
  return useMemo(() => {
    if (points.length === 0) {
      return { project: () => ({ x: 0, y: 0 }), minY: 0, maxY: 0, minX: 0, maxX: 0 };
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const rawMin = Math.min(...ys);
    const rawMax = Math.max(...ys);
    const minY = zeroBased ? Math.min(0, rawMin) : rawMin;
    const maxY = rawMax;

    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const innerW = width - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;

    return {
      minY,
      maxY,
      minX,
      maxX,
      project: (p: Point) => ({
        x: PAD.left + ((p.x - minX) / spanX) * innerW,
        y: PAD.top + innerH - ((p.y - minY) / spanY) * innerH,
      }),
    };
  }, [points, width, height, zeroBased]);
}

export function AreaChart({
  points,
  height = 150,
  tone = 'var(--viz-1)',
  format = { decimals: 4 },
  xPrefix = 'c',
  unit,
  zeroBased = true,
  emptyLabel = 'No data yet',
}: {
  points: Point[];
  height?: number;
  tone?: string;
  format?: NumberFormat;
  xPrefix?: string;
  unit?: string;
  zeroBased?: boolean;
  emptyLabel?: string;
}) {
  const WIDTH = 720;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const scale = useScale(points, WIDTH, height, zeroBased);

  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded border border-line bg-raised/30 font-mono text-2xs text-ink-faint"
        style={{ height }}
      >
        {emptyLabel}
      </div>
    );
  }

  const projected = points.map(scale.project);
  const line = projected.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const baseline = height - PAD.bottom;
  const area = `${line} L${projected.at(-1)!.x.toFixed(2)},${baseline} L${projected[0].x.toFixed(2)},${baseline} Z`;
  const gradientId = `area-${tone.replace(/[^a-z0-9]/gi, '')}-${points.length}`;

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, index)));
  };

  const active = hover !== null ? points[hover] : null;
  const activePos = hover !== null ? projected[hover] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        className="w-full cursor-crosshair"
        style={{ height }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
            <stop offset="100%" stopColor={tone} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive gridlines. */}
        {[0.25, 0.5, 0.75].map((t) => (
          <line
            key={t}
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={PAD.top + (height - PAD.top - PAD.bottom) * t}
            y2={PAD.top + (height - PAD.top - PAD.bottom) * t}
            stroke="var(--viz-grid)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={tone}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />

        {activePos && (
          <>
            <line
              x1={activePos.x}
              x2={activePos.x}
              y1={PAD.top}
              y2={baseline}
              stroke="var(--viz-axis)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={activePos.x}
              cy={activePos.y}
              r="4"
              fill={tone}
              stroke="var(--viz-surface)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute top-1 z-10 rounded border border-line-strong bg-abyss/95 px-2 py-1.5 shadow-panel"
          style={{
            left: `${(activePos!.x / WIDTH) * 100}%`,
            transform: `translateX(${activePos!.x > WIDTH * 0.7 ? '-105%' : '8px'})`,
          }}
        >
          <div className="label">{`${xPrefix}${active.x}`}</div>
          <div className="tabular mt-0.5 font-mono text-xs text-ink">
            {formatNumber(active.y, format)}
            {unit && <span className="ml-1 text-3xs text-ink-faint">{unit}</span>}
          </div>
        </div>
      )}

      <div className="mt-1 flex justify-between font-mono text-3xs text-ink-faint">
        <span>{`${xPrefix}${scale.minX}`}</span>
        <span className="tabular">
          {formatNumber(scale.minY, format)} — {formatNumber(scale.maxY, format)}
          {unit ? ` ${unit}` : ''}
        </span>
        <span>{`${xPrefix}${scale.maxX}`}</span>
      </div>
    </div>
  );
}

/**
 * Horizontal ranked bars.
 *
 * Identity comes from the axis label, so a single hue is correct here — a
 * categorical palette would encode nothing the label does not already say.
 */
export function RankedBars({
  rows,
  format = { decimals: 3 },
  tone = 'var(--viz-1)',
  negativeTone = 'var(--viz-bad)',
}: {
  rows: { label: string; value: number; sub?: string }[];
  format?: NumberFormat;
  tone?: string;
  negativeTone?: string;
}) {
  if (rows.length === 0) {
    return <div className="font-mono text-2xs text-ink-faint">No data</div>;
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);

  return (
    <ul className="space-y-1.5">
      {rows.map((row) => {
        const negative = row.value < 0;
        return (
          <li key={row.label} className="group grid grid-cols-[minmax(0,7.5rem)_1fr_auto] items-center gap-3">
            <span className="truncate font-mono text-3xs uppercase tracking-wider text-ink-muted">
              {row.label}
            </span>
            <span className="relative h-2 overflow-hidden rounded-sm bg-raised">
              <span
                className="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-500"
                style={{
                  width: `${Math.max(1.5, (Math.abs(row.value) / max) * 100)}%`,
                  background: negative ? negativeTone : tone,
                }}
              />
            </span>
            <span className="tabular w-20 text-right font-mono text-2xs text-ink">
              {formatNumber(row.value, format)}
            </span>
            {row.sub && (
              <span className="col-span-3 -mt-0.5 pl-[8.25rem] font-mono text-3xs text-ink-ghost opacity-0 transition-opacity group-hover:opacity-100">
                {row.sub}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Vertical columns over an ordinal axis (generations).
 *
 * Generation is ordinal, so magnitude is encoded by height and depth by a
 * single-hue sequential ramp — never a categorical palette.
 */
export function ColumnChart({
  bars,
  height = 130,
  format = { decimals: 2 },
  tone = 'var(--viz-1)',
}: {
  bars: { label: string; value: number; title?: string }[];
  height?: number;
  format?: NumberFormat;
  tone?: string;
}) {
  if (bars.length === 0) {
    return <div className="font-mono text-2xs text-ink-faint">No data</div>;
  }
  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1e-9);

  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {bars.map((bar, index) => {
        const ratio = Math.abs(bar.value) / max;
        const negative = bar.value < 0;
        // A narrow sequential ramp orders the cohorts without competing with
        // height, which is the measure. Position and label already carry the
        // ordering, so this stays subtle by design.
        const depth = 0.72 + (index / Math.max(1, bars.length - 1)) * 0.28;
        return (
          <div
            key={bar.label}
            className="group relative flex flex-1 flex-col items-center justify-end gap-1.5"
            title={bar.title ?? `${bar.label}: ${formatNumber(bar.value, format)}`}
          >
            <span className="tabular absolute -top-0.5 font-mono text-3xs text-ink opacity-0 transition-opacity group-hover:opacity-100">
              {formatNumber(bar.value, format)}
            </span>
            <span
              className="w-full rounded-t-[3px] transition-all duration-500"
              style={{
                height: `${Math.max(2, ratio * (height - 26))}px`,
                background: negative ? 'var(--viz-bad)' : tone,
                opacity: negative ? 0.85 : depth,
              }}
            />
            <span className="font-mono text-3xs text-ink-faint">{bar.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Compact trend line for a card. Decorative scale, exact values live nearby. */
export function Sparkline({
  points,
  width = 108,
  height = 26,
  tone = 'var(--viz-1)',
}: {
  points: number[];
  width?: number;
  height?: number;
  tone?: string;
}) {
  if (points.length < 2) {
    return <span className="font-mono text-3xs text-ink-ghost">—</span>;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((y, i) => {
      const px = (i / (points.length - 1)) * width;
      const py = height - 2 - ((y - min) / span) * (height - 4);
      return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke={tone} strokeWidth="1.4" opacity="0.9" />
    </svg>
  );
}

/**
 * A stacked proportion bar for a small set of *status* categories.
 * Status colours ship with a label, never colour alone.
 */
export function StatusBar({
  segments,
}: {
  segments: { label: string; value: number; tone: string }[];
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return <div className="font-mono text-2xs text-ink-faint">No data</div>;

  return (
    <div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-sm">
        {segments.map((segment) => (
          <span
            key={segment.label}
            className="rounded-sm transition-all duration-500"
            style={{ width: `${(segment.value / total) * 100}%`, background: segment.tone }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: segment.tone }} />
            <span className="font-mono text-3xs uppercase tracking-wider text-ink-muted">
              {segment.label}
            </span>
            <span className="tabular font-mono text-3xs text-ink-faint">
              {((segment.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
