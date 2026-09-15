import Link from 'next/link';
import { AreaChart, ColumnChart, Sparkline } from '@/components/charts';
import { ConsoleHeader, EmptyConsole } from '@/components/console/page-header';
import { TRAIT_KEYS } from '@/config/simulation';
import { getCycleSeries, getSurvivalStats, getTraitEvolution } from '@/lib/repo/analytics';
import { getActiveSimulation, listGenerations } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analytics' };

export default async function AnalyticsPage() {
  const simulation = await getActiveSimulation();
  if (!simulation) {
    return (
      <>
        <ConsoleHeader eyebrow="Population research" title="Analytics" />
        <EmptyConsole
          title="No data"
          description="Analytics compares cohorts: survival, lifetime, clone rate, and how the genome drifts from one generation to the next."
        />
      </>
    );
  }

  const [series, traits, survival, generations] = await Promise.all([
    getCycleSeries(simulation.id),
    getTraitEvolution(simulation.id),
    getSurvivalStats(simulation.id, simulation.cycle),
    listGenerations(simulation.id),
  ]);

  const founders = traits.find((t) => t.generation === 0);
  const latest = traits.at(-1);

  return (
    <>
      <ConsoleHeader
        eyebrow={`${generations.length} generations · cycle ${simulation.cycle}`}
        title="Analytics"
        description="Survival rate is the honest cross-generation measure: later cohorts are younger, so their accumulated profit is necessarily smaller. Trait means are the direct evidence of whether selection is moving the population."
        actions={
          <div className="flex gap-2">
            <Link href="/evolution" className="btn">
              Family tree
            </Link>
            <Link href="/leaderboard" className="btn">
              Leaderboard
            </Link>
            <Link href="/graveyard" className="btn">
              Graveyard
            </Link>
          </div>
        }
      />

      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Survival rate by generation</h2>
            <span className="font-mono text-3xs text-ink-ghost">% still alive</span>
          </div>
          <div className="p-3.5">
            <ColumnChart
              bars={survival.map((s) => ({
                label: `G${s.generation}`,
                value: s.survivalRate * 100,
                title: `Generation ${s.generation}: ${(s.survivalRate * 100).toFixed(0)}% of ${s.agentCount} agents alive`,
              }))}
              format={{ decimals: 0, suffix: '%' }}
              tone="var(--viz-good)"
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Average lifetime by generation</h2>
            <span className="font-mono text-3xs text-ink-ghost">cycles</span>
          </div>
          <div className="p-3.5">
            <ColumnChart
              bars={survival.map((s) => ({
                label: `G${s.generation}`,
                value: s.avgLifetimeCycles,
                title: `Generation ${s.generation}: ${s.avgLifetimeCycles.toFixed(1)} cycles mean lifetime`,
              }))}
              format={{ decimals: 1 }}
            />
          </div>
        </section>
      </div>

      {/* --- trait evolution: small multiples ----------------------------- */}
      <section className="panel mt-3">
        <div className="panel-head">
          <h2 className="label">Trait evolution across generations</h2>
          <span className="font-mono text-3xs text-ink-ghost">
            mean value per cohort · 0 → 1
          </span>
        </div>
        <div className="p-3.5">
          {traits.length < 2 ? (
            <p className="py-8 text-center font-mono text-2xs text-ink-faint">
              Trait drift appears once the population reaches a second generation.
            </p>
          ) : (
            <>
              <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
                {TRAIT_KEYS.map((key) => {
                  const points = traits.map((t) => t.traits[key] ?? 0.5);
                  const from = points[0];
                  const to = points.at(-1)!;
                  const delta = to - from;
                  return (
                    <div key={key} className="rounded border border-line bg-raised/30 p-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-mono text-3xs uppercase tracking-wider text-ink-muted">
                          {key.replace(/([A-Z])/g, ' $1')}
                        </span>
                        <span
                          className={`tabular font-mono text-3xs ${
                            Math.abs(delta) < 0.02
                              ? 'text-ink-ghost'
                              : delta > 0
                                ? 'text-good'
                                : 'text-bad'
                          }`}
                        >
                          {delta >= 0 ? '+' : ''}
                          {delta.toFixed(3)}
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <Sparkline points={points} width={190} height={30} />
                      </div>
                      <div className="tabular mt-1 flex justify-between font-mono text-3xs text-ink-ghost">
                        <span>G0 {from.toFixed(2)}</span>
                        <span>
                          G{traits.at(-1)!.generation} {to.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {founders && latest && (
                <p className="mt-4 font-mono text-3xs leading-relaxed text-ink-ghost">
                  Each panel is one trait, plotted generation 0 → {latest.generation}. Nothing tells
                  the population which traits pay; alignment between a genome and an action makes a
                  well-matched agent genuinely richer, and richer agents are the ones that reproduce.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Population over time</h2>
            <span className="font-mono text-3xs text-ink-ghost">live agents</span>
          </div>
          <div className="p-3.5">
            <AreaChart
              points={series.map((p) => ({ x: p.cycle, y: p.alive }))}
              height={150}
              unit="live"
              format={{ decimals: 0 }}
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Clone rate by generation</h2>
            <span className="font-mono text-3xs text-ink-ghost">offspring per agent</span>
          </div>
          <div className="p-3.5">
            <ColumnChart
              bars={survival.map((s) => ({
                label: `G${s.generation}`,
                value: s.cloneRate,
                title: `Generation ${s.generation}: ${s.cloneRate.toFixed(2)} offspring per agent`,
              }))}
              format={{ decimals: 2 }}
            />
          </div>
        </section>
      </div>

      <section className="panel mt-3">
        <div className="panel-head">
          <h2 className="label">Generation ledger</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-line">
                {['Generation', 'Agents', 'Alive', 'Dead', 'Survival', 'Avg capital', 'Avg profit', 'Best'].map(
                  (head) => (
                    <th key={head} className="label px-3 py-2 font-medium">
                      {head}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {generations.map((generation) => (
                <tr key={generation.number} className="row-hover">
                  <td className="px-3 py-2">
                    <Link
                      href={`/agents?generation=${generation.number}`}
                      className="font-mono text-3xs text-ink transition-colors hover:text-cy"
                    >
                      GENERATION {generation.number}
                    </Link>
                  </td>
                  <td className="tabular px-3 py-2 font-mono text-3xs text-ink">
                    {generation.agentCount}
                  </td>
                  <td className="tabular px-3 py-2 font-mono text-3xs text-good">
                    {generation.aliveCount}
                  </td>
                  <td className="tabular px-3 py-2 font-mono text-3xs text-bad">
                    {generation.deadCount}
                  </td>
                  <td className="tabular px-3 py-2 font-mono text-3xs text-ink-muted">
                    {(generation.survivalRate * 100).toFixed(0)}%
                  </td>
                  <td className="tabular px-3 py-2 font-mono text-3xs text-ink">
                    {generation.averageCapitalSol.toFixed(4)}
                  </td>
                  <td
                    className={`tabular px-3 py-2 font-mono text-3xs ${
                      generation.averageProfitSol >= 0 ? 'text-good' : 'text-bad'
                    }`}
                  >
                    {generation.averageProfitSol >= 0 ? '+' : ''}
                    {generation.averageProfitSol.toFixed(4)}
                  </td>
                  <td className="px-3 py-2">
                    {generation.bestAgentId && generation.bestAgentCode ? (
                      <Link
                        href={`/agents/${generation.bestAgentId}`}
                        className="font-mono text-3xs text-ink transition-colors hover:text-cy"
                      >
                        {generation.bestAgentCode}
                      </Link>
                    ) : (
                      <span className="font-mono text-3xs text-ink-ghost">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
