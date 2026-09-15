import { EngineRow } from '@/components/console/engine-panel';
import { ConsoleHeader, EmptyConsole } from '@/components/console/page-header';
import { TelemetryPanel } from '@/components/console/telemetry-panel';
import { listEngines } from '@/lib/repo/engines';
import { getActiveSimulation, getSimulationConfig } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Engines' };

export default async function EnginesPage() {
  const simulation = await getActiveSimulation();
  if (!simulation) {
    return (
      <>
        <ConsoleHeader eyebrow="Autonomous units" title="Engines" />
        <EmptyConsole
          title="No engines"
          description="Engines are the live view of each agent: what it decided, how confident it was, and how much runway it has left."
        />
      </>
    );
  }

  const config = await getSimulationConfig(simulation.id);
  const engines = await listEngines(simulation.id, {
    limit: 60,
    cycleCostSol: config.CYCLE_COST_SOL,
  });

  const byStatus = engines.reduce<Record<string, number>>((acc, engine) => {
    acc[engine.status] = (acc[engine.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <ConsoleHeader
        eyebrow={`${engines.length} units · cycle ${simulation.cycle}`}
        title="Engines"
        description="Each engine is one autonomous agent. Status is read from its most recent recorded action, and runway is its capital divided by the per-cycle upkeep — the number of cycles it survives if it earns nothing."
        actions={
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(byStatus).map(([status, count]) => (
              <span key={status} className="chip">
                {status} <span className="tabular text-ink">{count}</span>
              </span>
            ))}
          </div>
        }
      />

      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {engines.map((engine) => (
            <EngineRow key={engine.id} engine={engine} />
          ))}
        </div>
        <div className="xl:sticky xl:top-[72px] xl:h-fit">
          <TelemetryPanel height="h-[calc(100vh-176px)]" />
        </div>
      </div>
    </>
  );
}
