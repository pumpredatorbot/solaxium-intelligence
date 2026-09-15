import { getSolanaConfig } from '@/config/solana';
import { resolveProviderName } from '@/lib/ai/agent-brain';
import { getRunnerState } from '@/lib/engine/runner';
import {
  getActiveSimulation,
  getCorePopulation,
  getDashboardStats,
  listEvents,
  listSimulations,
} from '@/lib/repo/queries';
import { ConsoleProvider } from '@/components/console/console-provider';
import { Sidebar } from '@/components/console/sidebar';
import { Topbar } from '@/components/console/topbar';

export const dynamic = 'force-dynamic';

/**
 * The console shell.
 *
 * It resolves the active run on the server so the first paint already carries
 * real numbers, then hands them to ConsoleProvider, which owns the single
 * poller every live panel reads from.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const simulation = await getActiveSimulation();

  const [stats, simulations, events, population] = await Promise.all([
    simulation ? getDashboardStats(simulation.id, simulation.cycle) : Promise.resolve(null),
    listSimulations(10),
    simulation ? listEvents(simulation.id, { limit: 80 }) : Promise.resolve([]),
    simulation ? getCorePopulation(simulation.id) : Promise.resolve([]),
  ]);

  return (
    <ConsoleProvider
      initial={{
        simulation,
        runner: simulation ? getRunnerState(simulation.id) : null,
        stats,
        simulations,
        solana: getSolanaConfig(),
        aiProvider: resolveProviderName(),
        population,
      }}
      initialEvents={events}
    >
      <div className="min-h-screen bg-void">
        <Sidebar />
        <div className="lg:pl-[218px]">
          <Topbar />
          <main className="grid-field min-h-[calc(100vh-56px)] px-3 py-3 lg:px-4 lg:py-4">
            {children}
          </main>
        </div>
      </div>
    </ConsoleProvider>
  );
}
