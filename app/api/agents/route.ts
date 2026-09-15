import { NextRequest } from 'next/server';
import { fail, handle, readJson } from '@/lib/api';
import { prisma } from '@/lib/db';
import { createRng } from '@/lib/rng';
import { resolveConfig } from '@/lib/engine/config';
import { refreshGeneration, spawnAgent } from '@/lib/engine/engine';
import { getActiveSimulation, listAgents } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const simulation = await getActiveSimulation(params.get('simulationId'));
    if (!simulation) return { agents: [], total: 0, simulation: null };

    const generationParam = params.get('generation');

    const { agents, total } = await listAgents(simulation.id, simulation.cycle, {
      status: (params.get('status') as 'ALIVE' | 'DEAD' | null) ?? undefined,
      generation: generationParam !== null ? Number(generationParam) : undefined,
      orderBy: (params.get('orderBy') as never) ?? undefined,
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
      offset: params.get('offset') ? Number(params.get('offset')) : undefined,
    });

    return { agents, total, simulation };
  });
}

/**
 * Injects a new founder into a running simulation. Generation 0 by default —
 * useful for re-seeding a population that is heading for extinction.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const simulation = await getActiveSimulation(
    typeof body.simulationId === 'string' ? body.simulationId : null,
  );
  if (!simulation) return fail('No simulation to add an agent to', 404);
  if (simulation.status === 'COMPLETED' || simulation.status === 'STOPPED') {
    return fail(`Simulation is ${simulation.status}`, 409);
  }

  return handle(async () => {
    const config = resolveConfig(simulation.config);
    const row = await prisma.simulation.findUniqueOrThrow({
      where: { id: simulation.id },
      select: { seed: true, rngCursor: true },
    });
    const rng = createRng(row.seed, row.rngCursor);

    const agent = await spawnAgent(prisma, {
      simulationId: simulation.id,
      config,
      rng,
      cycle: simulation.cycle,
      generation: 0,
      parent: null,
    });

    await refreshGeneration(prisma, simulation.id, 0, simulation.cycle, config);
    await prisma.simulation.update({
      where: { id: simulation.id },
      data: { rngCursor: rng.cursor },
    });

    return { agent };
  });
}
