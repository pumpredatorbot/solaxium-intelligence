import Link from 'next/link';
import { AgentLink, EmptyState, PageHeader, Panel, StatusDot } from '@/components/ui';
import {
  getActiveSimulation,
  getLeaderboard,
  listGenerations,
  type LeaderboardCategory,
} from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leaderboard' };

const CATEGORIES: { key: LeaderboardCategory; label: string; format: (v: number) => string }[] = [
  { key: 'MOST_PROFITABLE', label: 'Most profitable', format: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(4)} SOL` },
  { key: 'HIGHEST_CAPITAL', label: 'Highest capital', format: (v) => `${v.toFixed(4)} SOL` },
  { key: 'LONGEST_SURVIVAL', label: 'Longest survival', format: (v) => `${v} cycles` },
  { key: 'MOST_CLONES', label: 'Most clones', format: (v) => String(v) },
  { key: 'BEST_ROI', label: 'Best ROI', format: (v) => `${(v * 100).toFixed(1)}%` },
];

const SCOPES = [
  { key: 'CURRENT', label: 'Current simulation' },
  { key: 'ALL_TIME', label: 'All time' },
];

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; scope?: string; generation?: string; simulationId?: string }>;
}) {
  const params = await searchParams;
  const simulation = await getActiveSimulation(params.simulationId);

  const category = (CATEGORIES.find((c) => c.key === params.category)?.key ??
    'MOST_PROFITABLE') as LeaderboardCategory;
  const scope = params.scope === 'ALL_TIME' ? 'ALL_TIME' : 'CURRENT';
  const generation = params.generation ? Number(params.generation) : undefined;

  const simulationId = scope === 'ALL_TIME' ? null : (simulation?.id ?? null);

  if (scope === 'CURRENT' && !simulationId) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 py-10">
        <PageHeader eyebrow="Rankings" title="Leaderboard" />
        <div className="mt-8">
          <EmptyState
            title="Nothing ranked yet"
            description="Run a simulation and the best performers will appear here."
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

  const [entries, generations] = await Promise.all([
    getLeaderboard(simulationId, category, { generation, limit: 40 }),
    simulation ? listGenerations(simulation.id) : Promise.resolve([]),
  ]);

  const activeCategory = CATEGORIES.find((c) => c.key === category)!;

  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...patch })) {
      if (value) next.set(key, String(value));
    }
    const query = next.toString();
    return query ? `/leaderboard?${query}` : '/leaderboard';
  };

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10">
      <PageHeader
        eyebrow="Rankings"
        title="Leaderboard"
        description="Who actually earned it. Rankings include the dead — a short, brilliant run still counts."
      />

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label mr-1">Metric</span>
          {CATEGORIES.map((c) => (
            <Link
              key={c.key}
              href={href({ category: c.key })}
              className={`chip ${category === c.key ? 'border-sol-deep text-sol' : ''}`}
            >
              {c.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="label mr-1">Scope</span>
          {SCOPES.map((s) => (
            <Link
              key={s.key}
              href={href({ scope: s.key, generation: undefined })}
              className={`chip ${scope === s.key ? 'border-sol-deep text-sol' : ''}`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        {scope === 'CURRENT' && generations.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">Gen</span>
            <Link
              href={href({ generation: undefined })}
              className={`chip ${!params.generation ? 'border-sol-deep text-sol' : ''}`}
            >
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
        {entries.length === 0 ? (
          <div className="px-6 py-14 text-center text-2xs text-ink-faint">
            No agents match this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-line text-2xs uppercase tracking-widest2 text-ink-faint">
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">Strategy</th>
                  <th className="px-4 py-3 text-right font-medium">Gen</th>
                  <th className="px-4 py-3 text-right font-medium">{activeCategory.label}</th>
                  <th className="px-4 py-3 text-right font-medium">Capital</th>
                  <th className="px-4 py-3 text-right font-medium">Cycles</th>
                  <th className="px-4 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {entries.map((entry, index) => (
                  <tr key={entry.id} className="link-row">
                    <td className="tabular px-4 py-2.5 font-mono text-2xs text-ink-faint">
                      {String(index + 1).padStart(2, '0')}
                    </td>
                    <td className="px-4 py-2.5">
                      <AgentLink code={entry.code} id={entry.id} />
                      <div className="mt-0.5 text-2xs text-ink-faint">{entry.name}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-2xs text-ink-muted">
                      {entry.strategy}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right font-mono text-xs text-ink-muted">
                      {entry.generation}
                    </td>
                    <td
                      className={`tabular px-4 py-2.5 text-right font-mono text-xs ${entry.metric >= 0 ? 'text-sol' : 'text-danger'}`}
                    >
                      {activeCategory.format(entry.metric)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right font-mono text-xs text-ink">
                      {entry.capitalSol.toFixed(4)}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right font-mono text-xs text-ink-muted">
                      {entry.cycles}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <StatusDot status={entry.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
