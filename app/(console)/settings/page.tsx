import { ConsoleHeader } from '@/components/console/page-header';
import { getSolanaConfig } from '@/config/solana';
import { resolveProviderName } from '@/lib/ai/agent-brain';
import { DEFAULT_SIMULATION_CONFIG, ACTION_DEFINITIONS } from '@/config/simulation';
import { getActiveSimulation, getSimulationConfig, listSimulations } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings' };

const DESCRIPTIONS: Record<string, string> = {
  INITIAL_CAPITAL_SOL: 'Capital every newborn agent receives.',
  CLONE_THRESHOLD_SOL: 'At or above this capital an agent may reproduce.',
  DEATH_THRESHOLD_SOL: 'At or below this capital the agent dies, permanently.',
  MAX_CLONES_PER_AGENT: 'Hard cap on offspring per agent.',
  CLONE_PARENT_COST_SOL: 'Debited from the parent on reproduction. 0 = treasury endows the clone.',
  MAX_GENERATIONS: 'Generation depth limit.',
  MAX_LIVE_AGENTS: 'Population cap, protecting the database and the UI.',
  CYCLE_COST_SOL: 'Upkeep charged to every living agent each cycle.',
  REVENUE_SCALE: 'Global revenue multiplier — the survivability dial.',
  MUTATION_RATE: 'Gaussian width of a trait mutation at cloning.',
  MUTATION_CHANCE: 'Probability that a given trait mutates at all.',
  STRATEGY_INHERITANCE: 'Chance a clone keeps its parent’s strategy label.',
  MEMORY_LIMIT: 'Memories kept per agent before summarisation.',
  MEMORY_SUMMARY_BATCH: 'Entries compacted into one summary.',
  MIN_AGE_FOR_CLONING: 'Cycles an agent must live before it may reproduce.',
  MARKET_AMPLITUDE: 'Market oscillation amplitude.',
  MARKET_PERIOD_CYCLES: 'Cycles per full market period.',
};

export default async function SettingsPage() {
  const simulation = await getActiveSimulation();
  const config = simulation
    ? await getSimulationConfig(simulation.id)
    : DEFAULT_SIMULATION_CONFIG;
  const solana = getSolanaConfig();
  const provider = resolveProviderName();
  const simulations = await listSimulations(12);

  const entries = Object.keys(DESCRIPTIONS).map((key) => ({
    key,
    value: (config as unknown as Record<string, number>)[key],
    description: DESCRIPTIONS[key],
    isDefault:
      (config as unknown as Record<string, number>)[key] ===
      (DEFAULT_SIMULATION_CONFIG as unknown as Record<string, number>)[key],
  }));

  return (
    <>
      <ConsoleHeader
        eyebrow="Configuration"
        title="Settings"
        description="Read-only. Economic constants live in /config/simulation.ts and are validated whenever a run loads them, so a hand-edited value can never produce an impossible economy."
      />

      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section className="panel">
          <div className="panel-head">
            <h2 className="label">Simulation parameters</h2>
            <span className="font-mono text-3xs text-ink-ghost">
              {simulation ? `run ${simulation.name}` : 'defaults'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-line">
                  {['Parameter', 'Value', 'Meaning'].map((head) => (
                    <th key={head} className="label px-3 py-2 font-medium">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {entries.map((entry) => (
                  <tr key={entry.key} className="row-hover">
                    <td className="px-3 py-2 font-mono text-3xs text-ink">{entry.key}</td>
                    <td className="tabular whitespace-nowrap px-3 py-2 font-mono text-3xs">
                      <span className={entry.isDefault ? 'text-ink-muted' : 'text-cy'}>
                        {entry.value}
                      </span>
                      {!entry.isDefault && (
                        <span className="ml-1.5 text-ink-ghost">overridden</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-3xs text-ink-ghost">
                      {entry.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-3">
          <section className="panel">
            <div className="panel-head">
              <h2 className="label">Runtime</h2>
            </div>
            <dl className="divide-y divide-line">
              {[
                ['AI provider', provider],
                ['Solana mode', solana.mode],
                ['Solana network', solana.network],
                ['RPC endpoint', solana.rpcUrl ?? 'none'],
                ['Real value', solana.realValueEnabled ? 'ENABLED' : 'Disabled'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 px-3.5 py-2">
                  <dt className="label">{label}</dt>
                  <dd
                    className={`font-mono text-3xs uppercase ${
                      label === 'Real value' && solana.realValueEnabled ? 'text-bad' : 'text-ink'
                    }`}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-line px-3.5 py-3 font-mono text-3xs leading-relaxed text-ink-ghost">
              Real value is hard-coded off in config/solana.ts. Enabling it is a reviewed code
              change with a documented checklist, never an environment variable.
            </p>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="label">Action catalogue</h2>
              <span className="font-mono text-3xs text-ink-ghost">
                {Object.keys(ACTION_DEFINITIONS).length} actions
              </span>
            </div>
            <ul className="divide-y divide-line">
              {Object.values(ACTION_DEFINITIONS).map((action) => (
                <li key={action.type} className="px-3.5 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-3xs text-ink">
                      {action.type.replace(/_/g, ' ')}
                    </span>
                    <span className="chip">{action.risk}</span>
                  </div>
                  <div className="tabular mt-1 font-mono text-3xs text-ink-ghost">
                    cost {action.cost.min}–{action.cost.max} · revenue ≤{' '}
                    {action.potentialRevenue.max} SOL · skew {action.revenueSkew}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <section className="panel mt-3">
        <div className="panel-head">
          <h2 className="label">Runs on this instance</h2>
          <span className="font-mono text-3xs text-ink-ghost">{simulations.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left">
            <thead>
              <tr className="border-b border-line">
                {['Run', 'Seed', 'Status', 'Cycle', 'Created'].map((head) => (
                  <th key={head} className="label px-3 py-2 font-medium">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {simulations.map((run) => (
                <tr key={run.id} className="row-hover">
                  <td className="px-3 py-2 font-mono text-3xs text-ink">
                    {run.name}
                    {simulation?.id === run.id && (
                      <span className="ml-2 text-cy">active</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-3xs text-ink-muted">{run.seed}</td>
                  <td className="px-3 py-2 font-mono text-3xs text-ink-muted">{run.status}</td>
                  <td className="tabular px-3 py-2 font-mono text-3xs text-ink-muted">
                    {run.cycle}
                  </td>
                  <td className="px-3 py-2 font-mono text-3xs text-ink-ghost">
                    {run.createdAt.slice(0, 16).replace('T', ' ')}
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
