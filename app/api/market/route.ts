import { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { getActionEconomics, getMarketSeries } from '@/lib/repo/analytics';
import { getActiveSimulation } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const simulation = await getActiveSimulation(request.nextUrl.searchParams.get('simulationId'));
    if (!simulation) return { simulation: null, actions: [], market: [] };

    const [actions, market] = await Promise.all([
      getActionEconomics(simulation.id),
      getMarketSeries(simulation.id, simulation.cycle),
    ]);

    return { simulation, actions, market };
  });
}
