import Link from 'next/link';
import { PageHeader, Panel } from '@/components/ui';
import { ActivityFeed } from '@/components/activity-feed';
import { SimulationControls } from '@/components/simulation-controls';
import { getSolanaConfig } from '@/config/solana';
import { resolveProviderName } from '@/lib/ai/agent-brain';
import { getRunnerState } from '@/lib/engine/runner';
import { getActiveSimulation, getDashboardStats, listEvents } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Live simulation' };

export default async function SimulationPage({
  searchParams,
}: {
  searchParams: Promise<{ simulationId?: string }>;
}) {
  const { simulationId } = await searchParams;
  const simulation = await getActiveSimulation(simulationId);

  const stats = simulation ? await getDashboardStats(simulation.id, simulation.cycle) : null;
  const events = simulation ? await listEvents(simulation.id, { limit: 80 }) : [];

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-10">
      <PageHeader
        eyebrow="Live"
        title="Simulation"
        description="Drive the population in real time. Every cycle every living agent observes, decides, acts, and settles its books — then the engine checks it for death and for the clone threshold."
        actions={
          simulation ? (
            <Link href="/dashboard" className="btn">
              Dashboard
            </Link>
          ) : undefined
        }
      />

      <div className="mt-8 grid gap-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <SimulationControls
          simulationId={simulation?.id ?? null}
          initial={{
            simulation,
            runner: simulation ? getRunnerState(simulation.id) : null,
            stats,
            aiProvider: resolveProviderName(),
            solana: getSolanaConfig(),
          }}
        />

        <Panel title="Event stream" bodyClassName="p-0">
          {simulation ? (
            <ActivityFeed
              simulationId={simulation.id}
              initialEvents={events}
              live={simulation.status === 'RUNNING'}
              height="h-[640px]"
              pollMs={700}
            />
          ) : (
            <div className="flex h-[640px] items-center justify-center px-6 text-center text-2xs text-ink-faint">
              Create a simulation to begin. Three founders are seeded with 1 SOL each.
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
