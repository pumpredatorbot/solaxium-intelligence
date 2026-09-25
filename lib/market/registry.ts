/**
 * Resolving a dataset row into a playable market.
 *
 * A FIXTURE dataset is stored as its seed, not as its ticks: the generator is
 * deterministic, so the whole market is regenerated on demand. That keeps a
 * 1500-token market at a few dozen bytes in the database instead of hundreds
 * of thousands of rows, and it is why replay costs nothing to keep around.
 *
 * RECORDED datasets — real pump.fun captures — will store their ticks, since
 * those cannot be regenerated. They resolve through the same interface, so the
 * engine never learns the difference.
 */

import { FixtureMarket } from './fixture-market';
import type { MarketFeed } from './types';

interface DatasetRow {
  key: string;
  source: string;
  seed: string | null;
  steps: number;
  stepMs: number;
}

// Regenerating a market on every engine step would dominate the step cost, so
// built markets are cached per process and keyed by dataset.
const globalForMarkets = globalThis as unknown as {
  __solaxiumMarkets?: Map<string, MarketFeed>;
};
const cache: Map<string, MarketFeed> = (globalForMarkets.__solaxiumMarkets ??= new Map());

export function marketFor(dataset: DatasetRow): MarketFeed {
  const cached = cache.get(dataset.key);
  if (cached) return cached;

  if (dataset.source !== 'FIXTURE') {
    throw new Error(
      `[market] dataset source "${dataset.source}" is not implemented yet. ` +
        `Only FIXTURE markets can be replayed in this build.`,
    );
  }
  if (!dataset.seed) {
    throw new Error(`[market] fixture dataset ${dataset.key} has no seed to regenerate from.`);
  }

  const market = new FixtureMarket({
    seed: dataset.seed,
    steps: dataset.steps,
    stepMs: dataset.stepMs,
  });
  cache.set(dataset.key, market);
  return market;
}

/** Drops a cached market, e.g. after a dataset is deleted. */
export function forgetMarket(key: string): void {
  cache.delete(key);
}
