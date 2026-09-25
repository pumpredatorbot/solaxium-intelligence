/**
 * The pump.fun ingestion path.
 *
 * Network access to pump.fun is blocked from this environment, so these tests
 * exercise the path with payloads shaped exactly like pump.fun's — real reserve
 * magnitudes, real field spellings, both the snake_case REST form and the
 * camelCase websocket form. What that can prove: the arithmetic, the
 * aggregation, the persistence, and that the engine trades a RECORDED dataset
 * end-to-end. What it cannot prove: that pump.fun's live response still has the
 * fields this expects. That needs one real call.
 *
 * The anchor is the bonding curve. Every pump.fun token launches with 30 virtual
 * SOL against ~1.073e9 virtual tokens, which is a ~28 SOL market cap. If the
 * price arithmetic is wrong, that number comes out wrong, and it is checked
 * below against the published curve rather than against my own output.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import {
  PRICE_LOT,
  PUMPFUN_TOTAL_SUPPLY,
  TOKEN_BASE_UNITS,
  mcapFromPrice,
  normaliseRestTrade,
  normaliseStreamLaunch,
  normaliseStreamTrade,
  priceFromReserves,
  toMillis,
} from '@/lib/market/pumpfun/types';
import { aggregate, marketStats } from '@/lib/market/pumpfun/aggregate';
import { RecordedMarket } from '@/lib/market/recorded-market';
import { loadRecordedMarket } from '@/lib/market/registry';
import { createTradingRun, runTradingStep } from '@/lib/engine/trading-engine';
import { recomputeCapital } from '@/lib/engine/ledger';
import { lamportsToSol, toNum } from '@/lib/sol';
import { resetDatabase } from './helpers';

// pump.fun's launch curve, from the on-chain constants.
const LAUNCH_SOL_RESERVES = 30_000_000_000; // 30 SOL in lamports
const LAUNCH_TOKEN_RESERVES = 1_073_000_000 * TOKEN_BASE_UNITS;

/** A REST trade payload, shaped as frontend-api returns them. */
function restTrade(over: Record<string, unknown> = {}) {
  return {
    signature: '5xRest' + Math.random().toString(36).slice(2, 10),
    mint: 'A1b2C3d4E5f6G7h8J9k1L2m3N4p5Q6r7S8t9U1v2W3x4',
    sol_amount: 250_000_000,
    token_amount: 8_900_000_000_000,
    is_buy: true,
    user: 'Trader1111111111111111111111111111111111111',
    timestamp: 1_758_800_000, // seconds, as pump.fun sends them
    virtual_sol_reserves: LAUNCH_SOL_RESERVES,
    virtual_token_reserves: LAUNCH_TOKEN_RESERVES,
    slot: 301_000_000,
    ...over,
  };
}

/** A pumpportal websocket payload, which quotes whole SOL and whole tokens. */
function streamTrade(over: Record<string, unknown> = {}) {
  return {
    signature: '5xWs' + Math.random().toString(36).slice(2, 10),
    mint: 'A1b2C3d4E5f6G7h8J9k1L2m3N4p5Q6r7S8t9U1v2W3x4',
    txType: 'buy',
    traderPublicKey: 'Trader2222222222222222222222222222222222222',
    solAmount: 0.25,
    tokenAmount: 8_900_000,
    vSolInBondingCurve: 30,
    vTokensInBondingCurve: 1_073_000_000,
    marketCapSol: 27.96,
    pool: 'pump',
    ...over,
  };
}

describe('the bonding curve arithmetic', () => {
  it('prices a launch at pump.fun’s published ~28 SOL market cap', () => {
    const price = priceFromReserves(LAUNCH_SOL_RESERVES, LAUNCH_TOKEN_RESERVES)!;
    const mcapSol = lamportsToSol(mcapFromPrice(price, PUMPFUN_TOTAL_SUPPLY));
    // The real figure is ~27.96 SOL. A wrong exponent anywhere misses by orders
    // of magnitude, so this is a genuine check on the unit conversion.
    expect(mcapSol).toBeGreaterThan(26);
    expect(mcapSol).toBeLessThan(30);
  });

  it('keeps precision intact through a 1000x collapse', () => {
    const launch = priceFromReserves(LAUNCH_SOL_RESERVES, LAUNCH_TOKEN_RESERVES)!;
    // A rug: almost all tokens sold back, reserves collapse.
    const rugged = priceFromReserves(LAUNCH_SOL_RESERVES / 1000, LAUNCH_TOKEN_RESERVES)!;
    expect(rugged).toBeGreaterThan(1000); // still thousands of lamports of resolution
    expect(launch / rugged).toBeCloseTo(1000, 0);
  });

  it('quotes per 1e6 tokens, because a single token rounds away', () => {
    const price = priceFromReserves(LAUNCH_SOL_RESERVES, LAUNCH_TOKEN_RESERVES)!;
    expect(PRICE_LOT).toBe(1_000_000);
    // Per single token this would be ~28 lamports; per lot it is ~2.8e7.
    expect(price).toBeGreaterThan(1e7);
  });

  it('rejects impossible reserves instead of inventing a price', () => {
    expect(priceFromReserves(0, LAUNCH_TOKEN_RESERVES)).toBeNull();
    expect(priceFromReserves(LAUNCH_SOL_RESERVES, 0)).toBeNull();
    expect(priceFromReserves(null, null)).toBeNull();
    expect(priceFromReserves(-5, LAUNCH_TOKEN_RESERVES)).toBeNull();
  });

  it('reads pump.fun timestamps in seconds and in milliseconds', () => {
    expect(toMillis(1_758_800_000)).toBe(1_758_800_000_000);
    expect(toMillis(1_758_800_000_000)).toBe(1_758_800_000_000);
    expect(toMillis(0)).toBeNull();
    expect(toMillis(null)).toBeNull();
  });
});

describe('payload parsing', () => {
  it('reads a REST trade', () => {
    const trade = normaliseRestTrade(restTrade())!;
    expect(trade.mint).toMatch(/^A1b2/);
    expect(trade.isBuy).toBe(true);
    expect(trade.at).toBe(1_758_800_000_000);
    expect(trade.solLamports).toBe(250_000_000);
    expect(trade.trader).toMatch(/^Trader1/);
    expect(trade.priceLamports).toBeGreaterThan(0);
  });

  it('reads a websocket trade, which quotes whole SOL rather than lamports', () => {
    const ws = normaliseStreamTrade(streamTrade(), 1_758_800_000_000)!;
    const rest = normaliseRestTrade(restTrade())!;
    // Same curve state expressed in two unit systems must give the same price.
    expect(ws.priceLamports / rest.priceLamports).toBeCloseTo(1, 3);
    expect(ws.at).toBe(1_758_800_000_000);
  });

  it('accepts numbers sent as strings, which pump.fun does intermittently', () => {
    const trade = normaliseRestTrade(
      restTrade({ sol_amount: '250000000', virtual_sol_reserves: '30000000000' }),
    )!;
    expect(trade.solLamports).toBe(250_000_000);
    expect(trade.priceLamports).toBeGreaterThan(0);
  });

  it('ignores unknown fields rather than failing the capture', () => {
    const trade = normaliseRestTrade(restTrade({ some_new_field: { nested: true } }));
    expect(trade).not.toBeNull();
  });

  it('skips a trade it cannot price or time, instead of guessing', () => {
    expect(normaliseRestTrade(restTrade({ virtual_sol_reserves: null }))).toBeNull();
    expect(normaliseRestTrade(restTrade({ timestamp: null }))).toBeNull();
    expect(normaliseRestTrade(restTrade({ is_buy: undefined }))).toBeNull();
    expect(normaliseRestTrade({ not: 'a trade' })).toBeNull();
  });

  it('reads a launch, and treats its initial buy as a buy', () => {
    const launch = normaliseStreamLaunch(
      streamTrade({ txType: 'create', name: 'Solaxium Test', symbol: 'sxtest', initialBuy: 1.5 }),
      1_758_800_000_000,
    )!;
    expect(launch.symbol).toBe('SXTEST');
    expect(launch.name).toBe('Solaxium Test');
    expect(launch.initialPriceLamports).toBeGreaterThan(0);

    const asTrade = normaliseStreamTrade(streamTrade({ txType: 'create', initialBuy: 1.5 }), 1)!;
    expect(asTrade.isBuy).toBe(true);
  });

  it('does not mistake a trade for a launch', () => {
    expect(normaliseStreamLaunch(streamTrade({ txType: 'buy' }), 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Builds a token's trade history along a price path.
 *
 * Reserves move along the curve, so each price is expressed the way pump.fun
 * would express it — as reserves — rather than as a price we assert directly.
 */
function history(
  mint: string,
  startAtSec: number,
  multiples: number[],
  opts: { stepSec?: number; buyRatio?: number } = {},
): ReturnType<typeof normaliseRestTrade>[] {
  const stepSec = opts.stepSec ?? 1;
  const buyRatio = opts.buyRatio ?? 0.7;
  return multiples.map((multiple, i) =>
    normaliseRestTrade(
      restTrade({
        mint,
        signature: `${mint}-${i}`,
        timestamp: startAtSec + i * stepSec,
        is_buy: (i * 7919) % 100 < buyRatio * 100,
        user: `Trader${(i % 9) + 1}`.padEnd(43, '1'),
        // Price scales with sol reserves along the curve.
        virtual_sol_reserves: Math.round(LAUNCH_SOL_RESERVES * multiple),
        virtual_token_reserves: LAUNCH_TOKEN_RESERVES,
      }),
    ),
  );
}

describe('aggregating real trades into a replayable market', () => {
  const T0 = 1_758_800_000;

  it('puts a token on the step grid at its launch and follows its price', () => {
    const trades = history('MINT_A'.padEnd(43, 'a'), T0, [1, 1.4, 2.2, 1.8, 0.6]).map((t) => t!);
    const market = aggregate([], trades, { stepMs: 1000, minTrades: 3, maxIdleSteps: 2 });

    expect(market.tokens).toHaveLength(1);
    const token = market.tokens[0];
    expect(token.launchStep).toBe(0);
    expect(token.ticks[0].momentum).toBeCloseTo(1, 5);
    expect(token.ticks[2].momentum).toBeCloseTo(2.2, 1);
    expect(token.ticks[4].momentum).toBeCloseTo(0.6, 1);
  });

  it('uses the closing print of a step, not an average', () => {
    const mint = 'MINT_B'.padEnd(43, 'b');
    // Three trades inside the same second, ending high.
    const trades = [
      normaliseRestTrade(restTrade({ mint, signature: 's1', timestamp: T0, virtual_sol_reserves: LAUNCH_SOL_RESERVES }))!,
      normaliseRestTrade(restTrade({ mint, signature: 's2', timestamp: T0, virtual_sol_reserves: LAUNCH_SOL_RESERVES * 2 }))!,
      normaliseRestTrade(restTrade({ mint, signature: 's3', timestamp: T0, virtual_sol_reserves: LAUNCH_SOL_RESERVES * 3 }))!,
      normaliseRestTrade(restTrade({ mint, signature: 's4', timestamp: T0 + 5, virtual_sol_reserves: LAUNCH_SOL_RESERVES * 3 }))!,
    ];
    const market = aggregate([], trades, { stepMs: 1000, minTrades: 3, maxIdleSteps: 1 });
    const token = market.tokens[0];
    // The launch price is the first print; the step closed at 3x that.
    expect(token.ticks[0].momentum).toBeCloseTo(3, 1);
    expect(token.ticks[0].buys + token.ticks[0].sells).toBe(3);
  });

  it('accumulates buys, sells, volume and distinct traders since launch', () => {
    const mint = 'MINT_C'.padEnd(43, 'c');
    const trades = history(mint, T0, [1, 1.1, 1.2, 1.3, 1.4, 1.5]).map((t) => t!);
    const market = aggregate([], trades, { stepMs: 1000, minTrades: 3, maxIdleSteps: 0 });
    const ticks = market.tokens[0].ticks;

    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].buys + ticks[i].sells).toBeGreaterThanOrEqual(ticks[i - 1].buys + ticks[i - 1].sells);
      expect(ticks[i].volumeLamports).toBeGreaterThanOrEqual(ticks[i - 1].volumeLamports);
      expect(ticks[i].holders).toBeGreaterThanOrEqual(ticks[i - 1].holders);
    }
    expect(ticks.at(-1)!.buys + ticks.at(-1)!.sells).toBe(6);
  });

  it('carries the last price through silence instead of dropping the token', () => {
    const mint = 'MINT_D'.padEnd(43, 'd');
    // Four trades, then nothing: a token that went quiet at 0.2x.
    const trades = history(mint, T0, [1, 0.5, 0.3, 0.2]).map((t) => t!);
    const market = aggregate([], trades, { stepMs: 1000, minTrades: 3, maxIdleSteps: 10 });
    const ticks = market.tokens[0].ticks;

    // Tracked for the idle window too, holding its last print.
    expect(ticks.length).toBe(14);
    expect(ticks.at(-1)!.momentum).toBeCloseTo(0.2, 1);
    // And no phantom activity during the silence.
    expect(ticks.at(-1)!.buys + ticks.at(-1)!.sells).toBe(4);
  });

  it('drops tokens with too little history to replay, and says so', () => {
    const thin = history('MINT_E'.padEnd(43, 'e'), T0, [1, 1.1]).map((t) => t!);
    const thick = history('MINT_F'.padEnd(43, 'f'), T0, [1, 1.2, 1.5, 2, 1.1]).map((t) => t!);
    const market = aggregate([], [...thin, ...thick], { stepMs: 1000, minTrades: 4 });

    expect(market.tokens).toHaveLength(1);
    expect(market.tokens[0].launch.mint).toMatch(/^MINT_F/);
    expect(market.dropped).toHaveLength(1);
    expect(market.dropped[0].reason).toMatch(/only 2 trades/);
  });

  it('is a pure function: the same capture aggregates identically', () => {
    const a = history('MINT_G'.padEnd(43, 'g'), T0, [1, 2, 3, 1.5, 0.4]).map((t) => t!);
    const b = history('MINT_H'.padEnd(43, 'h'), T0 + 3, [1, 0.8, 0.5, 0.3, 0.2]).map((t) => t!);

    const forward = aggregate([], [...a, ...b], { stepMs: 1000, minTrades: 3 });
    // Same trades, shuffled arrival order — a capture is a set, not a sequence.
    const shuffled = aggregate([], [...b.slice(2), ...a, ...b.slice(0, 2)], { stepMs: 1000, minTrades: 3 });

    expect(shuffled.tokens.map((t) => t.launch.mint)).toEqual(forward.tokens.map((t) => t.launch.mint));
    expect(shuffled.tokens[0].ticks).toEqual(forward.tokens[0].ticks);
    expect(shuffled.steps).toBe(forward.steps);
  });

  it('reports what the capture actually contained', () => {
    const mooner = history('MINT_I'.padEnd(43, 'i'), T0, [1, 2, 4, 8, 6]).map((t) => t!);
    const rug = history('MINT_J'.padEnd(43, 'j'), T0, [1, 1.5, 0.2, 0.1, 0.05]).map((t) => t!);
    const stats = marketStats(aggregate([], [...mooner, ...rug], { stepMs: 1000, minTrades: 3 }));

    expect(stats.doubleRate).toBeCloseTo(0.5, 2);
    expect(stats.rugRate).toBeCloseTo(0.5, 2);
    expect(stats.medianPeakMultiple).toBeGreaterThan(1.4);
  });

  it('returns an empty market rather than throwing when a capture found nothing', () => {
    const market = aggregate([], [], { windowStartMs: 1000 });
    expect(market.tokens).toEqual([]);
    expect(market.steps).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// End to end: the engine trading a recorded market
// ---------------------------------------------------------------------------

/** A capture of `count` tokens with overlapping, realistic shapes. */
function capture(count: number, T0 = 1_758_800_000) {
  const shapes: number[][] = [
    // rug: spikes, then collapses — the trap that punishes a slow exit
    [1, 1.8, 3.1, 2.4, 0.6, 0.2, 0.12, 0.1],
    // fizzle: never really moves
    [1, 1.1, 1.05, 0.95, 0.9, 0.85, 0.8, 0.78],
    // runner: the case a 1.5x/2x take-profit is built for
    [1, 1.3, 1.7, 2.2, 2.8, 3.4, 3.0, 2.6],
    // slow bleed
    [1, 0.95, 0.9, 0.8, 0.7, 0.6, 0.55, 0.5],
  ];
  const trades: NonNullable<ReturnType<typeof normaliseRestTrade>>[] = [];
  for (let i = 0; i < count; i++) {
    const shape = shapes[i % shapes.length];
    const mint = `MINTCAP${String(i).padStart(3, '0')}`.padEnd(43, 'z');
    // Launches staggered across the window, as real launches are.
    trades.push(...history(mint, T0 + i * 3, shape, { buyRatio: 0.4 + (i % 5) * 0.12 }).map((t) => t!));
  }
  return trades;
}

describe('the engine trades a recorded pump.fun market', () => {
  beforeEach(async () => {
    await resetDatabase();
    await prisma.marketDataset.deleteMany({});
  });

  /** Persists a capture the way the recorder does, without touching the network. */
  async function persistCapture(key: string, tokenCount = 40) {
    const market = aggregate([], capture(tokenCount), {
      stepMs: 1000, minTrades: 4, maxIdleSteps: 6,
    });
    expect(market.tokens.length).toBeGreaterThan(20);

    const dataset = await prisma.marketDataset.create({
      data: {
        key, source: 'RECORDED', seed: null,
        steps: market.steps, stepMs: market.stepMs, tokenCount: market.tokens.length,
        meta: { capture: 'test', priceUnit: `lamports per ${PRICE_LOT} tokens` },
      },
    });

    for (const token of market.tokens) {
      const row = await prisma.token.create({
        data: {
          datasetId: dataset.id, mint: token.launch.mint, symbol: token.launch.symbol,
          name: token.launch.name, launchStep: token.launchStep,
          launchedAt: new Date(token.launch.launchedAt),
          initialMcapLamports: BigInt(token.launch.initialMcapLamports),
          tradeCount: token.tradeCount, tickCount: token.ticks.length,
        },
        select: { id: true },
      });
      await prisma.tick.createMany({
        data: token.ticks.map((tick, offset) => ({
          tokenId: row.id, datasetId: dataset.id, mint: token.launch.mint,
          step: token.launchStep + offset, ageMs: tick.ageMs,
          priceLamports: BigInt(tick.priceLamports), mcapLamports: BigInt(tick.mcapLamports),
          buys: tick.buys, sells: tick.sells, volumeLamports: BigInt(tick.volumeLamports),
          holders: tick.holders, momentum: tick.momentum,
        })),
      });
    }
    return { dataset, market };
  }

  it('loads a capture back out of the database unchanged', async () => {
    const { dataset, market } = await persistCapture('test:roundtrip');
    const loaded = await loadRecordedMarket({
      id: dataset.id, key: `${dataset.key}:reload`, source: 'RECORDED',
      seed: null, steps: dataset.steps, stepMs: dataset.stepMs,
    });

    expect(loaded.source).toBe('RECORDED');
    const token = market.tokens[0];
    const tick = loaded.tickAt(token.launch.mint, token.launchStep + 2);
    expect(tick).not.toBeNull();
    expect(tick!.priceLamports).toBe(token.ticks[2].priceLamports);
    expect(tick!.buys).toBe(token.ticks[2].buys);
    expect(tick!.momentum).toBeCloseTo(token.ticks[2].momentum, 6);
    // Past its tracked life, the token stops quoting.
    expect(loaded.tickAt(token.launch.mint, token.launchStep + 9999)).toBeNull();
  });

  it('opens and closes real positions on real tokens, and the ledger holds', async () => {
    const { dataset } = await persistCapture('test:trade');

    const run = await createTradingRun({
      name: 'recorded run', seed: 'rec-1', founderCount: 20, datasetId: dataset.id,
    });
    await prisma.simulation.update({
      where: { id: run.simulationId }, data: { status: 'RUNNING' },
    });

    let closedTotal = 0;
    for (let i = 0; i < Math.min(dataset.steps, 80); i++) {
      const report = await runTradingStep(run.simulationId);
      closedTotal += report.closed;
      if (report.status !== 'RUNNING') break;
    }

    // The point of the test: positions were actually taken on the real mints
    // and actually settled with a P&L.
    const positions = await prisma.position.findMany({
      where: { simulationId: run.simulationId },
      include: { agent: { select: { code: true } } },
    });
    expect(positions.length).toBeGreaterThan(10);
    expect(closedTotal).toBeGreaterThan(5);

    const closed = positions.filter((p) => p.status === 'CLOSED');
    expect(closed.length).toBeGreaterThan(5);
    for (const position of closed) {
      expect(position.mint).toMatch(/^MINTCAP/);
      expect(position.pnlLamports).not.toBeNull();
      expect(position.exitReason).toMatch(/^(TP1|TP2|STOP|TIMEOUT)$/);
      expect(position.holdSteps).toBeGreaterThanOrEqual(0);
    }
    // Both directions must be represented, or the capture is not a market.
    expect(closed.some((p) => toNum(p.pnlLamports!) > 0)).toBe(true);
    expect(closed.some((p) => toNum(p.pnlLamports!) < 0)).toBe(true);

    // And the invariant that carries the whole project.
    const agents = await prisma.agent.findMany({ where: { simulationId: run.simulationId } });
    for (const agent of agents) {
      expect(toNum(agent.capitalLamports)).toBe(await recomputeCapital(prisma, agent.id));
    }
  }, 180_000);

  it('replays a recorded market deterministically', async () => {
    const { dataset } = await persistCapture('test:determinism');

    const fingerprint = async (seed: string) => {
      const run = await createTradingRun({
        name: seed, seed, founderCount: 14, datasetId: dataset.id,
      });
      await prisma.simulation.update({
        where: { id: run.simulationId }, data: { status: 'RUNNING' },
      });
      for (let i = 0; i < 40; i++) {
        if ((await runTradingStep(run.simulationId)).status !== 'RUNNING') break;
      }
      const positions = await prisma.position.findMany({
        where: { simulationId: run.simulationId },
        orderBy: [{ entryStep: 'asc' }, { mint: 'asc' }, { agent: { code: 'asc' } }],
        select: {
          mint: true, entryStep: true, exitStep: true, exitReason: true,
          pnlLamports: true, agent: { select: { code: true } },
        },
      });
      return positions.map((p) => ({
        ...p, pnlLamports: p.pnlLamports === null ? null : toNum(p.pnlLamports),
      }));
    };

    const left = await fingerprint('same-seed');
    const right = await fingerprint('same-seed');
    expect(left.length).toBeGreaterThan(10);
    expect(right).toEqual(left);
  }, 180_000);

  it('refuses to trade an empty dataset rather than producing a silent no-op', async () => {
    const empty = await prisma.marketDataset.create({
      data: { key: 'test:empty', source: 'RECORDED', steps: 100, stepMs: 1000, tokenCount: 0 },
    });
    await expect(createTradingRun({ seed: 'e', datasetId: empty.id })).rejects.toThrow(/no tokens/);
  });
});

describe('the recorded market feed', () => {
  it('presents launches in a fixed order, whatever order they were loaded in', () => {
    const tick = (mint: string): import('@/lib/market/types').MarketTick => ({
      mint, ageMs: 0, at: 0, priceLamports: 1000, mcapLamports: 1e10,
      buys: 5, sells: 1, volumeLamports: 1e9, holders: 4, momentum: 1,
    });
    const token = (mint: string) => ({
      launchStep: 3,
      launch: { mint, symbol: mint, name: mint, launchedAt: 0, initialMcapLamports: 1e10 },
      ticks: [tick(mint)],
    });

    const forward = new RecordedMarket({
      datasetId: 'd', key: 'k', steps: 10, stepMs: 1000,
      tokens: [token('AAA'), token('BBB'), token('CCC')],
    });
    const backward = new RecordedMarket({
      datasetId: 'd', key: 'k2', steps: 10, stepMs: 1000,
      tokens: [token('CCC'), token('AAA'), token('BBB')],
    });

    expect(forward.launches(3).map((l) => l.mint)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(backward.launches(3).map((l) => l.mint)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(forward.launches(4)).toEqual([]);
  });
});
