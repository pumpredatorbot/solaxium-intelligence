import { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { listEngines } from '@/lib/repo/engines';
import { getActiveSimulation, getSimulationConfig } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const simulation = await getActiveSimulation(params.get('simulationId'));
    if (!simulation) return { engines: [], simulation: null };

    const config = await getSimulationConfig(simulation.id);
    const statusParam = params.get('status');

    return {
      simulation,
      engines: await listEngines(simulation.id, {
        limit: params.get('limit') ? Math.min(Number(params.get('limit')), 200) : undefined,
        status: statusParam === 'ALIVE' || statusParam === 'DEAD' ? statusParam : undefined,
        cycleCostSol: config.CYCLE_COST_SOL,
      }),
    };
  });
}
