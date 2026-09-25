'use client';

import { pct, signedSol, useTrading } from './trading-provider';

/**
 * The headline figures for a paper-trading run.
 *
 * Deliberately not a set of gauges: each figure is a number the engine wrote,
 * with the denominator it was computed against next to it, because a win rate
 * without a trade count is not information.
 */
export function TradingKpis() {
  const { stats, dataset, simulation, mode, flow } = useTrading();

  if (!stats || (mode && mode !== 'TRADING')) {
    return (
      <section className="panel px-3.5 py-4">
        <p className="text-2xs text-ink-faint">
          {mode && mode !== 'TRADING'
            ? `The active run is an ${mode.toLowerCase()} simulation. Start a paper-trading run to populate this view.`
            : 'No run yet.'}
        </p>
      </section>
    );
  }

  const netSol = stats.capitalSol - stats.startingCapitalSol;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Realised P&L"
          value={`${signedSol(stats.realisedPnlSol, 3)} SOL`}
          sub={`${stats.closedTrades} closed`}
          tone={stats.realisedPnlSol > 0 ? 'good' : stats.realisedPnlSol < 0 ? 'bad' : undefined}
        />
        <Kpi
          label="Win rate"
          value={stats.closedTrades > 0 ? pct(stats.winRate, 1) : '—'}
          sub={`${stats.wins}/${stats.closedTrades}`}
        />
        <Kpi
          label="Capital"
          value={`${stats.capitalSol.toFixed(3)} SOL`}
          sub={`${signedSol(netSol, 3)} vs seeded`}
          tone={netSol > 0 ? 'good' : netSol < 0 ? 'bad' : undefined}
        />
        <Kpi
          label="Population"
          value={`${stats.liveAgents}`}
          sub={`${stats.deadAgents} dead · ${pct(stats.survivalRate, 0)} survive`}
        />
        <Kpi
          label="Generations"
          value={`${stats.generations}`}
          sub={`${stats.clones} clones`}
        />
        <Kpi
          label="Fitness"
          value={stats.bestFitness.toFixed(3)}
          sub={`mean ${stats.meanFitness.toFixed(3)}`}
        />
      </div>

      <div className="panel flex flex-wrap items-center gap-x-5 gap-y-1.5 px-3.5 py-2">
        <Inline label="market">
          {dataset ? (
            <>
              <span className={flow?.origin === 'pump.fun' ? 'text-cy' : 'text-ink-muted'}>
                {dataset.source !== 'RECORDED'
                  ? 'synthetic'
                  : flow?.origin === 'pump.fun'
                    ? 'pump.fun · real tokens'
                    : `recorded · ${flow?.origin ?? 'unattributed'}`}
              </span>
              <span className="text-ink-ghost"> · {dataset.tokenCount} tokens</span>
            </>
          ) : (
            <span className="text-ink-ghost">none</span>
          )}
        </Inline>
        <Inline label="step">
          {simulation ? `${simulation.cycle}${dataset ? ` / ${dataset.steps}` : ''}` : '—'}
        </Inline>
        <Inline label="open">{`${stats.openPositions}`}</Inline>
        <Inline label="avg hold">
          {stats.closedTrades > 0 ? `${stats.avgHoldSteps.toFixed(1)}s` : '—'}
        </Inline>
        <Inline label="costs">{`${stats.costsSol.toFixed(4)} SOL`}</Inline>
        <span className="chip ml-auto border-warn/30 bg-warn/[0.06] text-warn">
          paper only · no wallet, no transaction
        </span>
      </div>
    </div>
  );
}

function Kpi({
  label, value, sub, tone,
}: { label: string; value: string; sub: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="panel min-w-0 px-3 py-2.5">
      <p className="label truncate">{label}</p>
      <p
        className={`metric mt-1 truncate text-base ${
          tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : 'text-ink'
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 truncate text-3xs text-ink-ghost">{sub}</p>
    </div>
  );
}

function Inline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="label">{label}</span>
      <span className="metric text-2xs text-ink-muted">{children}</span>
    </span>
  );
}
