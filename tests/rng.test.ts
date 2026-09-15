import { describe, expect, it } from 'vitest';
import { createRng, generateSeed, hashSeed, SeededRandom } from '@/lib/rng';

describe('SeededRandom', () => {
  it('produces the same stream for the same seed', () => {
    const a = createRng('seed-1');
    const b = createRng('seed-1');
    const left = Array.from({ length: 50 }, () => a.next());
    const right = Array.from({ length: 50 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('produces a different stream for a different seed', () => {
    const a = Array.from({ length: 50 }, (_, i) => createRng('seed-1', i).next());
    const b = Array.from({ length: 50 }, (_, i) => createRng('seed-2', i).next());
    expect(a).not.toEqual(b);
  });

  it('resumes exactly from a persisted cursor', () => {
    const full = createRng('resume');
    const first = Array.from({ length: 10 }, () => full.next());
    const rest = Array.from({ length: 10 }, () => full.next());

    // Rebuild at the cursor and continue: the tail must match.
    const resumed = createRng('resume', 10);
    expect(Array.from({ length: 10 }, () => resumed.next())).toEqual(rest);
    expect(first).not.toEqual(rest);
  });

  it('advances the cursor once per draw', () => {
    const rng = new SeededRandom('cursor');
    expect(rng.cursor).toBe(0);
    rng.next();
    rng.next();
    expect(rng.cursor).toBe(2);
  });

  it('keeps every draw in range', () => {
    const rng = createRng('ranges');
    for (let i = 0; i < 2000; i++) {
      const u = rng.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      const n = rng.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });

  it('weights a weighted pick', () => {
    const rng = createRng('weighted');
    let a = 0;
    for (let i = 0; i < 4000; i++) {
      if (rng.weighted(['a', 'b'], [9, 1]) === 'a') a++;
    }
    expect(a / 4000).toBeGreaterThan(0.85);
    expect(a / 4000).toBeLessThan(0.95);
  });

  it('falls back to a uniform pick when all weights are zero', () => {
    const rng = createRng('zero-weights');
    expect(['a', 'b']).toContain(rng.weighted(['a', 'b'], [0, 0]));
  });

  it('hashes seeds to distinct 32-bit values', () => {
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
    expect(hashSeed('a')).toBe(hashSeed('a'));
  });

  it('generates unique seeds', () => {
    expect(generateSeed()).not.toBe(generateSeed());
  });
});
