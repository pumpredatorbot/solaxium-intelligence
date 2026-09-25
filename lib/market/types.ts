/**
 * Market data types.
 *
 * These describe a pump.fun-style launch market as the engine sees it. They
 * are deliberately source-agnostic: the same shapes come out of a live
 * recorder, a recorded dataset being replayed, or a synthetic fixture. The
 * engine never knows which.
 *
 * All prices are quoted in SOL per token, all sizes in lamports, so the paper
 * ledger uses the same integer arithmetic as the rest of the system.
 */

export type MarketSource = 'FIXTURE' | 'RECORDED' | 'LIVE';

/** A token as it appeared at launch. */
export interface TokenLaunch {
  /** Mint address. Synthetic for fixtures, the real base58 mint when recorded. */
  mint: string;
  symbol: string;
  name: string;
  /** Wall-clock launch time, from the market, not from the engine. */
  launchedAt: number;
  /** Initial market cap in lamports. */
  initialMcapLamports: number;
}

/**
 * One observation of a token's state.
 *
 * pump.fun exposes a bonding curve, so price is a function of supply sold.
 * We record the resulting price and the flow around it rather than trying to
 * reconstruct the curve — the flow is what a sniper actually reacts to.
 */
export interface MarketTick {
  mint: string;
  /** Milliseconds since the token launched. */
  ageMs: number;
  at: number;
  /** Price in lamports per token. */
  priceLamports: number;
  mcapLamports: number;
  buys: number;
  sells: number;
  /** Traded volume since launch, in lamports. */
  volumeLamports: number;
  holders: number;
  /** Price change vs the launch price, as a ratio. 1.72 = +72%. */
  momentum: number;
}

/** What an agent is shown when deciding whether to enter. */
export interface TokenSnapshot {
  mint: string;
  symbol: string;
  ageMs: number;
  priceLamports: number;
  mcapLamports: number;
  buys: number;
  sells: number;
  /** buys / (buys + sells), 0..1. The headline pressure signal. */
  buyRatio: number;
  volumeLamports: number;
  holders: number;
  momentum: number;
  /** Ticks observed so far — a proxy for how much evidence exists. */
  observations: number;
}

/**
 * A market a population can be run against.
 *
 * Implementations: FixtureMarket (seeded synthetic), RecordedMarket (replay
 * from Postgres), LiveMarket (pump.fun websocket). The engine only ever holds
 * this interface, which is why live ingestion can be added later without the
 * engine changing.
 */
export interface MarketFeed {
  readonly source: MarketSource;
  /** Stable identifier for the dataset, so a run can name what it traded. */
  readonly datasetId: string;

  /** Tokens launching in this step, in launch order. */
  launches(step: number): TokenLaunch[];
  /** The state of a token at a given step, or null once it is no longer tracked. */
  tickAt(mint: string, step: number): MarketTick | null;
  /** Total steps available. Infinite feeds report Number.POSITIVE_INFINITY. */
  readonly length: number;
  /** Milliseconds of market time per step. */
  readonly stepMs: number;
}

/** Aggregate description of a dataset, for the UI and for run provenance. */
export interface DatasetSummary {
  datasetId: string;
  source: MarketSource;
  tokenCount: number;
  steps: number;
  stepMs: number;
  /** Fraction of tokens that ever doubled from launch. */
  doubleRate: number;
  /** Fraction that lost more than half their launch price. */
  rugRate: number;
}
