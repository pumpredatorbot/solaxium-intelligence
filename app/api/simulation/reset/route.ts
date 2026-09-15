import { NextRequest } from 'next/server';
import { fail, handle, readJson } from '@/lib/api';
import { resetSimulation } from '@/lib/engine/engine';
import { drainRunner, stopRunner } from '@/lib/engine/runner';
import { getActiveSimulation } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Wipes a run back to cycle 0. With the same seed this reproduces the original
 * population exactly — that is the point of the seed.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const simulationId =
    typeof body.simulationId === 'string'
      ? body.simulationId
      : (await getActiveSimulation())?.id;

  if (!simulationId) return fail('No simulation to reset', 404);

  return handle(async () => {
    stopRunner(simulationId);
    // Let any cycle already in flight finish before touching its rows.
    await drainRunner(simulationId);
    const result = await resetSimulation(simulationId, {
      seed: typeof body.seed === 'string' ? body.seed : undefined,
      founderCount: typeof body.founderCount === 'number' ? body.founderCount : 3,
    });
    return { simulation: await getActiveSimulation(simulationId), seed: result.seed };
  });
}
