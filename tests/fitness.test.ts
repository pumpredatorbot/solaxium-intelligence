/**
 * Fitness.
 *
 * The property that matters most is the shrinkage: a lucky short record must
 * not outrank a long good one. Without it, selection amplifies noise and the
 * population evolves towards variance instead of skill.
 */

import { describe, expect, it } from 'vitest';
import { computeFitness, populationMeanRaw, FITNESS_WEIGHTS, type TradeRecord } from '@/lib/engine/fitness';
import { solToLamports } from '@/lib/sol';

const START = solToLamports(1);

function trade(returnPct: number, exitReason: TradeRecord['exitReason'] = 'TP1'): TradeRecord {
  return { returnPct, pnlLamports: Math.round(START * 0.1 * returnPct), exitReason, holdSteps: 5 };
}

describe('fitness weights', () => {
  it('sum to one so raw stays in 0..1', () => {
    const total = Object.values(FITNESS_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 9);
  });
});

describe('sample-size shrinkage', () => {
  it('does not let three lucky trades outrank two hundred good ones', () => {
    // Same lifetime, so the comparison isolates record length from longevity.
    const lucky = computeFitness({
      trades: [trade(3.0), trade(3.0), trade(3.0)],
      alive: true,
      stepsLived: 400,
      startingCapitalLamports: START,
    });
    const proven = computeFitness({
      trades: Array.from({ length: 200 }, () => trade(0.25)),
      alive: true,
      stepsLived: 400,
      startingCapitalLamports: START,
    });

    // The lucky agent's raw score is higher — it tripled its money every time.
    expect(lucky.raw).toBeGreaterThan(proven.raw);
    // But fitness, which is what selection reads, must prefer the evidence.
    expect(proven.fitness).toBeGreaterThan(lucky.fitness);
    expect(lucky.confidence).toBeLessThan(0.2);
    expect(proven.confidence).toBeGreaterThan(0.9);
  });

  it('pulls a thin record towards the population mean', () => {
    const prior = 0.5;
    const thin = computeFitness({
      trades: [trade(2.0)],
      alive: true,
      stepsLived: 10,
      startingCapitalLamports: START,
      populationMean: prior,
    });
    // One trade: almost all prior.
    expect(Math.abs(thin.fitness - prior)).toBeLessThan(Math.abs(thin.raw - prior) * 0.2);
  });

  it('trusts an agent more as its record grows', () => {
    const at = (n: number) =>
      computeFitness({
        trades: Array.from({ length: n }, () => trade(0.3)),
        alive: true,
        stepsLived: n * 2,
        startingCapitalLamports: START,
      });
    expect(at(5).confidence).toBeLessThan(at(50).confidence);
    expect(at(50).confidence).toBeLessThan(at(500).confidence);
    expect(at(500).fitness).toBeGreaterThan(at(5).fitness);
  });

  it('raises the bar when confidenceK is raised', () => {
    const trades = Array.from({ length: 20 }, () => trade(0.4));
    const lenient = computeFitness({ trades, alive: true, stepsLived: 40, startingCapitalLamports: START, confidenceK: 5 });
    const strict = computeFitness({ trades, alive: true, stepsLived: 40, startingCapitalLamports: START, confidenceK: 200 });
    expect(strict.confidence).toBeLessThan(lenient.confidence);
    expect(strict.fitness).toBeLessThan(lenient.fitness);
  });
});

describe('components', () => {
  it('keeps every score and the raw total inside 0..1', () => {
    for (const returns of [[-0.9, -0.9], [3, 3, 3], [0], [0.1, -0.1, 0.4]]) {
      const f = computeFitness({
        trades: returns.map((r) => trade(r)),
        alive: true,
        stepsLived: 50,
        startingCapitalLamports: START,
      });
      for (const score of [f.returnScore, f.consistencyScore, f.riskScore, f.executionScore, f.survivalScore, f.raw]) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });

  it('punishes the same mean return when it is erratic', () => {
    const steady = computeFitness({
      trades: Array.from({ length: 40 }, () => trade(0.2)),
      alive: true, stepsLived: 80, startingCapitalLamports: START,
    });
    const erratic = computeFitness({
      trades: Array.from({ length: 40 }, (_, i) => trade(i % 2 === 0 ? 1.6 : -1.2)),
      alive: true, stepsLived: 80, startingCapitalLamports: START,
    });
    expect(steady.consistencyScore).toBeGreaterThan(erratic.consistencyScore);
  });

  it('computes drawdown from the equity curve', () => {
    const f = computeFitness({
      trades: [
        { returnPct: 1, pnlLamports: START, exitReason: 'TP2', holdSteps: 3 },
        { returnPct: -0.9, pnlLamports: -Math.round(START * 1.5), exitReason: 'STOP', holdSteps: 3 },
      ],
      alive: true, stepsLived: 10, startingCapitalLamports: START,
    });
    // Peaked at 2 SOL, fell to 0.5 -> 75% drawdown.
    expect(f.maxDrawdown).toBeCloseTo(0.75, 2);
    expect(f.riskScore).toBeCloseTo(0.25, 2);
  });

  it('rewards hitting targets over being stopped', () => {
    const hits = computeFitness({
      trades: Array.from({ length: 20 }, () => trade(0.5, 'TP1')),
      alive: true, stepsLived: 40, startingCapitalLamports: START,
    });
    const stopped = computeFitness({
      trades: Array.from({ length: 20 }, () => trade(0.5, 'STOP')),
      alive: true, stepsLived: 40, startingCapitalLamports: START,
    });
    expect(hits.executionScore).toBeGreaterThan(stopped.executionScore);
  });

  it('scores a dead agent below an identical living one', () => {
    const trades = Array.from({ length: 30 }, () => trade(0.2));
    const alive = computeFitness({ trades, alive: true, stepsLived: 100, startingCapitalLamports: START });
    const dead = computeFitness({ trades, alive: false, stepsLived: 100, startingCapitalLamports: START });
    expect(alive.survivalScore).toBeGreaterThan(dead.survivalScore);
    expect(alive.fitness).toBeGreaterThan(dead.fitness);
  });

  it('handles an agent that never traded without producing NaN', () => {
    const f = computeFitness({ trades: [], alive: true, stepsLived: 5, startingCapitalLamports: START });
    for (const v of Object.values(f)) expect(Number.isFinite(v)).toBe(true);
    expect(f.confidence).toBe(0);
    // With no evidence at all, fitness is exactly the prior.
    expect(f.fitness).toBeCloseTo(0.5, 9);
  });

  it('reports supporting statistics consistently', () => {
    const f = computeFitness({
      trades: [trade(0.5, 'TP1'), trade(1.0, 'TP2'), trade(-0.3, 'STOP'), trade(0.05, 'TIMEOUT')],
      alive: true, stepsLived: 20, startingCapitalLamports: START,
    });
    expect(f.trades).toBe(4);
    expect(f.tp1Hits).toBe(1);
    expect(f.tp2Hits).toBe(1);
    expect(f.stops).toBe(1);
    expect(f.timeouts).toBe(1);
    expect(f.wins).toBe(3);
    expect(f.winRate).toBeCloseTo(0.75, 9);
  });
});

describe('populationMeanRaw', () => {
  it('averages, and falls back to a neutral prior when empty', () => {
    expect(populationMeanRaw([0.2, 0.4, 0.6])).toBeCloseTo(0.4, 9);
    expect(populationMeanRaw([])).toBe(0.5);
  });
});
