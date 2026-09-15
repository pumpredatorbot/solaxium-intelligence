import { NextRequest } from 'next/server';
import { fail, handle } from '@/lib/api';
import { getReplaySnapshot } from '@/lib/repo/replay';
import { getActiveSimulation } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Reconstructs the population at a given cycle from the ledger. This is a
 * query over recorded history, not a stored checkpoint.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const simulation = await getActiveSimulation(params.get('simulationId'));
  if (!simulation) return fail('No simulation to replay', 404);

  const cycleParam = Number(params.get('cycle') ?? simulation.cycle);
  if (!Number.isFinite(cycleParam)) return fail('cycle must be a number', 400);

  return handle(async () => ({
    simulation,
    snapshot: await getReplaySnapshot(simulation.id, cycleParam),
  }));
}
