/**
 * SOLAXIUM INTELLIGENCE — central simulation configuration.
 *
 * Nothing in the engine, the API or the UI may hardcode an economic constant.
 * Everything comes from here (or from a per-simulation override stored on the
 * `Simulation.config` column, which is validated against this shape).
 */

import type { ActionType, RiskLevel } from '@/lib/types';

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Range of SOL amounts, inclusive. Sampled with the simulation's seeded RNG. */
export interface SolRange {
  min: number;
  max: number;
}

export interface ActionDefinition {
  type: ActionType;
  label: string;
  description: string;
  /** Up-front cost in SOL, drawn from this range. */
  cost: SolRange;
  /**
   * Gross revenue in SOL on a fully successful outcome. This is the *ceiling*:
   * the realised draw is `min + (max-min) * u^revenueSkew`, so the headline
   * number is what an action can pay, not what it usually pays.
   */
  potentialRevenue: SolRange;
  /**
   * Skew of the revenue draw. 1 = uniform. Higher values push the typical
   * outcome towards `min` and make the top of the range genuinely rare, which
   * is what stops every agent from getting rich on the same safe action.
   */
  revenueSkew: number;
  risk: RiskLevel;
  /** Probability of a SUCCESS outcome for a perfectly neutral agent (0..1). */
  baseSuccessRate: number;
  /** Fraction of `potentialRevenue` earned on a PARTIAL outcome. */
  partialYield: number;
  /** Cycles consumed. Long actions are rarer but pay more. */
  duration: number;
  /**
   * Which trait pushes this action up in the decision ranking, and how hard.
   * The demo brain and the Claude prompt both read these.
   */
  drivenBy: { trait: TraitKey; weight: number }[];
  /** Persistent effect applied to the agent after the action resolves. */
  effect?: {
    /** Multiplier applied to revenue of subsequent actions, decaying per cycle. */
    revenueBoost?: number;
    boostDecay?: number;
  };
}

export const TRAIT_KEYS = [
  'riskTolerance',
  'innovation',
  'marketingFocus',
  'researchFocus',
  'savingBehavior',
  'aggressiveness',
  'patience',
  'salesFocus',
] as const;

export type TraitKey = (typeof TRAIT_KEYS)[number];

export interface SimulationConfig {
  /** Capital every newborn agent receives, in SOL. */
  INITIAL_CAPITAL_SOL: number;
  /** At or above this capital an agent becomes ELIGIBLE_TO_CLONE. */
  CLONE_THRESHOLD_SOL: number;
  /** At or below this capital the agent dies. */
  DEATH_THRESHOLD_SOL: number;
  MAX_CLONES_PER_AGENT: number;
  /**
   * SOL debited from the parent when it reproduces. Spec default is 0: the
   * simulated treasury endows the clone and the parent keeps its capital.
   */
  CLONE_PARENT_COST_SOL: number;
  /** Maximum generation depth. Generation 0 is the founder. */
  MAX_GENERATIONS: number;
  /** Hard ceiling on living agents, protects the DB and the UI. */
  MAX_LIVE_AGENTS: number;
  /** Upkeep charged to every living agent at the end of each of its cycles. */
  CYCLE_COST_SOL: number;
  /** Per-trait gaussian mutation width applied at cloning. */
  MUTATION_RATE: number;
  /** Probability that a given trait mutates at all during cloning. */
  MUTATION_CHANCE: number;
  /** How much of the parent's strategy the clone inherits (0..1). */
  STRATEGY_INHERITANCE: number;
  /** Memories kept per agent before summarisation kicks in. */
  MEMORY_LIMIT: number;
  /** Number of recent memories summarised into one SUMMARY entry. */
  MEMORY_SUMMARY_BATCH: number;
  /** Cycles an agent must live before it is allowed to clone. */
  MIN_AGE_FOR_CLONING: number;
  /** Market conditions oscillate in [1 - AMPLITUDE, 1 + AMPLITUDE]. */
  MARKET_AMPLITUDE: number;
  MARKET_PERIOD_CYCLES: number;
  /**
   * Global multiplier on every revenue draw. The single knob that decides
   * whether the economy is survivable: at 1.0 a perfectly neutral agent is
   * roughly break-even, below 1.0 the population shrinks.
   */
  REVENUE_SCALE: number;
  REVENUE_RANGES: Record<ActionType, SolRange>;
  EXPENSE_RANGES: Record<ActionType, SolRange>;
}

/**
 * Playback speed is a multiplier on simulated cycles per second. It is a
 * property of the *runner*, never of the simulation: changing it alters how
 * fast you watch a run, never its outcome.
 */
export const SPEED_MULTIPLIERS = [0.5, 1, 2, 5, 10, 25] as const;

export type SpeedMultiplier = (typeof SPEED_MULTIPLIERS)[number];

export const DEFAULT_SPEED: SpeedMultiplier = 1;

/** Fastest beat we will schedule; below this the loop batches instead. */
const MIN_INTERVAL_MS = 80;

export function isSpeedMultiplier(value: unknown): value is SpeedMultiplier {
  return (
    typeof value === 'number' && (SPEED_MULTIPLIERS as readonly number[]).includes(value)
  );
}

/**
 * Converts a multiplier into a timer interval and a per-tick batch size.
 *
 * At high speeds a 1-cycle-per-beat loop would need a sub-40ms timer, which the
 * event loop cannot honour reliably, so the loop runs several cycles per beat
 * instead. `interval x batch` always reconstructs the requested rate.
 */
export function speedSchedule(multiplier: number): { intervalMs: number; batch: number } {
  const rate = multiplier > 0 ? multiplier : 1;
  const intervalMs = Math.max(MIN_INTERVAL_MS, Math.round(1000 / rate));
  const batch = Math.max(1, Math.round((rate * intervalMs) / 1000));
  return { intervalMs, batch };
}

export const ACTION_DEFINITIONS: Record<ActionType, ActionDefinition> = {
  CREATE_PRODUCT: {
    type: 'CREATE_PRODUCT',
    label: 'Create product',
    description: 'Build a new digital product. Expensive up front, unlocks future sales.',
    cost: { min: 0.08, max: 0.22 },
    potentialRevenue: { min: 0.0, max: 0.12 },
    risk: 'MEDIUM',
    revenueSkew: 2.0,
    baseSuccessRate: 0.62,
    partialYield: 0.4,
    duration: 1,
    drivenBy: [
      { trait: 'innovation', weight: 1.0 },
      { trait: 'patience', weight: 0.4 },
    ],
    effect: { revenueBoost: 0.35, boostDecay: 0.08 },
  },
  SELL_PRODUCT: {
    type: 'SELL_PRODUCT',
    label: 'Sell product',
    description: 'Monetise the existing catalogue. Scales with sales focus and prior products.',
    cost: { min: 0.02, max: 0.06 },
    potentialRevenue: { min: 0.06, max: 0.95 },
    risk: 'MEDIUM',
    revenueSkew: 4.2,
    baseSuccessRate: 0.58,
    partialYield: 0.45,
    duration: 1,
    drivenBy: [
      { trait: 'salesFocus', weight: 1.0 },
      { trait: 'aggressiveness', weight: 0.35 },
    ],
  },
  OFFER_SERVICE: {
    type: 'OFFER_SERVICE',
    label: 'Offer service',
    description: 'Sell time for SOL. Cheap, reliable, low ceiling.',
    cost: { min: 0.02, max: 0.05 },
    potentialRevenue: { min: 0.05, max: 0.8 },
    risk: 'LOW',
    revenueSkew: 4.0,
    baseSuccessRate: 0.78,
    partialYield: 0.55,
    duration: 1,
    drivenBy: [
      { trait: 'salesFocus', weight: 0.6 },
      { trait: 'patience', weight: 0.5 },
    ],
  },
  MARKETING: {
    type: 'MARKETING',
    label: 'Marketing',
    description: 'Spend now to amplify the revenue of the next few cycles.',
    cost: { min: 0.05, max: 0.15 },
    potentialRevenue: { min: 0.0, max: 0.18 },
    risk: 'MEDIUM',
    revenueSkew: 2.4,
    baseSuccessRate: 0.6,
    partialYield: 0.35,
    duration: 1,
    drivenBy: [
      { trait: 'marketingFocus', weight: 1.0 },
      { trait: 'aggressiveness', weight: 0.4 },
    ],
    effect: { revenueBoost: 0.55, boostDecay: 0.16 },
  },
  RESEARCH: {
    type: 'RESEARCH',
    label: 'Research',
    description: 'Study the market. No direct revenue, improves later decisions.',
    cost: { min: 0.03, max: 0.09 },
    potentialRevenue: { min: 0.0, max: 0.06 },
    risk: 'LOW',
    revenueSkew: 2.0,
    baseSuccessRate: 0.7,
    partialYield: 0.3,
    duration: 1,
    drivenBy: [
      { trait: 'researchFocus', weight: 1.0 },
      { trait: 'patience', weight: 0.5 },
    ],
    effect: { revenueBoost: 0.2, boostDecay: 0.05 },
  },
  REST: {
    type: 'REST',
    label: 'Rest',
    description: 'Burn nothing but the cycle upkeep. A survival move, not a strategy.',
    cost: { min: 0, max: 0 },
    potentialRevenue: { min: 0, max: 0 },
    risk: 'LOW',
    revenueSkew: 1,
    baseSuccessRate: 1,
    partialYield: 0,
    duration: 1,
    drivenBy: [{ trait: 'patience', weight: 0.8 }],
  },
  INVEST_IN_GROWTH: {
    type: 'INVEST_IN_GROWTH',
    label: 'Invest in growth',
    description: 'High variance capital deployment. The fastest way up, and down.',
    cost: { min: 0.12, max: 0.45 },
    potentialRevenue: { min: 0.0, max: 1.6 },
    risk: 'HIGH',
    revenueSkew: 6.0,
    baseSuccessRate: 0.42,
    partialYield: 0.3,
    duration: 1,
    drivenBy: [
      { trait: 'riskTolerance', weight: 1.0 },
      { trait: 'aggressiveness', weight: 0.6 },
    ],
  },
  SAVE: {
    type: 'SAVE',
    label: 'Save',
    description: 'Hold capital, earn a small yield, skip the risk.',
    cost: { min: 0, max: 0.01 },
    potentialRevenue: { min: 0.0, max: 0.05 },
    risk: 'LOW',
    revenueSkew: 2.5,
    baseSuccessRate: 0.9,
    partialYield: 0.6,
    duration: 1,
    drivenBy: [
      { trait: 'savingBehavior', weight: 1.0 },
      { trait: 'patience', weight: 0.4 },
    ],
  },
};

function rangesFrom(pick: (d: ActionDefinition) => SolRange): Record<ActionType, SolRange> {
  return Object.fromEntries(
    Object.values(ACTION_DEFINITIONS).map((d) => [d.type, pick(d)]),
  ) as Record<ActionType, SolRange>;
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  INITIAL_CAPITAL_SOL: 1,
  CLONE_THRESHOLD_SOL: 5,
  DEATH_THRESHOLD_SOL: 0,
  MAX_CLONES_PER_AGENT: 3,
  CLONE_PARENT_COST_SOL: 0,
  MAX_GENERATIONS: 12,
  MAX_LIVE_AGENTS: 120,
  CYCLE_COST_SOL: 0.15,
  REVENUE_SCALE: 1.95,
  MUTATION_RATE: 0.08,
  MUTATION_CHANCE: 0.6,
  STRATEGY_INHERITANCE: 0.75,
  MEMORY_LIMIT: 40,
  MEMORY_SUMMARY_BATCH: 12,
  MIN_AGE_FOR_CLONING: 3,
  MARKET_AMPLITUDE: 0.25,
  MARKET_PERIOD_CYCLES: 40,
  REVENUE_RANGES: rangesFrom((d) => d.potentialRevenue),
  EXPENSE_RANGES: rangesFrom((d) => d.cost),
};

/** Default trait values for a founder agent (generation 0). */
export const FOUNDER_TRAITS: Record<TraitKey, number> = {
  riskTolerance: 0.5,
  innovation: 0.5,
  marketingFocus: 0.5,
  researchFocus: 0.5,
  savingBehavior: 0.5,
  aggressiveness: 0.5,
  patience: 0.5,
  salesFocus: 0.5,
};

export const STRATEGY_LABELS = [
  'BALANCED',
  'SERVICE_GRINDER',
  'PRODUCT_BUILDER',
  'GROWTH_HUNTER',
  'CONSERVATIVE',
  'MARKET_PUSHER',
  'RESEARCHER',
] as const;

export type StrategyLabel = (typeof STRATEGY_LABELS)[number];
