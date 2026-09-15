import { getSolanaConfig } from '@/config/solana';
import { SimulationSolanaProvider } from './simulation-provider';
import { ledgerBalanceSource } from './balance';
import type { SolanaProvider } from './provider';

export * from './provider';
export * from './network';
export * from './wallet';
export * from './transactions';
export { SimulationSolanaProvider, SIMULATED_FEE_LAMPORTS } from './simulation-provider';

let cached: SolanaProvider | null = null;

/**
 * Returns the active provider.
 *
 * V1 resolves to SimulationSolanaProvider for every mode. A non-simulation
 * mode throws rather than silently degrading, so a mis-set env var can never
 * quietly point the platform at a real cluster.
 */
export function getSolanaProvider(): SolanaProvider {
  const { mode } = getSolanaConfig();
  if (mode !== 'simulation') {
    throw new Error(
      `[solana] SOLANA_MODE="${mode}" is not implemented in V1. ` +
        `Only "simulation" is supported; see docs/SOLANA.md.`,
    );
  }
  cached ??= new SimulationSolanaProvider(ledgerBalanceSource);
  return cached;
}
