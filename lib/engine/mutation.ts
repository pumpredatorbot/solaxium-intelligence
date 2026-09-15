/**
 * Inheritance and mutation.
 *
 * A clone starts from its parent's trait vector and then drifts: each trait
 * mutates with probability MUTATION_CHANCE, by a gaussian step of width
 * MUTATION_RATE. Small enough that lineages stay recognisable, large enough
 * that ten generations of selection visibly move the population.
 */

import { TRAIT_KEYS, type SimulationConfig, type TraitKey } from '@/config/simulation';
import type { SeededRandom } from '@/lib/rng';
import { clamp01, type TraitVector } from './traits';

export interface TraitMutation {
  trait: TraitKey;
  from: number;
  to: number;
  delta: number;
}

export interface MutationResult {
  traits: TraitVector;
  mutations: TraitMutation[];
}

export function mutateTraits(
  parentTraits: TraitVector,
  rng: SeededRandom,
  config: Pick<SimulationConfig, 'MUTATION_RATE' | 'MUTATION_CHANCE'>,
): MutationResult {
  const traits = {} as TraitVector;
  const mutations: TraitMutation[] = [];

  for (const key of TRAIT_KEYS) {
    const from = clamp01(parentTraits[key]);
    if (!rng.chance(config.MUTATION_CHANCE)) {
      traits[key] = from;
      continue;
    }
    const to = clamp01(from + rng.normal(0, config.MUTATION_RATE));
    traits[key] = to;
    // Round for storage/display; the clamped value is the source of truth.
    mutations.push({
      trait: key,
      from: round4(from),
      to: round4(to),
      delta: round4(to - from),
    });
  }

  return { traits, mutations };
}

/**
 * The clone keeps the parent's strategy label with probability
 * STRATEGY_INHERITANCE, otherwise it re-derives one from its own mutated
 * traits — that is how a lineage changes course.
 */
export function inheritStrategy(
  parentStrategy: string,
  childTraits: TraitVector,
  rng: SeededRandom,
  config: Pick<SimulationConfig, 'STRATEGY_INHERITANCE'>,
  derive: (traits: TraitVector) => string,
): string {
  return rng.chance(config.STRATEGY_INHERITANCE) ? parentStrategy : derive(childTraits);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
