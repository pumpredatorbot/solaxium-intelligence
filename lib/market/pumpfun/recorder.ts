/**
 * Capturing a real pump.fun market into a replayable dataset.
 *
 * The recorder is the boundary between the live world and the engine: after it
 * runs, everything downstream is deterministic replay over stored rows. That
 * split is deliberate — it means a result can be re-examined, and that a slow
 * or rate-limited network never affects how the population evolves.
 *
 * NO REAL VALUE MOVES. The recorder reads public market data and writes rows.
 * It holds no key and cannot transact.
 */

import { prisma } from '@/lib/db';
import { aggregate, marketStats, type AggregateOptions } from './aggregate';
import { PumpFunClient, streamPumpFun } from './client';
import { PRICE_LOT, type RawLaunch, type RawTrade } from './types';

export interface BackfillOptions extends AggregateOptions {
  /** How many recent coins to walk. */
  coins?: number;
  /** Cap on trades fetched per coin. */
  maxTradesPerCoin?: number;
  /** Dataset key; defaults to a timestamped one. */
  key?: string;
  onProgress?: (note: string) => void;
}

export interface RecordResult {
  datasetId: string;
  key: string;
  tokenCount: number;
  tickCount: number;
  tradeCount: number;
  steps: number;
  stepMs: number;
  dropped: number;
  doubleRate: number;
  rugRate: number;
  medianPeakMultiple: number;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Records recent pump.fun history into a dataset.
 *
 * Backfill rather than live capture is the default for a reason: a token's
 * lifecycle is what agents have to learn, and history already contains complete
 * lifecycles — launch, run, rug — where a live capture has to wait hours for
 * even one. History also carries real exchange timestamps, which a live stream
 * does not.
 */
export async function backfillPumpFun(options: BackfillOptions = {}): Promise<RecordResult> {
  const progress = options.onProgress ?? (() => {});
  const client = new PumpFunClient({ onNote: progress });
  const coinCount = options.coins ?? 60;

  progress('checking pump.fun is reachable...');
  const health = await client.healthCheck();
  progress(`reachable via ${health.host}`);

  const launches: RawLaunch[] = [];
  let offset = 0;
  while (launches.length < coinCount) {
    const page = await client.recentCoins(Math.min(50, coinCount - launches.length), offset);
    if (page.length === 0) break;
    launches.push(...page);
    offset += page.length;
  }
  progress(`found ${launches.length} recent coins`);

  const trades: RawTrade[] = [];
  let index = 0;
  for (const launch of launches) {
    index++;
    const mintTrades = await client.tradesFor(launch.mint, options.maxTradesPerCoin ?? 2000);
    trades.push(...mintTrades);
    progress(`[${index}/${launches.length}] ${launch.symbol}: ${mintTrades.length} trades`);
  }

  progress(`aggregating ${trades.length} real trades...`);
  const market = aggregate(launches, trades, options);
  if (market.tokens.length === 0) {
    throw new Error(
      `Captured ${trades.length} trades but no token had enough history to replay. ` +
        `Lower minTrades, or capture more coins.`,
    );
  }

  const key =
    options.key ?? `pumpfun:${new Date(market.windowStartMs).toISOString().slice(0, 19)}`;
  return persist(market, key, {
    capture: 'backfill',
    timestampSource: 'pump.fun trade timestamps',
    coinsWalked: launches.length,
  }, progress);
}

export interface LiveCaptureOptions extends AggregateOptions {
  /** How long to listen, in seconds. */
  durationSec?: number;
  key?: string;
  onProgress?: (note: string) => void;
}

/**
 * Listens to the live stream for a while, then stores what it heard.
 *
 * Timestamps are arrival times — the stream carries none — and the dataset says
 * so in its provenance, because a strategy tuned on arrival latency would be
 * learning our network, not the market.
 */
export async function captureLivePumpFun(options: LiveCaptureOptions = {}): Promise<RecordResult> {
  const progress = options.onProgress ?? (() => {});
  const durationSec = options.durationSec ?? 600;
  const launches: RawLaunch[] = [];
  const trades: RawTrade[] = [];

  const controller = new AbortController();
  const stop = setTimeout(() => controller.abort(), durationSec * 1000);
  progress(`listening for ${durationSec}s...`);

  const reporter = setInterval(
    () => progress(`  ${launches.length} launches, ${trades.length} trades so far`),
    15_000,
  );

  try {
    await streamPumpFun(
      {
        onLaunch: (launch) => launches.push(launch),
        onTrade: (trade) => trades.push(trade),
        onNote: progress,
      },
      controller.signal,
    );
  } finally {
    clearTimeout(stop);
    clearInterval(reporter);
  }

  progress(`captured ${launches.length} launches and ${trades.length} trades`);
  const market = aggregate(launches, trades, options);
  if (market.tokens.length === 0) {
    throw new Error(
      `Captured ${trades.length} trades but no token had enough history to replay. ` +
        `Listen for longer, or lower minTrades.`,
    );
  }

  const key = options.key ?? `pumpfun-live:${new Date(market.windowStartMs).toISOString().slice(0, 19)}`;
  return persist(market, key, {
    capture: 'live',
    timestampSource: 'recorder arrival time (the stream carries no timestamps)',
  }, progress);
}

/** Writes an aggregated market as a RECORDED dataset. */
async function persist(
  market: ReturnType<typeof aggregate>,
  key: string,
  provenance: Record<string, unknown>,
  progress: (note: string) => void,
): Promise<RecordResult> {
  const stats = marketStats(market);
  const tickCount = market.tokens.reduce((sum, t) => sum + t.ticks.length, 0);

  const dataset = await prisma.marketDataset.upsert({
    where: { key },
    create: {
      key,
      source: 'RECORDED',
      seed: null,
      steps: market.steps,
      stepMs: market.stepMs,
      tokenCount: market.tokens.length,
      meta: {
        ...provenance,
        source: 'pump.fun',
        priceUnit: `lamports per ${PRICE_LOT} tokens`,
        windowStart: new Date(market.windowStartMs).toISOString(),
        windowEnd: new Date(market.windowEndMs).toISOString(),
        trades: market.tradeCount,
        ticks: tickCount,
        dropped: market.dropped.length,
        doubleRate: stats.doubleRate,
        rugRate: stats.rugRate,
        medianPeakMultiple: stats.medianPeakMultiple,
        recordedAt: new Date().toISOString(),
      },
    },
    update: {},
  });

  // A re-record of the same key replaces its tokens rather than doubling them.
  await prisma.token.deleteMany({ where: { datasetId: dataset.id } });

  progress(`writing ${market.tokens.length} tokens and ${tickCount} ticks...`);
  for (const token of market.tokens) {
    const row = await prisma.token.create({
      data: {
        datasetId: dataset.id,
        mint: token.launch.mint,
        symbol: token.launch.symbol,
        name: token.launch.name,
        launchStep: token.launchStep,
        launchedAt: new Date(token.launch.launchedAt),
        initialMcapLamports: BigInt(token.launch.initialMcapLamports),
        tradeCount: token.tradeCount,
        tickCount: token.ticks.length,
      },
      select: { id: true },
    });

    await prisma.tick.createMany({
      data: token.ticks.map((tick, offset) => ({
        tokenId: row.id,
        datasetId: dataset.id,
        mint: token.launch.mint,
        step: token.launchStep + offset,
        ageMs: tick.ageMs,
        priceLamports: BigInt(tick.priceLamports),
        mcapLamports: BigInt(tick.mcapLamports),
        buys: tick.buys,
        sells: tick.sells,
        volumeLamports: BigInt(tick.volumeLamports),
        holders: tick.holders,
        momentum: tick.momentum,
      })),
    });
  }

  await prisma.marketDataset.update({
    where: { id: dataset.id },
    data: { steps: market.steps, tokenCount: market.tokens.length },
  });

  return {
    datasetId: dataset.id,
    key,
    tokenCount: market.tokens.length,
    tickCount,
    tradeCount: market.tradeCount,
    steps: market.steps,
    stepMs: market.stepMs,
    dropped: market.dropped.length,
    doubleRate: stats.doubleRate,
    rugRate: stats.rugRate,
    medianPeakMultiple: stats.medianPeakMultiple,
    windowStart: new Date(market.windowStartMs),
    windowEnd: new Date(market.windowEndMs),
  };
}
