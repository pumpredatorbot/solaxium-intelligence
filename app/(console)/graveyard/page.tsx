import Link from 'next/link';
import { AgentLink, EmptyState, PageHeader, Panel, Stat } from '@/components/ui';
import { getActiveSimulation, listAgents } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Graveyard' };

const SORTS = [
  { key: 'profit', label: 'Most profitable' },
  { key: 'lifetime', label: 'Longest life' },
  { key: 'capital', label: 'Highest capital reached' },
  { key: 'clones', label: 'Most clones' },
  { key: 'code', label: 'Generation' },
] as const;

export default async function GraveyardPage({
  searchParams,
}: {
  searchParams: Promise<{ orderBy?: string; simulationId?: string }>;
}) {
  const params = await searchParams;
  const simulation = await getActiveSimulation(params.simulationId);

  if (!simulation) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-10">
        <PageHeader eyebrow="The dead" title="Graveyard" />
        <div className="mt-8">
          <EmptyState
            title="Nothing has died yet"
            description="No simulation has been run on this instance."
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

  const { agents, total } = await listAgents(simulation.id, simulation.cycle, {
    status: 'DEAD',
    orderBy: (params.orderBy as never) ?? 'profit',
    limit: 300,
  });

  const summary = agents.reduce(
    (acc, agent) => ({
      revenue: acc.revenue + agent.totalRevenueSol,
      expenses: acc.expenses + agent.totalExpensesSol,
      cycles: acc.cycles + agent.cycles,
      clones: acc.clones + agent.clonesCreated,
    }),
    { revenue: 0, expenses: 0, cycles: 0, clones: 0 },
  );

  const href = (orderBy: string) =>
    `/graveyard?orderBy=${orderBy}${params.simulationId ? `&simulationId=${params.simulationId}` : ''}`;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10">
      <PageHeader
        eyebrow={`${total} dead · cycle ${simulation.cycle}`}
        title="Graveyard"
        description="Every intelligence that ran out of capital. Their history is kept; their lineage may not have survived them."
      />

      {total === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No casualties yet"
            description="Every agent in this simulation is still solvent. Give it time — upkeep is charged every cycle."
          />
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Dead agents" value={String(total)} tone="danger" />
            <Stat label="Revenue earned before death" value={summary.revenue.toFixed(3)} unit="SOL" />
            <Stat label="Total cycles lived" value={String(summary.cycles)} />
            <Stat label="Offspring left behind" value={String(summary.clones)} />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">Sort</span>
            {SORTS.map((sort) => (
              <Link
                key={sort.key}
                href={href(sort.key)}
                className={`chip ${(params.orderBy ?? 'profit') === sort.key ? 'border-sol-deep text-sol' : ''}`}
              >
                {sort.label}
              </Link>
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <Panel key={agent.id} bodyClassName="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <AgentLink code={agent.code} id={agent.id} className="text-sm" />
                    <div className="mt-0.5 text-2xs text-ink-faint">{agent.name}</div>
                  </div>
                  <span className="font-mono text-2xs uppercase tracking-wider text-danger">
                    💀 Dead
                  </span>
                </div>

                <dl className="mt-4 space-y-1.5">
                  {[
                    ['Final capital', `${agent.capitalSol.toFixed(4)} SOL`],
                    ['Peak capital', `${agent.peakCapitalSol.toFixed(4)} SOL`],
                    ['Total revenue', `${agent.totalRevenueSol.toFixed(4)} SOL`],
                    ['Total expenses', `${agent.totalExpensesSol.toFixed(4)} SOL`],
                    [
                      'Profit',
                      `${agent.totalProfitSol >= 0 ? '+' : ''}${agent.totalProfitSol.toFixed(4)} SOL`,
                    ],
                    ['Cycles', String(agent.cycles)],
                    ['Lifetime', `${agent.lifetimeCycles} cycles`],
                    ['Generation', String(agent.generation)],
                    ['Clones', String(agent.clonesCreated)],
                    ['Strategy', agent.strategy],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3">
                      <dt className="label">{label}</dt>
                      <dd className="tabular font-mono text-2xs text-ink-muted">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
