import { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import {
  getCycleSeries,
  getSurvivalStats,
  getTraitEvolution,
} from '@/lib/repo/analytics';
import { getActiveSimulation, listGenerations } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const simulation = await getActiveSimulation(request.nextUrl.searchParams.get('simulationId'));
    if (!simulation) return { simulation: null, series: [], traits: [], survival: [], generations: [] };

    const [series, traits, survival, generations] = await Promise.all([
      getCycleSeries(simulation.id),
      getTraitEvolution(simulation.id),
      getSurvivalStats(simulation.id, simulation.cycle),
      listGenerations(simulation.id),
    ]);

    return { simulation, series, traits, survival, generations };
  });
}
