/**
 * SOLAXIUM INTELLIGENCE — Solana configuration.
 *
 * V1 runs in `simulation` mode: no RPC, no keypair, no signature, no network
 * call. The other modes exist so the abstraction is shaped correctly today;
 * they are not wired to a signer and `assertNoRealMoney()` guards every entry
 * point that could move value.
 */

export type SolanaMode = 'simulation' | 'devnet' | 'mainnet-beta';

export type SolanaNetwork = 'simulation' | 'devnet' | 'testnet' | 'mainnet-beta';

export interface SolanaConfig {
  mode: SolanaMode;
  network: SolanaNetwork;
  rpcUrl: string | null;
  /** True when the mode is allowed to move real value. Always false in V1. */
  realValueEnabled: boolean;
}

const VALID_MODES: SolanaMode[] = ['simulation', 'devnet', 'mainnet-beta'];

function readMode(): SolanaMode {
  const raw = (process.env.SOLANA_MODE ?? 'simulation').trim() as SolanaMode;
  return VALID_MODES.includes(raw) ? raw : 'simulation';
}

export function getSolanaConfig(): SolanaConfig {
  const mode = readMode();
  const network = (process.env.SOLANA_NETWORK ?? mode) as SolanaNetwork;
  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || null;

  return {
    mode,
    network: mode === 'simulation' ? 'simulation' : network,
    rpcUrl: mode === 'simulation' ? null : rpcUrl,
    // Hard-coded false for V1. Flipping this is a deliberate, reviewed change,
    // not a configuration toggle — see docs/SOLANA.md.
    realValueEnabled: false,
  };
}

export const DEFAULT_SOLANA_CONFIG: SolanaConfig = {
  mode: 'simulation',
  network: 'simulation',
  rpcUrl: null,
  realValueEnabled: false,
};

/**
 * Called by every provider method that would otherwise broadcast a
 * transaction. It throws unless the process is explicitly configured for real
 * value, which V1 never is.
 */
export function assertNoRealMoney(operation: string): void {
  const { realValueEnabled, mode } = getSolanaConfig();
  if (!realValueEnabled) {
    throw new Error(
      `[solana] "${operation}" is disabled: SOLAXIUM V1 runs a simulated economy ` +
        `(mode=${mode}, realValueEnabled=false). No value can be moved.`,
    );
  }
}
