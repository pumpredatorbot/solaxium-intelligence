/**
 * Hand-rolled SVG charts.
 *
 * A charting library would drag ~150KB into every page for what amounts to a
 * polyline; these render on the server, inherit the palette, and stay legible
 * at terminal density.
 */

export interface SeriesPoint {
  x: number;
  y: number;
}

function path(points: SeriesPoint[], width: number, height: number, padding = 2) {
  if (points.length === 0) return { line: '', area: '', min: 0, max: 0 };

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const inner = height - padding * 2;

  const project = (p: SeriesPoint) => ({
    x: ((p.x - minX) / spanX) * width,
    y: padding + inner - ((p.y - minY) / spanY) * inner,
  });

  const projected = points.map(project);
  const line = projected.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  return { line, area, min: minY, max: maxY };
}

export function AreaChart({
  points,
  height = 120,
  width = 640,
  tone = 'sol',
  label,
}: {
  points: SeriesPoint[];
  height?: number;
  width?: number;
  tone?: 'sol' | 'danger' | 'muted';
  label?: string;
}) {
  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded border border-line bg-raised/40 text-2xs text-ink-faint"
        style={{ height }}
      >
        Not enough data yet
      </div>
    );
  }

  const { line, area, min, max } = path(points, width, height);
  const stroke = tone === 'danger' ? '#E05B4A' : tone === 'muted' ? '#575C59' : '#14F195';
  const gradientId = `grad-${tone}-${points.length}-${Math.round(max * 1000)}`;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={label ?? 'chart'}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1.5 flex justify-between font-mono text-2xs text-ink-faint">
        <span className="tabular">{min.toFixed(3)}</span>
        <span className="tabular">{max.toFixed(3)}</span>
      </div>
    </div>
  );
}

export function BarChart({
  bars,
  height = 140,
  format = (v: number) => v.toFixed(2),
}: {
  bars: { label: string; value: number }[];
  height?: number;
  format?: (value: number) => string;
}) {
  if (bars.length === 0) {
    return <div className="text-2xs text-ink-faint">No data</div>;
  }

  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1e-9);

  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {bars.map((bar) => {
        const ratio = Math.abs(bar.value) / max;
        const negative = bar.value < 0;
        return (
          <div key={bar.label} className="group flex flex-1 flex-col items-center gap-1.5">
            <span className="tabular font-mono text-2xs text-ink-faint opacity-0 transition-opacity group-hover:opacity-100">
              {format(bar.value)}
            </span>
            <div
              className={`w-full rounded-sm ${negative ? 'bg-danger/50' : 'bg-sol/45'} transition-colors group-hover:${negative ? 'bg-danger/70' : 'bg-sol/70'}`}
              style={{ height: `${Math.max(2, ratio * (height - 34))}px` }}
            />
            <span className="font-mono text-2xs text-ink-faint">{bar.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Sparkline({
  points,
  width = 120,
  height = 26,
  tone = 'sol',
}: {
  points: number[];
  width?: number;
  height?: number;
  tone?: 'sol' | 'danger';
}) {
  if (points.length < 2) return <span className="text-2xs text-ink-faint">—</span>;

  const { line } = path(
    points.map((y, x) => ({ x, y })),
    width,
    height,
    1,
  );
  const stroke = tone === 'danger' ? '#E05B4A' : '#14F195';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <path d={line} fill="none" stroke={stroke} strokeWidth="1" opacity="0.8" />
    </svg>
  );
}
