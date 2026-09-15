import { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { getCycleSeries, getPortfolio } from '@/lib/repo/analytics';
import { getActiveSimulation } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const simulation = await getActiveSimulation(request.nextUrl.searchParams.get('simulationId'));
    if (!simulation) return { simulation: null, portfolio: null, series: [] };

    const [portfolio, series] = await Promise.all([
      getPortfolio(simulation.id),
      getCycleSeries(simulation.id),
    ]);

    return { simulation, portfolio, series };
  });
}
