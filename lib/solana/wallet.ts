/**
 * AgentWallet abstraction.
 *
 * In simulation mode a wallet is an identifier and nothing else. No keypair is
 * generated, no seed phrase exists, nothing is derivable from the stored row,
 * and the agent brain is never shown any of it.
 */

import type { SolanaNetwork } from '@/config/solana';
import type { SeededRandom } from '@/lib/rng';
import { simulatedAddress } from '@/lib/engine/naming';

export interface AgentWalletDescriptor {
  agentId: string;
  provider: 'simulation' | 'devnet' | 'mainnet-beta';
  publicAddress: string;
  network: SolanaNetwork;
}

/**
 * Creates the wallet descriptor for a newborn agent.
 *
 * V1 returns a virtual address prefixed `SIMx` so it can never be mistaken for
 * a real base58 Solana pubkey.
 */
export function createSimulatedWallet(agentId: string, rng: SeededRandom): AgentWalletDescriptor {
  return {
    agentId,
    provider: 'simulation',
    publicAddress: simulatedAddress(rng),
    network: 'simulation',
  };
}

export function isSimulatedAddress(address: string): boolean {
  return address.startsWith('SIMx');
}
