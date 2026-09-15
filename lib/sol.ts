/**
 * SOL <-> lamport arithmetic.
 *
 * The whole economy is computed in integer lamports. Floating point SOL only
 * appears at the boundaries: configuration input and UI output. This is what
 * makes `sum(ledger) === agent.capital` hold exactly, forever.
 */

import { LAMPORTS_PER_SOL } from '@/config/simulation';

export { LAMPORTS_PER_SOL };

/** Converts SOL (float, from config or user input) to integer lamports. */
export function solToLamports(sol: number): number {
  if (!Number.isFinite(sol)) throw new Error(`solToLamports: not a finite number: ${sol}`);
  return Math.round(sol * LAMPORTS_PER_SOL);
}

/** Converts integer lamports to SOL as a float, for display only. */
export function lamportsToSol(lamports: number | bigint): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

/** Formats lamports as a fixed-precision SOL string, e.g. "1.4200". */
export function formatSol(lamports: number | bigint, decimals = 4): string {
  return lamportsToSol(lamports).toFixed(decimals);
}

/** Formats lamports as a signed SOL string, e.g. "+0.4100" / "-0.0300". */
export function formatSolSigned(lamports: number | bigint, decimals = 4): string {
  const n = Number(lamports);
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}${(Math.abs(n) / LAMPORTS_PER_SOL).toFixed(decimals)}`;
}

/** Prisma returns BigInt for int8 columns; the engine works in safe integers. */
export function toNum(value: bigint | number): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

export function toBig(value: bigint | number): bigint {
  return typeof value === 'bigint' ? value : BigInt(Math.round(value));
}
