import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { lamportsToSol, solToLamports, toNum } from '@/lib/sol';
import { recomputeCapital } from '@/lib/engine/ledger';
import {
  createSimulation,
  isEligibleToClone,
  runCycle,
  startSimulation,
  validateAction,
} from '@/lib/engine/engine';
import { resolveConfig } from '@/lib/engine/config';
import { DEFAULT_SIMULATION_CONFIG } from '@/config/simulation';
import { CLONE_READY_CONFIG, creditAgent, resetDatabase, FAST_DEATH_CONFIG } from './helpers';

beforeEach(async () => {
  await resetDatabase();
});

describe('agent creation', () => {
  it('creates founders with the configured starting capital and a full genome', async () => {
    const { simulationId, founderIds } = await createSimulation({
      name: 'birth',
      seed: 'birth-1',
      founderCount: 3,
    });

    const agents = await prisma.agent.findMany({
      where: { simulationId },
      orderBy: { code: 'asc' },
      include: { traits: true, wallet: true },
    });

    expect(agents).toHaveLength(3);
    expect(agents.map((a) => a.code)).toEqual(['SX-001', 'SX-002', 'SX-003']);
    expect(founderIds).toHaveLength(3);

    for (const agent of agents) {
      expect(agent.status).toBe('ALIVE');
      expect(agent.generation).toBe(0);
      expect(agent.parentId).toBeNull();
      expect(toNum(agent.capitalLamports)).toBe(solToLamports(1));
      expect(toNum(agent.startingCapitalLamports)).toBe(solToLamports(1));
      expect(agent.traits).toHaveLength(8);
      for (const trait of agent.traits) {
        expect(trait.value).toBeGreaterThanOrEqual(0);
        expect(trait.value).toBeLessThanOrEqual(1);
      }
      // Wallets in V1 are virtual identifiers with no keypair behind them.
      expect(agent.wallet?.network).toBe('simulation');
      expect(agent.wallet?.publicAddress.startsWith('SIMx')).toBe(true);
    }
  });

  it('emits an AGENT_BORN event and a founding memory for each founder', async () => {
    const { simulationId, founderIds } = await createSimulation({
      name: 'events',
      seed: 'events-1',
      founderCount: 2,
    });

    const born = await prisma.simulationEvent.findMany({
      where: { simulationId, type: 'AGENT_BORN' },
    });
    expect(born).toHaveLength(2);

    const memories = await prisma.agentMemory.findMany({ where: { agentId: founderIds[0] } });
    expect(memories).toHaveLength(1);
    expect(memories[0].kind).toBe('STRATEGY');
  });

  it('opens generation 0 with the founders in it', async () => {
    const { simulationId } = await createSimulation({
      name: 'gen0',
      seed: 'gen0-1',
      founderCount: 4,
    });
    const generation = await prisma.generation.findUniqueOrThrow({
      where: { simulationId_number: { simulationId, number: 0 } },
    });
    expect(generation.agentCount).toBe(4);
    expect(generation.aliveCount).toBe(4);
    expect(generation.deadCount).toBe(0);
  });
});

describe('cycles, revenue and expenses', () => {
  it('has every living agent act exactly once per cycle', async () => {
    const { simulationId } = await createSimulation({
      name: 'cycle',
      seed: 'cycle-1',
      founderCount: 3,
    });
    await startSimulation(simulationId);

    const report = await runCycle(simulationId);

    expect(report.cycle).toBe(1);
    expect(report.agents).toHaveLength(3);

    const actions = await prisma.agentAction.findMany({ where: { simulationId, cycle: 1 } });
    expect(actions).toHaveLength(3);
    for (const action of actions) {
      expect(action.reasoning.length).toBeGreaterThan(0);
      expect(action.provider).toBe('demo');
      expect(action.confidence).toBeGreaterThanOrEqual(0);
      expect(action.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('charges cycle upkeep to every living agent', async () => {
    const { simulationId, founderIds } = await createSimulation({
      name: 'upkeep',
      seed: 'upkeep-1',
      founderCount: 1,
      // REST is free, so upkeep is the only guaranteed outflow.
      config: { CYCLE_COST_SOL: 0.05 },
    });
    await startSimulation(simulationId);
    await runCycle(simulationId);

    const upkeep = await prisma.transaction.findMany({
      where: { agentId: founderIds[0], type: 'EXPENSE' },
    });
    const upkeepRow = upkeep.find(
      (row) => (row.metadata as { kind?: string })?.kind === 'CYCLE_UPKEEP',
    );
    expect(upkeepRow).toBeDefined();
    expect(toNum(upkeepRow!.amountLamports)).toBe(-solToLamports(0.05));
  });

  it('moves capital only through the ledger over a long run', async () => {
    const { simulationId } = await createSimulation({
      name: 'invariant',
      seed: 'invariant-1',
      founderCount: 3,
    });
    await startSimulation(simulationId);
    for (let i = 0; i < 25; i++) {
      const report = await runCycle(simulationId);
      if (report.status !== 'RUNNING') break;
    }

    const agents = await prisma.agent.findMany({ where: { simulationId } });
    expect(agents.length).toBeGreaterThan(3);

    for (const agent of agents) {
      expect(toNum(agent.capitalLamports)).toBe(await recomputeCapital(prisma, agent.id));
    }
  });

  it('records revenue and expense events alongside the action', async () => {
    const { simulationId } = await createSimulation({
      name: 'cashflow',
      seed: 'cashflow-1',
      founderCount: 3,
    });
    await startSimulation(simulationId);
    for (let i = 0; i < 5; i++) await runCycle(simulationId);

    const revenue = await prisma.simulationEvent.count({
      where: { simulationId, type: 'AGENT_REVENUE' },
    });
    const expense = await prisma.simulationEvent.count({
      where: { simulationId, type: 'AGENT_EXPENSE' },
    });
    expect(revenue).toBeGreaterThan(0);
    expect(expense).toBeGreaterThan(0);
  });

  it('refuses to run a simulation that is not RUNNING', async () => {
    const { simulationId } = await createSimulation({ name: 'idle', seed: 'idle-1' });
    await expect(runCycle(simulationId)).rejects.toThrow(/not RUNNING/);
    // force single-steps regardless, for operators and tests.
    await expect(runCycle(simulationId, { force: true })).resolves.toMatchObject({ cycle: 1 });
  });
});

describe('death', () => {
  it('kills an agent whose capital reaches the death threshold', async () => {
    const { simulationId, founderIds } = await createSimulation({
      name: 'death',
      seed: 'death-1',
      founderCount: 1,
      config: FAST_DEATH_CONFIG,
    });
    await startSimulation(simulationId);

    const report = await runCycle(simulationId);

    expect(report.agents[0].died).toBe(true);
    expect(report.deaths).toBe(1);

    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: founderIds[0] } });
    expect(agent.status).toBe('DEAD');
    expect(agent.diedAtCycle).toBe(1);
    expect(agent.diedAt).not.toBeNull();
    expect(toNum(agent.capitalLamports)).toBe(0);
  });

  it('never lets a dead agent act, earn, spend or clone again', async () => {
    const { simulationId, founderIds } = await createSimulation({
      name: 'no-act-after-death',
      seed: 'dead-2',
      founderCount: 1,
      config: FAST_DEATH_CONFIG,
    });
    await startSimulation(simulationId);
    await runCycle(simulationId, { force: true });

    const actionsAtDeath = await prisma.agentAction.count({ where: { agentId: founderIds[0] } });
    const txAtDeath = await prisma.transaction.count({ where: { agentId: founderIds[0] } });

    for (let i = 0; i < 5; i++) await runCycle(simulationId, { force: true });

    expect(await prisma.agentAction.count({ where: { agentId: founderIds[0] } })).toBe(
      actionsAtDeath,
    );
    expect(await prisma.transaction.count({ where: { agentId: founderIds[0] } })).toBe(txAtDeath);
    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: founderIds[0] } });
    expect(agent.clonesCreated).toBe(0);
    expect(agent.cycles).toBe(1);
  });

  it('preserves the dead agent’s full history', async () => {
    const { simulationId, founderIds } = await createSimulation({
      name: 'history',
      seed: 'dead-3',
      founderCount: 1,
      config: FAST_DEATH_CONFIG,
    });
    await startSimulation(simulationId);
    await runCycle(simulationId);

    expect(await prisma.transaction.count({ where: { agentId: founderIds[0] } })).toBeGreaterThan(0);
    expect(await prisma.agentAction.count({ where: { agentId: founderIds[0] } })).toBe(1);
    const deathEvent = await prisma.simulationEvent.findFirst({
      where: { agentId: founderIds[0], type: 'AGENT_DEAD' },
    });
    expect(deathEvent).not.toBeNull();
    expect((deathEvent!.data as { finalCapitalSol: number }).finalCapitalSol).toBe(0);
  });

  it('completes the simulation when the last agent dies', async () => {
    const { simulationId } = await createSimulation({
      name: 'extinction',
      seed: 'extinct-1',
      founderCount: 2,
      config: FAST_DEATH_CONFIG,
    });
    await startSimulation(simulationId);
    const report = await runCycle(simulationId);

    expect(report.aliveAfter).toBe(0);
    expect(report.status).toBe('COMPLETED');
    const simulation = await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } });
    expect(simulation.status).toBe('COMPLETED');
    expect(simulation.endedAt).not.toBeNull();
  });
});

describe('cloning', () => {
  it('creates a clone once an agent crosses the threshold', async () => {
    const { simulationId, founderIds } = await createSimulation({
      name: 'clone',
      seed: 'clone-1',
      founderCount: 1,
      config: CLONE_READY_CONFIG,
    });
    await startSimulation(simulationId);
    // Put the founder over the threshold through the ledger, as the economy would.
    await creditAgent(founderIds[0], simulationId, 20);
    const report = await runCycle(simulationId);

    expect(report.births).toBe(1);
    expect(report.agents[0].cloned).not.toBeNull();

    const child = await prisma.agent.findFirstOrThrow({ where: { parentId: founderIds[0] } });
    expect(child.generation).toBe(1);
    expect(child.parentId).toBe(founderIds[0]);
    expect(child.code).toBe('SX-002');
    // The offspring is endowed by the treasury, not out of the parent's balance.
    expect(toNum(child.capitalLamports)).toBe(solToLamports(1));

    const parent = await prisma.agent.findUniqueOrThrow({ where: { id: founderIds[0] } });
    expect(parent.clonesCreated).toBe(1);
  });

  it('does not deduct the parent’s capital by default', async () => {
    const { simulationId, founderIds } = await createSimulation({
      name: 'clone-cost',
      seed: 'clone-2',
      founderCount: 1,
      config: CLONE_READY_CONFIG,
    });
    await startSimulation(simulationId);
    await creditAgent(founderIds[0], simulationId, 20);

    const before = await prisma.agent.findUniqueOrThrow({ where: { id: founderIds[0] } });
    await runCycle(simulationId);
    const after = await prisma.agent.findUniqueOrThrow({ where: { id: founderIds[0] } });

    const cloneCosts = await prisma.transaction.findMany({
      where: { agentId: founderIds[0] },
    });
    expect(cloneCosts.some((t) => (t.metadata as { kind?: string })?.kind === 'CLONE_COST')).toBe(
      false,
    );
    // Capital still moves from the action itself, just never from reproducing.
    expect(toNum(after.capitalLamports)).toBeGreaterThanOrEqual(
      toNum(before.capitalLamports) - solToLamports(1),
    );
  });

  it('caps offspring at MAX_CLONES_PER_AGENT', async () => {
    const { simulationId, founderIds } = await createSimulation({
      name: 'max-clones',
      seed: 'clone-3',
      founderCount: 1,
      config: { ...CLONE_READY_CONFIG, MAX_CLONES_PER_AGENT: 3 },
    });
    await startSimulation(simulationId);
    await creditAgent(founderIds[0], simulationId, 200);
    for (let i = 0; i < 12; i++) await runCycle(simulationId, { force: true });

    const parent = await prisma.agent.findUniqueOrThrow({ where: { id: founderIds[0] } });
    expect(parent.clonesCreated).toBeLessThanOrEqual(3);
    expect(await prisma.agent.count({ where: { parentId: founderIds[0] } })).toBeLessThanOrEqual(3);
  });

  it('produces at most one offspring per parent per cycle', async () => {
    const { simulationId, founderIds } = await createSimulation({
      name: 'one-per-cycle',
      seed: 'clone-4',
      founderCount: 1,
      config: CLONE_READY_CONFIG,
    });
    await startSimulation(simulationId);
    await creditAgent(founderIds[0], simulationId, 200);
    await runCycle(simulationId);
    expect(await prisma.agent.count({ where: { parentId: founderIds[0] } })).toBe(1);
  });

  it('records the mutation that produced each clone', async () => {
    const { simulationId, founderIds } = await createSimulation({
      name: 'clone-mutations',
      seed: 'clone-5',
      founderCount: 1,
      config: CLONE_READY_CONFIG,
    });
    await startSimulation(simulationId);
    await creditAgent(founderIds[0], simulationId, 20);
    await runCycle(simulationId);

    const clone = await prisma.clone.findFirstOrThrow({ where: { parentId: founderIds[0] } });
    const mutations = clone.mutations as { trait: string; from: number; to: number }[];
    expect(Array.isArray(mutations)).toBe(true);

    const parentTraits = await prisma.agentTrait.findMany({ where: { agentId: founderIds[0] } });
    const childTraits = await prisma.agentTrait.findMany({ where: { agentId: clone.childId } });
    expect(childTraits).toHaveLength(8);

    // Every recorded mutation must match what the child actually carries.
    for (const mutation of mutations) {
      const child = childTraits.find((t) => t.key === mutation.trait)!;
      const parent = parentTraits.find((t) => t.key === mutation.trait)!;
      expect(child.value).toBeCloseTo(mutation.to, 3);
      expect(parent.value).toBeCloseTo(mutation.from, 3);
    }
  });

  it('respects the eligibility rules', () => {
    const config = resolveConfig({});
    const base = {
      capitalLamports: solToLamports(config.CLONE_THRESHOLD_SOL),
      clonesCreated: 0,
      generation: 0,
      cycles: config.MIN_AGE_FOR_CLONING,
    };

    expect(isEligibleToClone(base, config)).toBe(true);
    expect(isEligibleToClone({ ...base, capitalLamports: solToLamports(1) }, config)).toBe(false);
    expect(
      isEligibleToClone({ ...base, clonesCreated: config.MAX_CLONES_PER_AGENT }, config),
    ).toBe(false);
    expect(isEligibleToClone({ ...base, cycles: 0 }, config)).toBe(
      config.MIN_AGE_FOR_CLONING === 0,
    );
    expect(isEligibleToClone({ ...base, generation: config.MAX_GENERATIONS }, config)).toBe(false);
  });

  it('respects the live population cap', async () => {
    const { simulationId } = await createSimulation({
      name: 'pop-cap',
      seed: 'clone-6',
      founderCount: 3,
      config: { ...CLONE_READY_CONFIG, MAX_LIVE_AGENTS: 5 },
    });
    await startSimulation(simulationId);
    for (let i = 0; i < 10; i++) await runCycle(simulationId, { force: true });

    expect(await prisma.agent.count({ where: { simulationId, status: 'ALIVE' } })).toBeLessThanOrEqual(5);
  });
});

describe('generations', () => {
  it('advances the generation number and records the cohort', async () => {
    const { simulationId } = await createSimulation({
      name: 'generations',
      seed: 'gen-1',
      founderCount: 2,
      config: CLONE_READY_CONFIG,
    });
    await startSimulation(simulationId);
    const founders = await prisma.agent.findMany({ where: { simulationId } });
    for (const founder of founders) await creditAgent(founder.id, simulationId, 200);
    for (let i = 0; i < 4; i++) await runCycle(simulationId, { force: true });

    const generations = await prisma.generation.findMany({
      where: { simulationId },
      orderBy: { number: 'asc' },
    });
    expect(generations.length).toBeGreaterThan(1);
    expect(generations[0].number).toBe(0);
    expect(generations[1].number).toBe(1);

    for (const generation of generations) {
      const actual = await prisma.agent.count({
        where: { simulationId, generation: generation.number },
      });
      expect(generation.agentCount).toBe(actual);
      expect(generation.aliveCount + generation.deadCount).toBe(generation.agentCount);
    }

    const started = await prisma.simulationEvent.count({
      where: { simulationId, type: 'GENERATION_STARTED' },
    });
    expect(started).toBe(generations.length);
  });

  it('links parents and children both ways', async () => {
    const { simulationId } = await createSimulation({
      name: 'lineage',
      seed: 'lineage-1',
      founderCount: 1,
      config: CLONE_READY_CONFIG,
    });
    await startSimulation(simulationId);
    const [founder] = await prisma.agent.findMany({ where: { simulationId } });
    await creditAgent(founder.id, simulationId, 200);
    for (let i = 0; i < 3; i++) await runCycle(simulationId, { force: true });

    const withChildren = await prisma.agent.findMany({
      where: { simulationId },
      include: { children: true, parent: true },
    });

    for (const agent of withChildren) {
      for (const child of agent.children) {
        expect(child.parentId).toBe(agent.id);
        expect(child.generation).toBe(agent.generation + 1);
      }
      if (agent.parent) {
        expect(agent.generation).toBe(agent.parent.generation + 1);
      }
    }
  });
});

describe('the engine validates every proposal', () => {
  it('substitutes REST for an action the agent cannot perform', () => {
    const snapshot = {
      availableActions: [
        { type: 'REST' as const },
        { type: 'OFFER_SERVICE' as const },
      ],
    } as never;

    expect(validateAction('OFFER_SERVICE', snapshot)).toBe('OFFER_SERVICE');
    expect(validateAction('INVEST_IN_GROWTH', snapshot)).toBe('REST');
  });
});

describe('configuration safety', () => {
  it('clamps out-of-range overrides', () => {
    const config = resolveConfig({
      INITIAL_CAPITAL_SOL: -5,
      MUTATION_RATE: 99,
      MAX_LIVE_AGENTS: 10_000_000,
    });
    expect(config.INITIAL_CAPITAL_SOL).toBeGreaterThan(0);
    expect(config.MUTATION_RATE).toBeLessThanOrEqual(1);
    expect(config.MAX_LIVE_AGENTS).toBeLessThanOrEqual(5000);
  });

  it('never lets the clone threshold sit at or below starting capital', () => {
    const config = resolveConfig({ INITIAL_CAPITAL_SOL: 5, CLONE_THRESHOLD_SOL: 2 });
    expect(config.CLONE_THRESHOLD_SOL).toBeGreaterThan(config.INITIAL_CAPITAL_SOL);
  });

  it('ignores garbage and falls back to defaults', () => {
    expect(resolveConfig(null).INITIAL_CAPITAL_SOL).toBe(
      DEFAULT_SIMULATION_CONFIG.INITIAL_CAPITAL_SOL,
    );
    expect(resolveConfig('nonsense').CYCLE_COST_SOL).toBe(
      DEFAULT_SIMULATION_CONFIG.CYCLE_COST_SOL,
    );
    expect(resolveConfig({ INITIAL_CAPITAL_SOL: 'lots' }).INITIAL_CAPITAL_SOL).toBe(
      DEFAULT_SIMULATION_CONFIG.INITIAL_CAPITAL_SOL,
    );
  });
});

describe('market conditions', () => {
  it('produces a bounded oscillation with readable labels', async () => {
    const config = resolveConfig({});
    const { marketAt } = await import('@/lib/engine/actions');
    for (let cycle = 0; cycle < 200; cycle++) {
      const market = marketAt(cycle, config);
      expect(market.multiplier).toBeGreaterThanOrEqual(1 - config.MARKET_AMPLITUDE - 1e-9);
      expect(market.multiplier).toBeLessThanOrEqual(1 + config.MARKET_AMPLITUDE + 1e-9);
      expect(['RECESSION', 'SLOWDOWN', 'STABLE', 'GROWTH', 'BOOM']).toContain(market.label);
    }
    expect(lamportsToSol(solToLamports(1))).toBe(1);
  });
});
