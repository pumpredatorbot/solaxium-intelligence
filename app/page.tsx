import Link from 'next/link';
import { Mark } from '@/components/mark';
import { DEFAULT_SIMULATION_CONFIG } from '@/config/simulation';
import { getActiveSimulation, getDashboardStats } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';

const LIFECYCLE = [
  {
    step: 'BORN',
    body: `Every agent enters with ${DEFAULT_SIMULATION_CONFIG.INITIAL_CAPITAL_SOL} SOL, a trait vector, and no history.`,
  },
  {
    step: 'EARN',
    body: 'Each cycle it reads its situation and commits capital to one economic action.',
  },
  {
    step: 'SURVIVE',
    body: `Upkeep is charged every cycle. At ${DEFAULT_SIMULATION_CONFIG.DEATH_THRESHOLD_SOL} SOL the agent is gone for good.`,
  },
  {
    step: 'CLONE',
    body: `Cross ${DEFAULT_SIMULATION_CONFIG.CLONE_THRESHOLD_SOL} SOL and it may produce up to ${DEFAULT_SIMULATION_CONFIG.MAX_CLONES_PER_AGENT} offspring.`,
  },
  {
    step: 'EVOLVE',
    body: 'Offspring inherit the parent genome, mutated. Selection does the rest.',
  },
];

export default async function LandingPage() {
  const simulation = await getActiveSimulation();
  const stats = simulation ? await getDashboardStats(simulation.id, simulation.cycle) : null;

  return (
    <div>
      {/* ---------------------------------------------------------------- hero */}
      <section className="grid-lines relative overflow-hidden border-b border-line">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-[0.07]"
          style={{
            background: 'radial-gradient(60% 100% at 50% 0%, #14F195 0%, transparent 70%)',
          }}
        />
        <div className="relative mx-auto max-w-[1400px] px-6 py-24 sm:py-32">
          <div className="flex items-center gap-2.5">
            <Mark className="h-4 w-4 text-sol" />
            <span className="label text-ink-muted">Evolutionary intelligence laboratory</span>
          </div>

          <h1 className="mt-7 max-w-4xl text-4xl font-medium leading-[1.05] tracking-tight text-ink sm:text-6xl">
            SOLAXIUM
            <br />
            INTELLIGENCE
          </h1>

          <p className="mt-6 font-mono text-sm uppercase tracking-widest2 text-sol">
            Earn. Survive. Evolve.
          </p>

          <p className="mt-8 max-w-2xl text-base leading-relaxed text-ink-muted">
            An evolutionary intelligence laboratory where autonomous AI agents must generate wealth
            to survive. Every agent starts with {DEFAULT_SIMULATION_CONFIG.INITIAL_CAPITAL_SOL} SOL.
            It earns, it spends, it remembers. When its capital runs out, it dies — and its lineage
            ends with it.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/simulation" className="btn btn-primary">
              Start simulation
            </Link>
            <Link href="/agents" className="btn">
              Explore agents
            </Link>
          </div>

          <div className="mt-14 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line pt-6 font-mono text-2xs uppercase tracking-widest2 text-ink-faint">
            <span>Simulated Solana economy</span>
            <span className="text-line-strong">/</span>
            <span>Seeded &amp; reproducible</span>
            <span className="text-line-strong">/</span>
            <span>No real value is moved</span>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ live bar */}
      {stats && simulation && (
        <section className="border-b border-line bg-surface">
          <div className="mx-auto grid max-w-[1400px] grid-cols-2 divide-x divide-line px-0 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: 'Live agents', value: String(stats.liveAgents), tone: 'text-sol' },
              { label: 'Dead', value: String(stats.deadAgents), tone: 'text-danger/90' },
              { label: 'Generations', value: String(stats.generations), tone: 'text-ink' },
              { label: 'Clones', value: String(stats.totalClones), tone: 'text-ink' },
              {
                label: 'Total capital',
                value: `${stats.totalCapitalSol.toFixed(2)}`,
                tone: 'text-ink',
                unit: 'SOL',
              },
              {
                label: 'Survival',
                value: `${(stats.survivalRate * 100).toFixed(0)}%`,
                tone: 'text-ink',
              },
            ].map((item) => (
              <div key={item.label} className="border-b border-line px-5 py-5 lg:border-b-0">
                <div className="label">{item.label}</div>
                <div className={`tabular mt-1.5 font-mono text-lg ${item.tone}`}>
                  {item.value}
                  {item.unit && (
                    <span className="ml-1 text-2xs text-ink-faint">{item.unit}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ----------------------------------------------------------- lifecycle */}
      <section className="mx-auto max-w-[1400px] px-6 py-20">
        <div className="label">How it works</div>
        <h2 className="mt-3 text-2xl font-medium tracking-tight text-ink">
          Five states. One outcome that matters.
        </h2>

        <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
          {LIFECYCLE.map((item, index) => (
            <li key={item.step} className="bg-surface p-6">
              <div className="tabular font-mono text-2xs text-ink-faint">
                {String(index + 1).padStart(2, '0')}
              </div>
              <div className="mt-4 font-mono text-sm uppercase tracking-widest2 text-sol">
                {item.step}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* --------------------------------------------------------------- rule */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-[1400px] px-6 py-24 text-center">
          <div className="label">The rule is simple</div>
          <blockquote className="mx-auto mt-6 max-w-3xl text-2xl font-medium leading-snug tracking-tight text-ink sm:text-3xl">
            “An intelligence that cannot sustain itself, dies.”
          </blockquote>
          <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-ink-muted">
            No agent is rescued. No capital is granted after birth. What survives to the next
            generation survives because it earned the right to.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------ closing */}
      <section className="mx-auto max-w-[1400px] px-6 py-20">
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-3">
          {[
            {
              title: 'Real decisions',
              body: 'Agents score every affordable action against their genome, their memory, and the market, then commit. The engine validates and executes — a brain only ever proposes.',
            },
            {
              title: 'Real ledger',
              body: 'Every lamport is a transaction row. An agent’s balance is recomputable from its ledger alone, and the API exposes both so you can check.',
            },
            {
              title: 'Real evolution',
              body: 'Offspring inherit a mutated trait vector. Across generations, selection visibly moves the population towards what actually pays.',
            },
          ].map((item) => (
            <div key={item.title} className="bg-surface p-7">
              <h3 className="font-mono text-xs uppercase tracking-widest2 text-ink">
                {item.title}
              </h3>
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/simulation" className="btn btn-primary">
            Start simulation
          </Link>
          <Link href="/dashboard" className="btn">
            Open dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
