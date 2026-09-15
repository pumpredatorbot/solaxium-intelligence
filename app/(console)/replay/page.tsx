import { ConsoleHeader, EmptyConsole } from '@/components/console/page-header';
import { ReplayPanel } from '@/components/console/replay-panel';
import { AreaChart } from '@/components/charts';
import { getCycleSeries } from '@/lib/repo/analytics';
import { getReplaySnapshot } from '@/lib/repo/replay';
import { getActiveSimulation } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Replay' };

export default async function ReplayPage() {
  const simulation = await getActiveSimulation();
  if (!simulation) {
    return (
      <>
        <ConsoleHeader eyebrow="Deterministic history" title="Replay" />
        <EmptyConsole
          title="Nothing to replay"
          description="Replay reconstructs the population at any past cycle directly from the ledger."
        />
      </>
    );
  }

  const [snapshot, series] = await Promise.all([
    getReplaySnapshot(simulation.id, simulation.cycle),
    getCycleSeries(simulation.id),
  ]);

  return (
    <>
      <ConsoleHeader
        eyebrow={`seed ${simulation.seed} · ${simulation.cycle} cycles recorded`}
        title="Replay"
        description="Scrub to any cycle and the population is rebuilt from the append-only ledger — not from a stored checkpoint, so replay can never disagree with the live data. The same seed also reproduces the run byte-for-byte from scratch."
      />

      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <ReplayPanel initialSnapshot={snapshot} />

        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Determinism</h2>
          </div>
          <dl className="divide-y divide-line">
            {[
              ['Seed', simulation.seed],
              ['Cycles recorded', String(simulation.cycle)],
              ['Status', simulation.status],
              ['Started', simulation.startedAt ? simulation.startedAt.slice(0, 19).replace('T', ' ') : '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 px-3.5 py-2">
                <dt className="label">{label}</dt>
                <dd className="tabular truncate font-mono text-3xs text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-line px-3.5 py-3 font-mono text-3xs leading-relaxed text-ink-ghost">
            The generator is counter-based, so the entire RNG state is one integer persisted after
            every cycle. A paused run resumes on the exact same random stream.
          </p>
        </section>
      </div>

      <section className="panel mt-3">
        <div className="panel-head">
          <h2 className="label">Recorded timeline</h2>
          <span className="font-mono text-3xs text-ink-ghost">
            births and deaths per cycle
          </span>
        </div>
        <div className="grid gap-3 p-3.5 lg:grid-cols-2">
          <div>
            <div className="label mb-2">Births</div>
            <AreaChart
              points={series.map((p) => ({ x: p.cycle, y: p.born }))}
              height={130}
              unit="agents"
              format={{ decimals: 0 }}
              tone="var(--viz-good)"
            />
          </div>
          <div>
            <div className="label mb-2">Deaths</div>
            <AreaChart
              points={series.map((p) => ({ x: p.cycle, y: p.died }))}
              height={130}
              unit="agents"
              format={{ decimals: 0 }}
              tone="var(--viz-bad)"
            />
          </div>
        </div>
      </section>
    </>
  );
}
