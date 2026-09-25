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

import { prisma } from '@/lib/db';
import { FixtureMarket } from './fixture-market';
import { RecordedMarket } from './recorded-market';
import { toNum } from '@/lib/sol';
import type { MarketFeed, MarketTick } from './types';

interface DatasetRow {
  id: string;
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

  if (dataset.source === 'RECORDED') {
    throw new Error(
      `[market] recorded dataset ${dataset.key} must be loaded with loadRecordedMarket() ` +
        `before it can be stepped: its ticks live in the database, not in a seed.`,
    );
  }
  if (dataset.source !== 'FIXTURE') {
    throw new Error(
      `[market] dataset source "${dataset.source}" is not implemented yet. ` +
        `FIXTURE and RECORDED markets can be replayed in this build.`,
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

/**
 * Loads a recorded capture into memory and caches it.
 *
 * Async, unlike the fixture path, because real ticks have to be read; the
 * engine awaits this once per process per dataset and then steps in memory.
 */
export async function loadRecordedMarket(dataset: DatasetRow): Promise<MarketFeed> {
  const cached = cache.get(dataset.key);
  if (cached) return cached;

  const tokens = await prisma.token.findMany({
    where: { datasetId: dataset.id },
    orderBy: [{ launchStep: 'asc' }, { mint: 'asc' }],
    select: {
      mint: true, symbol: true, name: true, launchStep: true, launchedAt: true,
      initialMcapLamports: true,
      ticks: {
        orderBy: { step: 'asc' },
        select: {
          mint: true, step: true, ageMs: true, priceLamports: true, mcapLamports: true,
          buys: true, sells: true, volumeLamports: true, holders: true, momentum: true,
        },
      },
    },
  });

  if (tokens.length === 0) {
    throw new Error(`[market] recorded dataset ${dataset.key} holds no tokens.`);
  }

  const market = new RecordedMarket({
    datasetId: dataset.id,
    key: dataset.key,
    steps: dataset.steps,
    stepMs: dataset.stepMs,
    tokens: tokens.map((token) => ({
      launchStep: token.launchStep,
      launch: {
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        launchedAt: token.launchedAt.getTime(),
        initialMcapLamports: toNum(token.initialMcapLamports),
      },
      ticks: token.ticks.map(
        (tick): MarketTick => ({
          mint: tick.mint,
          ageMs: tick.ageMs,
          at: tick.step * dataset.stepMs,
          priceLamports: toNum(tick.priceLamports),
          mcapLamports: toNum(tick.mcapLamports),
          buys: tick.buys,
          sells: tick.sells,
          volumeLamports: toNum(tick.volumeLamports),
          holders: tick.holders,
          momentum: tick.momentum,
        }),
      ),
    })),
  });

  cache.set(dataset.key, market);
  return market;
}

/** Resolves any dataset, loading recorded ticks when needed. */
export async function marketForAsync(dataset: DatasetRow): Promise<MarketFeed> {
  if (dataset.source === 'RECORDED') return loadRecordedMarket(dataset);
  return marketFor(dataset);
}
