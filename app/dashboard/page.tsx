import Link from 'next/link';
import { AgentLink, EmptyState, PageHeader, Panel, Stat, StatusDot } from '@/components/ui';
import { BarChart } from '@/components/charts';
import { ActivityFeed } from '@/components/activity-feed';
import {
  getActiveSimulation,
  getDashboardStats,
  listAgents,
  listEvents,
  listGenerations,
} from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ simulationId?: string }>;
}) {
  const { simulationId } = await searchParams;
  const simulation = await getActiveSimulation(simulationId);

  if (!simulation) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-10">
        <PageHeader eyebrow="Overview" title="Dashboard" />
        <div className="mt-8">
          <EmptyState
            title="No simulation yet"
            description="Nothing has been run on this instance. Create a simulation and the population will start earning, dying and reproducing."
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

  const [stats, generations, top, events] = await Promise.all([
    getDashboardStats(simulation.id, simulation.cycle),
    listGenerations(simulation.id),
    listAgents(simulation.id, simulation.cycle, { orderBy: 'capital', limit: 8 }),
    listEvents(simulation.id, { limit: 40 }),
  ]);

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10">
      <PageHeader
        eyebrow={`${simulation.name} · seed ${simulation.seed}`}
        title="Dashboard"
        description={`Cycle ${simulation.cycle}. Every figure below is denominated in simulated SOL and derived from the economic ledger.`}
        actions={
          <>
            <span className="chip">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  simulation.status === 'RUNNING' ? 'bg-sol animate-pulse-soft' : 'bg-ink-faint'
                }`}
              />
              {simulation.status}
            </span>
            <Link href="/simulation" className="btn">
              Controls
            </Link>
          </>
        }
      />

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Live agents" value={String(stats.liveAgents)} tone="sol" />
        <Stat label="Dead agents" value={String(stats.deadAgents)} tone="danger" />
        <Stat
          label="Total capital"
          value={stats.totalCapitalSol.toFixed(3)}
          unit="SOL"
        />
        <Stat
          label="Total revenue"
          value={stats.totalRevenueSol.toFixed(3)}
          unit="SOL"
        />
        <Stat
          label="Total profit"
          value={stats.totalProfitSol.toFixed(3)}
          unit="SOL"
          tone={stats.totalProfitSol >= 0 ? 'sol' : 'danger'}
        />
        <Stat label="Generations" value={String(stats.generations)} />
        <Stat label="Total clones" value={String(stats.totalClones)} />
        <Stat
          label="Survival rate"
          value={`${(stats.survivalRate * 100).toFixed(1)}%`}
          hint={`${stats.liveAgents} of ${stats.totalAgents} agents`}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel
          title="Average profit by generation"
          className="lg:col-span-2"
          bodyClassName="p-5"
        >
          {generations.length > 0 ? (
            <BarChart
              bars={generations.map((g) => ({
                label: `G${g.number}`,
                value: g.averageProfitSol,
              }))}
              format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(3)} SOL`}
            />
          ) : (
            <div className="text-2xs text-ink-faint">No generations recorded yet.</div>
          )}
          <p className="mt-4 text-2xs leading-relaxed text-ink-faint">
            Later generations are younger, so a lower bar is not necessarily a worse genome — see
            the generations page for survival rates, which are age-adjusted.
          </p>
        </Panel>

        <Panel title="Best performer" bodyClassName="p-5">
          {stats.bestAgent ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <AgentLink code={stats.bestAgent.code} id={stats.bestAgent.id} className="text-sm" />
                <StatusDot status={stats.bestAgent.status} />
              </div>
              <div className="space-y-2.5">
                {[
                  ['Capital', `${stats.bestAgent.capitalSol.toFixed(4)} SOL`],
                  ['Profit', `${stats.bestAgent.totalProfitSol >= 0 ? '+' : ''}${stats.bestAgent.totalProfitSol.toFixed(4)} SOL`],
                  ['ROI', `${(stats.bestAgent.roi * 100).toFixed(1)}%`],
                  ['Generation', String(stats.bestAgent.generation)],
                  ['Cycles', String(stats.bestAgent.cycles)],
                  ['Clones', String(stats.bestAgent.clonesCreated)],
                  ['Strategy', stats.bestAgent.strategy],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <span className="label">{label}</span>
                    <span className="tabular font-mono text-xs text-ink">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-2xs text-ink-faint">No agents yet.</div>
          )}
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel
          title="Top agents by capital"
          bodyClassName="p-0"
          action={
            <Link href="/agents" className="label transition-colors hover:text-ink">
              All agents →
            </Link>
          }
        >
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line text-2xs uppercase tracking-widest2 text-ink-faint">
                <th className="px-4 py-2.5 font-medium">Agent</th>
                <th className="px-4 py-2.5 font-medium">Gen</th>
                <th className="px-4 py-2.5 text-right font-medium">Capital</th>
                <th className="px-4 py-2.5 text-right font-medium">Profit</th>
                <th className="px-4 py-2.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {top.agents.map((agent) => (
                <tr key={agent.id} className="link-row">
                  <td className="px-4 py-2.5">
                    <AgentLink code={agent.code} id={agent.id} />
                    <div className="mt-0.5 text-2xs text-ink-faint">{agent.strategy}</div>
                  </td>
                  <td className="tabular px-4 py-2.5 font-mono text-xs text-ink-muted">
                    {agent.generation}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right font-mono text-xs text-ink">
                    {agent.capitalSol.toFixed(4)}
                  </td>
                  <td
                    className={`tabular px-4 py-2.5 text-right font-mono text-xs ${
                      agent.totalProfitSol >= 0 ? 'text-sol' : 'text-danger'
                    }`}
                  >
                    {agent.totalProfitSol >= 0 ? '+' : ''}
                    {agent.totalProfitSol.toFixed(4)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <StatusDot status={agent.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Activity" bodyClassName="p-0">
          <ActivityFeed
            simulationId={simulation.id}
            initialEvents={events}
            live={simulation.status === 'RUNNING'}
            height="h-[420px]"
          />
        </Panel>
      </div>
    </div>
  );
}
