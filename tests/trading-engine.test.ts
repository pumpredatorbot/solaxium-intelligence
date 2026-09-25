/**
 * The persisted paper-trading engine.
 *
 * Two claims carry the whole project, and both are asserted here against the
 * real database path rather than the in-memory harness:
 *
 *  - the ledger stays authoritative — an agent's balance is recomputable from
 *    its transactions, positions included;
 *  - a run reproduces exactly from its seed, so a result can be re-examined
 *    instead of merely believed.
 *
 * NO REAL VALUE MOVES: a position is an accounting entry against synthetic
 * prices. No wallet, no key, no network call.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createTradingRun, labelGenome, runTradingStep } from '@/lib/engine/trading-engine';
import { recomputeCapital } from '@/lib/engine/ledger';
import { toNum } from '@/lib/sol';
import { FOUNDER_TRADING_TRAITS, TRADING_TRAIT_KEYS } from '@/config/trading';
import { resetDatabase } from './helpers';

/**
 * Everything about a finished run that two seeded replays must agree on.
 *
 * Keyed by agent code and mint, never by cuid or timestamp: those differ
 * between two runs by design and would make the comparison vacuous.
 */
async function fingerprint(simulationId: string) {
  const agents = await prisma.agent.findMany({
    where: { simulationId },
    orderBy: { code: 'asc' },
    select: {
      code: true, generation: true, status: true, strategy: true, capitalLamports: true,
      tradesClosed: true, wins: true, tp1Hits: true, tp2Hits: true, stops: true,
      timeouts: true, fitness: true, rawFitness: true, clonesCreated: true,
      diedAtCycle: true, bornAtCycle: true,
      traits: { orderBy: { key: 'asc' }, select: { key: true, value: true } },
    },
  });

  const positions = await prisma.position.findMany({
    where: { simulationId },
    orderBy: [{ entryStep: 'asc' }, { mint: 'asc' }, { agent: { code: 'asc' } }],
    select: {
      mint: true, entryStep: true, exitStep: true, exitReason: true, status: true,
      sizeLamports: true, pnlLamports: true, returnPct: true, holdSteps: true,
      agent: { select: { code: true } },
    },
  });

  return {
    agents: agents.map((a) => ({ ...a, capitalLamports: toNum(a.capitalLamports) })),
    positions: positions.map((p) => ({
      ...p,
      code: p.agent.code,
      agent: undefined,
      sizeLamports: toNum(p.sizeLamports),
      pnlLamports: p.pnlLamports === null ? null : toNum(p.pnlLamports),
    })),
  };
}

/** Creates a run and advances it `steps` market steps. */
async function advance(
  seed: string,
  steps: number,
  founderCount = 12,
): Promise<string> {
  const created = await createTradingRun({
    name: `test ${seed}`,
    seed,
    marketSeed: `mkt-${seed}`,
    founderCount,
    steps: steps + 40,
  });
  await prisma.simulation.update({
    where: { id: created.simulationId },
    data: { status: 'RUNNING' },
  });
  for (let i = 0; i < steps; i++) {
    const report = await runTradingStep(created.simulationId);
    if (report.status !== 'RUNNING') break;
  }
  return created.simulationId;
}

beforeEach(async () => {
  await resetDatabase();
});

describe('creating a run', () => {
  it('seeds founders through the ledger, not a bare column write', async () => {
    const created = await createTradingRun({ seed: 'c1', founderCount: 6, steps: 200 });
    const agents = await prisma.agent.findMany({
      where: { simulationId: created.simulationId },
      include: { traits: true, transactions: true },
    });

    expect(agents).toHaveLength(6);
    for (const agent of agents) {
      expect(agent.generation).toBe(0);
      expect(agent.traits).toHaveLength(TRADING_TRAIT_KEYS.length);
      expect(agent.transactions).toHaveLength(1);
      expect(agent.transactions[0].type).toBe('INITIAL_CAPITAL');
      expect(toNum(agent.capitalLamports)).toBe(await recomputeCapital(prisma, agent.id));
    }
  });

  it('records the market by seed rather than by row', async () => {
    const created = await createTradingRun({ seed: 'c2', marketSeed: 'mkt-c2', steps: 300 });
    const simulation = await prisma.simulation.findUniqueOrThrow({
      where: { id: created.simulationId },
      include: { dataset: true },
    });

    expect(simulation.mode).toBe('TRADING');
    expect(simulation.dataset?.source).toBe('FIXTURE');
    expect(simulation.dataset?.seed).toBe('mkt-c2');
    expect(simulation.dataset?.tokenCount).toBeGreaterThan(0);
    // A fixture market is regenerated from its seed; storing its ticks would
    // cost hundreds of thousands of rows for no added information.
    expect(await prisma.token.count()).toBe(0);
  });

  it('refuses to step an economic run', async () => {
    const economic = await prisma.simulation.create({
      data: { name: 'econ', seed: 'e', config: {}, mode: 'ECONOMIC', status: 'RUNNING' },
    });
    await expect(runTradingStep(economic.id)).rejects.toThrow(/not a TRADING run/);
  });
});

describe('the ledger stays authoritative', () => {
  it('holds for every agent after a run with births and deaths', async () => {
    const simulationId = await advance('ledger', 50);
    const agents = await prisma.agent.findMany({ where: { simulationId } });
    expect(agents.length).toBeGreaterThan(0);

    for (const agent of agents) {
      expect(toNum(agent.capitalLamports)).toBe(await recomputeCapital(prisma, agent.id));
    }
  });

  it('writes one ledger entry per position opened and per position closed', async () => {
    const simulationId = await advance('entries', 45);
    const positions = await prisma.position.findMany({ where: { simulationId } });
    expect(positions.length).toBeGreaterThan(5);

    const opens = await prisma.transaction.count({
      where: { simulationId, metadata: { path: ['kind'], equals: 'POSITION_OPEN' } },
    });
    const closes = await prisma.transaction.count({
      where: { simulationId, metadata: { path: ['kind'], equals: 'POSITION_CLOSE' } },
    });
    expect(opens).toBe(positions.length);
    expect(closes).toBe(positions.filter((p) => p.status === 'CLOSED').length);
  });

  it('never leaves an agent holding negative capital', async () => {
    const simulationId = await advance('nonneg', 50);
    const agents = await prisma.agent.findMany({ where: { simulationId } });
    for (const agent of agents) {
      expect(toNum(agent.capitalLamports)).toBeGreaterThanOrEqual(0);
    }
  });

  it('never declares an agent dead while it still holds an open position', async () => {
    const simulationId = await advance('nodeath', 60);
    const dead = await prisma.agent.findMany({
      where: { simulationId, status: 'DEAD' },
      include: { positions: { where: { status: 'OPEN' } } },
    });
    for (const agent of dead) expect(agent.positions).toHaveLength(0);
  });
});

describe('replay determinism on the persisted path', () => {
  it('reproduces a whole run from its seed', async () => {
    const a = await advance('repro', 40);
    const b = await advance('repro', 40);

    const left = await fingerprint(a);
    const right = await fingerprint(b);

    // Guard against a vacuous pass: the run has to have actually done something.
    expect(left.positions.length).toBeGreaterThan(10);
    expect(left.agents.length).toBeGreaterThan(0);

    expect(right.agents).toEqual(left.agents);
    expect(right.positions).toEqual(left.positions);
  }, 180_000);

  it('produces a different run for a different seed', async () => {
    const a = await advance('seed-a', 35);
    const b = await advance('seed-b', 35);

    const left = await fingerprint(a);
    const right = await fingerprint(b);
    expect(right.positions).not.toEqual(left.positions);
  }, 180_000);

  it('survives a pause: the RNG cursor carries the whole generator state', async () => {
    // A run stepped in one go, and the same run stepped with a full reload of
    // the engine state in the middle, must land in the same place. This is the
    // property that lets a paused run resume identically after a restart.
    const straight = await advance('pause', 30);

    const created = await createTradingRun({
      name: 'paused', seed: 'pause', marketSeed: 'mkt-pause', founderCount: 12, steps: 70,
    });
    await prisma.simulation.update({
      where: { id: created.simulationId },
      data: { status: 'RUNNING' },
    });
    for (let i = 0; i < 15; i++) await runTradingStep(created.simulationId);
    // Pause: nothing is held in memory between these two loops — the next step
    // rebuilds the RNG from the persisted cursor alone.
    await prisma.simulation.update({
      where: { id: created.simulationId },
      data: { status: 'PAUSED' },
    });
    await prisma.$disconnect();
    await prisma.simulation.update({
      where: { id: created.simulationId },
      data: { status: 'RUNNING' },
    });
    for (let i = 0; i < 15; i++) await runTradingStep(created.simulationId);

    const left = await fingerprint(straight);
    const right = await fingerprint(created.simulationId);
    expect(left.positions.length).toBeGreaterThan(10);
    expect(right.positions).toEqual(left.positions);
    expect(right.agents).toEqual(left.agents);
  }, 180_000);

  it('advances the persisted RNG cursor without ever rewinding it', async () => {
    const created = await createTradingRun({ seed: 'cursor', founderCount: 10, steps: 120 });
    await prisma.simulation.update({
      where: { id: created.simulationId },
      data: { status: 'RUNNING' },
    });

    let previous = -1;
    for (let i = 0; i < 10; i++) {
      await runTradingStep(created.simulationId);
      const { rngCursor } = await prisma.simulation.findUniqueOrThrow({
        where: { id: created.simulationId },
        select: { rngCursor: true },
      });
      expect(rngCursor).toBeGreaterThanOrEqual(previous);
      previous = rngCursor;
    }
  });
});

describe('genome labelling', () => {
  it('calls a neutral genome BALANCED, so no founder looks pre-programmed', () => {
    expect(labelGenome(FOUNDER_TRADING_TRAITS)).toBe('BALANCED');
  });

  it('names a pronounced tendency', () => {
    expect(labelGenome({ ...FOUNDER_TRADING_TRAITS, riskTolerance: 1 })).toBe('SIZE_HUNTER');
    expect(labelGenome({ ...FOUNDER_TRADING_TRAITS, entrySpeed: 1, momentumWeight: 1 }))
      .toBe('MOMENTUM_SNIPER');
    expect(labelGenome({ ...FOUNDER_TRADING_TRAITS, capitalPreservation: 1, riskTolerance: 0 }))
      .toBe('CONSERVATIVE');
  });
});
