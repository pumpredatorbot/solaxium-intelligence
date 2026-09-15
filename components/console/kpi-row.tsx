'use client';

import { Sparkline } from '@/components/charts';
import { useConsole, type StatsSample } from './console-provider';

/**
 * Headline figures.
 *
 * Values are the live totals from the engine. The sparkline and the change
 * indicator are built from this client's own observation buffer, so they are
 * explicitly session-scoped — labelled as such rather than presented as the
 * run's full history.
 */
export function KpiRow() {
  const { stats, statsHistory, simulation } = useConsole();

  if (!stats || !simulation) {
    return (
      <div className="panel px-4 py-8 text-center font-mono text-2xs text-ink-faint">
        No simulation running. Press play to create one.
      </div>
    );
  }

  const cards = [
    {
      label: 'Total capital',
      value: stats.totalCapitalSol,
      unit: 'SOL',
      pick: (s: StatsSample) => s.capitalSol,
      tone: 'var(--viz-1)',
    },
    {
      label: 'Total revenue',
      value: stats.totalRevenueSol,
      unit: 'SOL',
      pick: (s: StatsSample) => s.revenueSol,
      tone: 'var(--viz-1)',
    },
    {
      label: 'Total expenses',
      value: stats.totalExpensesSol,
      unit: 'SOL',
      pick: (s: StatsSample) => s.expensesSol,
      tone: 'var(--viz-2)',
    },
    {
      label: 'Total P&L',
      value: stats.totalProfitSol,
      unit: 'SOL',
      pick: (s: StatsSample) => s.profitSol,
      tone: stats.totalProfitSol >= 0 ? 'var(--viz-good)' : 'var(--viz-bad)',
      signed: true,
    },
  ];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => {
        const series = statsHistory.map(card.pick);
        const delta = series.length > 1 ? series.at(-1)! - series[0] : 0;
        const pct = series.length > 1 && series[0] !== 0 ? (delta / Math.abs(series[0])) * 100 : null;

        return (
          <article key={card.label} className="panel panel-lit min-w-0 overflow-hidden p-3.5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="label">{card.label}</h3>
              {pct !== null && Math.abs(pct) >= 0.05 && (
                <span
                  className={`tabular font-mono text-3xs ${delta >= 0 ? 'text-good' : 'text-bad'}`}
                  title="Change since this session started observing"
                >
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
                </span>
              )}
            </div>

            <div className="mt-2 flex items-baseline gap-1.5">
              <span
                className="tabular font-mono text-[1.65rem] font-medium leading-none tracking-tight"
                style={{ color: card.signed ? card.tone : undefined }}
              >
                {card.signed && card.value >= 0 ? '+' : ''}
                {card.value.toFixed(3)}
              </span>
              <span className="font-mono text-3xs uppercase text-ink-faint">{card.unit}</span>
            </div>

            <div className="mt-2.5 h-[26px]">
              <Sparkline points={series} tone={card.tone} width={180} height={26} />
            </div>
          </article>
        );
      })}

      {/* Population block */}
      <article className="panel grid grid-cols-4 overflow-hidden">
        {[
          { label: 'Alive', value: stats.liveAgents, tone: 'text-good' },
          { label: 'Dead', value: stats.deadAgents, tone: 'text-bad' },
          { label: 'Gens', value: stats.generations, tone: 'text-ink' },
          { label: 'Clones', value: stats.totalClones, tone: 'text-ink' },
        ].map((item, index) => (
          <div
            key={item.label}
            className={`px-2.5 py-3.5 ${index > 0 ? 'border-l border-line' : ''}`}
          >
            <div className="label">{item.label}</div>
            <div className={`tabular mt-1.5 font-mono text-xl font-medium leading-none ${item.tone}`}>
              {item.value}
            </div>
          </div>
        ))}
        <div className="col-span-4 border-t border-line px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="label">Survival rate</span>
            <span className="tabular font-mono text-2xs text-ink">
              {(stats.survivalRate * 100).toFixed(1)}%
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{
                width: `${Math.max(1, stats.survivalRate * 100)}%`,
                background: 'var(--viz-good)',
              }}
            />
          </div>
        </div>
      </article>
    </div>
  );
}
