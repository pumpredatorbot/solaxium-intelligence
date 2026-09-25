/**
 * Real trades into a replayable market.
 *
 * This is the whole point of the recorded path: pump.fun gives an irregular
 * stream of individual trades, and the engine needs a regular grid of ticks it
 * can step through identically every time. Aggregation is where that
 * conversion happens, and it is a pure function — same trades in, same market
 * out — so a recorded dataset replays as deterministically as a synthetic one.
 *
 * Three decisions worth knowing about, because they change what agents learn:
 *
 *  - **Last price wins inside a step.** A step is a closing price, not an
 *    average: an agent stepping the market sees what the last trade printed,
 *    which is the price it could actually have acted on next.
 *  - **Prices carry forward through silence.** A token nobody trades has not
 *    become worthless, it has become illiquid. Carrying the last print for a
 *    bounded number of steps models that honestly; dropping the token instead
 *    would quietly erase open positions.
 *  - **Buys, sells and volume are cumulative since launch.** They are evidence
 *    an agent accumulates, not an instantaneous rate, and they match the
 *    semantics the synthetic market already used so a genome decoded against
 *    one is decoded the same way against the other.
 */

import type { MarketTick, TokenLaunch } from '../types';
import { PRICE_LOT, type RawLaunch, type RawTrade } from './types';

export interface AggregateOptions {
  /** Milliseconds of market time per step. */
  stepMs?: number;
  /**
   * How long to keep quoting a token after its last trade. A rugged token goes
   * quiet; its holders are still holding.
   */
  maxIdleSteps?: number;
  /** Hard cap on how long any token is tracked, so one survivor cannot stretch the dataset. */
  maxLifespanSteps?: number;
  /** Tokens with fewer trades than this are dropped: too little to replay. */
  minTrades?: number;
  /** Explicit window start; defaults to the earliest launch or trade seen. */
  windowStartMs?: number;
}

export const AGGREGATE_DEFAULTS = {
  stepMs: 1000,
  maxIdleSteps: 45,
  maxLifespanSteps: 600,
  minTrades: 4,
} as const;

export interface AggregatedToken {
  launch: TokenLaunch;
  launchStep: number;
  /** Ticks by step offset from launchStep: index 0 is the launch step. */
  ticks: MarketTick[];
  tradeCount: number;
}

export interface AggregatedMarket {
  tokens: AggregatedToken[];
  steps: number;
  stepMs: number;
  windowStartMs: number;
  windowEndMs: number;
  /** Tokens seen but dropped, and why — provenance, not decoration. */
  dropped: { mint: string; reason: string }[];
  tradeCount: number;
}

/**
 * Builds a market from real launches and trades.
 *
 * Launch metadata is optional: a token's launch price is recovered from its
 * first trade, which is more reliable than a coin record fetched later (by then
 * the reserves have moved). Metadata only supplies the symbol and name.
 */
export function aggregate(
  launches: RawLaunch[],
  trades: RawTrade[],
  options: AggregateOptions = {},
): AggregatedMarket {
  const stepMs = options.stepMs ?? AGGREGATE_DEFAULTS.stepMs;
  const maxIdleSteps = options.maxIdleSteps ?? AGGREGATE_DEFAULTS.maxIdleSteps;
  const maxLifespanSteps = options.maxLifespanSteps ?? AGGREGATE_DEFAULTS.maxLifespanSteps;
  const minTrades = options.minTrades ?? AGGREGATE_DEFAULTS.minTrades;

  const meta = new Map(launches.map((l) => [l.mint, l]));
  const dropped: { mint: string; reason: string }[] = [];

  // Chronological, with the signature as a tiebreak so two trades in the same
  // millisecond can never swap places between two aggregations of the same
  // capture. Without a total order the dataset would not be reproducible.
  const sorted = [...trades].sort(
    (a, b) => a.at - b.at || (a.signature ?? '').localeCompare(b.signature ?? '') || a.mint.localeCompare(b.mint),
  );

  const byMint = new Map<string, RawTrade[]>();
  for (const trade of sorted) {
    const list = byMint.get(trade.mint);
    if (list) list.push(trade);
    else byMint.set(trade.mint, [trade]);
  }

  if (sorted.length === 0) {
    const start = options.windowStartMs ?? 0;
    return {
      tokens: [], steps: 0, stepMs, windowStartMs: start, windowEndMs: start,
      dropped: [...meta.keys()].map((mint) => ({ mint, reason: 'no trades' })),
      tradeCount: 0,
    };
  }

  const windowStartMs =
    options.windowStartMs ??
    Math.min(sorted[0].at, ...[...meta.values()].map((l) => l.launchedAt).filter((t) => t > 0));
  const windowEndMs = sorted[sorted.length - 1].at;

  const stepOf = (at: number) => Math.max(0, Math.floor((at - windowStartMs) / stepMs));

  const tokens: AggregatedToken[] = [];

  // Mints in a stable order, so the dataset's token order does not depend on
  // Map insertion from an upstream response.
  for (const mint of [...byMint.keys()].sort()) {
    const mintTrades = byMint.get(mint)!;
    if (mintTrades.length < minTrades) {
      dropped.push({ mint, reason: `only ${mintTrades.length} trades` });
      continue;
    }

    const first = mintTrades[0];
    const info = meta.get(mint);
    // A launch time from metadata is preferred — it is the real creation
    // timestamp — but never one that postdates the first trade we hold.
    const launchedAt =
      info && info.launchedAt > 0 && info.launchedAt <= first.at ? info.launchedAt : first.at;
    const launchStep = stepOf(launchedAt);
    const launchPrice = first.priceLamports;

    const lastTradeStep = stepOf(mintTrades[mintTrades.length - 1].at);
    const lifespan = Math.min(
      lastTradeStep - launchStep + maxIdleSteps,
      maxLifespanSteps,
    );
    if (lifespan < 1) {
      dropped.push({ mint, reason: 'lifespan under one step' });
      continue;
    }

    // --- bucket trades by step offset ------------------------------------
    const buckets = new Map<number, RawTrade[]>();
    for (const trade of mintTrades) {
      const offset = stepOf(trade.at) - launchStep;
      if (offset < 0 || offset > lifespan) continue;
      const list = buckets.get(offset);
      if (list) list.push(trade);
      else buckets.set(offset, [trade]);
    }

    const ticks: MarketTick[] = [];
    const traders = new Set<string>();
    let buys = 0;
    let sells = 0;
    let volume = 0;
    let lastPrice = launchPrice;
    let lastMcap = first.mcapLamports;

    for (let offset = 0; offset <= lifespan; offset++) {
      const bucket = buckets.get(offset);
      if (bucket) {
        for (const trade of bucket) {
          if (trade.isBuy) buys++;
          else sells++;
          volume += trade.solLamports;
          if (trade.trader) traders.add(trade.trader);
        }
        // Closing print of the step.
        const last = bucket[bucket.length - 1];
        lastPrice = last.priceLamports;
        lastMcap = last.mcapLamports;
      }

      ticks.push({
        mint,
        ageMs: offset * stepMs,
        at: (launchStep + offset) * stepMs,
        priceLamports: Math.max(1, lastPrice),
        mcapLamports: Math.max(1, lastMcap),
        buys,
        sells,
        volumeLamports: volume,
        // Distinct wallets that have traded: a lower bound on holders, and the
        // only holder figure a trade history can honestly support.
        holders: Math.max(1, traders.size),
        momentum: launchPrice > 0 ? lastPrice / launchPrice : 1,
      });
    }

    tokens.push({
      launch: {
        mint,
        symbol: info?.symbol ?? mint.slice(0, 6).toUpperCase(),
        name: info?.name ?? mint.slice(0, 8),
        launchedAt,
        initialMcapLamports: Math.max(1, first.mcapLamports),
      },
      launchStep,
      ticks,
      tradeCount: mintTrades.length,
    });
  }

  for (const mint of meta.keys()) {
    if (!byMint.has(mint)) dropped.push({ mint, reason: 'no trades' });
  }

  tokens.sort((a, b) => a.launchStep - b.launchStep || a.launch.mint.localeCompare(b.launch.mint));

  const steps = tokens.reduce((max, t) => Math.max(max, t.launchStep + t.ticks.length), 0);

  return { tokens, steps, stepMs, windowStartMs, windowEndMs, dropped, tradeCount: sorted.length };
}

/** What fraction of tokens doubled, and what fraction halved. Dataset provenance. */
export function marketStats(market: AggregatedMarket): {
  doubleRate: number;
  rugRate: number;
  medianPeakMultiple: number;
} {
  if (market.tokens.length === 0) return { doubleRate: 0, rugRate: 0, medianPeakMultiple: 0 };

  const peaks: number[] = [];
  let doubled = 0;
  let rugged = 0;

  for (const token of market.tokens) {
    const launch = token.ticks[0]?.priceLamports ?? 1;
    let peak = 0;
    for (const tick of token.ticks) peak = Math.max(peak, tick.priceLamports / launch);
    peaks.push(peak);
    if (peak >= 2) doubled++;
    const final = token.ticks[token.ticks.length - 1]!.priceLamports / launch;
    if (final <= 0.5) rugged++;
  }

  peaks.sort((a, b) => a - b);
  return {
    doubleRate: doubled / market.tokens.length,
    rugRate: rugged / market.tokens.length,
    medianPeakMultiple: peaks[Math.floor(peaks.length / 2)],
  };
}

export { PRICE_LOT };
