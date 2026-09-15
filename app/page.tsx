import Link from 'next/link';
import { SolaxiumMark } from '@/components/brand';
import { DEFAULT_SIMULATION_CONFIG } from '@/config/simulation';
import { getActiveSimulation, getDashboardStats } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';

const LIFECYCLE = [
  {
    step: 'BORN',
    body: `Enters with ${DEFAULT_SIMULATION_CONFIG.INITIAL_CAPITAL_SOL} SOL, a trait vector, and no history.`,
  },
  { step: 'EARN', body: 'Reads its situation each cycle and commits capital to one economic action.' },
  {
    step: 'SURVIVE',
    body: `Upkeep is charged every cycle. At ${DEFAULT_SIMULATION_CONFIG.DEATH_THRESHOLD_SOL} SOL it is gone for good.`,
  },
  {
    step: 'CLONE',
    body: `Cross ${DEFAULT_SIMULATION_CONFIG.CLONE_THRESHOLD_SOL} SOL and it may produce up to ${DEFAULT_SIMULATION_CONFIG.MAX_CLONES_PER_AGENT} offspring.`,
  },
  { step: 'EVOLVE', body: 'Offspring inherit the parent genome, mutated. Selection does the rest.' },
];

export default async function LandingPage() {
  const simulation = await getActiveSimulation();
  const stats = simulation ? await getDashboardStats(simulation.id, simulation.cycle) : null;

  return (
    <div className="min-h-screen bg-void">
      {/* --- chrome ------------------------------------------------------ */}
      <header className="sticky top-0 z-30 border-b border-line bg-void/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1320px] items-center gap-3 px-6 py-3.5">
          <SolaxiumMark size={28} />
          <span className="font-mono text-xs font-semibold uppercase tracking-widest2 text-ink">
            Solaxium
          </span>
          <span className="hidden font-mono text-3xs uppercase tracking-widest3 text-ink-faint sm:inline">
            Intelligence
          </span>
          <Link href="/overview" className="btn btn-primary ml-auto">
            Open console
          </Link>
        </div>
      </header>

      {/* --- hero -------------------------------------------------------- */}
      <section className="grid-field relative overflow-hidden border-b border-line">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-[0.14]"
          style={{
            background:
              'radial-gradient(52% 100% at 50% 0%, #22E0F0 0%, #9A6BFF 38%, transparent 72%)',
          }}
        />
        <div className="relative mx-auto max-w-[1320px] px-6 py-24 sm:py-32">
          <div className="flex items-center gap-2.5">
            <span className="h-1 w-1 rounded-full bg-cy" />
            <span className="label">Evolutionary intelligence laboratory</span>
          </div>

          <h1 className="mt-7 max-w-4xl text-[2.6rem] font-medium leading-[1.02] tracking-tight text-ink sm:text-6xl">
            SOLAXIUM
            <br />
            INTELLIGENCE
          </h1>

          <p className="mt-6 font-mono text-sm uppercase tracking-widest2 text-cy">
            Earn. Survive. Evolve.
          </p>

          <p className="mt-8 max-w-2xl text-sm leading-relaxed text-ink-muted">
            An evolutionary intelligence laboratory where autonomous AI agents must generate wealth
            to survive. Every agent starts with {DEFAULT_SIMULATION_CONFIG.INITIAL_CAPITAL_SOL} SOL.
            It earns, it spends, it remembers. When its capital runs out it dies — and its lineage
            ends with it.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/overview" className="btn btn-primary">
              Start simulation
            </Link>
            <Link href="/agents" className="btn">
              Explore agents
            </Link>
          </div>

          <div className="mt-14 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-line pt-6 font-mono text-3xs uppercase tracking-widest2 text-ink-faint">
            <span>Simulated Solana economy</span>
            <span className="text-line-strong">/</span>
            <span>Seeded &amp; reproducible</span>
            <span className="text-line-strong">/</span>
            <span>No real value is moved</span>
          </div>
        </div>
      </section>

      {/* --- live bar ----------------------------------------------------- */}
      {stats && (
        <section className="border-b border-line bg-abyss">
          <dl className="mx-auto grid max-w-[1320px] grid-cols-2 divide-x divide-line sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: 'Live agents', value: String(stats.liveAgents), tone: 'text-good' },
              { label: 'Dead', value: String(stats.deadAgents), tone: 'text-bad' },
              { label: 'Generations', value: String(stats.generations), tone: 'text-ink' },
              { label: 'Clones', value: String(stats.totalClones), tone: 'text-ink' },
              {
                label: 'Total capital',
                value: stats.totalCapitalSol.toFixed(2),
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
                <dt className="label">{item.label}</dt>
                <dd className={`tabular mt-1.5 font-mono text-lg ${item.tone}`}>
                  {item.value}
                  {item.unit && <span className="ml-1 text-3xs text-ink-faint">{item.unit}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* --- lifecycle ----------------------------------------------------- */}
      <section className="mx-auto max-w-[1320px] px-6 py-20">
        <div className="label">How it works</div>
        <h2 className="mt-3 text-xl font-medium tracking-tight text-ink sm:text-2xl">
          Five states. One outcome that matters.
        </h2>

        <ol className="mt-10 grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
          {LIFECYCLE.map((item, index) => (
            <li key={item.step} className="bg-surface p-5">
              <div className="tabular font-mono text-3xs text-ink-ghost">
                {String(index + 1).padStart(2, '0')}
              </div>
              <div className="mt-4 font-mono text-xs uppercase tracking-widest2 text-cy">
                {item.step}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* --- rule --------------------------------------------------------- */}
      <section className="border-y border-line bg-abyss">
        <div className="mx-auto max-w-[1320px] px-6 py-24 text-center">
          <div className="label">The rule is simple</div>
          <blockquote className="mx-auto mt-6 max-w-3xl text-2xl font-medium leading-snug tracking-tight text-ink sm:text-3xl">
            “An intelligence that cannot sustain itself, dies.”
          </blockquote>
          <p className="mx-auto mt-6 max-w-xl text-xs leading-relaxed text-ink-muted">
            No agent is rescued. No capital is granted after birth. What survives to the next
            generation survives because it earned the right to.
          </p>
        </div>
      </section>

      {/* --- pillars ------------------------------------------------------ */}
      <section className="mx-auto max-w-[1320px] px-6 py-20">
        <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-3">
          {[
            {
              title: 'Real decisions',
              body: 'Agents score every affordable action against their genome, their memory and the market, then commit. The engine validates and executes — a brain only ever proposes.',
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
            <div key={item.title} className="bg-surface p-6">
              <h3 className="font-mono text-xs uppercase tracking-widest2 text-ink">{item.title}</h3>
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/overview" className="btn btn-primary">
            Open the console
          </Link>
          <Link href="/analytics" className="btn">
            See the evidence
          </Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-2 px-6 py-6 font-mono text-3xs uppercase tracking-widest2 text-ink-ghost sm:flex-row sm:items-center sm:justify-between">
          <span>Solaxium Intelligence — Earn. Survive. Evolve.</span>
          <span>V1 · Simulated Solana economy · No real value is moved</span>
        </div>
      </footer>
    </div>
  );
}
