import { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { getRunnerState } from '@/lib/engine/runner';
import {
  getActiveSimulation,
  getCorePopulation,
  getDashboardStats,
  listSimulations,
} from '@/lib/repo/queries';
import { getSolanaConfig } from '@/config/solana';
import { resolveProviderName } from '@/lib/ai/agent-brain';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const simulationId = request.nextUrl.searchParams.get('simulationId');
    const simulation = await getActiveSimulation(simulationId);

    if (!simulation) {
      return {
        simulation: null,
        runner: null,
        stats: null,
        simulations: await listSimulations(10),
        solana: getSolanaConfig(),
        aiProvider: resolveProviderName(),
        population: [],
      };
    }

    return {
      simulation,
      runner: getRunnerState(simulation.id),
      stats: await getDashboardStats(simulation.id, simulation.cycle),
      simulations: await listSimulations(10),
      solana: getSolanaConfig(),
      aiProvider: resolveProviderName(),
      population: await getCorePopulation(simulation.id),
    };
  });
}
