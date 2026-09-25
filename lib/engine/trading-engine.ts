/**
 * The paper-trading engine.
 *
 * Framework-free, like the engine it sits beside: no React, no request object.
 * It advances a population one market step at a time and persists everything —
 * positions, fills, fitness, births and deaths — so a run can be inspected,
 * replayed and audited after the fact.
 *
 * NO REAL VALUE MOVES. Every position is an accounting entry against recorded
 * or synthetic prices. There is no wallet, no key, no signature, no
 * transaction and no network call anywhere in this path.
 *
 * Capital moves only through the existing ledger, so the invariant the project
 * has always held — an agent's balance is recomputable from its transactions —
 * survives the pivot unchanged.
 */

import {
  DEFAULT_TRADING_CONFIG,
  TRADING_TRAIT_KEYS,
  decodeStrategy,
  type TradingConfig,
  type TradingTraitKey,
} from '@/config/trading';
import { prisma } from '@/lib/db';
import { createRng, generateSeed, type SeededRandom } from '@/lib/rng';
import { lamportsToSol, solToLamports, toNum } from '@/lib/sol';
import { marketForAsync } from '@/lib/market/registry';
import { FixtureMarket } from '@/lib/market/fixture-market';
import type { MarketFeed } from '@/lib/market/types';
import { emit } from './events';
import { postEntry, type DbClient } from './ledger';
import { computeFitness, populationMeanRaw, type TradeRecord } from './fitness';
import { formatAgentCode, generateAgentName } from './naming';
import {
  openPosition,
  passesEntryFilter,
  settle,
  stepPosition,
  toSnapshot,
  type PaperPosition,
} from './paper-execution';

type Genome = Record<TradingTraitKey, number>;

// ---------------------------------------------------------------------------
// Creating a run
// ---------------------------------------------------------------------------

export interface CreateTradingRunInput {
  name?: string;
  /** Seed for agent genomes and mutation. */
  seed?: string;
  /** Seed for the market. Separate, so one market can host many populations. */
  marketSeed?: string;
  founderCount?: number;
  steps?: number;
  config?: Partial<TradingConfig>;
  /**
   * An existing dataset to trade — a real pump.fun capture. When given, no
   * synthetic market is generated and `marketSeed`/`steps` are ignored: the
   * capture defines the market.
   */
  datasetId?: string;
}

export interface CreateTradingRunResult {
  simulationId: string;
  datasetId: string;
  seed: string;
  marketSeed: string;
  founderIds: string[];
}

function resolveConfig(overrides?: Partial<TradingConfig>): TradingConfig {
  return { ...DEFAULT_TRADING_CONFIG, ...(overrides ?? {}) };
}

export async function createTradingRun(
  input: CreateTradingRunInput = {},
): Promise<CreateTradingRunResult> {
  const seed = input.seed?.trim() || generateSeed();
  const marketSeed = input.marketSeed?.trim() || `mkt-${seed}`;
  const config = resolveConfig(input.config);
  const steps = input.steps ?? 4000;
  const founderCount = Math.min(Math.max(input.founderCount ?? config.FOUNDER_COUNT, 1), 400);

  // --- dataset ----------------------------------------------------------
  // Either an existing capture (real pump.fun data) or a freshly generated
  // synthetic market. The engine treats both identically from here on.
  let dataset: { id: string; key: string; source: string; steps: number; stepMs: number; tokenCount: number };
  let datasetLabel: string;

  if (input.datasetId) {
    const existing = await prisma.marketDataset.findUnique({ where: { id: input.datasetId } });
    if (!existing) throw new Error(`Unknown dataset ${input.datasetId}`);
    if (existing.tokenCount === 0) {
      throw new Error(`Dataset ${existing.key} holds no tokens; nothing to trade.`);
    }
    dataset = existing;
    datasetLabel = `${existing.tokenCount} real tokens (${existing.key})`;
  } else {
    const key = `fixture:${marketSeed}:${steps}`;
    const market = new FixtureMarket({ seed: marketSeed, steps });
    const summary = market.summary();
    dataset = await prisma.marketDataset.upsert({
      where: { key },
      create: {
        key,
        source: 'FIXTURE',
        seed: marketSeed,
        steps,
        stepMs: summary.stepMs,
        tokenCount: summary.tokenCount,
        meta: {
          doubleRate: summary.doubleRate,
          rugRate: summary.rugRate,
          archetypes: market.archetypeBreakdown(),
        },
      },
      update: {},
    });
    datasetLabel = `${summary.tokenCount} synthetic tokens (seed ${marketSeed})`;
  }

  const simulation = await prisma.simulation.create({
    data: {
      name: input.name?.trim() || `Paper run ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      seed,
      mode: 'TRADING',
      datasetId: dataset.id,
      status: 'CREATED',
      cycle: 0,
      rngCursor: 0,
      config: config as unknown as Record<string, number>,
    },
  });

  await emit(prisma, {
    simulationId: simulation.id,
    type: 'SIMULATION_CREATED',
    cycle: 0,
    message: `Paper-trading run created on ${datasetLabel} — seed ${seed}.`,
    data: { seed, marketSeed, founderCount, dataset: dataset.key, source: dataset.source },
  });

  const rng = createRng(seed, 0);
  const founderIds: string[] = [];
  for (let i = 0; i < founderCount; i++) {
    const agent = await spawnTrader(prisma, {
      simulationId: simulation.id,
      config,
      rng,
      step: 0,
      generation: 0,
      parent: null,
    });
    founderIds.push(agent.id);
  }

  await emit(prisma, {
    simulationId: simulation.id,
    type: 'GENERATION_STARTED',
    cycle: 0,
    message: `Generation 0 opened with ${founderCount} founders on a neutral genome.`,
    data: { generation: 0 },
  });

  await prisma.simulation.update({
    where: { id: simulation.id },
    data: { rngCursor: rng.cursor },
  });

  return {
    simulationId: simulation.id,
    datasetId: dataset.id,
    seed,
    marketSeed,
    founderIds,
  };
}

// ---------------------------------------------------------------------------
// Birth
// ---------------------------------------------------------------------------

function randomGenome(rng: SeededRandom, spread = 0.22): Genome {
  const genome = {} as Genome;
  for (const key of TRADING_TRAIT_KEYS) {
    genome[key] = clamp01(0.5 + rng.normal(0, spread));
  }
  return genome;
}

function mutateGenome(parent: Genome, rng: SeededRandom, config: TradingConfig): Genome {
  const genome = {} as Genome;
  for (const key of TRADING_TRAIT_KEYS) {
    genome[key] = rng.chance(config.MUTATION_CHANCE)
      ? clamp01(parent[key] + rng.normal(0, config.MUTATION_RATE))
      : parent[key];
  }
  return genome;
}

/** Names the dominant tendency of a genome, for the UI. */
export function labelGenome(genome: Genome): string {
  const d = (k: TradingTraitKey) => genome[k] - 0.5;
  const scores: Record<string, number> = {
    MOMENTUM_SNIPER: d('entrySpeed') * 0.8 + d('momentumWeight') * 0.5,
    FAST_FLIPPER: d('entrySpeed') * 0.6 + d('takeProfitBias') * 0.7,
    PATIENT_SCALPER: d('holdPatience') * 0.8 - d('entrySpeed') * 0.3,
    CONSERVATIVE: d('capitalPreservation') * 0.8 - d('riskTolerance') * 0.5,
    SIZE_HUNTER: d('riskTolerance') * 0.9,
    CONTRARIAN: -d('momentumWeight') * 0.8 + d('pressureFilter') * 0.3,
  };
  let best = 'BALANCED';
  let bestScore = 0.07;
  for (const [label, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = label;
    }
  }
  return best;
}

export interface SpawnTraderInput {
  simulationId: string;
  config: TradingConfig;
  rng: SeededRandom;
  step: number;
  generation: number;
  parent: { id: string; code: string; genome: Genome } | null;
}

export async function spawnTrader(
  db: DbClient,
  input: SpawnTraderInput,
): Promise<{ id: string; code: string; genome: Genome }> {
  const { simulationId, config, rng, step, generation, parent } = input;

  const index = (await db.agent.count({ where: { simulationId } })) + 1;
  const code = formatAgentCode(index);
  const genome = parent ? mutateGenome(parent.genome, rng, config) : randomGenome(rng);
  const startingLamports = solToLamports(config.INITIAL_CAPITAL_SOL);

  const agent = await db.agent.create({
    data: {
      simulationId,
      code,
      name: generateAgentName(rng),
      generation,
      parentId: parent?.id ?? null,
      status: 'ALIVE',
      capitalLamports: 0n,
      startingCapitalLamports: BigInt(startingLamports),
      peakCapitalLamports: 0n,
      bornAtCycle: step,
      strategy: labelGenome(genome),
      momentum: 1,
    },
    select: { id: true },
  });

  await db.agentTrait.createMany({
    data: TRADING_TRAIT_KEYS.map((key) => ({ agentId: agent.id, key, value: genome[key] })),
  });

  // Seed capital arrives through the ledger, so an agent's very first lamports
  // already have a transaction behind them.
  await postEntry(db, {
    agentId: agent.id,
    simulationId,
    type: parent ? 'CLONE_BONUS' : 'INITIAL_CAPITAL',
    amountLamports: startingLamports,
    cycle: step,
    metadata: parent ? { parentCode: parent.code } : { origin: 'TREASURY' },
  });

  await emit(db, {
    simulationId,
    type: 'AGENT_BORN',
    cycle: step,
    agentId: agent.id,
    agentCode: code,
    message: parent
      ? `${code} born from ${parent.code} — generation ${generation}, ${labelGenome(genome)}.`
      : `${code} born — generation ${generation}, neutral genome.`,
    data: { generation, parentCode: parent?.code ?? null, strategy: labelGenome(genome) },
  });

  return { id: agent.id, code, genome };
}

// ---------------------------------------------------------------------------
// One market step
// ---------------------------------------------------------------------------

export interface TradingStepReport {
  simulationId: string;
  step: number;
  opened: number;
  closed: number;
  births: number;
  deaths: number;
  aliveAfter: number;
  realisedPnlSol: number;
  status: 'RUNNING' | 'COMPLETED';
}

export async function runTradingStep(
  simulationId: string,
  options: { force?: boolean } = {},
): Promise<TradingStepReport> {
  const simulation = await prisma.simulation.findUnique({
    where: { id: simulationId },
    include: { dataset: true },
  });
  if (!simulation) throw new Error(`Unknown simulation ${simulationId}`);
  if (simulation.mode !== 'TRADING') {
    throw new Error(`Simulation ${simulationId} is not a TRADING run.`);
  }
  if (!simulation.dataset) throw new Error(`Simulation ${simulationId} has no market dataset.`);
  if (!options.force && simulation.status !== 'RUNNING') {
    throw new Error(`Simulation ${simulationId} is ${simulation.status}, not RUNNING.`);
  }

  const config = resolveConfig(simulation.config as Partial<TradingConfig>);
  const market = await marketForAsync(simulation.dataset);
  const rng = createRng(simulation.seed, simulation.rngCursor);
  const step = simulation.cycle + 1;

  const closedThisStep = new Set<string>();
  /**
   * Per-step working state.
   *
   * Built once from the rows already fetched and mutated in place as positions
   * open and close. Re-reading capital and open-position counts from the
   * database mid-step cost ~240 extra round trips per step for data already in
   * memory, and was the dominant remaining cost after batching upkeep.
   */
  const state = new Map<
    string,
    { capital: number; openCount: number; genome: Genome; code: string; bornAtCycle: number;
      startingCapital: number; fitness: number; rawFitness: number; tradesClosed: number;
      wins: number; maxDrawdown: number; clonesCreated: number; generation: number }
  >();
  let opened = 0;
  let closed = 0;
  let births = 0;
  let deaths = 0;
  let realisedPnl = 0;

  // Deterministic ordering: Postgres guarantees none without ORDER BY, and an
  // unstable order would break replay even on a fixed seed.
  const living = await prisma.agent.findMany({
    where: { simulationId, status: 'ALIVE' },
    orderBy: { code: 'asc' },
    include: {
      traits: true,
      // A nested include carries no ordering guarantee either, and the order
      // positions close in decides the order of their ledger entries.
      positions: { where: { status: 'OPEN' }, orderBy: [{ entryStep: 'asc' }, { mint: 'asc' }] },
    },
  });

  for (const agent of living) {
    state.set(agent.id, {
      capital: toNum(agent.capitalLamports),
      openCount: agent.positions.length,
      genome: genomeFromRows(agent.traits),
      code: agent.code,
      bornAtCycle: agent.bornAtCycle,
      startingCapital: toNum(agent.startingCapitalLamports),
      fitness: agent.fitness,
      rawFitness: agent.rawFitness,
      tradesClosed: agent.tradesClosed,
      wins: agent.wins,
      maxDrawdown: agent.maxDrawdown,
      clonesCreated: agent.clonesCreated,
      generation: agent.generation,
    });
  }
  let liveCount = living.length;

  // --- 1. resolve open positions ----------------------------------------
  for (const agent of living) {
    for (const row of agent.positions) {
      const position = toPaperPosition(row);
      const tick = market.tickAt(position.mint, step);

      const outcome = tick
        ? stepPosition(position, tick, step, config)
        : // The token stopped being tracked: close at the entry quote rather
          // than dropping the position, which would silently erase a loss.
          settle(position, 'TIMEOUT', position.quotedEntryLamports, 0, step, config);

      if (!outcome) continue;

      await prisma.$transaction(async (tx) => {
        await postEntry(tx, {
          agentId: agent.id,
          simulationId,
          type: 'REVENUE',
          amountLamports: outcome.proceedsLamports,
          cycle: step,
          metadata: { kind: 'POSITION_CLOSE', mint: position.mint, exit: outcome.exitReason },
        });
        await tx.position.update({
          where: { id: row.id },
          data: {
            status: 'CLOSED',
            exitStep: outcome.exitStep,
            exitReason: outcome.exitReason,
            exitPriceLamports: BigInt(outcome.exitPriceLamports),
            proceedsLamports: BigInt(outcome.proceedsLamports),
            pnlLamports: BigInt(outcome.pnlLamports),
            returnPct: outcome.returnPct,
            holdSteps: outcome.holdSteps,
            feesLamports: BigInt(outcome.totalFeesLamports),
            slippageLamports: BigInt(outcome.totalSlippageLamports),
            closedAt: new Date(),
          },
        });
      });

      const st = state.get(agent.id)!;
      st.capital += outcome.proceedsLamports;
      st.openCount--;

      closedThisStep.add(agent.id);
      closed++;
      realisedPnl += outcome.pnlLamports;
    }
  }

  // --- 2. entry decisions -------------------------------------------------
  const eligible: { mint: string; symbol: string; age: number }[] = [];
  for (let age = config.MIN_ENTRY_AGE_STEPS; age <= config.MAX_ENTRY_AGE_STEPS; age++) {
    for (const launch of market.launches(step - age)) {
      eligible.push({ mint: launch.mint, symbol: launch.symbol, age });
    }
  }

  for (const candidate of eligible) {
    const tick = market.tickAt(candidate.mint, step);
    if (!tick) continue;
    const snapshot = toSnapshot(tick, candidate.symbol, candidate.age);

    for (const agent of living) {
      const st = state.get(agent.id);
      if (!st) continue;
      if (st.openCount >= config.MAX_CONCURRENT_POSITIONS) continue;

      const strategy = decodeStrategy(st.genome, config);
      if (!passesEntryFilter(snapshot, strategy, market.stepMs)) continue;

      const position = openPosition({
        tick,
        symbol: candidate.symbol,
        step,
        capitalLamports: st.capital,
        strategy,
        config,
      });
      if (!position) continue;

      const committed = position.sizeLamports + position.entryFeeLamports;

      await prisma.$transaction(async (tx) => {
        await postEntry(tx, {
          agentId: agent.id,
          simulationId,
          type: 'EXPENSE',
          amountLamports: -committed,
          cycle: step,
          metadata: { kind: 'POSITION_OPEN', mint: position.mint },
        });
        await tx.position.create({
          data: {
            agentId: agent.id,
            simulationId,
            mint: position.mint,
            symbol: position.symbol,
            status: 'OPEN',
            entryStep: step,
            quotedEntryLamports: BigInt(position.quotedEntryLamports),
            entryPriceLamports: BigInt(position.entryPriceLamports),
            sizeLamports: BigInt(position.sizeLamports),
            takeProfitMultiple: position.takeProfitMultiple,
            stopMultiple: position.stopMultiple,
            maxHoldSteps: position.maxHoldSteps,
            feesLamports: BigInt(position.entryFeeLamports),
            slippageLamports: BigInt(position.entrySlippageLamports),
          },
        });
      });

      st.capital -= committed;
      st.openCount++;
      opened++;
    }
  }

  // --- 3. upkeep, fitness, death, reproduction ---------------------------
  //
  // Two things are deliberately not done every step for every agent:
  //
  //  - Upkeep is posted once per UPKEEP_INTERVAL_STEPS, covering the interval.
  //    Posting it per agent per step made it the largest single source of
  //    writes in the loop for a cost that is economically identical.
  //  - Fitness is recomputed only for agents that actually closed a position,
  //    because nothing else can change it. Recomputing for everyone meant
  //    re-reading every closed position of every agent on every step.
  const upkeepDue = step % config.UPKEEP_INTERVAL_STEPS === 0;
  const stepCost = solToLamports(config.STEP_COST_SOL) * config.UPKEEP_INTERVAL_STEPS;
  // Ordered because the mean is a float sum: the same values added in a
  // different order differ in the last bits, and that difference propagates
  // into every shrunk fitness score.
  const priorRows = await prisma.agent.findMany({
    where: { simulationId, tradesClosed: { gt: 0 } },
    orderBy: { code: 'asc' },
    select: { rawFitness: true },
  });
  const prior = populationMeanRaw(priorRows.map((r) => r.rawFitness));

  if (upkeepDue && stepCost > 0) {
    for (const agent of living) {
      state.get(agent.id)!.capital -= stepCost;
      await postEntry(prisma, {
        agentId: agent.id,
        simulationId,
        type: 'EXPENSE',
        amountLamports: -stepCost,
        cycle: step,
        metadata: { kind: 'UPKEEP', coversSteps: config.UPKEEP_INTERVAL_STEPS },
      });
    }
  }

  await prisma.agent.updateMany({
    where: { id: { in: living.map((a) => a.id) } },
    data: { cycles: { increment: 1 } },
  });

  for (const agent of living) {
    const hadClose = closedThisStep.has(agent.id);

    const st = state.get(agent.id)!;
    // `summary` carries only the fields the decisions below need, so the
    // cached path and the recomputed path have one shared shape.
    let summary = cachedBreakdown(st);
    if (hadClose) {
      // Chronological, and not merely for tidiness: max drawdown walks the
      // equity curve these trades imply, so a different order yields a
      // different — and wrong — worst peak-to-trough. Unordered, it also made
      // two runs of the same seed disagree on fitness.
      const closedPositions = await prisma.position.findMany({
        where: { agentId: agent.id, status: 'CLOSED' },
        orderBy: [{ exitStep: 'asc' }, { mint: 'asc' }],
        select: { returnPct: true, pnlLamports: true, exitReason: true, holdSteps: true },
      });
      const trades: TradeRecord[] = closedPositions.map((p) => ({
        returnPct: p.returnPct ?? 0,
        pnlLamports: toNum(p.pnlLamports ?? 0n),
        exitReason: (p.exitReason ?? 'TIMEOUT') as TradeRecord['exitReason'],
        holdSteps: p.holdSteps ?? 0,
      }));

      const full = computeFitness({
        trades,
        alive: true,
        stepsLived: step - st.bornAtCycle,
        startingCapitalLamports: st.startingCapital,
        populationMean: prior,
        confidenceK: config.FITNESS_CONFIDENCE_K,
      });

      await prisma.agent.update({
        where: { id: agent.id },
        data: {
          fitness: full.fitness,
          rawFitness: full.raw,
          tradesClosed: full.trades,
          wins: full.wins,
          tp1Hits: full.tp1Hits,
          tp2Hits: full.tp2Hits,
          stops: full.stops,
          timeouts: full.timeouts,
          maxDrawdown: full.maxDrawdown,
          avgHoldSteps: full.avgHoldSteps,
        },
      });

      summary = {
        fitness: full.fitness,
        raw: full.raw,
        trades: full.trades,
        wins: full.wins,
        winRate: full.winRate,
        maxDrawdown: full.maxDrawdown,
      };
    }

    const capital = st.capital;
    const stillOpen = st.openCount;

    // --- death: only once nothing is open, so a position cannot be lost ---
    if (capital <= solToLamports(config.DEATH_THRESHOLD_SOL) && stillOpen === 0) {
      await prisma.agent.update({
        where: { id: agent.id },
        data: { status: 'DEAD', diedAt: new Date(), diedAtCycle: step },
      });
      await emit(prisma, {
        simulationId,
        type: 'AGENT_DEAD',
        cycle: step,
        agentId: agent.id,
        agentCode: agent.code,
        message: `${agent.code} died at step ${step} after ${summary.trades} trades. Fitness ${summary.fitness.toFixed(3)}.`,
        data: {
          finalCapitalSol: lamportsToSol(capital),
          trades: summary.trades,
          winRate: summary.winRate,
          fitness: summary.fitness,
          generation: st.generation,
        },
      });
      deaths++;
      liveCount--;
      continue;
    }

    // --- reproduction ----------------------------------------------------
    const eligibleToClone =
      capital >= solToLamports(config.CLONE_THRESHOLD_SOL) &&
      st.clonesCreated < config.MAX_CLONES_PER_AGENT &&
      summary.trades >= config.MIN_TRADES_FOR_CLONING &&
      summary.fitness >= config.MIN_FITNESS_FOR_CLONING &&
      st.generation + 1 <= config.MAX_GENERATIONS &&
      liveCount < config.MAX_LIVE_AGENTS;

    if (!eligibleToClone) continue;

    const parentGenome = st.genome;
    const child = await spawnTrader(prisma, {
      simulationId,
      config,
      rng,
      step,
      generation: st.generation + 1,
      parent: { id: agent.id, code: agent.code, genome: parentGenome },
    });
    await prisma.agent.update({
      where: { id: agent.id },
      data: { clonesCreated: { increment: 1 } },
    });
    await prisma.clone.create({
      data: {
        simulationId,
        parentId: agent.id,
        childId: child.id,
        cycle: step,
        mutations: TRADING_TRAIT_KEYS.map((key) => ({
          trait: key,
          from: round4(parentGenome[key]),
          to: round4(child.genome[key]),
          delta: round4(child.genome[key] - parentGenome[key]),
        })),
      },
    });
    await emit(prisma, {
      simulationId,
      type: 'CLONE_CREATED',
      cycle: step,
      agentId: agent.id,
      agentCode: agent.code,
      message: `${agent.code} reproduced (fitness ${summary.fitness.toFixed(3)}, ${summary.trades} trades) → ${child.code}.`,
      data: { childId: child.id, childCode: child.code, generation: st.generation + 1 },
    });
    births++;
    liveCount++;
  }

  const aliveAfter = await prisma.agent.count({ where: { simulationId, status: 'ALIVE' } });
  const exhausted = step >= market.length - config.MAX_ENTRY_AGE_STEPS;
  const status: TradingStepReport['status'] =
    aliveAfter === 0 || exhausted ? 'COMPLETED' : 'RUNNING';

  if (status === 'COMPLETED') {
    await prisma.simulation.update({
      where: { id: simulationId },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });
    await emit(prisma, {
      simulationId,
      type: 'SIMULATION_COMPLETED',
      cycle: step,
      message:
        aliveAfter === 0
          ? `Extinction at step ${step}.`
          : `Market exhausted at step ${step}; ${aliveAfter} agents still trading.`,
      data: { step, aliveAfter },
    });
  }

  await prisma.simulation.update({
    where: { id: simulationId },
    data: { cycle: step, rngCursor: rng.cursor },
  });

  return {
    simulationId,
    step,
    opened,
    closed,
    births,
    deaths,
    aliveAfter,
    realisedPnlSol: lamportsToSol(realisedPnl),
    status,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PositionRow {
  mint: string;
  symbol: string;
  entryStep: number;
  quotedEntryLamports: bigint;
  entryPriceLamports: bigint;
  sizeLamports: bigint;
  takeProfitMultiple: number;
  stopMultiple: number;
  maxHoldSteps: number;
  feesLamports: bigint;
  slippageLamports: bigint;
}

function toPaperPosition(row: PositionRow): PaperPosition {
  return {
    mint: row.mint,
    symbol: row.symbol,
    entryStep: row.entryStep,
    quotedEntryLamports: toNum(row.quotedEntryLamports),
    entryPriceLamports: toNum(row.entryPriceLamports),
    sizeLamports: toNum(row.sizeLamports),
    takeProfitMultiple: row.takeProfitMultiple,
    stopMultiple: row.stopMultiple,
    maxHoldSteps: row.maxHoldSteps,
    entryFeeLamports: toNum(row.feesLamports),
    entrySlippageLamports: toNum(row.slippageLamports),
  };
}

function genomeFromRows(rows: { key: string; value: number }[]): Genome {
  const genome = {} as Genome;
  for (const key of TRADING_TRAIT_KEYS) genome[key] = 0.5;
  for (const row of rows) {
    if ((TRADING_TRAIT_KEYS as readonly string[]).includes(row.key)) {
      genome[row.key as TradingTraitKey] = clamp01(row.value);
    }
  }
  return genome;
}

/**
 * The agent's last computed fitness, read from its own row.
 *
 * Valid precisely because fitness can only change when a position closes, and
 * every close recomputes and persists it.
 */
function cachedBreakdown(agent: {
  fitness: number;
  rawFitness: number;
  tradesClosed: number;
  wins: number;
  maxDrawdown: number;
}): { fitness: number; raw: number; trades: number; wins: number; winRate: number; maxDrawdown: number } {
  return {
    fitness: agent.fitness,
    raw: agent.rawFitness,
    trades: agent.tradesClosed,
    wins: agent.wins,
    winRate: agent.tradesClosed > 0 ? agent.wins / agent.tradesClosed : 0,
    maxDrawdown: agent.maxDrawdown,
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export type { MarketFeed };
