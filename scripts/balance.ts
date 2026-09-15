/**
 * Economy balance harness.
 *
 *   npx tsx scripts/balance.ts [--sweep]
 *
 * Runs the *pure* parts of the engine — decision scoring, action resolution,
 * death, cloning, mutation — entirely in memory, with no database. That makes
 * a 20-config x 5-seed sweep take seconds instead of an hour, which is what
 * makes the economy tunable at all.
 *
 * It is the same code path the real engine uses (`scoreAction`,
 * `resolveAction`, `mutateTraits`), so the numbers it reports are the numbers
 * the persisted simulation produces.
 */

import { DEFAULT_SIMULATION_CONFIG, type SimulationConfig } from '@/config/simulation';
import { ACTION_DEFINITIONS } from '@/config/simulation';
import { createRng, type SeededRandom } from '@/lib/rng';
import { lamportsToSol, solToLamports } from '@/lib/sol';
import { decayMomentum, marketAt, resolveAction } from '@/lib/engine/actions';
import { scoreAction } from '@/lib/ai/demo';
import { mutateTraits } from '@/lib/engine/mutation';
import { deriveStrategy } from '@/lib/engine/strategy';
import { randomTraits, type TraitVector } from '@/lib/engine/traits';
import type { AgentSnapshot, AvailableAction } from '@/lib/engine/snapshot';
import type { ActionType } from '@/lib/types';

interface SimAgent {
  code: string;
  generation: number;
  traits: TraitVector;
  strategy: string;
  capital: number;
  starting: number;
  revenue: number;
  expenses: number;
  cycles: number;
  clones: number;
  momentum: number;
  alive: boolean;
  history: { type: ActionType; netSol: number }[];
}

export interface RunStats {
  total: number;
  alive: number;
  dead: number;
  clones: number;
  generations: number;
  medianLifetime: number;
  avgProfitByGen: number[];
  bestCapitalSol: number;
  extinct: boolean;
  /** Mean profit per cycle lived, by generation. Age-adjusted, so cohorts
   *  born late are comparable to the founders. */
  profitPerCycleByGen: number[];
  /** Fraction of each generation still alive at the end of the run. */
  survivalByGen: number[];
  /** Mean trait vector by generation — this is what "evolution" must move. */
  traitMeansByGen: Record<string, number>[];
}

function snapshotFor(agent: SimAgent, config: SimulationConfig, cycle: number): AgentSnapshot {
  const capitalSol = lamportsToSol(agent.capital);
  const available: AvailableAction[] = Object.values(ACTION_DEFINITIONS)
    .filter((def) => capitalSol >= config.EXPENSE_RANGES[def.type].min)
    .map((def) => ({
      type: def.type,
      label: def.label,
      description: def.description,
      estimatedCostSol: config.EXPENSE_RANGES[def.type],
      potentialRevenueSol: config.REVENUE_RANGES[def.type],
      risk: def.risk,
      affordable: capitalSol >= config.EXPENSE_RANGES[def.type].max,
    }));
  if (!available.some((a) => a.type === 'REST')) {
    const def = ACTION_DEFINITIONS.REST;
    available.push({
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
    name: agent.code,
    generation: agent.generation,
    parentCode: null,
    strategy: agent.strategy,
    cycles: agent.cycles,
    clonesCreated: agent.clones,
    maxClones: config.MAX_CLONES_PER_AGENT,
    capitalSol,
    startingCapitalSol: lamportsToSol(agent.starting),
    totalRevenueSol: lamportsToSol(agent.revenue),
    totalExpensesSol: lamportsToSol(agent.expenses),
    totalProfitSol: lamportsToSol(agent.capital - agent.starting),
    roi: agent.starting > 0 ? (agent.capital - agent.starting) / agent.starting : 0,
    cloneThresholdSol: config.CLONE_THRESHOLD_SOL,
    deathThresholdSol: config.DEATH_THRESHOLD_SOL,
    cycleCostSol: config.CYCLE_COST_SOL,
    runwayCycles: capitalSol / Math.max(config.CYCLE_COST_SOL, 1e-9),
    traits: agent.traits,
    market: marketAt(cycle, config),
    momentum: agent.momentum,
    memory: [],
    recentActions: agent.history.slice(-8).map((h, i) => ({
      cycle: cycle - agent.history.slice(-8).length + i,
      type: h.type,
      outcome: h.netSol > 0 ? 'SUCCESS' : 'FAILURE',
      costSol: 0,
      revenueSol: Math.max(0, h.netSol),
      netSol: h.netSol,
    })),
    availableActions: available,
  };
}

/** Mirrors DemoProvider.decide without the async/provider indirection. */
function decide(snapshot: AgentSnapshot, rng: SeededRandom): ActionType {
  const candidates = snapshot.availableActions.map((a) => a.type);
  const scores = candidates.map((type) => scoreAction(type, snapshot));
  const temperature = 0.35 + snapshot.traits.innovation * 0.55;
  const max = Math.max(...scores);
  const weights = scores.map((s) => Math.exp((s - max) / temperature));
  return rng.weighted(candidates, weights);
}

export function simulate(
  config: SimulationConfig,
  seed: string,
  cycles: number,
  founders = 4,
): RunStats {
  const rng = createRng(seed, 0);
  const agents: SimAgent[] = [];
  const lifetimes: number[] = [];
  let counter = 0;
  let clones = 0;

  const birth = (generation: number, traits: TraitVector, strategy: string): SimAgent => {
    counter++;
    return {
      code: `SX-${String(counter).padStart(3, '0')}`,
      generation,
      traits,
      strategy,
      capital: solToLamports(config.INITIAL_CAPITAL_SOL),
      starting: solToLamports(config.INITIAL_CAPITAL_SOL),
      revenue: 0,
      expenses: 0,
      cycles: 0,
      clones: 0,
      momentum: 1,
      alive: true,
      history: [],
    };
  };

  for (let i = 0; i < founders; i++) {
    const traits = randomTraits(rng);
    agents.push(birth(0, traits, deriveStrategy(traits)));
  }

  const deathThreshold = solToLamports(config.DEATH_THRESHOLD_SOL);
  const cloneThreshold = solToLamports(config.CLONE_THRESHOLD_SOL);
  const upkeep = solToLamports(config.CYCLE_COST_SOL);

  for (let cycle = 1; cycle <= cycles; cycle++) {
    const market = marketAt(cycle, config);
    const living = agents.filter((a) => a.alive);
    if (living.length === 0) break;

    for (const agent of living) {
      const snapshot = snapshotFor(agent, config, cycle);
      const action = decide(snapshot, rng);
      const resolved = resolveAction(action, {
        traits: agent.traits,
        capitalLamports: agent.capital,
        market,
        momentum: agent.momentum,
        config,
        rng,
      });

      const spend = Math.min(agent.capital, resolved.costLamports);
      agent.capital -= spend;
      agent.expenses += spend;
      agent.capital += resolved.revenueLamports;
      agent.revenue += resolved.revenueLamports;
      const up = Math.min(agent.capital, upkeep);
      agent.capital -= up;
      agent.expenses += up;
      agent.cycles++;
      agent.momentum = Math.min(
        3,
        Math.max(0.5, decayMomentum(agent.momentum, config) + resolved.momentumGain),
      );
      agent.history.push({
        type: action,
        netSol: lamportsToSol(resolved.revenueLamports - spend - up),
      });

      if (agent.capital <= deathThreshold) {
        agent.alive = false;
        lifetimes.push(agent.cycles);
        continue;
      }

      const liveCount = agents.filter((a) => a.alive).length;
      if (
        agent.capital >= cloneThreshold &&
        agent.clones < config.MAX_CLONES_PER_AGENT &&
        agent.cycles >= config.MIN_AGE_FOR_CLONING &&
        agent.generation + 1 <= config.MAX_GENERATIONS &&
        liveCount < config.MAX_LIVE_AGENTS
      ) {
        const { traits } = mutateTraits(agent.traits, rng, config);
        const strategy = rng.chance(config.STRATEGY_INHERITANCE)
          ? agent.strategy
          : deriveStrategy(traits);
        agent.clones++;
        agent.capital -= solToLamports(config.CLONE_PARENT_COST_SOL);
        clones++;
        agents.push(birth(agent.generation + 1, traits, strategy));
      }
    }
  }

  const alive = agents.filter((a) => a.alive);
  for (const a of alive) lifetimes.push(a.cycles);
  const maxGen = agents.reduce((m, a) => Math.max(m, a.generation), 0);
  const avgProfitByGen: number[] = [];
  for (let g = 0; g <= maxGen; g++) {
    const cohort = agents.filter((a) => a.generation === g);
    avgProfitByGen.push(
      cohort.length === 0
        ? 0
        : cohort.reduce((s, a) => s + lamportsToSol(a.capital - a.starting), 0) / cohort.length,
    );
  }
  const sorted = [...lifetimes].sort((a, b) => a - b);

  const profitPerCycleByGen: number[] = [];
  const survivalByGen: number[] = [];
  const traitMeansByGen: Record<string, number>[] = [];
  for (let g = 0; g <= maxGen; g++) {
    const cohort = agents.filter((a) => a.generation === g);
    if (cohort.length === 0) {
      profitPerCycleByGen.push(0);
      survivalByGen.push(0);
      traitMeansByGen.push({});
      continue;
    }
    profitPerCycleByGen.push(
      cohort.reduce(
        (s, a) => s + lamportsToSol(a.capital - a.starting) / Math.max(1, a.cycles),
        0,
      ) / cohort.length,
    );
    survivalByGen.push(cohort.filter((a) => a.alive).length / cohort.length);
    const means: Record<string, number> = {};
    for (const key of Object.keys(cohort[0].traits)) {
      means[key] =
        cohort.reduce((s, a) => s + (a.traits as Record<string, number>)[key], 0) / cohort.length;
    }
    traitMeansByGen.push(means);
  }

  return {
    profitPerCycleByGen,
    survivalByGen,
    traitMeansByGen,
    total: agents.length,
    alive: alive.length,
    dead: agents.length - alive.length,
    clones,
    generations: maxGen + 1,
    medianLifetime: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    avgProfitByGen,
    bestCapitalSol: agents.reduce((m, a) => Math.max(m, lamportsToSol(a.capital)), 0),
    extinct: alive.length === 0,
  };
}

function summarise(config: SimulationConfig, cycles: number, seeds: string[]): string {
  const runs = seeds.map((s) => simulate(config, s, cycles));
  const avg = (f: (r: RunStats) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
  const mortality = avg((r) => (r.total ? r.dead / r.total : 0));
  return [
    `agents ${avg((r) => r.total).toFixed(0).padStart(4)}`,
    `alive ${avg((r) => r.alive).toFixed(0).padStart(4)}`,
    `mortality ${(mortality * 100).toFixed(0).padStart(3)}%`,
    `clones ${avg((r) => r.clones).toFixed(0).padStart(4)}`,
    `gens ${avg((r) => r.generations).toFixed(1).padStart(4)}`,
    `medLife ${avg((r) => r.medianLifetime).toFixed(0).padStart(3)}`,
    `best ${avg((r) => r.bestCapitalSol).toFixed(1).padStart(6)} SOL`,
    `extinct ${runs.filter((r) => r.extinct).length}/${runs.length}`,
  ].join('  ');
}

function main() {
  const seeds = ['s1', 's2', 's3', 's4', 's5'];
  const cycles = 120;

  if (process.argv.includes('--sweep')) {
    for (const scale of [1.5, 1.65, 1.8, 1.95]) {
      for (const cost of [0.11, 0.13, 0.15, 0.17]) {
        const config: SimulationConfig = {
          ...DEFAULT_SIMULATION_CONFIG,
          REVENUE_SCALE: scale,
          CYCLE_COST_SOL: cost,
          MAX_LIVE_AGENTS: 400,
        };
        console.log(
          `scale ${scale.toFixed(2)} cost ${cost.toFixed(3)} | ${summarise(config, cycles, seeds)}`,
        );
      }
    }
    return;
  }

  console.log(`\nDEFAULT CONFIG — ${cycles} cycles, ${seeds.length} seeds`);
  console.log(summarise(DEFAULT_SIMULATION_CONFIG, cycles, seeds));

  // Aggregate the age-adjusted evolution metrics across many seeds: a single
  // run is noise, the question is whether selection moves the population.
  const manySeeds = Array.from({ length: 24 }, (_, i) => `evo-${i}`);
  const runs = manySeeds.map((s) => simulate(DEFAULT_SIMULATION_CONFIG, s, cycles));
  const maxGen = Math.max(...runs.map((r) => r.profitPerCycleByGen.length));

  console.log('\nGEN   COHORTS   PROFIT/CYCLE (SOL)   SURVIVAL   riskTol   salesFocus   patience');
  for (let g = 0; g < maxGen; g++) {
    const present = runs.filter((r) => r.profitPerCycleByGen.length > g);
    if (present.length < 3) break;
    const mean = (f: (r: RunStats) => number) =>
      present.reduce((a, r) => a + f(r), 0) / present.length;
    const trait = (key: string) =>
      present.reduce((a, r) => a + (r.traitMeansByGen[g]?.[key] ?? 0.5), 0) / present.length;
    console.log(
      `${String(g).padStart(3)}   ${String(present.length).padStart(7)}   ` +
        `${mean((r) => r.profitPerCycleByGen[g]).toFixed(4).padStart(18)}   ` +
        `${(mean((r) => r.survivalByGen[g]) * 100).toFixed(0).padStart(7)}%   ` +
        `${trait('riskTolerance').toFixed(3).padStart(7)}   ` +
        `${trait('salesFocus').toFixed(3).padStart(10)}   ` +
        `${trait('patience').toFixed(3).padStart(8)}`,
    );
  }
}

// Only run the CLI when invoked directly — tests import `simulate` from here.
if (process.argv[1]?.endsWith('balance.ts')) {
  main();
}
