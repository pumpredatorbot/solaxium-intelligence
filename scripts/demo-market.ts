/**
 * Seeds a locally generated market as a RECORDED dataset.
 *
 *   npm run demo:market
 *
 * WHY THIS EXISTS: the recorded path — stored ticks, the token flow panel,
 * marked-to-market open positions — can only be exercised against a dataset
 * that stores its ticks, and a real pump.fun capture needs network access to
 * pump.fun. This produces a dataset of the same shape so that path can be run
 * and seen without it.
 *
 * WHAT IT IS NOT: real market data. The dataset's provenance records that
 * plainly, and the console labels a market by that provenance rather than by
 * "RECORDED", so this can never be displayed as real pump.fun activity. The
 * price paths below are hand-written archetypes, not observations.
 *
 * Once pump.fun is reachable, `npm run record` produces the real thing and the
 * console shows it as "pump.fun · real mints".
 */

import { prisma } from '@/lib/db';
import { aggregate, marketStats } from '@/lib/market/pumpfun/aggregate';
import { normaliseRestTrade, PRICE_LOT, TOKEN_BASE_UNITS, type RawLaunch, type RawTrade } from '@/lib/market/pumpfun/types';

const LAUNCH_SOL_RESERVES = 30_000_000_000;
const LAUNCH_TOKEN_RESERVES = 1_073_000_000 * TOKEN_BASE_UNITS;

/**
 * Deliberately overlapping archetypes.
 *
 * A market where one signal separates winners from losers teaches a population
 * nothing worth learning: the first genome that finds the signal wins and
 * evolution stops. Rugs therefore spike before collapsing, exactly as real ones
 * do, so early price action cannot by itself identify them.
 */
const SHAPES: number[][] = [
  [1, 1.8, 3.1, 2.4, 0.6, 0.2, 0.12, 0.1, 0.09, 0.08], // rug that pumped first
  [1, 1.1, 1.05, 0.95, 0.9, 0.85, 0.8, 0.78, 0.75, 0.72], // fizzle
  [1, 1.3, 1.7, 2.2, 2.8, 3.4, 3.0, 2.6, 2.2, 2.0], // runner
  [1, 0.95, 0.9, 0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4], // slow bleed
  [1, 2.4, 5.2, 8.1, 6.4, 4.2, 3.1, 2.4, 2.0, 1.8], // mooner
];

const SYMBOLS = [
  'WIF', 'BONK', 'POPCAT', 'MOODENG', 'GIGA', 'FWOG',
  'PNUT', 'ACT', 'MICHI', 'BRETT', 'SIGMA', 'TOSHI',
];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const count = Number(arg('tokens', '140'));
  const key = arg('key', 'synthetic-demo:recorded-path');
  const startSec = Math.floor(Date.now() / 1000) - count * 4 - 600;

  const launches: RawLaunch[] = [];
  const trades: RawTrade[] = [];

  for (let i = 0; i < count; i++) {
    const shape = SHAPES[i % SHAPES.length];
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
    shape.forEach((multiple, step) => {
      const level = step === 0 ? 1 : multiple * jitter;
      for (let t = 0; t < 3; t++) {
        const trade = normaliseRestTrade({
          signature: `${mint}-${step}-${t}`,
          mint,
          timestamp: launchedAt + step,
          sol_amount: 40_000_000 + ((i * 13 + step * 7 + t) % 40) * 12_000_000,
          token_amount: 1e12,
          // Buy pressure follows the price, as it does in a real launch.
          is_buy: (i * 31 + step * 17 + t * 11) % 100 < (level > 1 ? 68 : 38),
          user: `Trader${(i * 5 + t) % 40}`.padEnd(43, '1'),
          virtual_sol_reserves: Math.round(LAUNCH_SOL_RESERVES * level),
          virtual_token_reserves: LAUNCH_TOKEN_RESERVES,
        });
        if (trade) trades.push(trade);
      }
    });
  }

  const market = aggregate(launches, trades, { stepMs: 1000, minTrades: 6, maxIdleSteps: 8 });
  const stats = marketStats(market);

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
        // The console labels a market by this. It must never read "pump.fun".
        source: 'synthetic (local demo)',
        capture: 'generated locally by scripts/demo-market.ts — NOT real market data',
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

  console.log(`
dataset    ${key}
id         ${dataset.id}
tokens     ${market.tokens.length}
ticks      ${market.tokens.reduce((s, t) => s + t.ticks.length, 0)}
steps      ${market.steps} @ ${market.stepMs}ms
doubled    ${(stats.doubleRate * 100).toFixed(1)}%
rugged     ${(stats.rugRate * 100).toFixed(1)}%

This is NOT real pump.fun data. Run "npm run record" for that.
Trade it:  npm run trade -- --dataset ${dataset.id}
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
