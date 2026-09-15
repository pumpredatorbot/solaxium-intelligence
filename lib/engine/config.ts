/**
 * Per-simulation configuration: the defaults from /config/simulation.ts merged
 * with whatever overrides were stored on the Simulation row, validated so a
 * hand-edited JSON column can never poison the economy.
 */

import { DEFAULT_SIMULATION_CONFIG, type SimulationConfig } from '@/config/simulation';

const NUMERIC_BOUNDS: Partial<Record<keyof SimulationConfig, [number, number]>> = {
  INITIAL_CAPITAL_SOL: [0.01, 1000],
  CLONE_THRESHOLD_SOL: [0.02, 10_000],
  DEATH_THRESHOLD_SOL: [0, 100],
  MAX_CLONES_PER_AGENT: [0, 20],
  CLONE_PARENT_COST_SOL: [0, 1000],
  MAX_GENERATIONS: [1, 200],
  MAX_LIVE_AGENTS: [1, 5000],
  CYCLE_COST_SOL: [0, 100],
  REVENUE_SCALE: [0.05, 5],
  MUTATION_RATE: [0, 1],
  MUTATION_CHANCE: [0, 1],
  STRATEGY_INHERITANCE: [0, 1],
  MEMORY_LIMIT: [4, 1000],
  MEMORY_SUMMARY_BATCH: [2, 500],
  MIN_AGE_FOR_CLONING: [0, 1000],
  MARKET_AMPLITUDE: [0, 0.9],
  MARKET_PERIOD_CYCLES: [2, 10_000],
};

export function resolveConfig(overrides?: unknown): SimulationConfig {
  const config: SimulationConfig = {
    ...DEFAULT_SIMULATION_CONFIG,
    REVENUE_RANGES: { ...DEFAULT_SIMULATION_CONFIG.REVENUE_RANGES },
    EXPENSE_RANGES: { ...DEFAULT_SIMULATION_CONFIG.EXPENSE_RANGES },
  };

  if (!overrides || typeof overrides !== 'object') return config;
  const raw = overrides as Record<string, unknown>;

  for (const [key, bounds] of Object.entries(NUMERIC_BOUNDS) as [
    keyof SimulationConfig,
    [number, number],
  ][]) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      (config[key] as number) = Math.min(bounds[1], Math.max(bounds[0], value));
    }
  }

  // The clone threshold must sit above the starting capital, otherwise every
  // newborn is instantly eligible and the population explodes on cycle 1.
  if (config.CLONE_THRESHOLD_SOL <= config.INITIAL_CAPITAL_SOL) {
    config.CLONE_THRESHOLD_SOL = config.INITIAL_CAPITAL_SOL * 2;
  }
  if (config.DEATH_THRESHOLD_SOL >= config.INITIAL_CAPITAL_SOL) {
    config.DEATH_THRESHOLD_SOL = 0;
  }

  return config;
}

/** The subset persisted on Simulation.config — ranges stay in code. */
export function serialisableConfig(config: SimulationConfig): Record<string, number> {
  return Object.fromEntries(
    (Object.keys(NUMERIC_BOUNDS) as (keyof SimulationConfig)[]).map((key) => [
      key,
      config[key] as number,
    ]),
  );
}
