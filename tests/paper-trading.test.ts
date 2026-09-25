/**
 * Paper execution and the synthetic market.
 *
 * NO REAL VALUE MOVES anywhere in this path: a position is an accounting
 * entry against recorded prices. These tests pin the cost model, because a
 * paper engine that fills for free reliably evolves agents that are only
 * profitable because the costs are missing.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_TRADING_CONFIG, decodeStrategy, FOUNDER_TRADING_TRAITS, TRADING_TRAIT_KEYS } from '@/config/trading';
import { FixtureMarket } from '@/lib/market/fixture-market';
import {
  openPosition, passesEntryFilter, resolvePosition, slippageFor, stepPosition, toSnapshot,
} from '@/lib/engine/paper-execution';
import { solToLamports } from '@/lib/sol';
import type { MarketTick } from '@/lib/market/types';

const C = DEFAULT_TRADING_CONFIG;
const CAPITAL = solToLamports(1);

function tick(price: number, over: Partial<MarketTick> = {}): MarketTick {
  return {
    mint: 'M1', ageMs: 1000, at: 1000, priceLamports: price,
    mcapLamports: solToLamports(20), buys: 40, sells: 10,
    volumeLamports: solToLamports(5), holders: 25, momentum: 1.2, ...over,
  };
}

describe('cost model', () => {
  it('charges more slippage as a position grows relative to mcap', () => {
    const small = slippageFor(solToLamports(0.05), solToLamports(20), C);
    const large = slippageFor(solToLamports(5), solToLamports(20), C);
    expect(large).toBeGreaterThan(small);
    expect(small).toBeGreaterThanOrEqual(C.BASE_SLIPPAGE);
    expect(large).toBeLessThanOrEqual(0.45);
  });

  it('never returns a free fill', () => {
    expect(slippageFor(0, solToLamports(20), C)).toBeGreaterThan(0);
  });

  it('pays above the quote on entry', () => {
    const p = openPosition({
      tick: tick(100), symbol: 'X', step: 5, capitalLamports: CAPITAL,
      strategy: decodeStrategy(FOUNDER_TRADING_TRAITS, C), config: C,
    })!;
    expect(p.entryPriceLamports).toBeGreaterThan(p.quotedEntryLamports);
    expect(p.entryFeeLamports).toBeGreaterThan(0);
  });

  it('refuses a position too small to cover its own round trip', () => {
    const p = openPosition({
      tick: tick(100), symbol: 'X', step: 1, capitalLamports: 500,
      strategy: decodeStrategy(FOUNDER_TRADING_TRAITS, C), config: C,
    });
    expect(p).toBeNull();
  });

  it('loses money on a flat round trip, because costs are real', () => {
    const p = openPosition({
      tick: tick(100), symbol: 'X', step: 0, capitalLamports: CAPITAL,
      strategy: decodeStrategy(FOUNDER_TRADING_TRAITS, C), config: C,
    })!;
    // Exit at the same quote it entered at.
    const outcome = resolvePosition(p, [tick(100, { ageMs: 2000 })], C);
    expect(outcome.pnlLamports).toBeLessThan(0);
    expect(outcome.returnPct).toBeLessThan(0);
  });
});

describe('exit rules', () => {
  const strategy = { ...decodeStrategy(FOUNDER_TRADING_TRAITS, C), takeProfitMultiple: 1.5, stopMultiple: 0.7, maxHoldSteps: 10 };
  const open = () => openPosition({ tick: tick(100), symbol: 'X', step: 0, capitalLamports: CAPITAL, strategy, config: C })!;

  it('labels a patient target TP2 and a fast one TP1', () => {
    // The target is a continuum between ×1.5 and ×2.0, so the two labels have to
    // be bands. Requiring exact equality with ×2.0 made TP2 unreachable for
    // every genome but one, and reported patient agents as fast bankers.
    const fast = { ...strategy, takeProfitMultiple: C.TP1_MULTIPLE };
    const patient = { ...strategy, takeProfitMultiple: C.TP2_MULTIPLE };
    const middling = { ...strategy, takeProfitMultiple: (C.TP1_MULTIPLE + C.TP2_MULTIPLE) / 2 - 0.01 };

    const settleAt = (s: typeof strategy) => {
      const p = openPosition({ tick: tick(100), symbol: 'X', step: 0, capitalLamports: CAPITAL, strategy: s, config: C })!;
      const spike = Math.round(p.entryPriceLamports * 4);
      return resolvePosition(p, [tick(spike)], C).exitReason;
    };

    expect(settleAt(fast)).toBe('TP1');
    expect(settleAt(patient)).toBe('TP2');
    expect(settleAt(middling)).toBe('TP1');
  });

  it('takes profit at the target, not at a gapped-through better price', () => {
    const p = open();
    const spike = Math.round(p.entryPriceLamports * 5);
    const outcome = resolvePosition(p, [tick(spike)], C);
    expect(outcome.exitReason).toBe('TP1');
    // Filled at the 1.5x target, not at the 5x print.
    expect(outcome.quotedExitLamports).toBeCloseTo(p.entryPriceLamports * 1.5, -1);
  });

  it('fills a stop where the market actually was, which may be far worse', () => {
    const p = open();
    const crash = Math.round(p.entryPriceLamports * 0.2);
    const outcome = resolvePosition(p, [tick(crash)], C);
    expect(outcome.exitReason).toBe('STOP');
    // Not rescued at the 0.7 stop level.
    expect(outcome.quotedExitLamports).toBe(crash);
    expect(outcome.returnPct).toBeLessThan(-0.7);
  });

  it('times out once maxHoldSteps is reached', () => {
    const p = open();
    const flat = Array.from({ length: 20 }, () => tick(p.entryPriceLamports));
    const outcome = resolvePosition(p, flat, C);
    expect(outcome.exitReason).toBe('TIMEOUT');
    expect(outcome.holdSteps).toBeLessThanOrEqual(strategy.maxHoldSteps + 1);
  });

  it('closes rather than discards a position whose token stops being tracked', () => {
    const outcome = resolvePosition(open(), [], C);
    expect(outcome.exitReason).toBe('TIMEOUT');
    expect(Number.isFinite(outcome.pnlLamports)).toBe(true);
  });

  it('streaming and batch resolution agree', () => {
    const p = open();
    const ticks = [tick(105), tick(120), tick(Math.round(p.entryPriceLamports * 1.6))];
    const batch = resolvePosition(p, ticks, C);

    let streamed = null;
    for (let i = 0; i < ticks.length && !streamed; i++) {
      streamed = stepPosition(p, ticks[i], p.entryStep + i + 1, C);
    }
    expect(streamed!.exitReason).toBe(batch.exitReason);
    expect(streamed!.pnlLamports).toBe(batch.pnlLamports);
  });
});

describe('entry filter', () => {
  it('only fires at the agent’s chosen age', () => {
    const strategy = { ...decodeStrategy(FOUNDER_TRADING_TRAITS, C), entryAgeSteps: 3, minBuyRatio: 0, maxMomentum: 99 };
    const snap = (ageMs: number) => toSnapshot(tick(100, { ageMs }), 'X', 1);
    expect(passesEntryFilter(snap(3000), strategy, 1000)).toBe(true);
    expect(passesEntryFilter(snap(2000), strategy, 1000)).toBe(false);
  });

  it('respects the pressure and momentum bounds', () => {
    const strategy = { ...decodeStrategy(FOUNDER_TRADING_TRAITS, C), entryAgeSteps: 1, minBuyRatio: 0.8, maxMomentum: 2 };
    const weak = toSnapshot(tick(100, { buys: 10, sells: 40 }), 'X', 1);
    const hot = toSnapshot(tick(100, { buys: 90, sells: 5, momentum: 9 }), 'X', 1);
    const good = toSnapshot(tick(100, { buys: 90, sells: 5, momentum: 1.4 }), 'X', 1);
    expect(passesEntryFilter(weak, strategy, 1000)).toBe(false);
    expect(passesEntryFilter(hot, strategy, 1000)).toBe(false);
    expect(passesEntryFilter(good, strategy, 1000)).toBe(true);
  });
});

describe('genome decoding', () => {
  it('keeps every decoded parameter inside its configured bounds', () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const genome = Object.fromEntries(TRADING_TRAIT_KEYS.map((k) => [k, v])) as Record<string, number>;
      const s = decodeStrategy(genome as never, C);
      expect(s.entryAgeSteps).toBeGreaterThanOrEqual(C.MIN_ENTRY_AGE_STEPS);
      expect(s.entryAgeSteps).toBeLessThanOrEqual(C.MAX_ENTRY_AGE_STEPS);
      expect(s.positionFraction).toBeGreaterThanOrEqual(C.MIN_POSITION_FRACTION);
      expect(s.positionFraction).toBeLessThanOrEqual(C.MAX_POSITION_FRACTION);
      expect(s.stopMultiple).toBeGreaterThanOrEqual(C.MIN_STOP_MULTIPLE);
      expect(s.stopMultiple).toBeLessThanOrEqual(C.MAX_STOP_MULTIPLE);
      expect(s.takeProfitMultiple).toBeGreaterThanOrEqual(C.TP1_MULTIPLE);
      expect(s.takeProfitMultiple).toBeLessThanOrEqual(C.TP2_MULTIPLE);
    }
  });

  it('puts the neutral genome in the middle, pre-programming nothing', () => {
    const s = decodeStrategy(FOUNDER_TRADING_TRAITS, C);
    expect(s.entryAgeSteps).toBeGreaterThan(C.MIN_ENTRY_AGE_STEPS);
    expect(s.entryAgeSteps).toBeLessThan(C.MAX_ENTRY_AGE_STEPS);
    expect(s.takeProfitMultiple).toBeCloseTo((C.TP1_MULTIPLE + C.TP2_MULTIPLE) / 2, 6);
  });

  it('maps entrySpeed so that faster means younger tokens', () => {
    const fast = decodeStrategy({ ...FOUNDER_TRADING_TRAITS, entrySpeed: 1 }, C);
    const slow = decodeStrategy({ ...FOUNDER_TRADING_TRAITS, entrySpeed: 0 }, C);
    expect(fast.entryAgeSteps).toBeLessThan(slow.entryAgeSteps);
  });
});

describe('fixture market', () => {
  it('is deterministic for a seed', () => {
    const a = new FixtureMarket({ seed: 'm', steps: 300 });
    const b = new FixtureMarket({ seed: 'm', steps: 300 });
    expect(b.summary()).toEqual(a.summary());
    expect(b.tickAt(a.launches(0)[0]?.mint ?? 'x', 3)).toEqual(a.tickAt(a.launches(0)[0]?.mint ?? 'x', 3));
  });

  it('differs for a different seed', () => {
    const a = new FixtureMarket({ seed: 'm1', steps: 300 });
    const b = new FixtureMarket({ seed: 'm2', steps: 300 });
    expect(b.summary().tokenCount === a.summary().tokenCount && b.datasetId === a.datasetId).toBe(false);
  });

  it('is a brutal market: most tokens end far below their launch price', () => {
    const m = new FixtureMarket({ seed: 'brutal', steps: 1200 });
    expect(m.summary().rugRate).toBeGreaterThan(0.5);
  });

  it('never reveals a token’s archetype through the snapshot', () => {
    const m = new FixtureMarket({ seed: 'hidden', steps: 200 });
    const mint = m.launches(0)[0]?.mint ?? m.launches(1)[0]!.mint;
    const snapshot = toSnapshot(m.tickAt(mint, 2)!, 'X', 1);
    expect(Object.values(snapshot)).not.toContain(m.archetypeOf(mint));
    expect(JSON.stringify(snapshot)).not.toMatch(/RUG|MOONER|FIZZLE|PUMP/);
  });

  it('stops serving ticks once a token is past its lifespan', () => {
    const m = new FixtureMarket({ seed: 'life', steps: 200, tokenLifespan: 10 });
    const launch = m.launches(0)[0] ?? m.launches(1)[0]!;
    expect(m.tickAt(launch.mint, 5)).not.toBeNull();
    expect(m.tickAt(launch.mint, 999)).toBeNull();
  });
});
