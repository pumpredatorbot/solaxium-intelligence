import { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { getActiveSimulation, listGenerations } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const simulation = await getActiveSimulation(request.nextUrl.searchParams.get('simulationId'));
    if (!simulation) return { generations: [], simulation: null };
    return { generations: await listGenerations(simulation.id), simulation };
  });
}
