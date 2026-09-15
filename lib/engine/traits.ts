/**
 * Trait vector helpers. Traits are the agent's genome: eight values in [0, 1]
 * that bias every decision and are what actually evolves across generations.
 */

import { TRAIT_KEYS, FOUNDER_TRAITS, type TraitKey } from '@/config/simulation';
import type { SeededRandom } from '@/lib/rng';

export type TraitVector = Record<TraitKey, number>;

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function founderTraits(): TraitVector {
  return { ...FOUNDER_TRAITS };
}

/**
 * Traits for a founder that should not be a perfect 0.5 across the board —
 * a population of identical founders has nothing to select between.
 */
export function randomTraits(rng: SeededRandom, spread = 0.22): TraitVector {
  const out = {} as TraitVector;
  for (const key of TRAIT_KEYS) {
    out[key] = clamp01(0.5 + rng.normal(0, spread));
  }
  return out;
}

export function traitsFromRows(rows: { key: string; value: number }[]): TraitVector {
  const out = founderTraits();
  for (const row of rows) {
    if ((TRAIT_KEYS as readonly string[]).includes(row.key)) {
      out[row.key as TraitKey] = clamp01(row.value);
    }
  }
  return out;
}

export function traitsToRows(traits: TraitVector): { key: TraitKey; value: number }[] {
  return TRAIT_KEYS.map((key) => ({ key, value: clamp01(traits[key]) }));
}

/** The trait that most distinguishes this agent from a neutral one. */
export function dominantTrait(traits: TraitVector): TraitKey {
  let best: TraitKey = TRAIT_KEYS[0];
  let bestDistance = -1;
  for (const key of TRAIT_KEYS) {
    const distance = Math.abs(traits[key] - 0.5);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = key;
    }
  }
  return best;
}
