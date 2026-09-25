/**
 * Evolution harness — the paper-trading population, in memory.
 *
 *   npx tsx scripts/evolve.ts [--seed s] [--steps n] [--founders n] [--verbose]
 *
 * Runs the real decode/execute/fitness/selection path with no database, so the
 * economics can be checked in seconds rather than hours. This is the same
 * method that was used to balance the previous engine, and it is what proves
 * the population is actually evolving rather than drifting.
 */

import {
  DEFAULT_TRADING_CONFIG,
  FOUNDER_TRADING_TRAITS,
  TRADING_TRAIT_KEYS,
  decodeStrategy,
  type TradingConfig,
  type TradingTraitKey,
} from '@/config/trading';
import { FixtureMarket } from '@/lib/market/fixture-market';
import { createRng, type SeededRandom } from '@/lib/rng';
import { lamportsToSol, solToLamports } from '@/lib/sol';
import {
  openPosition,
  passesEntryFilter,
  settle,
  stepPosition,
  toSnapshot,
  type PaperPosition,
} from '@/lib/engine/paper-execution';
import { computeFitness, populationMeanRaw, type TradeRecord } from '@/lib/engine/fitness';

type Genome = Record<TradingTraitKey, number>;

interface Agent {
  code: string;
  generation: number;
  parent: string | null;
  genome: Genome;
  capital: number;
  startingCapital: number;
  alive: boolean;
  bornStep: number;
  diedStep: number | null;
  stepsLived: number;
  clones: number;
  trades: TradeRecord[];
  open: PaperPosition[];
  raw: number;
  fitness: number;
}

function randomGenome(rng: SeededRandom, spread = 0.22): Genome {
  const g = {} as Genome;
  for (const key of TRADING_TRAIT_KEYS) {
    g[key] = Math.min(1, Math.max(0, 0.5 + rng.normal(0, spread)));
  }
  return g;
}

function mutate(parent: Genome, rng: SeededRandom, config: TradingConfig): Genome {
  const g = {} as Genome;
  for (const key of TRADING_TRAIT_KEYS) {
    if (!rng.chance(config.MUTATION_CHANCE)) {
      g[key] = parent[key];
      continue;
    }
    g[key] = Math.min(1, Math.max(0, parent[key] + rng.normal(0, config.MUTATION_RATE)));
  }
  return g;
}

export interface EvolveResult {
  agents: Agent[];
  generations: number;
  byGeneration: {
    generation: number;
    count: number;
    alive: number;
    survivalRate: number;
    meanFitness: number;
    meanReturn: number;
    meanTrades: number;
    genome: Genome;
  }[];
  totalTrades: number;
}

export function evolve(options: {
  seed: string;
  steps?: number;
  founders?: number;
  config?: TradingConfig;
  verbose?: boolean;
}): EvolveResult {
  const config = options.config ?? DEFAULT_TRADING_CONFIG;
  const steps = options.steps ?? 3000;
  const founders = options.founders ?? config.FOUNDER_COUNT;

  const market = new FixtureMarket({ seed: `mkt-${options.seed}`, steps, launchRate: 0.9 });
  const rng = createRng(`evo-${options.seed}`);

  const agents: Agent[] = [];
  const tracked = new Map<string, { symbol: string; launchStep: number }>();
  let counter = 0;

  const spawn = (generation: number, genome: Genome, parent: string | null, step: number): Agent => {
    counter++;
    const agent: Agent = {
      code: `SX-${String(counter).padStart(4, '0')}`,
      generation,
      parent,
      genome,
      capital: solToLamports(config.INITIAL_CAPITAL_SOL),
      startingCapital: solToLamports(config.INITIAL_CAPITAL_SOL),
      alive: true,
      bornStep: step,
      diedStep: null,
      stepsLived: 0,
      clones: 0,
      trades: [],
      open: [],
      raw: 0.5,
      fitness: 0.5,
    };
    agents.push(agent);
    return agent;
  };

  for (let i = 0; i < founders; i++) spawn(0, randomGenome(rng), null, 0);

  const deathThreshold = solToLamports(config.DEATH_THRESHOLD_SOL);
  const cloneThreshold = solToLamports(config.CLONE_THRESHOLD_SOL);
  const stepCost = solToLamports(config.STEP_COST_SOL);

  for (let step = 0; step < steps; step++) {
    for (const launch of market.launches(step)) {
      tracked.set(launch.mint, { symbol: launch.symbol, launchStep: step });
    }

    const living = agents.filter((a) => a.alive);
    if (living.length === 0) break;

    // --- 1. resolve open positions against this step's ticks -------------
    for (const agent of living) {
      if (agent.open.length === 0) continue;
      const remaining: PaperPosition[] = [];

      for (const position of agent.open) {
        const tick = market.tickAt(position.mint, step);
        if (!tick) {
          // Token stopped being tracked: close at entry quote, never drop it.
          const outcome = settle(position, 'TIMEOUT', position.quotedEntryLamports, 0, step, config);
          agent.capital += outcome.proceedsLamports;
          agent.trades.push({
            returnPct: outcome.returnPct,
            pnlLamports: outcome.pnlLamports,
            exitReason: outcome.exitReason,
            holdSteps: outcome.holdSteps,
          });
          continue;
        }

        const outcome = stepPosition(position, tick, step, config);
        if (!outcome) {
          remaining.push(position);
          continue;
        }
        agent.capital += outcome.proceedsLamports;
        agent.trades.push({
          returnPct: outcome.returnPct,
          pnlLamports: outcome.pnlLamports,
          exitReason: outcome.exitReason,
          holdSteps: outcome.holdSteps,
        });
      }
      agent.open = remaining;
    }

    // --- 2. entry decisions on eligible tokens ---------------------------
    for (const [mint, meta] of tracked) {
      const age = step - meta.launchStep;
      if (age < config.MIN_ENTRY_AGE_STEPS || age > config.MAX_ENTRY_AGE_STEPS) continue;
      const tick = market.tickAt(mint, step);
      if (!tick) continue;
      const snapshot = toSnapshot(tick, meta.symbol, age);

      for (const agent of living) {
        if (!agent.alive) continue;
        if (agent.open.length >= config.MAX_CONCURRENT_POSITIONS) continue;
        if (agent.open.some((p) => p.mint === mint)) continue;

        const strategy = decodeStrategy(agent.genome, config);
        if (!passesEntryFilter(snapshot, strategy, market.stepMs)) continue;

        const position = openPosition({
          tick,
          symbol: meta.symbol,
          step,
          capitalLamports: agent.capital,
          strategy,
          config,
        });
        if (!position) continue;
        agent.capital -= position.sizeLamports + position.entryFeeLamports;
        agent.open.push(position);
      }
    }

    // --- 3. upkeep, death, reproduction ----------------------------------
    const rawScores = agents.filter((a) => a.trades.length > 0).map((a) => a.raw);
    const prior = populationMeanRaw(rawScores);

    for (const agent of living) {
      agent.stepsLived++;
      agent.capital = Math.max(0, agent.capital - stepCost);

      const breakdown = computeFitness({
        trades: agent.trades,
        alive: agent.alive,
        stepsLived: agent.stepsLived,
        startingCapitalLamports: agent.startingCapital,
        populationMean: prior,
        confidenceK: config.FITNESS_CONFIDENCE_K,
      });
      agent.raw = breakdown.raw;
      agent.fitness = breakdown.fitness;

      // Death: only once nothing is still open, so a position cannot be lost.
      if (agent.capital <= deathThreshold && agent.open.length === 0) {
        agent.alive = false;
        agent.diedStep = step;
        continue;
      }

      const liveCount = agents.filter((a) => a.alive).length;
      if (
        agent.capital >= cloneThreshold &&
        agent.clones < config.MAX_CLONES_PER_AGENT &&
        agent.trades.length >= config.MIN_TRADES_FOR_CLONING &&
        agent.fitness >= config.MIN_FITNESS_FOR_CLONING &&
        agent.generation + 1 <= config.MAX_GENERATIONS &&
        liveCount < config.MAX_LIVE_AGENTS
      ) {
        agent.clones++;
        spawn(agent.generation + 1, mutate(agent.genome, rng, config), agent.code, step);
      }
    }

    // Tokens past their useful life stop being considered.
    for (const [mint, meta] of tracked) {
      if (step - meta.launchStep > 60) tracked.delete(mint);
    }
  }

  // --- report -------------------------------------------------------------
  const maxGen = agents.reduce((m, a) => Math.max(m, a.generation), 0);
  const byGeneration = [];
  for (let g = 0; g <= maxGen; g++) {
    const cohort = agents.filter((a) => a.generation === g);
    if (cohort.length === 0) continue;
    const genome = {} as Genome;
    for (const key of TRADING_TRAIT_KEYS) {
      genome[key] = cohort.reduce((s, a) => s + a.genome[key], 0) / cohort.length;
    }
    const withTrades = cohort.filter((a) => a.trades.length > 0);
    byGeneration.push({
      generation: g,
      count: cohort.length,
      alive: cohort.filter((a) => a.alive).length,
      survivalRate: cohort.filter((a) => a.alive).length / cohort.length,
      meanFitness: cohort.reduce((s, a) => s + a.fitness, 0) / cohort.length,
      meanReturn:
        withTrades.length > 0
          ? withTrades.reduce(
              (s, a) => s + a.trades.reduce((x, t) => x + t.returnPct, 0) / a.trades.length,
              0,
            ) / withTrades.length
          : 0,
      meanTrades: cohort.reduce((s, a) => s + a.trades.length, 0) / cohort.length,
      genome,
    });
  }

  return {
    agents,
    generations: byGeneration.length,
    byGeneration,
    totalTrades: agents.reduce((s, a) => s + a.trades.length, 0),
  };
}

function main() {
  const arg = (n: string, d: string) => {
    const i = process.argv.indexOf(`--${n}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
  };

  const result = evolve({
    seed: arg('seed', 'e1'),
    steps: Number(arg('steps', '3000')),
    founders: Number(arg('founders', String(DEFAULT_TRADING_CONFIG.FOUNDER_COUNT))),
  });

  console.log(`\nagents ${result.agents.length} · generations ${result.generations} · trades ${result.totalTrades}`);
  console.log('\nGEN  N   ALIVE  SURV   FITNESS  MEAN RET  TRADES │ entrySpd  pressure  tpBias  risk  hold  momentum');
  for (const g of result.byGeneration) {
    console.log(
      `${String(g.generation).padStart(3)} ${String(g.count).padStart(3)}  ${String(g.alive).padStart(5)}  ` +
        `${(g.survivalRate * 100).toFixed(0).padStart(4)}%  ${g.meanFitness.toFixed(3).padStart(7)}  ` +
        `${((g.meanReturn) * 100).toFixed(1).padStart(7)}%  ${g.meanTrades.toFixed(0).padStart(6)} │ ` +
        `${g.genome.entrySpeed.toFixed(3).padStart(8)}  ${g.genome.pressureFilter.toFixed(3).padStart(8)}  ` +
        `${g.genome.takeProfitBias.toFixed(3).padStart(6)}  ${g.genome.riskTolerance.toFixed(3).padStart(4)}  ` +
        `${g.genome.holdPatience.toFixed(3).padStart(4)}  ${g.genome.momentumWeight.toFixed(3).padStart(8)}`,
    );
  }
  console.log(`\n(starting genome is 0.500 on every trait — any drift is selection)`);
}

if (process.argv[1]?.endsWith('evolve.ts')) main();
