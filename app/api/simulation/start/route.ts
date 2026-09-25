import { NextRequest } from 'next/server';
import { DEFAULT_SPEED, isSpeedMultiplier } from '@/config/simulation';
import { handle, readJson } from '@/lib/api';
import { createSimulation, startSimulation } from '@/lib/engine/engine';
import { createTradingRun } from '@/lib/engine/trading-engine';
import { startRunner } from '@/lib/engine/runner';
import { getActiveSimulation } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Starts a simulation. With no `simulationId` it creates a fresh run first, so
 * "START" works from a cold database in one click.
 *
 * `mode: 'TRADING'` starts a paper-trading run instead of an economic one, on a
 * recorded pump.fun capture when `datasetId` names one and on a synthetic
 * market otherwise. Both then run on the same runner.
 */
export async function POST(request: NextRequest) {
  return handle(async () => {
    const body = await readJson(request);
    const speed = isSpeedMultiplier(body.speed) ? body.speed : DEFAULT_SPEED;

    let simulationId = typeof body.simulationId === 'string' ? body.simulationId : null;
    let created = false;

    if (!simulationId && body.mode === 'TRADING') {
      const result = await createTradingRun({
        name: typeof body.name === 'string' ? body.name : undefined,
        seed: typeof body.seed === 'string' ? body.seed : undefined,
        founderCount: typeof body.founderCount === 'number' ? body.founderCount : undefined,
        datasetId: typeof body.datasetId === 'string' ? body.datasetId : undefined,
        steps: typeof body.steps === 'number' ? body.steps : undefined,
      });
      simulationId = result.simulationId;
      created = true;
    } else if (!simulationId) {
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
