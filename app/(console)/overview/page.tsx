import { SolaxiumCore } from '@/components/console/solaxium-core';
import { EnginePanel } from '@/components/console/engine-panel';
import { EventsPanel } from '@/components/console/events-panel';
import { KpiRow } from '@/components/console/kpi-row';
import { PerformancePanel } from '@/components/console/performance-panel';
import { ReplayPanel } from '@/components/console/replay-panel';
import { SolanaPanel } from '@/components/console/solana-panel';
import { TelemetryPanel } from '@/components/console/telemetry-panel';
import { AreaChart } from '@/components/charts';
import { getCycleSeries } from '@/lib/repo/analytics';
import { listEngines } from '@/lib/repo/engines';
import { getReplaySnapshot } from '@/lib/repo/replay';
import { getActiveSimulation, getCorePopulation, getSimulationConfig } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overview' };

export default async function OverviewPage() {
  const simulation = await getActiveSimulation();
  const config = simulation ? await getSimulationConfig(simulation.id) : null;

  const [series, engines, population, snapshot] = await Promise.all([
    simulation ? getCycleSeries(simulation.id) : Promise.resolve([]),
    simulation && config
      ? listEngines(simulation.id, { limit: 6, cycleCostSol: config.CYCLE_COST_SOL })
      : Promise.resolve([]),
    simulation ? getCorePopulation(simulation.id) : Promise.resolve([]),
    simulation ? getReplaySnapshot(simulation.id, simulation.cycle) : Promise.resolve(null),
  ]);

  const capitalPoints = series.map((p) => ({ x: p.cycle, y: p.capitalSol }));
  const totalPnl = series.at(-1)?.profitSol ?? 0;
  const generationDepth = population.length > 0 ? Math.max(...population.map((n) => n.g)) : 0;

  return (
    <div className="space-y-3">
      <KpiRow />

      {/* --- engines | core | telemetry ---------------------------------- */}
      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,296px)_minmax(0,1fr)_minmax(0,324px)]">
        <div className="order-2 min-w-0 xl:order-1">
          <EnginePanel initialEngines={engines} limit={6} height="h-[532px]" />
        </div>

        <section className="panel panel-lit order-1 flex min-w-0 flex-col overflow-hidden xl:order-2">
          <div className="panel-head">
            <h2 className="label">Solaxium core</h2>
            <span className="font-mono text-3xs uppercase tracking-wider text-ink-ghost">
              Collective intelligence
            </span>
          </div>
          <div className="flex flex-1 items-center justify-center p-3">
            <div className="w-full max-w-[520px]">
              <SolaxiumCore initialPopulation={population} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-px border-t border-line bg-line">
            {[
              ['Generation depth', String(generationDepth)],
              ['Lineage edges', String(population.filter((n) => n.p).length)],
              ['Clone threshold', config ? `${config.CLONE_THRESHOLD_SOL} SOL` : '—'],
            ].map(([label, value]) => (
              <div key={label} className="bg-surface px-3 py-2">
                <div className="label">{label}</div>
                <div className="tabular mt-1 font-mono text-2xs text-ink">{value}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="order-3 flex min-w-0 flex-col gap-3">
          <TelemetryPanel height="h-[318px]" />
          <EventsPanel height="h-[186px]" />
        </div>
      </div>

      {/* --- analytics strip --------------------------------------------- */}
      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,324px)]">
        <PerformancePanel series={series} height={168} />

        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Capital evolution</h2>
            <span className={`tabular font-mono text-xs ${totalPnl >= 0 ? 'text-good' : 'text-bad'}`}>
              {totalPnl >= 0 ? '+' : ''}
              {totalPnl.toFixed(3)} SOL
            </span>
          </div>
          <div className="p-3.5">
            <AreaChart
              points={capitalPoints}
              height={168}
              unit="SOL"
              format={{ decimals: 3 }}
              emptyLabel="Run the simulation to plot capital"
            />
            <p className="mt-2.5 font-mono text-3xs leading-relaxed text-ink-ghost">
              Reconstructed from the ledger: every transaction summed up to each cycle.
            </p>
          </div>
        </section>

        <SolanaPanel />
      </div>

      <ReplayPanel initialSnapshot={snapshot} compact />
    </div>
  );
}
