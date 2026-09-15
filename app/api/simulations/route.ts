import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/api';
import { createSimulation } from '@/lib/engine/engine';
import { getActiveSimulation, listSimulations } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return handle(async () => ({ simulations: await listSimulations(50) }));
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const body = await readJson(request);
    const result = await createSimulation({
      name: typeof body.name === 'string' ? body.name : undefined,
      seed: typeof body.seed === 'string' ? body.seed : undefined,
      founderCount: typeof body.founderCount === 'number' ? body.founderCount : 3,
      config:
        typeof body.config === 'object' && body.config
          ? (body.config as Record<string, unknown>)
          : undefined,
    });
    return { ...result, simulation: await getActiveSimulation(result.simulationId) };
  });
}
