import { NextRequest } from 'next/server';
import { SPEED_MULTIPLIERS, isSpeedMultiplier } from '@/config/simulation';
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
  const speed = body.speed;
  if (!isSpeedMultiplier(speed)) {
    return fail(`speed must be one of ${SPEED_MULTIPLIERS.join(', ')}`, 400);
  }

  return handle(async () => ({ runner: setSpeed(simulationId, speed) }));
}
