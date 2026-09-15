import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentLink, PageHeader, Panel, Stat, StatusDot, TraitBar } from '@/components/ui';
import { AreaChart } from '@/components/charts';
import { STRATEGY_DESCRIPTIONS } from '@/lib/engine/strategy';
import type { StrategyLabel } from '@/config/simulation';
import { prisma } from '@/lib/db';
import { getAgentDetail } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id }, select: { code: true } });
  return { title: agent?.code ?? 'Agent' };
}

const OUTCOME_TONE: Record<string, string> = {
  SUCCESS: 'text-sol',
  PARTIAL: 'text-warn',
  FAILURE: 'text-danger',
};

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const row = await prisma.agent.findUnique({
    where: { id },
    select: { simulation: { select: { cycle: true, id: true } } },
  });
  if (!row) notFound();

  const detail = await getAgentDetail(id, row.simulation.cycle);
  if (!detail) notFound();

  const { agent, traits, parent, children, actions, transactions, memory, capitalSeries, wallet, mutations } =
    detail;

  const dead = agent.status === 'DEAD';

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10">
      <PageHeader
        eyebrow={`Generation ${agent.generation} · ${agent.name}`}
        title={agent.code}
        description={
          STRATEGY_DESCRIPTIONS[agent.strategy as StrategyLabel] ??
          'No dominant strategy recorded.'
        }
        actions={
          <>
            <StatusDot status={agent.status} />
            <Link href="/agents" className="btn">
              All agents
            </Link>
          </>
        }
      />

      {dead && (
        <div className="mt-6 rounded-lg border border-danger/25 bg-danger/[0.04] px-5 py-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <span className="font-mono text-sm uppercase tracking-widest2 text-danger">
              💀 Dead
            </span>
            <span className="font-mono text-2xs text-ink-muted">
              Died at cycle {agent.diedAtCycle} after {agent.lifetimeCycles} cycles of life
              {agent.diedAt ? ` · ${new Date(agent.diedAt).toISOString().slice(0, 16).replace('T', ' ')}` : ''}
            </span>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={dead ? 'Final capital' : 'Capital'}
          value={agent.capitalSol.toFixed(4)}
          unit="SOL"
          tone={dead ? 'danger' : 'sol'}
        />
        <Stat label="Total revenue" value={agent.totalRevenueSol.toFixed(4)} unit="SOL" />
        <Stat label="Total expenses" value={agent.totalExpensesSol.toFixed(4)} unit="SOL" />
        <Stat
          label="Profit"
          value={`${agent.totalProfitSol >= 0 ? '+' : ''}${agent.totalProfitSol.toFixed(4)}`}
          unit="SOL"
          tone={agent.totalProfitSol >= 0 ? 'sol' : 'danger'}
        />
        <Stat label="ROI" value={`${(agent.roi * 100).toFixed(1)}%`} />
        <Stat label="Cycles" value={String(agent.cycles)} hint={`Lifetime ${agent.lifetimeCycles}`} />
        <Stat label="Peak capital" value={agent.peakCapitalSol.toFixed(4)} unit="SOL" />
        <Stat label="Clones" value={String(agent.clonesCreated)} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel title="Capital over time" className="lg:col-span-2" bodyClassName="p-5">
          <AreaChart
            points={capitalSeries.map((p) => ({ x: p.cycle, y: p.capitalSol }))}
            tone={dead ? 'danger' : 'sol'}
            height={160}
            label={`${agent.code} capital`}
          />
          <div className="mt-3 flex justify-between font-mono text-2xs text-ink-faint">
            <span>cycle {capitalSeries[0]?.cycle ?? 0}</span>
            <span>cycle {capitalSeries.at(-1)?.cycle ?? 0}</span>
          </div>
        </Panel>

        <Panel title="Lineage" bodyClassName="p-5">
          <div className="space-y-4">
            <div>
              <div className="label mb-1.5">Parent</div>
              {parent ? (
                <div className="flex items-center gap-2">
                  <AgentLink code={parent.code} id={parent.id} />
                  <span className="chip">G{parent.generation}</span>
                </div>
              ) : (
                <span className="font-mono text-xs text-ink-faint">ORIGIN</span>
              )}
            </div>

            <div>
              <div className="label mb-1.5">Children ({children.length})</div>
              {children.length === 0 ? (
                <span className="font-mono text-2xs text-ink-faint">No offspring</span>
              ) : (
                <ul className="space-y-1.5">
                  {children.map((child) => (
                    <li key={child.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AgentLink code={child.code} id={child.id} />
                        <span className="chip">G{child.generation}</span>
                      </div>
                      <span
                        className={`tabular font-mono text-2xs ${child.status === 'ALIVE' ? 'text-sol' : 'text-danger/80'}`}
                      >
                        {child.capitalSol.toFixed(3)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {wallet && (
              <div>
                <div className="label mb-1.5">Wallet ({wallet.network})</div>
                <code className="block break-all font-mono text-2xs text-ink-faint">
                  {wallet.publicAddress}
                </code>
                <p className="mt-1.5 text-2xs leading-relaxed text-ink-faint">
                  Virtual address. No keypair exists for this agent.
                </p>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel title="Traits" bodyClassName="p-5">
          <div className="space-y-3">
            {Object.entries(traits).map(([key, value]) => (
              <TraitBar key={key} name={key} value={value} />
            ))}
          </div>
          {mutations && mutations.length > 0 && (
            <div className="mt-6 border-t border-line pt-4">
              <div className="label mb-2.5">Mutations at birth</div>
              <ul className="space-y-1.5">
                {mutations.map((m) => (
                  <li key={m.trait} className="flex items-center justify-between font-mono text-2xs">
                    <span className="text-ink-faint">{m.trait}</span>
                    <span className="tabular text-ink-muted">
                      {m.from.toFixed(3)} → {m.to.toFixed(3)}{' '}
                      <span className={m.delta >= 0 ? 'text-sol' : 'text-danger'}>
                        ({m.delta >= 0 ? '+' : ''}
                        {m.delta.toFixed(3)})
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Memory" className="lg:col-span-2" bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {memory.length === 0 ? (
              <li className="px-4 py-6 text-center text-2xs text-ink-faint">No memories yet.</li>
            ) : (
              memory.map((m, index) => (
                <li key={index} className="flex gap-3 px-4 py-2.5 font-mono text-2xs">
                  <span className="tabular w-9 shrink-0 text-ink-faint">c{m.cycle}</span>
                  <span className="w-16 shrink-0 uppercase tracking-wider text-ink-faint">
                    {m.kind}
                  </span>
                  <span className="flex-1 leading-relaxed text-ink-muted">{m.content}</span>
                </li>
              ))
            )}
          </ul>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Panel title="Recent decisions" bodyClassName="p-0">
          <div className="max-h-[520px] overflow-y-auto">
            <ul className="divide-y divide-line">
              {actions.length === 0 ? (
                <li className="px-4 py-6 text-center text-2xs text-ink-faint">
                  No actions recorded.
                </li>
              ) : (
                actions.map((action) => (
                  <li key={action.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs">
                      <span className="tabular text-ink-faint">c{action.cycle}</span>
                      <span className="uppercase tracking-wider text-ink">{action.type}</span>
                      <span className={`uppercase ${OUTCOME_TONE[action.outcome]}`}>
                        {action.outcome}
                      </span>
                      <span className="chip">{action.riskLevel}</span>
                      <span className="ml-auto tabular text-ink-muted">
                        −{action.costSol.toFixed(3)} / +{action.revenueSol.toFixed(3)}
                      </span>
                      <span
                        className={`tabular w-16 text-right ${action.netSol >= 0 ? 'text-sol' : 'text-danger'}`}
                      >
                        {action.netSol >= 0 ? '+' : ''}
                        {action.netSol.toFixed(3)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-2xs leading-relaxed text-ink-faint">
                      {action.reasoning}
                    </p>
                    <div className="mt-1 font-mono text-2xs text-ink-faint/70">
                      {action.provider} · confidence {(action.confidence * 100).toFixed(0)}%
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </Panel>

        <Panel title="Ledger" bodyClassName="p-0">
          <div className="max-h-[520px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-2xs uppercase tracking-widest2 text-ink-faint">
                  <th className="px-4 py-2.5 font-medium">Cycle</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="tabular px-4 py-2 font-mono text-2xs text-ink-faint">
                      c{tx.cycle}
                    </td>
                    <td className="px-4 py-2 font-mono text-2xs uppercase tracking-wider text-ink-muted">
                      {tx.type.replace(/_/g, ' ')}
                    </td>
                    <td
                      className={`tabular px-4 py-2 text-right font-mono text-2xs ${tx.amountSol >= 0 ? 'text-sol' : 'text-danger'}`}
                    >
                      {tx.amountSol >= 0 ? '+' : ''}
                      {tx.amountSol.toFixed(4)}
                    </td>
                    <td className="tabular px-4 py-2 text-right font-mono text-2xs text-ink">
                      {tx.balanceAfterSol.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
