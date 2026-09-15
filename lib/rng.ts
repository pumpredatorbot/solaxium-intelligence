/**
 * Counter-based seeded PRNG.
 *
 * Every random draw in the simulation goes through here. The generator is
 * *counter-based* rather than state-chaining: `nth draw = hash(seed, n)`. That
 * means the full RNG state is a single integer, so a paused simulation can be
 * persisted and resumed on the exact same random stream — which is what makes
 * a run reproducible from its seed alone.
 */

/** FNV-1a over a string, used to fold an arbitrary seed into 32 bits. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32: strong avalanche, fast, stateless given (seed, counter). */
function splitmix32(seedHash: number, counter: number): number {
  let z = (seedHash + Math.imul(counter, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  z = (z ^ (z >>> 15)) >>> 0;
  return z;
}

export class SeededRandom {
  readonly seed: string;
  private readonly seedHash: number;
  private counter: number;

  constructor(seed: string, cursor = 0) {
    this.seed = seed;
    this.seedHash = hashSeed(seed);
    this.counter = cursor;
  }

  /** Number of draws consumed so far. Persist this to resume the stream. */
  get cursor(): number {
    return this.counter;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return splitmix32(this.seedHash, this.counter++) / 0x1_0000_0000;
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('SeededRandom.pick: empty array');
    return items[this.int(0, items.length - 1)];
  }

  /** Approximate standard normal via the Box-Muller transform. */
  normal(mean = 0, stdDev = 1): number {
    const u = Math.max(this.next(), Number.EPSILON);
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Weighted pick. Weights must be non-negative; all-zero falls back to uniform. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length !== weights.length) {
      throw new Error('SeededRandom.weighted: length mismatch');
    }
    const total = weights.reduce((a, w) => a + Math.max(0, w), 0);
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= Math.max(0, weights[i]);
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** A stable short id derived from the stream, e.g. for virtual addresses. */
  token(length = 8): string {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let out = '';
    for (let i = 0; i < length; i++) out += alphabet[this.int(0, alphabet.length - 1)];
    return out;
  }
}

/** Creates a fresh generator positioned at `cursor` draws into `seed`'s stream. */
export function createRng(seed: string, cursor = 0): SeededRandom {
  return new SeededRandom(seed, cursor);
}

/** A random, human-readable seed for a new simulation. */
export function generateSeed(): string {
  return `sx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
