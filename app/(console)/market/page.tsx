import { AreaChart, RankedBars, StatusBar } from '@/components/charts';
import { ConsoleHeader, EmptyConsole } from '@/components/console/page-header';
import { ACTION_DEFINITIONS } from '@/config/simulation';
import { getActionEconomics, getMarketSeries } from '@/lib/repo/analytics';
import { getActiveSimulation, getSimulationConfig } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Market' };

export default async function MarketPage() {
  const simulation = await getActiveSimulation();
  if (!simulation) {
    return (
      <>
        <ConsoleHeader eyebrow="Conditions & returns" title="Market" />
        <EmptyConsole
          title="No market data"
          description="The market page measures what each economic action actually returned across the run."
        />
      </>
    );
  }

  const [actions, market, config] = await Promise.all([
    getActionEconomics(simulation.id),
    getMarketSeries(simulation.id, simulation.cycle),
    getSimulationConfig(simulation.id),
  ]);

  const current = market.at(-1);
  const totalActions = actions.reduce((sum, a) => sum + a.count, 0);
  const outcomes = actions.reduce(
    (acc, a) => ({
      success: acc.success + a.successRate * a.count,
      partial: acc.partial + a.partialRate * a.count,
      failure: acc.failure + a.failureRate * a.count,
    }),
    { success: 0, partial: 0, failure: 0 },
  );

  return (
    <>
      <ConsoleHeader
        eyebrow={`${totalActions.toLocaleString()} actions executed`}
        title="Market"
        description="Conditions oscillate on a fixed cycle and are identical across seeds, so runs stay comparable. Everything below is measured from the action log — not from the configured ranges."
        actions={
          current && (
            <span className="chip chip-active">
              {current.label} · ×{current.multiplier.toFixed(2)}
            </span>
          )
        }
      />

      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Market multiplier</h2>
            <span className="font-mono text-3xs text-ink-ghost">
              period {config.MARKET_PERIOD_CYCLES} cycles · amplitude ±
              {(config.MARKET_AMPLITUDE * 100).toFixed(0)}%
            </span>
          </div>
          <div className="p-3.5">
            <AreaChart
              points={market.map((m) => ({ x: m.cycle, y: m.multiplier }))}
              height={150}
              unit="×"
              zeroBased={false}
              format={{ decimals: 3 }}
            />
            <p className="mt-2.5 font-mono text-3xs leading-relaxed text-ink-ghost">
              Scales revenue and nudges success probability. A conservative genome that looks
              mediocre in a boom is often the one that survives the recession.
            </p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Outcome distribution</h2>
          </div>
          <div className="p-3.5">
            <StatusBar
              segments={[
                { label: 'Success', value: outcomes.success, tone: 'var(--viz-good)' },
                { label: 'Partial', value: outcomes.partial, tone: 'var(--viz-warn)' },
                { label: 'Failure', value: outcomes.failure, tone: 'var(--viz-bad)' },
              ]}
            />
            <p className="mt-4 font-mono text-3xs leading-relaxed text-ink-ghost">
              Success probability is capped at 88%. Nothing in this economy is a sure thing.
            </p>
          </div>
        </section>
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Mean net per execution</h2>
            <span className="font-mono text-3xs text-ink-ghost">SOL</span>
          </div>
          <div className="p-3.5">
            <RankedBars
              rows={actions.map((a) => ({
                label: a.type.replace(/_/g, ' '),
                value: a.meanNetSol,
                sub: `${a.count} executions · ${(a.successRate * 100).toFixed(0)}% success`,
              }))}
              format={{ decimals: 4, signed: true }}
            />
            <p className="mt-3.5 font-mono text-3xs leading-relaxed text-ink-ghost">
              The number that decides whether an action is worth taking. Identity comes from the
              row label, so a single hue is used rather than a colour per category.
            </p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Action ledger</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-b border-line">
                  {['Action', 'Risk', 'N', 'Success', 'Revenue', 'Cost', 'Net'].map((head) => (
                    <th key={head} className="label px-3 py-2 font-medium">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {actions.map((action) => (
                  <tr key={action.type} className="row-hover">
                    <td className="px-3 py-2">
                      <div className="font-mono text-3xs text-ink">
                        {action.type.replace(/_/g, ' ')}
                      </div>
                      <div className="font-mono text-3xs text-ink-ghost">
                        {ACTION_DEFINITIONS[action.type].label}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-3xs text-ink-muted">{action.risk}</td>
                    <td className="tabular px-3 py-2 font-mono text-3xs text-ink-muted">
                      {action.count}
                    </td>
                    <td className="tabular px-3 py-2 font-mono text-3xs text-ink-muted">
                      {(action.successRate * 100).toFixed(0)}%
                    </td>
                    <td className="tabular px-3 py-2 font-mono text-3xs text-ink">
                      {action.revenueSol.toFixed(2)}
                    </td>
                    <td className="tabular px-3 py-2 font-mono text-3xs text-ink-muted">
                      {action.costSol.toFixed(2)}
                    </td>
                    <td
                      className={`tabular px-3 py-2 font-mono text-3xs ${
                        action.netSol >= 0 ? 'text-good' : 'text-bad'
                      }`}
                    >
                      {action.netSol >= 0 ? '+' : ''}
                      {action.netSol.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
