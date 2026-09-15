import { describe, expect, it } from 'vitest';
import { DEFAULT_SIMULATION_CONFIG, TRAIT_KEYS } from '@/config/simulation';
import { createRng } from '@/lib/rng';
import { mutateTraits } from '@/lib/engine/mutation';
import { clamp01, dominantTrait, founderTraits, randomTraits, traitsFromRows, traitsToRows } from '@/lib/engine/traits';
import { deriveStrategy } from '@/lib/engine/strategy';

const CONFIG = DEFAULT_SIMULATION_CONFIG;

describe('traits', () => {
  it('clamps into [0,1] and defaults NaN to neutral', () => {
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0.5);
  });

  it('round-trips through database rows', () => {
    const traits = randomTraits(createRng('traits'));
    expect(traitsFromRows(traitsToRows(traits))).toEqual(traits);
  });

  it('ignores unknown trait keys from the database', () => {
    const traits = traitsFromRows([{ key: 'notATrait', value: 0.9 }]);
    expect(traits).toEqual(founderTraits());
  });

  it('identifies the most distinguishing trait', () => {
    const traits = { ...founderTraits(), aggressiveness: 0.95 };
    expect(dominantTrait(traits)).toBe('aggressiveness');
  });
});

describe('mutation', () => {
  it('keeps every mutated trait inside [0,1]', () => {
    const rng = createRng('mutation-bounds');
    let traits = randomTraits(rng);
    for (let generation = 0; generation < 200; generation++) {
      traits = mutateTraits(traits, rng, { MUTATION_RATE: 0.4, MUTATION_CHANCE: 1 }).traits;
      for (const key of TRAIT_KEYS) {
        expect(traits[key]).toBeGreaterThanOrEqual(0);
        expect(traits[key]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('inherits the parent genome, changed but recognisable', () => {
    const rng = createRng('mutation-drift');
    const parent = randomTraits(rng);
    const { traits: child, mutations } = mutateTraits(parent, rng, CONFIG);

    expect(mutations.length).toBeGreaterThan(0);
    // Mutation is a drift, not a re-roll: the child stays close to the parent.
    for (const key of TRAIT_KEYS) {
      expect(Math.abs(child[key] - parent[key])).toBeLessThan(0.5);
    }
  });

  it('records from/to/delta for every trait that moved', () => {
    const rng = createRng('mutation-record');
    const parent = randomTraits(rng);
    const { traits: child, mutations } = mutateTraits(parent, rng, {
      MUTATION_RATE: 0.1,
      MUTATION_CHANCE: 1,
    });

    expect(mutations).toHaveLength(TRAIT_KEYS.length);
    for (const mutation of mutations) {
      expect(mutation.to).toBeCloseTo(child[mutation.trait], 3);
      expect(mutation.delta).toBeCloseTo(mutation.to - mutation.from, 3);
    }
  });

  it('does not mutate at all when the chance is zero', () => {
    const rng = createRng('mutation-off');
    const parent = randomTraits(rng);
    const { traits, mutations } = mutateTraits(parent, rng, {
      MUTATION_RATE: 0.5,
      MUTATION_CHANCE: 0,
    });
    expect(traits).toEqual(parent);
    expect(mutations).toHaveLength(0);
  });

  it('is deterministic for a given seed', () => {
    const parent = randomTraits(createRng('p'));
    const a = mutateTraits(parent, createRng('m'), CONFIG);
    const b = mutateTraits(parent, createRng('m'), CONFIG);
    expect(a.traits).toEqual(b.traits);
  });
});

describe('strategy derivation', () => {
  it('reads a dominant trait as the matching strategy', () => {
    expect(deriveStrategy({ ...founderTraits(), riskTolerance: 1, aggressiveness: 1 })).toBe(
      'GROWTH_HUNTER',
    );
    expect(deriveStrategy({ ...founderTraits(), savingBehavior: 1, riskTolerance: 0 })).toBe(
      'CONSERVATIVE',
    );
    expect(deriveStrategy({ ...founderTraits(), researchFocus: 1 })).toBe('RESEARCHER');
  });

  it('falls back to BALANCED for a neutral genome', () => {
    expect(deriveStrategy(founderTraits())).toBe('BALANCED');
  });
});
