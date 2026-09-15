import { NextRequest } from 'next/server';
import { SPEEDS, type SpeedName } from '@/config/simulation';
import { fail, handle, readJson } from '@/lib/api';
import { setSpeed } from '@/lib/engine/runner';
import { getActiveSimulation } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const simulationId =
    typeof body.simulationId === 'string'
      ? body.simulationId
      : (await getActiveSimulation())?.id;

  if (!simulationId) return fail('No simulation selected', 404);
  if (!SPEEDS.includes(body.speed as SpeedName)) {
    return fail(`speed must be one of ${SPEEDS.join(', ')}`, 400);
  }

  return handle(async () => ({ runner: setSpeed(simulationId, body.speed as SpeedName) }));
}
