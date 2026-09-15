import Link from 'next/link';
import { AreaChart, RankedBars } from '@/components/charts';
import { ConsoleHeader, EmptyConsole } from '@/components/console/page-header';
import { getCycleSeries, getPortfolio } from '@/lib/repo/analytics';
import { getActiveSimulation } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Portfolio' };

export default async function PortfolioPage() {
  const simulation = await getActiveSimulation();
  if (!simulation) {
    return (
      <>
        <ConsoleHeader eyebrow="Capital & treasury" title="Portfolio" />
        <EmptyConsole
          title="No holdings"
          description="The portfolio aggregates the economic ledger: what was endowed, what was earned, what was spent, and who holds it now."
        />
      </>
    );
  }

  const [portfolio, series] = await Promise.all([
    getPortfolio(simulation.id),
    getCycleSeries(simulation.id),
  ]);

  const stats = [
    { label: 'Live capital', value: portfolio.totalCapitalSol, tone: 'text-ink' },
    { label: 'Earned', value: portfolio.earnedSol, tone: 'text-good' },
    { label: 'Spent', value: portfolio.spentSol, tone: 'text-ink-muted' },
    {
      label: 'Realised P&L',
      value: portfolio.realisedProfitSol,
      tone: portfolio.realisedProfitSol >= 0 ? 'text-good' : 'text-bad',
      signed: true,
    },
    { label: 'Treasury endowment', value: portfolio.endowedSol, tone: 'text-ink-muted' },
  ];

  return (
    <>
      <ConsoleHeader
        eyebrow={`${portfolio.transactionCount.toLocaleString()} ledger entries`}
        title="Portfolio"
        description="Every figure is computed from the append-only ledger. Endowments — seed capital and the clone bonus — are tracked separately from earnings, so profit means money the population actually made."
      />

      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {stats.map((stat) => (
          <article key={stat.label} className="panel p-3.5">
            <div className="label">{stat.label}</div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className={`tabular font-mono text-xl font-medium ${stat.tone}`}>
                {stat.signed && stat.value >= 0 ? '+' : ''}
                {stat.value.toFixed(3)}
              </span>
              <span className="font-mono text-3xs text-ink-faint">SOL</span>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Net cashflow per cycle</h2>
            <span className="font-mono text-3xs text-ink-ghost">revenue − expenses</span>
          </div>
          <div className="p-3.5">
            <AreaChart
              points={series.map((p) => ({ x: p.cycle, y: p.netSol }))}
              height={170}
              unit="SOL"
              zeroBased
              format={{ decimals: 4 }}
              tone="var(--viz-1)"
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Ledger composition</h2>
          </div>
          <div className="p-3.5">
            <RankedBars
              rows={portfolio.ledger.map((entry) => ({
                label: entry.type.replace(/_/g, ' '),
                value: entry.totalSol,
                sub: `${entry.count.toLocaleString()} entries`,
              }))}
              format={{ decimals: 2, signed: true }}
            />
          </div>
        </section>
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Holdings</h2>
            <span className="font-mono text-3xs text-ink-ghost">
              {portfolio.holdings.length} living agents
            </span>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line">
                  {['Agent', 'Gen', 'Capital', 'Share'].map((head) => (
                    <th key={head} className="label px-3 py-2 font-medium">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {portfolio.holdings.map((holding) => (
                  <tr key={holding.id} className="row-hover">
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/agents/${holding.id}`}
                        className="font-mono text-3xs text-ink transition-colors hover:text-cy"
                      >
                        {holding.code}
                      </Link>
                    </td>
                    <td className="tabular px-3 py-1.5 font-mono text-3xs text-ink-muted">
                      {holding.generation}
                    </td>
                    <td className="tabular px-3 py-1.5 font-mono text-3xs text-ink">
                      {holding.capitalSol.toFixed(4)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="h-1 w-16 overflow-hidden rounded-full bg-raised">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.max(2, holding.shareOfTotal * 100)}%`,
                              background: 'var(--viz-1)',
                            }}
                          />
                        </span>
                        <span className="tabular font-mono text-3xs text-ink-faint">
                          {(holding.shareOfTotal * 100).toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Concentration</h2>
          </div>
          <div className="p-3.5">
            <div className="flex items-baseline gap-2">
              <span className="tabular font-mono text-3xl font-medium text-ink">
                {(portfolio.concentrationTop5 * 100).toFixed(1)}%
              </span>
              <span className="font-mono text-3xs uppercase tracking-wider text-ink-faint">
                held by top 5
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raised">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{
                  width: `${Math.max(1, portfolio.concentrationTop5 * 100)}%`,
                  background:
                    portfolio.concentrationTop5 > 0.6 ? 'var(--viz-warn)' : 'var(--viz-1)',
                }}
              />
            </div>
            <p className="mt-4 font-mono text-3xs leading-relaxed text-ink-ghost">
              High concentration means a handful of lineages have out-competed the rest — the
              expected outcome of selection, and the reason average profit per generation falls as
              the population grows.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
