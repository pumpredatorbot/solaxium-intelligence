'use client';

import { useState } from 'react';
import { AreaChart } from '@/components/charts';
import type { CyclePoint } from '@/lib/repo/analytics';

/**
 * Performance, tabbed by measure.
 *
 * One measure at a time and one y-scale per chart — capital in SOL and a
 * population count do not belong on shared axes, and a dual-axis chart would
 * invite a comparison the data does not support.
 */

const TABS = [
  { key: 'capital', label: 'Capital', unit: 'SOL', tone: 'var(--viz-1)' },
  { key: 'pnl', label: 'P&L', unit: 'SOL', tone: 'var(--viz-good)' },
  { key: 'revenue', label: 'Revenue', unit: 'SOL', tone: 'var(--viz-1)' },
  { key: 'survival', label: 'Survival', unit: '%', tone: 'var(--viz-good)' },
  { key: 'agents', label: 'Agents', unit: 'live', tone: 'var(--viz-1)' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function PerformancePanel({
  series,
  height = 170,
}: {
  series: CyclePoint[];
  height?: number;
}) {
  const [tab, setTab] = useState<TabKey>('capital');
  const active = TABS.find((t) => t.key === tab)!;

  const points = series.map((point) => {
    const total = point.alive + point.dead;
    const y =
      tab === 'capital'
        ? point.capitalSol
        : tab === 'pnl'
          ? point.profitSol
          : tab === 'revenue'
            ? point.revenueSol
            : tab === 'survival'
              ? total > 0
                ? (point.alive / total) * 100
                : 0
              : point.alive;
    return { x: point.cycle, y };
  });

  const decimals = active.unit === 'SOL' ? 3 : active.unit === '%' ? 1 : 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="label">Performance</h2>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Performance measure">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`chip ${tab === item.key ? 'chip-active' : 'hover:text-ink-muted'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-3.5">
        <AreaChart
          points={points}
          height={height}
          tone={active.tone}
          unit={active.unit}
          zeroBased={tab !== 'capital'}
          format={{ decimals }}
          emptyLabel="Run the simulation to plot history"
        />
      </div>
    </section>
  );
}
