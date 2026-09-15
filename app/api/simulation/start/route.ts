import { NextRequest } from 'next/server';
import type { SpeedName } from '@/config/simulation';
import { SPEEDS } from '@/config/simulation';
import { handle, readJson } from '@/lib/api';
import { createSimulation, startSimulation } from '@/lib/engine/engine';
import { startRunner } from '@/lib/engine/runner';
import { getActiveSimulation } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Starts a simulation. With no `simulationId` it creates a fresh run first, so
 * "START SIMULATION" works from a cold database in one click.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const body = await readJson(request);
    const speed = (
      SPEEDS.includes(body.speed as SpeedName) ? body.speed : 'NORMAL'
    ) as SpeedName;

    let simulationId = typeof body.simulationId === 'string' ? body.simulationId : null;
    let created = false;

    if (!simulationId) {
      const result = await createSimulation({
        name: typeof body.name === 'string' ? body.name : undefined,
        seed: typeof body.seed === 'string' ? body.seed : undefined,
        founderCount: typeof body.founderCount === 'number' ? body.founderCount : 3,
        config:
          typeof body.config === 'object' && body.config
            ? (body.config as Record<string, unknown>)
            : undefined,
      });
      simulationId = result.simulationId;
      created = true;
    }

    await startSimulation(simulationId);
    const runner = startRunner(simulationId, speed);

    return { simulation: await getActiveSimulation(simulationId), runner, created };
  });
}
