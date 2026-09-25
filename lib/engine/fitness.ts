/**
 * Fitness.
 *
 * "The agent made money, so it was good" is the trap this module exists to
 * avoid. An agent can be profitable and still be worthless as a parent: it may
 * have bet enormous size on three coin flips, or ridden one lucky token, or
 * survived by never trading at all.
 *
 * Fitness therefore combines five measures, and then does the thing that
 * matters most: it **shrinks the score towards the population mean in
 * proportion to how much evidence the agent has produced**. With trades /
 * (trades + K), an agent with three lucky wins is pulled back to average,
 * while one with two hundred trades is trusted on its own record.
 *
 * Without that shrinkage, selection amplifies noise: the luckiest agents
 * reproduce, their luck does not inherit, and the population evolves towards
 * variance rather than towards skill. With it, the trait that actually
 * survives across generations is the one that pays repeatedly.
 *
 * Pure and dependency-free, so it can be tested exhaustively.
 */

export type ExitReason = 'TP1' | 'TP2' | 'STOP' | 'TIMEOUT';

export interface TradeRecord {
  /** Net return on the position, after slippage and fees. 0.5 = +50%. */
  returnPct: number;
  /** Signed lamports the position added to the agent. */
  pnlLamports: number;
  exitReason: ExitReason;
  holdSteps: number;
}

export interface FitnessInput {
  trades: TradeRecord[];
  alive: boolean;
  stepsLived: number;
  /** Lamports the agent was born with. */
  startingCapitalLamports: number;
  /**
   * Mean raw score of the population this agent is judged against. Defaults
   * to a neutral 0.5 prior when the caller has no population context.
   */
  populationMean?: number;
  /** Shrinkage constant. Higher demands more evidence. */
  confidenceK?: number;
}

export interface FitnessBreakdown {
  /** Risk-adjusted profitability, 0..1. */
  returnScore: number;
  /** Sharpe-like regularity of per-trade returns, 0..1. */
  consistencyScore: number;
  /** 1 - max drawdown, 0..1. */
  riskScore: number;
  /** Take-profit hit rate against stops and timeouts, 0..1. */
  executionScore: number;
  /** How long it lasted, 0..1. */
  survivalScore: number;

  /** Weighted combination, before shrinkage. */
  raw: number;
  /** trades / (trades + K). */
  confidence: number;
  /** The final, evidence-weighted score. This is what selection reads. */
  fitness: number;

  // --- supporting statistics, surfaced on the agent page ----------------
  trades: number;
  wins: number;
  winRate: number;
  meanReturn: number;
  stdReturn: number;
  sharpe: number;
  maxDrawdown: number;
  tp1Hits: number;
  tp2Hits: number;
  stops: number;
  timeouts: number;
  avgHoldSteps: number;
  totalPnlLamports: number;
}

/** Component weights. They sum to 1, so `raw` stays in 0..1. */
export const FITNESS_WEIGHTS = {
  return: 0.35,
  consistency: 0.2,
  risk: 0.2,
  execution: 0.15,
  survival: 0.1,
} as const;

const NEUTRAL_PRIOR = 0.5;

export function computeFitness(input: FitnessInput): FitnessBreakdown {
  const {
    trades,
    alive,
    stepsLived,
    startingCapitalLamports,
    populationMean = NEUTRAL_PRIOR,
    confidenceK = 20,
  } = input;

  const n = trades.length;
  const returns = trades.map((t) => t.returnPct);

  const meanReturn = n > 0 ? returns.reduce((a, b) => a + b, 0) / n : 0;
  const variance =
    n > 1 ? returns.reduce((acc, r) => acc + (r - meanReturn) ** 2, 0) / (n - 1) : 0;
  const stdReturn = Math.sqrt(variance);

  // Sharpe-like, with a floor on the denominator rather than a zero-guard.
  //
  // Guarding on `std > 0` would score a perfectly steady agent as *unknown*
  // (sharpe 0, neutral) while an erratic one with the same mean scored above
  // it — exactly backwards. Zero dispersion is the best possible regularity,
  // so the floor lets it express that while keeping the ratio finite. The
  // floor is in return units: 5% per-trade dispersion is the reference scale.
  const DISPERSION_FLOOR = 0.05;
  const sharpe = n > 1 ? meanReturn / (stdReturn + DISPERSION_FLOOR) : 0;

  // --- drawdown, from the equity curve the trades imply -----------------
  // `trades` must be in the order they closed: this walk is a sequence, not a
  // set, and a shuffled input reports a drawdown the agent never suffered.
  let equity = startingCapitalLamports;
  let peak = startingCapitalLamports;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity += trade.pnlLamports;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }

  const wins = trades.filter((t) => t.pnlLamports > 0).length;
  const tp1Hits = trades.filter((t) => t.exitReason === 'TP1').length;
  const tp2Hits = trades.filter((t) => t.exitReason === 'TP2').length;
  const stops = trades.filter((t) => t.exitReason === 'STOP').length;
  const timeouts = trades.filter((t) => t.exitReason === 'TIMEOUT').length;
  const totalPnlLamports = trades.reduce((acc, t) => acc + t.pnlLamports, 0);
  const avgHoldSteps = n > 0 ? trades.reduce((acc, t) => acc + t.holdSteps, 0) / n : 0;

  // --- components, each normalised to 0..1 -------------------------------

  // Squashed rather than clamped, so the scale never saturates: a linear map
  // sent both +25% and +100% to 1.0 and could not tell a good agent from an
  // exceptional one. tanh keeps the ordering strict at every magnitude while
  // still being steep near zero, where the decisions actually are.
  const returnScore = clamp01(0.5 + 0.5 * Math.tanh(meanReturn * 2.5));

  const consistencyScore = clamp01(0.5 + 0.5 * Math.tanh(sharpe * 0.6));

  const riskScore = clamp01(1 - maxDrawdown);

  const tpRate = n > 0 ? (tp1Hits + tp2Hits) / n : 0;
  const stopRate = n > 0 ? stops / n : 0;
  const timeoutRate = n > 0 ? timeouts / n : 0;
  // Timeouts are penalised only mildly: drifting out of a position is weaker
  // than hitting a target, but it is not the same failure as being stopped.
  const executionScore = clamp01(0.5 + 0.6 * tpRate - 0.4 * stopRate - 0.15 * timeoutRate);

  const longevity = Math.min(1, stepsLived / 200);
  const survivalScore = alive ? clamp01(0.5 + 0.5 * longevity) : clamp01(0.3 * longevity);

  const raw =
    FITNESS_WEIGHTS.return * returnScore +
    FITNESS_WEIGHTS.consistency * consistencyScore +
    FITNESS_WEIGHTS.risk * riskScore +
    FITNESS_WEIGHTS.execution * executionScore +
    FITNESS_WEIGHTS.survival * survivalScore;

  // --- the part that matters --------------------------------------------
  // An agent is trusted on its own record only in proportion to the evidence
  // behind it. Everything else is pulled back towards the population.
  const confidence = n / (n + confidenceK);
  const fitness = populationMean + confidence * (raw - populationMean);

  return {
    returnScore,
    consistencyScore,
    riskScore,
    executionScore,
    survivalScore,
    raw,
    confidence,
    fitness,
    trades: n,
    wins,
    winRate: n > 0 ? wins / n : 0,
    meanReturn,
    stdReturn,
    sharpe,
    maxDrawdown,
    tp1Hits,
    tp2Hits,
    stops,
    timeouts,
    avgHoldSteps,
    totalPnlLamports,
  };
}

/**
 * Mean raw score across a population, used as the shrinkage prior.
 * Falls back to the neutral prior for an empty population.
 */
export function populationMeanRaw(raws: number[]): number {
  if (raws.length === 0) return NEUTRAL_PRIOR;
  return raws.reduce((a, b) => a + b, 0) / raws.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
