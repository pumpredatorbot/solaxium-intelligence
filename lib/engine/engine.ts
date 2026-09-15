/**
 * SOLAXIUM simulation engine.
 *
 * Framework-free by design: no React, no Next.js, no request object. It talks
 * to Prisma and to an AIProvider, and it is driven either by the live runner
 * (lib/engine/runner.ts), an API route, a test, or `npm run simulate`.
 *
 * Invariants it enforces:
 *   - a dead agent never acts, earns, spends or reproduces again;
 *   - every lamport movement is a ledger row written in the same transaction
 *     as the balance update;
 *   - the entire run is reproducible from (seed, config).
 */

import { ACTION_DEFINITIONS, type SimulationConfig } from '@/config/simulation';
import type { ActionType, AgentStatus } from '@/lib/types';
import { prisma } from '@/lib/db';
import { createRng, generateSeed, type SeededRandom } from '@/lib/rng';
import { lamportsToSol, solToLamports, toNum } from '@/lib/sol';
import { think } from '@/lib/ai/agent-brain';
import { createSimulatedWallet } from '@/lib/solana/wallet';
import { decayMomentum, marketAt, resolveAction } from './actions';
import { resolveConfig, serialisableConfig } from './config';
import { emit } from './events';
import { postEntry, type DbClient } from './ledger';
import { compactMemory, recallForPrompt, remember } from './memory';
import { formatAgentCode, generateAgentName } from './naming';
import type { AgentSnapshot, AvailableAction, MarketConditions } from './snapshot';
import { deriveStrategy } from './strategy';
import { mutateTraits, type TraitMutation } from './mutation';
import { clamp01, randomTraits, traitsFromRows, traitsToRows, type TraitVector } from './traits';

// ---------------------------------------------------------------------------
// Simulation lifecycle
// ---------------------------------------------------------------------------

export interface CreateSimulationInput {
  name?: string;
  seed?: string;
  founderCount?: number;
  config?: Record<string, unknown>;
}

export interface CreateSimulationResult {
  simulationId: string;
  seed: string;
  founderIds: string[];
}

export async function createSimulation(
  input: CreateSimulationInput = {},
): Promise<CreateSimulationResult> {
  const seed = input.seed?.trim() || generateSeed();
  const config = resolveConfig(input.config);
  const founderCount = Math.min(Math.max(input.founderCount ?? 1, 1), 12);

  const simulation = await prisma.simulation.create({
    data: {
      name: input.name?.trim() || `Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      seed,
      status: 'CREATED',
      cycle: 0,
      rngCursor: 0,
      config: serialisableConfig(config),
    },
  });

  await emit(prisma, {
    simulationId: simulation.id,
    type: 'SIMULATION_CREATED',
    cycle: 0,
    message: `Simulation "${simulation.name}" created with seed ${seed}.`,
    data: { seed, founderCount },
  });

  const rng = createRng(seed, 0);
  const founderIds: string[] = [];

  for (let i = 0; i < founderCount; i++) {
    const agent = await spawnAgent(prisma, {
      simulationId: simulation.id,
      config,
      rng,
      cycle: 0,
      generation: 0,
      parent: null,
    });
    founderIds.push(agent.id);
  }

  await refreshGeneration(prisma, simulation.id, 0, 0, config);
  await emit(prisma, {
    simulationId: simulation.id,
    type: 'GENERATION_STARTED',
    cycle: 0,
    message: `Generation 0 opened with ${founderCount} founder${founderCount === 1 ? '' : 's'}.`,
    data: { generation: 0 },
  });

  await prisma.simulation.update({
    where: { id: simulation.id },
    data: { rngCursor: rng.cursor },
  });

  return { simulationId: simulation.id, seed, founderIds };
}

export async function startSimulation(simulationId: string): Promise<void> {
  const simulation = await requireSimulation(simulationId);
  if (simulation.status === 'COMPLETED' || simulation.status === 'STOPPED') {
    throw new Error(`Simulation ${simulationId} is ${simulation.status} and cannot be restarted.`);
  }
  if (simulation.status === 'RUNNING') return;

  await prisma.simulation.update({
    where: { id: simulationId },
    data: { status: 'RUNNING', startedAt: simulation.startedAt ?? new Date() },
  });
  await emit(prisma, {
    simulationId,
    type: 'SIMULATION_STARTED',
    cycle: simulation.cycle,
    message:
      simulation.status === 'PAUSED'
        ? `Simulation resumed at cycle ${simulation.cycle}.`
        : `Simulation started.`,
  });
}

export async function pauseSimulation(simulationId: string): Promise<void> {
  const simulation = await requireSimulation(simulationId);
  if (simulation.status !== 'RUNNING') return;

  await prisma.simulation.update({ where: { id: simulationId }, data: { status: 'PAUSED' } });
  await emit(prisma, {
    simulationId,
    type: 'SIMULATION_PAUSED',
    cycle: simulation.cycle,
    message: `Simulation paused at cycle ${simulation.cycle}.`,
  });
}

export async function stopSimulation(simulationId: string): Promise<void> {
  const simulation = await requireSimulation(simulationId);
  if (simulation.status === 'STOPPED' || simulation.status === 'COMPLETED') return;

  await prisma.simulation.update({
    where: { id: simulationId },
    data: { status: 'STOPPED', endedAt: new Date() },
  });
  await emit(prisma, {
    simulationId,
    type: 'SIMULATION_STOPPED',
    cycle: simulation.cycle,
    message: `Simulation stopped at cycle ${simulation.cycle}.`,
  });
}

/**
 * Resets a simulation to cycle 0, re-seeding the same (or a new) run.
 *
 * Everything downstream of the Simulation row is deleted by cascade, then the
 * founders are respawned from the seed — so a reset with the same seed
 * reproduces the same population exactly.
 */
export async function resetSimulation(
  simulationId: string,
  options: { seed?: string; founderCount?: number } = {},
): Promise<CreateSimulationResult> {
  const simulation = await requireSimulation(simulationId);
  const config = resolveConfig(simulation.config);
  const seed = options.seed?.trim() || simulation.seed;

  await prisma.$transaction([
    prisma.simulationEvent.deleteMany({ where: { simulationId } }),
    prisma.generation.deleteMany({ where: { simulationId } }),
    prisma.clone.deleteMany({ where: { simulationId } }),
    prisma.transaction.deleteMany({ where: { simulationId } }),
    prisma.agentAction.deleteMany({ where: { simulationId } }),
    prisma.agent.deleteMany({ where: { simulationId } }),
    prisma.simulation.update({
      where: { id: simulationId },
      data: { status: 'CREATED', cycle: 0, rngCursor: 0, seed, startedAt: null, endedAt: null },
    }),
  ]);

  await emit(prisma, {
    simulationId,
    type: 'SIMULATION_CREATED',
    cycle: 0,
    message: `Simulation reset to cycle 0 with seed ${seed}.`,
    data: { seed },
  });

  const rng = createRng(seed, 0);
  const founderCount = Math.min(Math.max(options.founderCount ?? 1, 1), 12);
  const founderIds: string[] = [];

  for (let i = 0; i < founderCount; i++) {
    const agent = await spawnAgent(prisma, {
      simulationId,
      config,
      rng,
      cycle: 0,
      generation: 0,
      parent: null,
    });
    founderIds.push(agent.id);
  }

  await refreshGeneration(prisma, simulationId, 0, 0, config);
  await emit(prisma, {
    simulationId,
    type: 'GENERATION_STARTED',
    cycle: 0,
    message: `Generation 0 opened with ${founderCount} founder${founderCount === 1 ? '' : 's'}.`,
    data: { generation: 0 },
  });
  await prisma.simulation.update({ where: { id: simulationId }, data: { rngCursor: rng.cursor } });

  return { simulationId, seed, founderIds };
}

// ---------------------------------------------------------------------------
// Birth
// ---------------------------------------------------------------------------

export interface SpawnAgentInput {
  simulationId: string;
  config: SimulationConfig;
  rng: SeededRandom;
  cycle: number;
  generation: number;
  parent: {
    id: string;
    code: string;
    traits: TraitVector;
    strategy: string;
  } | null;
  mutations?: TraitMutation[];
}

export interface SpawnedAgent {
  id: string;
  code: string;
  name: string;
  generation: number;
  traits: TraitVector;
  strategy: string;
}

export async function spawnAgent(db: DbClient, input: SpawnAgentInput): Promise<SpawnedAgent> {
  const { simulationId, config, rng, cycle, generation, parent } = input;

  const index = (await db.agent.count({ where: { simulationId } })) + 1;
  const code = formatAgentCode(index);
  const name = generateAgentName(rng);

  const traits = parent ? parent.traits : randomTraits(rng);
  const strategy = parent ? parent.strategy : deriveStrategy(traits);
  const startingLamports = solToLamports(config.INITIAL_CAPITAL_SOL);

  const agent = await db.agent.create({
    data: {
      simulationId,
      code,
      name,
      generation,
      parentId: parent?.id ?? null,
      status: 'ALIVE',
      // Capital starts at zero and is credited through the ledger, so the
      // very first lamports an agent owns already have a transaction behind them.
      capitalLamports: 0n,
      startingCapitalLamports: BigInt(startingLamports),
      peakCapitalLamports: 0n,
      bornAtCycle: cycle,
      strategy,
      momentum: 1,
    },
    select: { id: true },
  });

  await db.agentTrait.createMany({
    data: traitsToRows(traits).map((t) => ({ agentId: agent.id, key: t.key, value: t.value })),
  });

  const wallet = createSimulatedWallet(agent.id, rng);
  await db.agentWallet.create({
    data: {
      agentId: agent.id,
      provider: wallet.provider,
      publicAddress: wallet.publicAddress,
      network: wallet.network,
    },
  });

  await postEntry(db, {
    agentId: agent.id,
    simulationId,
    type: parent ? 'CLONE_BONUS' : 'INITIAL_CAPITAL',
    amountLamports: startingLamports,
    cycle,
    metadata: parent ? { parentCode: parent.code } : { origin: 'TREASURY' },
  });

  await remember(db, {
    agentId: agent.id,
    kind: 'STRATEGY',
    content: parent
      ? `Born from ${parent.code} in generation ${generation} with an inherited ${strategy} strategy.`
      : `Founded generation 0 with a ${strategy} strategy and ${config.INITIAL_CAPITAL_SOL} SOL.`,
    importance: 0.9,
    cycle,
  });

  await emit(db, {
    simulationId,
    type: 'AGENT_BORN',
    cycle,
    agentId: agent.id,
    agentCode: code,
    message: parent
      ? `${code} born from ${parent.code} — generation ${generation}, starting capital ${config.INITIAL_CAPITAL_SOL} SOL.`
      : `${code} born — generation ${generation}, starting capital ${config.INITIAL_CAPITAL_SOL} SOL.`,
    data: {
      generation,
      parentCode: parent?.code ?? null,
      startingCapitalSol: config.INITIAL_CAPITAL_SOL,
      strategy,
    },
  });

  return { id: agent.id, code, name, generation, traits, strategy };
}

// ---------------------------------------------------------------------------
// The cycle
// ---------------------------------------------------------------------------

export interface AgentCycleReport {
  agentId: string;
  code: string;
  generation: number;
  action: ActionType;
  outcome: 'SUCCESS' | 'PARTIAL' | 'FAILURE';
  reasoning: string;
  provider: string;
  confidence: number;
  costSol: number;
  revenueSol: number;
  capitalBeforeSol: number;
  capitalAfterSol: number;
  died: boolean;
  cloned: { childId: string; childCode: string; generation: number } | null;
}

export interface CycleReport {
  simulationId: string;
  cycle: number;
  market: MarketConditions;
  agents: AgentCycleReport[];
  births: number;
  deaths: number;
  aliveAfter: number;
  status: 'RUNNING' | 'COMPLETED' | 'PAUSED' | 'STOPPED' | 'CREATED';
}

/**
 * Advances the simulation by exactly one cycle.
 *
 * `force` bypasses the RUNNING check so an operator (or a test) can single-step
 * a paused simulation without starting the live loop.
 */
export async function runCycle(
  simulationId: string,
  options: { force?: boolean; provider?: string } = {},
): Promise<CycleReport> {
  const simulation = await requireSimulation(simulationId);

  if (!options.force && simulation.status !== 'RUNNING') {
    throw new Error(`Simulation ${simulationId} is ${simulation.status}, not RUNNING.`);
  }

  const config = resolveConfig(simulation.config);
  const rng = createRng(simulation.seed, simulation.rngCursor);
  const cycle = simulation.cycle + 1;
  const market = marketAt(cycle, config);

  // Deterministic ordering: without this, Postgres row order would make the
  // run unreproducible even with a fixed seed.
  const livingAgents = await prisma.agent.findMany({
    where: { simulationId, status: 'ALIVE' },
    orderBy: { code: 'asc' },
    include: { traits: true },
  });

  const reports: AgentCycleReport[] = [];
  let births = 0;
  let deaths = 0;
  const touchedGenerations = new Set<number>();

  for (const agent of livingAgents) {
    // The agent may have died earlier in this same cycle's loop is impossible
    // (one pass per agent), but a re-read keeps the balance authoritative.
    const traits = traitsFromRows(agent.traits);
    const capitalBefore = toNum(agent.capitalLamports);

    const snapshot = await buildSnapshot({
      agent: {
        id: agent.id,
        code: agent.code,
        name: agent.name,
        generation: agent.generation,
        parentId: agent.parentId,
        strategy: agent.strategy,
        cycles: agent.cycles,
        clonesCreated: agent.clonesCreated,
        momentum: agent.momentum,
        capitalLamports: capitalBefore,
        startingCapitalLamports: toNum(agent.startingCapitalLamports),
        totalRevenueLamports: toNum(agent.totalRevenueLamports),
        totalExpensesLamports: toNum(agent.totalExpensesLamports),
      },
      traits,
      market,
      config,
    });

    const decision = await think(snapshot, rng, options.provider);

    // The engine — not the brain — decides what actually happens.
    const action = validateAction(decision.action, snapshot);
    const resolved = resolveAction(action, {
      traits,
      capitalLamports: capitalBefore,
      market,
      momentum: agent.momentum,
      config,
      rng,
    });

    const cycleCostLamports = solToLamports(config.CYCLE_COST_SOL);

    // Everything that moves money for this agent this cycle happens inside one
    // transaction: partial application can never leave the ledger inconsistent.
    const applied = await prisma.$transaction(async (tx) => {
      if (resolved.costLamports > 0) {
        await postEntry(tx, {
          agentId: agent.id,
          simulationId,
          type: 'EXPENSE',
          amountLamports: -resolved.costLamports,
          cycle,
          metadata: { action, kind: 'ACTION_COST' },
        });
      }

      if (resolved.revenueLamports > 0) {
        await postEntry(tx, {
          agentId: agent.id,
          simulationId,
          type: 'REVENUE',
          amountLamports: resolved.revenueLamports,
          cycle,
          metadata: { action, outcome: resolved.outcome },
        });
      }

      if (cycleCostLamports > 0) {
        await postEntry(tx, {
          agentId: agent.id,
          simulationId,
          type: 'EXPENSE',
          amountLamports: -cycleCostLamports,
          cycle,
          metadata: { kind: 'CYCLE_UPKEEP' },
        });
      }

      await tx.agentAction.create({
        data: {
          agentId: agent.id,
          simulationId,
          cycle,
          type: action,
          outcome: resolved.outcome,
          riskLevel: decision.riskLevel,
          costLamports: BigInt(resolved.costLamports),
          revenueLamports: BigInt(resolved.revenueLamports),
          netLamports: BigInt(resolved.revenueLamports - resolved.costLamports),
          confidence: decision.confidence,
          reasoning: decision.reasoning,
          provider: decision.provider,
        },
      });

      const nextMomentum = clampMomentum(
        decayMomentum(agent.momentum, config) + resolved.momentumGain,
      );

      const updated = await tx.agent.update({
        where: { id: agent.id },
        data: { cycles: { increment: 1 }, momentum: nextMomentum },
        select: { capitalLamports: true, cycles: true },
      });

      return { capitalAfter: toNum(updated.capitalLamports), cycles: updated.cycles };
    });

    await emit(prisma, {
      simulationId,
      type: 'AGENT_ACTION',
      cycle,
      agentId: agent.id,
      agentCode: agent.code,
      message: `${agent.code} → ${action} (${resolved.outcome}). Cost ${lamportsToSol(resolved.costLamports).toFixed(4)} SOL, revenue ${lamportsToSol(resolved.revenueLamports).toFixed(4)} SOL. Capital ${lamportsToSol(capitalBefore).toFixed(4)} → ${lamportsToSol(applied.capitalAfter).toFixed(4)} SOL.`,
      data: {
        action,
        outcome: resolved.outcome,
        costSol: lamportsToSol(resolved.costLamports),
        revenueSol: lamportsToSol(resolved.revenueLamports),
        capitalBeforeSol: lamportsToSol(capitalBefore),
        capitalAfterSol: lamportsToSol(applied.capitalAfter),
        reasoning: decision.reasoning,
        confidence: decision.confidence,
        provider: decision.provider,
        riskLevel: decision.riskLevel,
      },
    });

    if (resolved.revenueLamports > 0) {
      await emit(prisma, {
        simulationId,
        type: 'AGENT_REVENUE',
        cycle,
        agentId: agent.id,
        agentCode: agent.code,
        message: `${agent.code} earned ${lamportsToSol(resolved.revenueLamports).toFixed(4)} SOL from ${action}.`,
        data: { amountSol: lamportsToSol(resolved.revenueLamports), action },
      });
    }
    if (resolved.costLamports + cycleCostLamports > 0) {
      await emit(prisma, {
        simulationId,
        type: 'AGENT_EXPENSE',
        cycle,
        agentId: agent.id,
        agentCode: agent.code,
        message: `${agent.code} spent ${lamportsToSol(resolved.costLamports + cycleCostLamports).toFixed(4)} SOL.`,
        data: {
          amountSol: lamportsToSol(resolved.costLamports + cycleCostLamports),
          action,
        },
      });
    }

    await remember(prisma, {
      agentId: agent.id,
      kind: resolved.outcome === 'FAILURE' ? 'FAILURE' : 'SUCCESS',
      content: `c${cycle} ${action} ${resolved.outcome}: spent ${lamportsToSol(resolved.costLamports).toFixed(3)} SOL, earned ${lamportsToSol(resolved.revenueLamports).toFixed(3)} SOL.`,
      importance: resolved.outcome === 'FAILURE' ? 0.55 : 0.5,
      cycle,
    });
    await compactMemory(prisma, agent.id, cycle, config);

    touchedGenerations.add(agent.generation);

    // --- death check -------------------------------------------------------
    const deathThreshold = solToLamports(config.DEATH_THRESHOLD_SOL);
    let died = false;
    if (applied.capitalAfter <= deathThreshold) {
      await killAgent(prisma, {
        agentId: agent.id,
        code: agent.code,
        simulationId,
        cycle,
        capitalLamports: applied.capitalAfter,
      });
      died = true;
      deaths++;
    }

    // --- clone check -------------------------------------------------------
    let cloned: AgentCycleReport['cloned'] = null;
    if (!died) {
      cloned = await maybeClone(
        {
          id: agent.id,
          code: agent.code,
          generation: agent.generation,
          strategy: agent.strategy,
          clonesCreated: agent.clonesCreated,
          cycles: applied.cycles,
          capitalLamports: applied.capitalAfter,
          traits,
        },
        { simulationId, config, rng, cycle },
      );
      if (cloned) {
        births++;
        touchedGenerations.add(cloned.generation);
      }
    }

    reports.push({
      agentId: agent.id,
      code: agent.code,
      generation: agent.generation,
      action,
      outcome: resolved.outcome,
      reasoning: decision.reasoning,
      provider: decision.provider,
      confidence: decision.confidence,
      costSol: lamportsToSol(resolved.costLamports + cycleCostLamports),
      revenueSol: lamportsToSol(resolved.revenueLamports),
      capitalBeforeSol: lamportsToSol(capitalBefore),
      capitalAfterSol: lamportsToSol(applied.capitalAfter),
      died,
      cloned,
    });
  }

  for (const generation of touchedGenerations) {
    await refreshGeneration(prisma, simulationId, generation, cycle, config);
  }

  const aliveAfter = await prisma.agent.count({ where: { simulationId, status: 'ALIVE' } });

  let status: CycleReport['status'] = 'RUNNING';
  if (aliveAfter === 0) {
    status = 'COMPLETED';
    await prisma.simulation.update({
      where: { id: simulationId },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });
    await emit(prisma, {
      simulationId,
      type: 'SIMULATION_COMPLETED',
      cycle,
      message: `Extinction at cycle ${cycle}. No agents remain.`,
      data: { cycle },
    });
  }

  await prisma.simulation.update({
    where: { id: simulationId },
    data: { cycle, rngCursor: rng.cursor },
  });

  return {
    simulationId,
    cycle,
    market,
    agents: reports,
    births,
    deaths,
    aliveAfter,
    status,
  };
}

// ---------------------------------------------------------------------------
// Death
// ---------------------------------------------------------------------------

async function killAgent(
  db: DbClient,
  input: {
    agentId: string;
    code: string;
    simulationId: string;
    cycle: number;
    capitalLamports: number;
  },
): Promise<void> {
  const agent = await db.agent.update({
    where: { id: input.agentId },
    data: {
      status: 'DEAD' satisfies AgentStatus,
      diedAt: new Date(),
      diedAtCycle: input.cycle,
    },
    select: {
      cycles: true,
      bornAtCycle: true,
      generation: true,
      totalRevenueLamports: true,
      totalExpensesLamports: true,
      startingCapitalLamports: true,
      clonesCreated: true,
    },
  });

  await remember(db, {
    agentId: input.agentId,
    kind: 'MILESTONE',
    content: `Died at cycle ${input.cycle} after ${agent.cycles} cycles with ${lamportsToSol(input.capitalLamports).toFixed(4)} SOL.`,
    importance: 1,
    cycle: input.cycle,
  });

  await emit(db, {
    simulationId: input.simulationId,
    type: 'AGENT_DEAD',
    cycle: input.cycle,
    agentId: input.agentId,
    agentCode: input.code,
    message: `${input.code} died at cycle ${input.cycle} after ${agent.cycles} cycles. Final capital ${lamportsToSol(input.capitalLamports).toFixed(4)} SOL.`,
    data: {
      finalCapitalSol: lamportsToSol(input.capitalLamports),
      cycles: agent.cycles,
      lifetime: input.cycle - agent.bornAtCycle,
      generation: agent.generation,
      totalRevenueSol: lamportsToSol(agent.totalRevenueLamports),
      totalExpensesSol: lamportsToSol(agent.totalExpensesLamports),
      clonesCreated: agent.clonesCreated,
    },
  });
}

// ---------------------------------------------------------------------------
// Cloning
// ---------------------------------------------------------------------------

export interface CloneCandidate {
  id: string;
  code: string;
  generation: number;
  strategy: string;
  clonesCreated: number;
  cycles: number;
  capitalLamports: number;
  traits: TraitVector;
}

export interface CloneContext {
  simulationId: string;
  config: SimulationConfig;
  rng: SeededRandom;
  cycle: number;
}

/** Whether an agent is ELIGIBLE_TO_CLONE right now. */
export function isEligibleToClone(
  candidate: Pick<CloneCandidate, 'capitalLamports' | 'clonesCreated' | 'generation' | 'cycles'>,
  config: SimulationConfig,
): boolean {
  return (
    candidate.capitalLamports >= solToLamports(config.CLONE_THRESHOLD_SOL) &&
    candidate.clonesCreated < config.MAX_CLONES_PER_AGENT &&
    candidate.generation + 1 <= config.MAX_GENERATIONS &&
    candidate.cycles >= config.MIN_AGE_FOR_CLONING
  );
}

/**
 * Creates at most one offspring per parent per cycle. The population cap is
 * checked here rather than in the caller so every clone path respects it.
 */
export async function maybeClone(
  candidate: CloneCandidate,
  ctx: CloneContext,
): Promise<{ childId: string; childCode: string; generation: number } | null> {
  if (!isEligibleToClone(candidate, ctx.config)) return null;

  const liveCount = await prisma.agent.count({
    where: { simulationId: ctx.simulationId, status: 'ALIVE' },
  });
  if (liveCount >= ctx.config.MAX_LIVE_AGENTS) return null;

  const { traits, mutations } = mutateTraits(candidate.traits, ctx.rng, ctx.config);
  const strategy = ctx.rng.chance(ctx.config.STRATEGY_INHERITANCE)
    ? candidate.strategy
    : deriveStrategy(traits);

  const child = await spawnAgent(prisma, {
    simulationId: ctx.simulationId,
    config: ctx.config,
    rng: ctx.rng,
    cycle: ctx.cycle,
    generation: candidate.generation + 1,
    parent: { id: candidate.id, code: candidate.code, traits, strategy },
  });

  const parentCostLamports = solToLamports(ctx.config.CLONE_PARENT_COST_SOL);

  await prisma.$transaction(async (tx) => {
    if (parentCostLamports > 0) {
      await postEntry(tx, {
        agentId: candidate.id,
        simulationId: ctx.simulationId,
        type: 'EXPENSE',
        amountLamports: -parentCostLamports,
        cycle: ctx.cycle,
        metadata: { kind: 'CLONE_COST', childCode: child.code },
      });
    }

    await tx.agent.update({
      where: { id: candidate.id },
      data: { clonesCreated: { increment: 1 } },
    });

    await tx.clone.create({
      data: {
        simulationId: ctx.simulationId,
        parentId: candidate.id,
        childId: child.id,
        cycle: ctx.cycle,
        mutations: mutations as unknown as object[],
      },
    });
  });

  const isNewGeneration =
    (await prisma.agent.count({
      where: { simulationId: ctx.simulationId, generation: child.generation },
    })) === 1;

  if (isNewGeneration) {
    await emit(prisma, {
      simulationId: ctx.simulationId,
      type: 'GENERATION_STARTED',
      cycle: ctx.cycle,
      message: `Generation ${child.generation} opened.`,
      data: { generation: child.generation },
    });
  }

  await emit(prisma, {
    simulationId: ctx.simulationId,
    type: 'CLONE_CREATED',
    cycle: ctx.cycle,
    agentId: candidate.id,
    agentCode: candidate.code,
    message: `${candidate.code} reached the clone threshold and produced ${child.code} (generation ${child.generation}).`,
    data: {
      childCode: child.code,
      childId: child.id,
      generation: child.generation,
      mutations,
      strategy,
    },
  });

  await remember(prisma, {
    agentId: candidate.id,
    kind: 'MILESTONE',
    content: `Reached ${lamportsToSol(candidate.capitalLamports).toFixed(3)} SOL and produced ${child.code}.`,
    importance: 0.95,
    cycle: ctx.cycle,
  });

  return { childId: child.id, childCode: child.code, generation: child.generation };
}

// ---------------------------------------------------------------------------
// Generations
// ---------------------------------------------------------------------------

export async function refreshGeneration(
  db: DbClient,
  simulationId: string,
  generation: number,
  cycle: number,
  config: SimulationConfig,
): Promise<void> {
  const agents = await db.agent.findMany({
    where: { simulationId, generation },
    select: {
      id: true,
      code: true,
      status: true,
      capitalLamports: true,
      startingCapitalLamports: true,
      totalRevenueLamports: true,
      totalExpensesLamports: true,
    },
  });
  if (agents.length === 0) return;

  const aliveCount = agents.filter((a) => a.status === 'ALIVE').length;
  const deadCount = agents.length - aliveCount;

  let totalCapital = 0;
  let totalRevenue = 0;
  let totalExpenses = 0;
  let bestProfit = -Infinity;
  let bestAgent: { id: string; code: string } | null = null;

  for (const agent of agents) {
    const capital = toNum(agent.capitalLamports);
    const profit = capital - toNum(agent.startingCapitalLamports);
    totalCapital += capital;
    totalRevenue += toNum(agent.totalRevenueLamports);
    totalExpenses += toNum(agent.totalExpensesLamports);
    if (profit > bestProfit) {
      bestProfit = profit;
      bestAgent = { id: agent.id, code: agent.code };
    }
  }

  const averageCapital = Math.round(totalCapital / agents.length);
  const averageProfit = Math.round(
    agents.reduce(
      (sum, a) => sum + (toNum(a.capitalLamports) - toNum(a.startingCapitalLamports)),
      0,
    ) / agents.length,
  );

  const ended = aliveCount === 0;

  await db.generation.upsert({
    where: { simulationId_number: { simulationId, number: generation } },
    create: {
      simulationId,
      number: generation,
      agentCount: agents.length,
      aliveCount,
      deadCount,
      totalCapitalLamports: BigInt(totalCapital),
      totalRevenueLamports: BigInt(totalRevenue),
      totalExpensesLamports: BigInt(totalExpenses),
      averageCapitalLamports: BigInt(averageCapital),
      averageProfitLamports: BigInt(averageProfit),
      bestAgentId: bestAgent?.id ?? null,
      bestAgentCode: bestAgent?.code ?? null,
      startedAtCycle: cycle,
      endedAtCycle: ended ? cycle : null,
    },
    update: {
      agentCount: agents.length,
      aliveCount,
      deadCount,
      totalCapitalLamports: BigInt(totalCapital),
      totalRevenueLamports: BigInt(totalRevenue),
      totalExpensesLamports: BigInt(totalExpenses),
      averageCapitalLamports: BigInt(averageCapital),
      averageProfitLamports: BigInt(averageProfit),
      bestAgentId: bestAgent?.id ?? null,
      bestAgentCode: bestAgent?.code ?? null,
      endedAtCycle: ended ? cycle : null,
    },
  });

  if (ended) {
    const already = await db.simulationEvent.count({
      where: { simulationId, type: 'GENERATION_ENDED', data: { path: ['generation'], equals: generation } },
    });
    if (already === 0) {
      await emit(db, {
        simulationId,
        type: 'GENERATION_ENDED',
        cycle,
        message: `Generation ${generation} extinct: ${agents.length} agent${agents.length === 1 ? '' : 's'}, average profit ${lamportsToSol(averageProfit).toFixed(4)} SOL.`,
        data: { generation, averageProfitSol: lamportsToSol(averageProfit) },
      });
    }
  }
  void config;
}

// ---------------------------------------------------------------------------
// Snapshot construction
// ---------------------------------------------------------------------------

interface BuildSnapshotInput {
  agent: {
    id: string;
    code: string;
    name: string;
    generation: number;
    parentId: string | null;
    strategy: string;
    cycles: number;
    clonesCreated: number;
    momentum: number;
    capitalLamports: number;
    startingCapitalLamports: number;
    totalRevenueLamports: number;
    totalExpensesLamports: number;
  };
  traits: TraitVector;
  market: MarketConditions;
  config: SimulationConfig;
}

export async function buildSnapshot(input: BuildSnapshotInput): Promise<AgentSnapshot> {
  const { agent, traits, market, config } = input;

  const [parent, memory, recentActionRows] = await Promise.all([
    agent.parentId
      ? prisma.agent.findUnique({ where: { id: agent.parentId }, select: { code: true } })
      : Promise.resolve(null),
    recallForPrompt(prisma, agent.id, 8),
    prisma.agentAction.findMany({
      where: { agentId: agent.id },
      orderBy: { cycle: 'desc' },
      take: 8,
      select: {
        cycle: true,
        type: true,
        outcome: true,
        costLamports: true,
        revenueLamports: true,
        netLamports: true,
      },
    }),
  ]);

  const capitalSol = lamportsToSol(agent.capitalLamports);
  const totalRevenueSol = lamportsToSol(agent.totalRevenueLamports);
  const totalExpensesSol = lamportsToSol(agent.totalExpensesLamports);
  const startingCapitalSol = lamportsToSol(agent.startingCapitalLamports);
  const profitSol = capitalSol - startingCapitalSol;

  const burnPerCycle = Math.max(config.CYCLE_COST_SOL, 1e-9);
  const runwayCycles = capitalSol / burnPerCycle;

  const availableActions: AvailableAction[] = Object.values(ACTION_DEFINITIONS).map((def) => ({
    type: def.type,
    label: def.label,
    description: def.description,
    estimatedCostSol: config.EXPENSE_RANGES[def.type],
    potentialRevenueSol: config.REVENUE_RANGES[def.type],
    risk: def.risk,
    affordable: capitalSol >= config.EXPENSE_RANGES[def.type].max,
  })).filter((a) => capitalSol >= config.EXPENSE_RANGES[a.type].min);

  // REST costs nothing, so it is always a legal move — an agent can never be
  // left with an empty action set.
  if (!availableActions.some((a) => a.type === 'REST')) {
    const def = ACTION_DEFINITIONS.REST;
    availableActions.push({
      type: 'REST',
      label: def.label,
      description: def.description,
      estimatedCostSol: config.EXPENSE_RANGES.REST,
      potentialRevenueSol: config.REVENUE_RANGES.REST,
      risk: def.risk,
      affordable: true,
    });
  }

  return {
    code: agent.code,
    name: agent.name,
    generation: agent.generation,
    parentCode: parent?.code ?? null,
    strategy: agent.strategy,
    cycles: agent.cycles,
    clonesCreated: agent.clonesCreated,
    maxClones: config.MAX_CLONES_PER_AGENT,

    capitalSol,
    startingCapitalSol,
    totalRevenueSol,
    totalExpensesSol,
    totalProfitSol: profitSol,
    roi: startingCapitalSol > 0 ? profitSol / startingCapitalSol : 0,

    cloneThresholdSol: config.CLONE_THRESHOLD_SOL,
    deathThresholdSol: config.DEATH_THRESHOLD_SOL,
    cycleCostSol: config.CYCLE_COST_SOL,
    runwayCycles,

    traits: { ...traits },
    market,
    momentum: agent.momentum,

    memory: memory.map((m) => ({
      kind: m.kind,
      content: m.content,
      importance: m.importance,
      cycle: m.cycle,
    })),
    recentActions: recentActionRows
      .map((a) => ({
        cycle: a.cycle,
        type: a.type,
        outcome: a.outcome,
        costSol: lamportsToSol(a.costLamports),
        revenueSol: lamportsToSol(a.revenueLamports),
        netSol: lamportsToSol(a.netLamports),
      }))
      .reverse(),
    availableActions,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The engine's veto. A brain may only ever propose; this is where a proposal
 * becomes an action, or is replaced by one the agent can actually perform.
 */
export function validateAction(proposed: ActionType, snapshot: AgentSnapshot): ActionType {
  const available = snapshot.availableActions.map((a) => a.type);
  if (available.includes(proposed)) return proposed;
  return available.includes('REST') ? 'REST' : available[0];
}

async function requireSimulation(simulationId: string) {
  const simulation = await prisma.simulation.findUnique({ where: { id: simulationId } });
  if (!simulation) throw new Error(`Unknown simulation ${simulationId}`);
  return simulation;
}

function clampMomentum(value: number): number {
  return Math.min(3, Math.max(0.5, Number.isFinite(value) ? value : 1));
}

export { clamp01 };
