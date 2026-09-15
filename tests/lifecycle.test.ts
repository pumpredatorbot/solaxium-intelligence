import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  createSimulation,
  pauseSimulation,
  resetSimulation,
  runCycle,
  startSimulation,
  stopSimulation,
} from '@/lib/engine/engine';
import { resetDatabase } from './helpers';

beforeEach(async () => {
  await resetDatabase();
});

async function status(simulationId: string) {
  return (await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } })).status;
}

describe('simulation lifecycle', () => {
  it('starts from CREATED and records the start time', async () => {
    const { simulationId } = await createSimulation({ name: 'lifecycle', seed: 'lc-1' });
    expect(await status(simulationId)).toBe('CREATED');

    await startSimulation(simulationId);
    const simulation = await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } });
    expect(simulation.status).toBe('RUNNING');
    expect(simulation.startedAt).not.toBeNull();
  });

  it('pauses and resumes on the same random stream', async () => {
    const { simulationId } = await createSimulation({
      name: 'pause',
      seed: 'lc-2',
      founderCount: 2,
    });
    await startSimulation(simulationId);
    for (let i = 0; i < 5; i++) await runCycle(simulationId);

    await pauseSimulation(simulationId);
    expect(await status(simulationId)).toBe('PAUSED');

    const paused = await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } });
    // A paused simulation must not advance.
    await expect(runCycle(simulationId)).rejects.toThrow(/not RUNNING/);
    expect((await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } })).cycle).toBe(
      paused.cycle,
    );

    await startSimulation(simulationId);
    expect(await status(simulationId)).toBe('RUNNING');
    const report = await runCycle(simulationId);
    expect(report.cycle).toBe(paused.cycle + 1);
  });

  it('records the pause and resume in the event feed', async () => {
    const { simulationId } = await createSimulation({ name: 'events', seed: 'lc-3' });
    await startSimulation(simulationId);
    await pauseSimulation(simulationId);
    await startSimulation(simulationId);

    const events = await prisma.simulationEvent.findMany({
      where: { simulationId, type: { in: ['SIMULATION_STARTED', 'SIMULATION_PAUSED'] } },
      orderBy: { seq: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual([
      'SIMULATION_STARTED',
      'SIMULATION_PAUSED',
      'SIMULATION_STARTED',
    ]);
    expect(events[2].message).toMatch(/resumed/i);
  });

  it('stops permanently and refuses to restart', async () => {
    const { simulationId } = await createSimulation({ name: 'stop', seed: 'lc-4' });
    await startSimulation(simulationId);
    await stopSimulation(simulationId);

    expect(await status(simulationId)).toBe('STOPPED');
    const simulation = await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } });
    expect(simulation.endedAt).not.toBeNull();
    await expect(startSimulation(simulationId)).rejects.toThrow(/STOPPED/);
  });

  it('is idempotent for repeated start / pause / stop', async () => {
    const { simulationId } = await createSimulation({ name: 'idempotent', seed: 'lc-5' });
    await startSimulation(simulationId);
    await startSimulation(simulationId);
    expect(await status(simulationId)).toBe('RUNNING');

    await pauseSimulation(simulationId);
    await pauseSimulation(simulationId);
    expect(await status(simulationId)).toBe('PAUSED');

    await stopSimulation(simulationId);
    await stopSimulation(simulationId);
    expect(await status(simulationId)).toBe('STOPPED');
  });

  it('resets to cycle 0 and clears the population', async () => {
    const { simulationId } = await createSimulation({
      name: 'reset',
      seed: 'lc-6',
      founderCount: 3,
    });
    await startSimulation(simulationId);
    for (let i = 0; i < 15; i++) {
      const report = await runCycle(simulationId);
      if (report.status !== 'RUNNING') break;
    }

    const grown = await prisma.agent.count({ where: { simulationId } });
    expect(grown).toBeGreaterThanOrEqual(3);

    await resetSimulation(simulationId, { founderCount: 3 });

    const simulation = await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } });
    expect(simulation.status).toBe('CREATED');
    expect(simulation.cycle).toBe(0);
    expect(simulation.rngCursor).toBeGreaterThan(0); // founders consumed draws
    expect(simulation.startedAt).toBeNull();
    expect(simulation.endedAt).toBeNull();

    const agents = await prisma.agent.findMany({
      where: { simulationId },
      orderBy: { code: 'asc' },
    });
    expect(agents).toHaveLength(3);
    expect(agents.map((a) => a.code)).toEqual(['SX-001', 'SX-002', 'SX-003']);

    expect(await prisma.agentAction.count({ where: { simulationId } })).toBe(0);
    expect(await prisma.clone.count({ where: { simulationId } })).toBe(0);
    // Only the three founders' INITIAL_CAPITAL entries remain.
    expect(await prisma.transaction.count({ where: { simulationId } })).toBe(3);
  });

  it('can reset onto a different seed', async () => {
    const { simulationId } = await createSimulation({ name: 'reseed', seed: 'lc-7' });
    await resetSimulation(simulationId, { seed: 'a-different-seed', founderCount: 1 });
    const simulation = await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } });
    expect(simulation.seed).toBe('a-different-seed');
  });

  it('rejects operations on an unknown simulation', async () => {
    await expect(startSimulation('nope')).rejects.toThrow(/Unknown simulation/);
    await expect(runCycle('nope')).rejects.toThrow(/Unknown simulation/);
  });
});
