import { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { getActiveSimulation, listEvents } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The activity feed. Pass `afterSeq` to poll for only what is new — the client
 * uses this to stream the live simulation without re-fetching history.
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const simulation = await getActiveSimulation(params.get('simulationId'));
    if (!simulation) return { events: [], simulation: null };

    const afterSeq = params.get('afterSeq');
    const types = params.get('types')?.split(',').filter(Boolean);

    return {
      simulation,
      events: await listEvents(simulation.id, {
        limit: params.get('limit') ? Math.min(Number(params.get('limit')), 300) : undefined,
        afterSeq: afterSeq !== null ? Number(afterSeq) : undefined,
        types,
      }),
    };
  });
}
