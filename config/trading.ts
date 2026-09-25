/**
 * SOLAXIUM paper-trading configuration.
 *
 * Every parameter an agent can express lives in its genome; everything here is
 * the *arena* those agents compete in — the costs, the limits and the bounds
 * the genome is decoded into. Nothing here is hardcoded elsewhere.
 *
 * NO REAL VALUE MOVES. Positions are paper positions against recorded or
 * synthetic market data. There is no wallet, no key and no transaction.
 */

/** The genome. Eight traits in [0,1], mutated at cloning exactly as before. */
export const TRADING_TRAIT_KEYS = [
  /** Fraction of capital committed per position. */
  'riskTolerance',
  /** How early after launch the agent is willing to enter. */
  'entrySpeed',
  /** How long it will hold before giving up on a position. */
  'holdPatience',
  /** Preference for taking profit at TP1 (+50%) rather than holding for TP2 (+100%). */
  'takeProfitBias',
  /** Weight placed on price momentum when judging a launch. */
  'momentumWeight',
  /** How much buy/sell pressure must favour a token before entering. */
  'pressureFilter',
  /** Stop-loss tightness and drawdown aversion. */
  'capitalPreservation',
  /** Willingness to deviate from its own best-known rule. */
  'exploration',
] as const;

export type TradingTraitKey = (typeof TRADING_TRAIT_KEYS)[number];

export interface TradingConfig {
  // --- capital ----------------------------------------------------------
  /** Starting capital for every newborn agent, in SOL. */
  INITIAL_CAPITAL_SOL: number;
  /**
   * At or above this, an agent may reproduce. Tuned against extinction:
   * generation 0 trades a neutral genome and loses ~25%, so the bar has to be
   * low enough that some founder reaches it before the cohort dies out.
   */
  CLONE_THRESHOLD_SOL: number;
  /** At or below this, the agent is dead. */
  DEATH_THRESHOLD_SOL: number;
  MAX_CLONES_PER_AGENT: number;
  MAX_GENERATIONS: number;
  MAX_LIVE_AGENTS: number;
  FOUNDER_COUNT: number;

  // --- position sizing ---------------------------------------------------
  /** Bounds on the fraction of capital a single position may use. */
  MIN_POSITION_FRACTION: number;
  MAX_POSITION_FRACTION: number;
  /** Positions an agent may hold at once. */
  MAX_CONCURRENT_POSITIONS: number;

  // --- exits -------------------------------------------------------------
  /** First take-profit, as a multiple of entry. 1.5 = +50%. */
  TP1_MULTIPLE: number;
  /** Second take-profit. 2.0 = +100%. */
  TP2_MULTIPLE: number;
  /** Bounds on the stop, as a multiple of entry. */
  MIN_STOP_MULTIPLE: number;
  MAX_STOP_MULTIPLE: number;
  /** Bounds on how many steps a position may be held. */
  MIN_HOLD_STEPS: number;
  MAX_HOLD_STEPS: number;

  // --- entry window ------------------------------------------------------
  /** Bounds on token age at entry, in steps. */
  MIN_ENTRY_AGE_STEPS: number;
  MAX_ENTRY_AGE_STEPS: number;

  // --- execution costs ---------------------------------------------------
  /**
   * Slippage charged on entry and exit, as a fraction. Launch markets are
   * thin; a paper engine that fills at the quoted price would evolve agents
   * that are profitable only because the costs are missing.
   */
  BASE_SLIPPAGE: number;
  /** Extra slippage proportional to position size relative to token mcap. */
  IMPACT_COEFFICIENT: number;
  /** Flat fee per fill, in SOL — stands in for priority fees and the 1% pump.fun fee. */
  FEE_SOL: number;
  /** Per-step capital cost. Idling is not free. */
  STEP_COST_SOL: number;

  // --- evolution ---------------------------------------------------------
  MUTATION_RATE: number;
  MUTATION_CHANCE: number;
  /** Minimum closed trades before an agent may reproduce. */
  MIN_TRADES_FOR_CLONING: number;
  /**
   * Shrinkage constant for fitness. An agent's own record is trusted in
   * proportion to trades / (trades + K), so a 3-trade winner cannot outrank a
   * 200-trade one on luck. Raising K demands more evidence.
   */
  FITNESS_CONFIDENCE_K: number;
  /** Minimum fitness an agent must hold to stay eligible to reproduce. */
  MIN_FITNESS_FOR_CLONING: number;
}

export const DEFAULT_TRADING_CONFIG: TradingConfig = {
  INITIAL_CAPITAL_SOL: 1,
  CLONE_THRESHOLD_SOL: 1.8,
  DEATH_THRESHOLD_SOL: 0.05,
  MAX_CLONES_PER_AGENT: 3,
  MAX_GENERATIONS: 20,
  MAX_LIVE_AGENTS: 160,
  /**
   * Founders per run. Swept against extinction rate: 24 founders go extinct in
   * 38% of seeds and 48 in 13%, because a narrow starting cloud of neutral
   * genomes can miss the viable region entirely. 80 reaches 0%.
   */
  FOUNDER_COUNT: 80,

  MIN_POSITION_FRACTION: 0.02,
  MAX_POSITION_FRACTION: 0.35,
  MAX_CONCURRENT_POSITIONS: 3,

  TP1_MULTIPLE: 1.5,
  TP2_MULTIPLE: 2.0,
  MIN_STOP_MULTIPLE: 0.55,
  MAX_STOP_MULTIPLE: 0.9,
  MIN_HOLD_STEPS: 5,
  MAX_HOLD_STEPS: 40,

  MIN_ENTRY_AGE_STEPS: 1,
  MAX_ENTRY_AGE_STEPS: 8,

  BASE_SLIPPAGE: 0.012,
  IMPACT_COEFFICIENT: 0.35,
  FEE_SOL: 0.0006,
  STEP_COST_SOL: 0.00015,

  MUTATION_RATE: 0.08,
  MUTATION_CHANCE: 0.6,
  MIN_TRADES_FOR_CLONING: 8,
  FITNESS_CONFIDENCE_K: 20,
  MIN_FITNESS_FOR_CLONING: 0.52,
};

/** Founder genome: neutral, so generation 0 has nothing pre-programmed. */
export const FOUNDER_TRADING_TRAITS: Record<TradingTraitKey, number> = {
  riskTolerance: 0.5,
  entrySpeed: 0.5,
  holdPatience: 0.5,
  takeProfitBias: 0.5,
  momentumWeight: 0.5,
  pressureFilter: 0.5,
  capitalPreservation: 0.5,
  exploration: 0.5,
};

// ---------------------------------------------------------------------------
// Genome decoding — the only place a trait becomes a number the engine uses
// ---------------------------------------------------------------------------

export interface DecodedStrategy {
  /** Token age at which this agent enters, in steps. */
  entryAgeSteps: number;
  /** Minimum buy ratio (0..1) required to enter. */
  minBuyRatio: number;
  /** Maximum momentum the agent will still chase. */
  maxMomentum: number;
  /** Fraction of capital per position. */
  positionFraction: number;
  /** Exit multiple it aims for. */
  takeProfitMultiple: number;
  /** Stop multiple. */
  stopMultiple: number;
  /** Maximum steps held. */
  maxHoldSteps: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/**
 * Turns a genome into a concrete strategy.
 *
 * This mapping is the agent's entire "program". Evolution searches it; nothing
 * here is tuned towards a known-good answer, and the neutral genome sits in
 * the middle of every range.
 */
export function decodeStrategy(
  traits: Record<TradingTraitKey, number>,
  config: TradingConfig,
): DecodedStrategy {
  // Faster agents enter younger tokens: more upside, far less information.
  const entryAgeSteps = Math.round(
    lerp(config.MAX_ENTRY_AGE_STEPS, config.MIN_ENTRY_AGE_STEPS, traits.entrySpeed),
  );

  // A stricter filter trades fewer, better-looking launches.
  const minBuyRatio = lerp(0.3, 0.92, traits.pressureFilter);

  // momentumWeight decides how much already-running price it will chase.
  const maxMomentum = lerp(1.15, 6.0, traits.momentumWeight);

  const positionFraction = lerp(
    config.MIN_POSITION_FRACTION,
    config.MAX_POSITION_FRACTION,
    traits.riskTolerance,
  );

  // High takeProfitBias means "bank at TP1"; low means "hold out for TP2".
  const takeProfitMultiple = lerp(config.TP2_MULTIPLE, config.TP1_MULTIPLE, traits.takeProfitBias);

  // High capitalPreservation means a tighter stop, cutting losers sooner.
  const stopMultiple = lerp(
    config.MIN_STOP_MULTIPLE,
    config.MAX_STOP_MULTIPLE,
    traits.capitalPreservation,
  );

  const maxHoldSteps = Math.round(
    lerp(config.MIN_HOLD_STEPS, config.MAX_HOLD_STEPS, traits.holdPatience),
  );

  return {
    entryAgeSteps,
    minBuyRatio,
    maxMomentum,
    positionFraction,
    takeProfitMultiple,
    stopMultiple,
    maxHoldSteps,
  };
}

/** Readable strategy labels, derived from the genome's dominant tendencies. */
export const TRADING_STRATEGY_LABELS = [
  'BALANCED',
  'MOMENTUM_SNIPER',
  'PATIENT_SCALPER',
  'FAST_FLIPPER',
  'CONSERVATIVE',
  'SIZE_HUNTER',
  'CONTRARIAN',
] as const;

export type TradingStrategyLabel = (typeof TRADING_STRATEGY_LABELS)[number];
