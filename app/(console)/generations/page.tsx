import Link from 'next/link';
import { AgentLink, EmptyState, PageHeader, Panel } from '@/components/ui';
import { ColumnChart } from '@/components/charts';
import { getActiveSimulation, listGenerations } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Generations' };

export default async function GenerationsPage({
  searchParams,
}: {
  searchParams: Promise<{ simulationId?: string }>;
}) {
  const { simulationId } = await searchParams;
  const simulation = await getActiveSimulation(simulationId);
  const generations = simulation ? await listGenerations(simulation.id) : [];

  if (!simulation || generations.length === 0) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-10">
        <PageHeader eyebrow="Lineage" title="Generations" />
        <div className="mt-8">
          <EmptyState
            title="No generations"
            description="Generations are recorded as agents reproduce. Run a simulation long enough for an agent to cross the clone threshold."
            action={
              <Link href="/simulation" className="btn btn-primary mt-2">
                Start simulation
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10">
      <PageHeader
        eyebrow={`${generations.length} generations · cycle ${simulation.cycle}`}
        title="Generations"
        description="Each cohort compared against the ones before it. Survival rate is the honest measure — later generations are younger, so their accumulated profit is necessarily smaller."
      />

      <div className="mt-8 grid gap-3 lg:grid-cols-2">
        <Panel title="Survival rate by generation" bodyClassName="p-5">
          <ColumnChart
            bars={generations.map((g) => ({
              label: `G${g.number}`,
              value: g.survivalRate * 100,
            }))}
            format={{ decimals: 0, suffix: '%' }}
          />
        </Panel>
        <Panel title="Average capital by generation" bodyClassName="p-5">
          <ColumnChart
            bars={generations.map((g) => ({
              label: `G${g.number}`,
              value: g.averageCapitalSol,
            }))}
            format={{ decimals: 3, suffix: ' SOL' }}
          />
        </Panel>
      </div>

      <Panel className="mt-3" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left">
            <thead>
              <tr className="border-b border-line text-2xs uppercase tracking-widest2 text-ink-faint">
                <th className="px-4 py-3 font-medium">Generation</th>
                <th className="px-4 py-3 text-right font-medium">Agents</th>
                <th className="px-4 py-3 text-right font-medium">Alive</th>
                <th className="px-4 py-3 text-right font-medium">Dead</th>
                <th className="px-4 py-3 text-right font-medium">Survival</th>
                <th className="px-4 py-3 text-right font-medium">Avg capital</th>
                <th className="px-4 py-3 text-right font-medium">Avg profit</th>
                <th className="px-4 py-3 text-right font-medium">Total revenue</th>
                <th className="px-4 py-3 text-right font-medium">Best</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {generations.map((g) => (
                <tr key={g.number} className="link-row">
                  <td className="px-4 py-3">
                    <Link
                      href={`/agents?generation=${g.number}`}
                      className="font-mono text-xs text-ink transition-colors hover:text-sol"
                    >
                      GENERATION {g.number}
                    </Link>
                    <div className="mt-0.5 text-2xs text-ink-faint">
                      opened cycle {g.startedAtCycle}
                      {g.endedAtCycle !== null ? ` · extinct cycle ${g.endedAtCycle}` : ''}
                    </div>
                  </td>
                  <td className="tabular px-4 py-3 text-right font-mono text-xs text-ink">
                    {g.agentCount}
                  </td>
                  <td className="tabular px-4 py-3 text-right font-mono text-xs text-sol">
                    {g.aliveCount}
                  </td>
                  <td className="tabular px-4 py-3 text-right font-mono text-xs text-danger/80">
                    {g.deadCount}
                  </td>
                  <td className="tabular px-4 py-3 text-right font-mono text-xs text-ink-muted">
                    {(g.survivalRate * 100).toFixed(0)}%
                  </td>
                  <td className="tabular px-4 py-3 text-right font-mono text-xs text-ink">
                    {g.averageCapitalSol.toFixed(4)}
                  </td>
                  <td
                    className={`tabular px-4 py-3 text-right font-mono text-xs ${g.averageProfitSol >= 0 ? 'text-sol' : 'text-danger'}`}
                  >
                    {g.averageProfitSol >= 0 ? '+' : ''}
                    {g.averageProfitSol.toFixed(4)}
                  </td>
                  <td className="tabular px-4 py-3 text-right font-mono text-xs text-ink-muted">
                    {g.totalRevenueSol.toFixed(3)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {g.bestAgentId && g.bestAgentCode ? (
                      <AgentLink code={g.bestAgentCode} id={g.bestAgentId} />
                    ) : (
                      <span className="font-mono text-2xs text-ink-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
