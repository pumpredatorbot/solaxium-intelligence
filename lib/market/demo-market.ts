/**
 * A locally generated market, stored the way a real capture is stored.
 *
 * WHY: the recorded path — stored ticks, the token flow panel, open positions
 * marked to market — can only be exercised against a dataset that stores its
 * ticks, and a real pump.fun capture needs network access to pump.fun. This
 * produces a dataset of the same shape so that path can be run and seen
 * without it.
 *
 * WHAT IT IS NOT: market data. The price paths below are hand-written
 * archetypes. The dataset's provenance records that plainly, and the console
 * labels a market by that provenance rather than by its RECORDED source, so
 * this can never be displayed as real pump.fun activity.
 */

import { prisma } from '@/lib/db';
import { aggregate, marketStats } from './pumpfun/aggregate';
import {
  normaliseRestTrade, PRICE_LOT, TOKEN_BASE_UNITS,
  type RawLaunch, type RawTrade,
} from './pumpfun/types';

const LAUNCH_SOL_RESERVES = 30_000_000_000;
const LAUNCH_TOKEN_RESERVES = 1_073_000_000 * TOKEN_BASE_UNITS;

/**
 * Deliberately overlapping archetypes.
 *
 * A market where one signal separates winners from losers teaches a population
 * nothing worth learning: the first genome to find the signal wins and the
 * search stops. Rugs therefore spike before collapsing, exactly as real ones
 * do, so early price action cannot by itself identify them.
 */
interface Archetype {
  name: string;
  path: number[];
  /**
   * The archetype's true buy pressure, 0..1 — the fact an agent is trying to
   * infer. It is never exposed: what a snapshot shows is this blurred by noise
   * that decays with the token's age, so waiting buys information but costs
   * entry price. Without a signal like this the market has traps and nothing
   * to learn from them, and a population can only die.
   */
  truth: number;
}

const SHAPES: Archetype[] = [
  {
    // Rug that pumped first — the trap. Its price tracks a runner's for several
    // steps, so price action alone cannot identify one. It is capped just above
    // ×2 and collapses fast: a rug that reliably ran to ×3 would make
    // "snipe everything and hold for the double" a winning strategy, and a demo
    // market that rewards indiscriminate sniping teaches the wrong lesson.
    name: 'RUG',
    truth: 0.3,
    path: [1, 1.32, 1.61, 1.88, 2.02, 1.74, 1.18, 0.62, 0.3, 0.2, 0.15, 0.13, 0.12, 0.11, 0.1, 0.1, 0.09, 0.09, 0.08, 0.08],
  },
  {
    // Fizzle: never really moves, bleeds out on fees.
    name: 'FIZZLE',
    truth: 0.44,
    path: [1, 1.08, 1.12, 1.1, 1.05, 1.02, 0.98, 0.95, 0.93, 0.9, 0.88, 0.86, 0.84, 0.82, 0.8, 0.79, 0.78, 0.76, 0.75, 0.74],
  },
  {
    // Runner: the case a ×1.5/×2.0 take-profit exists for.
    name: 'RUNNER',
    truth: 0.74,
    path: [1, 1.15, 1.35, 1.55, 1.8, 2.05, 2.35, 2.7, 3.0, 3.3, 3.5, 3.4, 3.2, 3.0, 2.8, 2.6, 2.4, 2.3, 2.2, 2.1],
  },
  {
    // Slow bleed: down from the first print, no spike to trap anyone.
    name: 'BLEED',
    truth: 0.34,
    path: [1, 0.98, 0.95, 0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6, 0.57, 0.54, 0.51, 0.48, 0.46, 0.44, 0.42, 0.4],
  },
  {
    // Mooner: rare, and the whole reason to hold past the first target.
    name: 'MOONER',
    truth: 0.9,
    path: [1, 1.5, 2.3, 3.4, 4.8, 6.2, 7.5, 8.4, 8.1, 7.2, 6.1, 5.2, 4.5, 3.9, 3.4, 3.0, 2.7, 2.5, 2.3, 2.2],
  },
];

const SHAPE_WEIGHTS = [0.30, 0.30, 0.16, 0.20, 0.04] as const; // rug, fizzle, runner, bleed, mooner

/** Picks an archetype from the weights, deterministically by index. */
function shapeFor(index: number): Archetype {
  // A fixed low-discrepancy sequence rather than a PRNG: the demo market must
  // be identical every time it is seeded, so two people comparing results are
  // comparing the same market.
  const position = ((index * 0.6180339887) % 1 + 1) % 1;
  let cumulative = 0;
  for (let i = 0; i < SHAPE_WEIGHTS.length; i++) {
    cumulative += SHAPE_WEIGHTS[i];
    if (position < cumulative) return SHAPES[i];
  }
  return SHAPES[SHAPES.length - 1];
}

const SYMBOLS = [
  'WIF', 'BONK', 'POPCAT', 'MOODENG', 'GIGA', 'FWOG',
  'PNUT', 'ACT', 'MICHI', 'BRETT', 'SIGMA', 'TOSHI',
];

export const DEMO_MARKET_KEY = 'synthetic-demo:recorded-path';
/** Never "pump.fun". The console labels markets by this. */
export const DEMO_MARKET_ORIGIN = 'synthetic (local demo)';

export interface DemoMarketResult {
  datasetId: string;
  key: string;
  tokenCount: number;
  tickCount: number;
  steps: number;
  stepMs: number;
  doubleRate: number;
  rugRate: number;
}

export async function seedDemoMarket(
  options: { tokens?: number; key?: string } = {},
): Promise<DemoMarketResult> {
  const count = Math.max(10, Math.min(options.tokens ?? 140, 400));
  const key = options.key ?? DEMO_MARKET_KEY;
  const startSec = Math.floor(Date.now() / 1000) - count * 4 - 600;

  const launches: RawLaunch[] = [];
  const trades: RawTrade[] = [];

  for (let i = 0; i < count; i++) {
    const archetype = shapeFor(i);
    const shape = archetype.path;
    const mint = `SYNTH${String(i).padStart(4, '0')}`.padEnd(43, 'x');
    const symbol = `${SYMBOLS[i % SYMBOLS.length]}${Math.floor(i / SYMBOLS.length) || ''}`;
    const launchedAt = startSec + i * 4;

    launches.push({
      mint, symbol, name: `${symbol} (synthetic)`,
      launchedAt: launchedAt * 1000,
      initialMcapLamports: 28_000_000_000,
      initialPriceLamports: 27_960_000,
    });

    // Per-token jitter, so tokens sharing an archetype are not identical.
    const jitter = 0.75 + ((i * 37) % 50) / 100;
    shape.forEach((step0, step) => {
      const level = step === 0 ? 1 : step0 * jitter;

      // Observable buy pressure: the archetype's truth, blurred by noise that
      // shrinks as the token ages. Early on a rug and a runner look alike;
      // waiting resolves them but costs entry price. That trade-off is the
      // thing the population is evolving to solve.
      const noise = 0.34 * Math.exp(-step / 6);
      const wobble = (((i * 97 + step * 53) % 200) / 100 - 1) * noise;
      const pressure = Math.max(0.05, Math.min(0.95, archetype.truth + wobble));

      for (let t = 0; t < 3; t++) {
        const trade = normaliseRestTrade({
          signature: `${mint}-${step}-${t}`,
          mint,
          timestamp: launchedAt + step,
          sol_amount: 40_000_000 + ((i * 13 + step * 7 + t) % 40) * 12_000_000,
          token_amount: 1e12,
          is_buy: (i * 31 + step * 17 + t * 11) % 100 < pressure * 100,
          user: `Trader${(i * 5 + t) % 40}`.padEnd(43, '1'),
          virtual_sol_reserves: Math.round(LAUNCH_SOL_RESERVES * level),
          virtual_token_reserves: LAUNCH_TOKEN_RESERVES,
        });
        if (trade) trades.push(trade);
      }
    });
  }

  const market = aggregate(launches, trades, { stepMs: 1000, minTrades: 6, maxIdleSteps: 20 });
  const stats = marketStats(market);

  // Re-seeding replaces the dataset rather than doubling its tokens.
  await prisma.marketDataset.deleteMany({ where: { key } });
  const dataset = await prisma.marketDataset.create({
    data: {
      key,
      source: 'RECORDED',
      seed: null,
      steps: market.steps,
      stepMs: market.stepMs,
      tokenCount: market.tokens.length,
      meta: {
        source: DEMO_MARKET_ORIGIN,
        capture: 'generated locally — NOT real market data',
        reason: 'exercises the recorded path where pump.fun is unreachable',
        priceUnit: `lamports per ${PRICE_LOT} tokens`,
        trades: market.tradeCount,
        doubleRate: stats.doubleRate,
        rugRate: stats.rugRate,
        recordedAt: new Date().toISOString(),
      },
    },
  });

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

  return {
    datasetId: dataset.id,
    key,
    tokenCount: market.tokens.length,
    tickCount: market.tokens.reduce((sum, t) => sum + t.ticks.length, 0),
    steps: market.steps,
    stepMs: market.stepMs,
    doubleRate: stats.doubleRate,
    rugRate: stats.rugRate,
  };
}
