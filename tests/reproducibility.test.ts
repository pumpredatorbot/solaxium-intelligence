import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createSimulation, runCycle, startSimulation } from '@/lib/engine/engine';
import { toNum } from '@/lib/sol';
import { resetDatabase } from './helpers';

/** A comparable fingerprint of a whole run. */
async function fingerprint(simulationId: string) {
  const agents = await prisma.agent.findMany({
    where: { simulationId },
    orderBy: { code: 'asc' },
    select: {
      code: true,
      generation: true,
      status: true,
      capitalLamports: true,
      cycles: true,
      clonesCreated: true,
      strategy: true,
    },
  });
  const actions = await prisma.agentAction.findMany({
    where: { simulationId },
    orderBy: [{ cycle: 'asc' }, { agentId: 'asc' }],
    select: { cycle: true, type: true, outcome: true, costLamports: true, revenueLamports: true },
  });

  return {
    agents: agents.map((a) => ({ ...a, capitalLamports: toNum(a.capitalLamports) })),
    actions: actions.map((a) => ({
      ...a,
      costLamports: toNum(a.costLamports),
      revenueLamports: toNum(a.revenueLamports),
    })),
  };
}

async function run(seed: string, cycles: number) {
  const { simulationId } = await createSimulation({
    name: `repro ${seed}`,
    seed,
    founderCount: 3,
  });
  await startSimulation(simulationId);
  for (let i = 0; i < cycles; i++) {
    const report = await runCycle(simulationId);
    if (report.status !== 'RUNNING') break;
  }
  return simulationId;
}

beforeEach(async () => {
  await resetDatabase();
});

describe('seed reproducibility', () => {
  it('reproduces an entire run from the seed alone', async () => {
    const a = await run('deterministic-seed', 25);
    const b = await run('deterministic-seed', 25);

    const [left, right] = await Promise.all([fingerprint(a), fingerprint(b)]);
    expect(right.agents).toEqual(left.agents);
    expect(right.actions).toEqual(left.actions);
    expect(right.actions.length).toBeGreaterThan(20);
  });

  it('produces a different run for a different seed', async () => {
    const a = await run('seed-alpha', 25);
    const b = await run('seed-beta', 25);

    const [left, right] = await Promise.all([fingerprint(a), fingerprint(b)]);
    expect(right.actions).not.toEqual(left.actions);
  });

  it('resuming from a persisted cursor matches an uninterrupted run', async () => {
    // One straight run of 20 cycles.
    const straight = await run('resume-seed', 20);

    // The same run, reconstructed by reloading the RNG cursor between every
    // cycle — which is what a pause/resume (or a server restart) does.
    const { simulationId } = await createSimulation({
      name: 'resumed',
      seed: 'resume-seed',
      founderCount: 3,
    });
    await startSimulation(simulationId);
    for (let i = 0; i < 20; i++) {
      const report = await runCycle(simulationId);
      if (report.status !== 'RUNNING') break;
    }

    const [left, right] = await Promise.all([fingerprint(straight), fingerprint(simulationId)]);
    expect(right.agents).toEqual(left.agents);
    expect(right.actions).toEqual(left.actions);
  });

  it('advances the persisted cursor monotonically', async () => {
    const { simulationId } = await createSimulation({
      name: 'cursor',
      seed: 'cursor-seed',
      founderCount: 2,
    });
    await startSimulation(simulationId);

    let previous = (await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } }))
      .rngCursor;
    for (let i = 0; i < 6; i++) {
      await runCycle(simulationId);
      const current = (await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } }))
        .rngCursor;
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });
});
