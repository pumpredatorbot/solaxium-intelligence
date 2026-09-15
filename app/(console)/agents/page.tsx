import Link from 'next/link';
import { AgentLink, EmptyState, PageHeader, Panel, StatusDot } from '@/components/ui';
import { getActiveSimulation, listAgents, listGenerations } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Agents' };

const ORDERS = [
  { key: 'capital', label: 'Capital' },
  { key: 'profit', label: 'Profit' },
  { key: 'roi', label: 'ROI' },
  { key: 'lifetime', label: 'Cycles' },
  { key: 'clones', label: 'Clones' },
  { key: 'code', label: 'ID' },
] as const;

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'ALIVE', label: 'Alive' },
  { key: 'DEAD', label: 'Dead' },
] as const;

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; orderBy?: string; generation?: string; simulationId?: string }>;
}) {
  const params = await searchParams;
  const simulation = await getActiveSimulation(params.simulationId);

  if (!simulation) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-10">
        <PageHeader eyebrow="Population" title="Agents" />
        <div className="mt-8">
          <EmptyState
            title="No population"
            description="No simulation has been run yet, so there are no agents to inspect."
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

  const [{ agents, total }, generations] = await Promise.all([
    listAgents(simulation.id, simulation.cycle, {
      status: params.status === 'ALIVE' || params.status === 'DEAD' ? params.status : undefined,
      generation: params.generation ? Number(params.generation) : undefined,
      orderBy: (params.orderBy as never) ?? 'capital',
      limit: 200,
    }),
    listGenerations(simulation.id),
  ]);

  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { ...params, ...patch };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, String(value));
    }
    const query = next.toString();
    return query ? `/agents?${query}` : '/agents';
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10">
      <PageHeader
        eyebrow={`${total} agents · cycle ${simulation.cycle}`}
        title="Agents"
        description="Every intelligence this simulation has produced, alive or dead."
      />

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-1.5">
          <span className="label mr-1">Status</span>
          {FILTERS.map((filter) => (
            <Link
              key={filter.key || 'all'}
              href={href({ status: filter.key || undefined })}
              className={`chip ${(params.status ?? '') === filter.key ? 'border-sol-deep text-sol' : ''}`}
            >
              {filter.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label mr-1">Sort</span>
          {ORDERS.map((order) => (
            <Link
              key={order.key}
              href={href({ orderBy: order.key })}
              className={`chip ${(params.orderBy ?? 'capital') === order.key ? 'border-sol-deep text-sol' : ''}`}
            >
              {order.label}
            </Link>
          ))}
        </div>

        {generations.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">Gen</span>
            <Link href={href({ generation: undefined })} className={`chip ${!params.generation ? 'border-sol-deep text-sol' : ''}`}>
              All
            </Link>
            {generations.map((g) => (
              <Link
                key={g.number}
                href={href({ generation: String(g.number) })}
                className={`chip ${params.generation === String(g.number) ? 'border-sol-deep text-sol' : ''}`}
              >
                G{g.number}
              </Link>
            ))}
          </div>
        )}
      </div>

      <Panel className="mt-6" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-line text-2xs uppercase tracking-widest2 text-ink-faint">
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Strategy</th>
                <th className="px-4 py-3 text-right font-medium">Gen</th>
                <th className="px-4 py-3 text-right font-medium">Capital</th>
                <th className="px-4 py-3 text-right font-medium">Revenue</th>
                <th className="px-4 py-3 text-right font-medium">Expenses</th>
                <th className="px-4 py-3 text-right font-medium">Profit</th>
                <th className="px-4 py-3 text-right font-medium">ROI</th>
                <th className="px-4 py-3 text-right font-medium">Cycles</th>
                <th className="px-4 py-3 text-right font-medium">Clones</th>
                <th className="px-4 py-3 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {agents.map((agent) => (
                <tr key={agent.id} className="link-row">
                  <td className="px-4 py-2.5">
                    <AgentLink code={agent.code} id={agent.id} />
                    <div className="mt-0.5 text-2xs text-ink-faint">{agent.name}</div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-2xs text-ink-muted">{agent.strategy}</td>
                  <td className="tabular px-4 py-2.5 text-right font-mono text-xs text-ink-muted">
                    {agent.generation}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right font-mono text-xs text-ink">
                    {agent.capitalSol.toFixed(4)}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right font-mono text-xs text-ink-muted">
                    {agent.totalRevenueSol.toFixed(4)}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right font-mono text-xs text-ink-muted">
                    {agent.totalExpensesSol.toFixed(4)}
                  </td>
                  <td
                    className={`tabular px-4 py-2.5 text-right font-mono text-xs ${agent.totalProfitSol >= 0 ? 'text-sol' : 'text-danger'}`}
                  >
                    {agent.totalProfitSol >= 0 ? '+' : ''}
                    {agent.totalProfitSol.toFixed(4)}
                  </td>
                  <td
                    className={`tabular px-4 py-2.5 text-right font-mono text-xs ${agent.roi >= 0 ? 'text-ink-muted' : 'text-danger'}`}
                  >
                    {(agent.roi * 100).toFixed(0)}%
                  </td>
                  <td className="tabular px-4 py-2.5 text-right font-mono text-xs text-ink-muted">
                    {agent.cycles}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right font-mono text-xs text-ink-muted">
                    {agent.clonesCreated}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <StatusDot status={agent.status} />
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
