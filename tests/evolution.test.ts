/**
 * The load-bearing claim of the project: that selection actually moves the
 * population. If this suite fails, SOLAXIUM is a random number generator with
 * a nice dashboard.
 *
 * It runs against the pure in-memory harness (scripts/balance.ts) so it can
 * afford the many seeds a statistical claim needs.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_SIMULATION_CONFIG } from '@/config/simulation';
import { simulate } from '@/scripts/balance';

const SEEDS = Array.from({ length: 24 }, (_, i) => `evo-${i}`);
const CYCLES = 120;

const runs = SEEDS.map((seed) => simulate(DEFAULT_SIMULATION_CONFIG, seed, CYCLES));

function meanAcrossRuns(pick: (run: (typeof runs)[number]) => number | undefined): number {
  const values = runs.map(pick).filter((v): v is number => v !== undefined);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function cohortsAtGeneration(generation: number) {
  return runs.filter((run) => run.profitPerCycleByGen.length > generation);
}

describe('the default economy is survivable but not safe', () => {
  it('kills a substantial share of the population', () => {
    const mortality = meanAcrossRuns((r) => (r.total ? r.dead / r.total : 0));
    expect(mortality).toBeGreaterThan(0.2);
    expect(mortality).toBeLessThan(0.75);
  });

  it('almost never goes extinct', () => {
    expect(runs.filter((r) => r.extinct).length / runs.length).toBeLessThan(0.15);
  });

  it('reaches several generations', () => {
    expect(meanAcrossRuns((r) => r.generations)).toBeGreaterThan(3);
  });

  it('produces agents that substantially outgrow their seed capital', () => {
    expect(meanAcrossRuns((r) => r.bestCapitalSol)).toBeGreaterThan(
      DEFAULT_SIMULATION_CONFIG.CLONE_THRESHOLD_SOL,
    );
  });
});

describe('selection moves the population', () => {
  it('improves survival rate across generations', () => {
    const early = cohortsAtGeneration(0).map((r) => r.survivalByGen[0]);
    const late = cohortsAtGeneration(4).map((r) => r.survivalByGen[4]);

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(late.length).toBeGreaterThan(5);
    // Later cohorts inherit genomes that already proved they could pay upkeep.
    expect(mean(late)).toBeGreaterThan(mean(early));
  });

  it('drives the trait the economy rewards upwards', () => {
    // salesFocus drives SELL_PRODUCT and OFFER_SERVICE, the two reliable
    // earners — so it is what selection should discover.
    const traitAt = (generation: number) => {
      const cohorts = cohortsAtGeneration(generation);
      return (
        cohorts.reduce((a, r) => a + (r.traitMeansByGen[generation]?.salesFocus ?? 0.5), 0) /
        cohorts.length
      );
    };

    const founders = traitAt(0);
    const descendants = traitAt(4);

    expect(founders).toBeGreaterThan(0.35);
    expect(founders).toBeLessThan(0.65); // founders start near neutral
    expect(descendants).toBeGreaterThan(founders + 0.1); // and the line moves
  });

  it('improves age-adjusted profitability across generations', () => {
    const early = meanAcrossRuns((r) => r.profitPerCycleByGen[0]);
    const late = meanAcrossRuns((r) => r.profitPerCycleByGen[4]);
    expect(late).toBeGreaterThan(early);
  });
});

describe('a harsher economy behaves as configured', () => {
  it('goes extinct when upkeep outruns what the market can pay', () => {
    const brutal = { ...DEFAULT_SIMULATION_CONFIG, CYCLE_COST_SOL: 2, REVENUE_SCALE: 0.2 };
    const results = SEEDS.slice(0, 8).map((seed) => simulate(brutal, seed, 60));
    expect(results.every((r) => r.extinct)).toBe(true);
  });

  it('never dies out when upkeep is free and revenue is rich', () => {
    const generous = { ...DEFAULT_SIMULATION_CONFIG, CYCLE_COST_SOL: 0, REVENUE_SCALE: 3 };
    const results = SEEDS.slice(0, 8).map((seed) => simulate(generous, seed, 60));
    expect(results.every((r) => !r.extinct)).toBe(true);
    expect(results.every((r) => r.clones > 0)).toBe(true);
  });
});
