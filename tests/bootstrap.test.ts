/**
 * Boot resume.
 *
 * `Simulation.status` outlives the process; the runner does not. These assert
 * the reconciliation is correct and, above all, idempotent — a second runner
 * on the same simulation would advance it twice per beat and corrupt the RNG
 * cursor, destroying reproducibility.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  bootstrapOnce,
  resetBootstrapLatch,
  resumeRunningSimulations,
} from '@/lib/engine/bootstrap';
import { createSimulation, pauseSimulation, startSimulation, stopSimulation } from '@/lib/engine/engine';
import { getRunnerState, stopAllRunners, stopRunner } from '@/lib/engine/runner';
import { resetDatabase } from './helpers';

beforeEach(async () => {
  stopAllRunners();
  resetBootstrapLatch();
  await resetDatabase();
});

afterEach(() => {
  // Never leave a live timer behind for the next suite.
  stopAllRunners();
});

describe('resumeRunningSimulations', () => {
  it('re-arms a simulation the database still considers RUNNING', async () => {
    const { simulationId } = await createSimulation({ name: 'resume', seed: 'boot-1' });
    await startSimulation(simulationId);

    // Simulate a process restart: the row stays RUNNING, the timer is gone.
    stopRunner(simulationId);
    expect(getRunnerState(simulationId).running).toBe(false);

    const report = await resumeRunningSimulations();

    expect(report.resumed).toEqual([simulationId]);
    expect(report.alreadyRunning).toEqual([]);
    expect(report.error).toBeNull();
    expect(getRunnerState(simulationId).running).toBe(true);
  });

  it('never arms a second runner for the same simulation', async () => {
    const { simulationId } = await createSimulation({ name: 'idempotent', seed: 'boot-2' });
    await startSimulation(simulationId);
    stopRunner(simulationId);

    const first = await resumeRunningSimulations();
    const second = await resumeRunningSimulations();
    const third = await resumeRunningSimulations();

    expect(first.resumed).toEqual([simulationId]);
    // Subsequent calls recognise the live loop and leave it alone.
    expect(second.resumed).toEqual([]);
    expect(second.alreadyRunning).toEqual([simulationId]);
    expect(third.alreadyRunning).toEqual([simulationId]);
    expect(getRunnerState(simulationId).running).toBe(true);
  });

  it('leaves simulations that are not RUNNING alone', async () => {
    const created = await createSimulation({ name: 'created', seed: 'boot-3' });

    const paused = await createSimulation({ name: 'paused', seed: 'boot-4' });
    await startSimulation(paused.simulationId);
    await pauseSimulation(paused.simulationId);
    stopRunner(paused.simulationId);

    const stopped = await createSimulation({ name: 'stopped', seed: 'boot-5' });
    await startSimulation(stopped.simulationId);
    await stopSimulation(stopped.simulationId);
    stopRunner(stopped.simulationId);

    const report = await resumeRunningSimulations();

    expect(report.resumed).toEqual([]);
    for (const id of [created.simulationId, paused.simulationId, stopped.simulationId]) {
      expect(getRunnerState(id).running).toBe(false);
    }
  });

  it('resumes every live simulation, not just the first', async () => {
    const ids: string[] = [];
    for (const seed of ['boot-6', 'boot-7', 'boot-8']) {
      const { simulationId } = await createSimulation({ name: seed, seed });
      await startSimulation(simulationId);
      stopRunner(simulationId);
      ids.push(simulationId);
    }

    const report = await resumeRunningSimulations();

    expect(report.resumed.sort()).toEqual([...ids].sort());
    for (const id of ids) expect(getRunnerState(id).running).toBe(true);
  });

  it('actually advances a resumed simulation', async () => {
    const { simulationId } = await createSimulation({
      name: 'advances',
      seed: 'boot-9',
      founderCount: 2,
    });
    await startSimulation(simulationId);
    stopRunner(simulationId);

    const before = (await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } }))
      .cycle;

    await resumeRunningSimulations();
    // Default speed is 1 cycle/s; give the loop room for at least one beat.
    await new Promise((resolve) => setTimeout(resolve, 2400));

    const after = (await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } }))
      .cycle;
    expect(after).toBeGreaterThan(before);
  }, 20_000);
});

describe('bootstrapOnce', () => {
  it('runs once per process and no-ops afterwards', async () => {
    const { simulationId } = await createSimulation({ name: 'once', seed: 'boot-10' });
    await startSimulation(simulationId);
    stopRunner(simulationId);

    const first = await bootstrapOnce();
    const second = await bootstrapOnce();
    const third = await bootstrapOnce();

    expect(first?.resumed).toEqual([simulationId]);
    // The latch means later calls do no work at all, not merely no harm.
    expect(second).toBeNull();
    expect(third).toBeNull();
  });

  it('runs again after the latch is reset', async () => {
    const { simulationId } = await createSimulation({ name: 'relatch', seed: 'boot-11' });
    await startSimulation(simulationId);
    stopRunner(simulationId);

    expect((await bootstrapOnce())?.resumed).toEqual([simulationId]);
    expect(await bootstrapOnce()).toBeNull();

    resetBootstrapLatch();
    stopRunner(simulationId);
    expect((await bootstrapOnce())?.resumed).toEqual([simulationId]);
  });
});
