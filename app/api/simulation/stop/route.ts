import { NextRequest } from 'next/server';
import { fail, handle, readJson } from '@/lib/api';
import { stopSimulation } from '@/lib/engine/engine';
import { drainRunner, stopRunner } from '@/lib/engine/runner';
import { getActiveSimulation } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const simulationId =
    typeof body.simulationId === 'string'
      ? body.simulationId
      : (await getActiveSimulation())?.id;

  if (!simulationId) return fail('No simulation to stop', 404);

  return handle(async () => {
    stopRunner(simulationId);
    // Let any cycle already in flight finish before touching its rows.
    await drainRunner(simulationId);
    await stopSimulation(simulationId);
    return { simulation: await getActiveSimulation(simulationId) };
  });
}
