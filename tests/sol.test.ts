import { describe, expect, it } from 'vitest';
import { LAMPORTS_PER_SOL, formatSol, formatSolSigned, lamportsToSol, solToLamports, toBig, toNum } from '@/lib/sol';

describe('SOL arithmetic', () => {
  it('round-trips whole SOL exactly', () => {
    expect(solToLamports(1)).toBe(LAMPORTS_PER_SOL);
    expect(lamportsToSol(LAMPORTS_PER_SOL)).toBe(1);
  });

  it('keeps fractional SOL exact as integer lamports', () => {
    // 0.1 + 0.2 !== 0.3 in floats; in lamports it must be exact.
    const sum = solToLamports(0.1) + solToLamports(0.2);
    expect(sum).toBe(solToLamports(0.3));
  });

  it('rejects non-finite input', () => {
    expect(() => solToLamports(Number.NaN)).toThrow();
    expect(() => solToLamports(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('formats with a stable precision and sign', () => {
    expect(formatSol(solToLamports(1.42))).toBe('1.4200');
    expect(formatSolSigned(solToLamports(0.41))).toBe('+0.4100');
    expect(formatSolSigned(-solToLamports(0.03))).toBe('-0.0300');
    expect(formatSolSigned(0)).toBe('0.0000');
  });

  it('converts between bigint and number safely', () => {
    expect(toNum(5n)).toBe(5);
    expect(toNum(5)).toBe(5);
    expect(toBig(5)).toBe(5n);
    expect(toBig(5n)).toBe(5n);
  });
});
