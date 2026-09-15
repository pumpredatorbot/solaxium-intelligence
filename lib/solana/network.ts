/**
 * Network descriptors. `simulation` is the only network V1 will resolve to;
 * the others are declared so the shape is right when V2 arrives.
 */

import type { SolanaNetwork } from '@/config/solana';

export interface NetworkDescriptor {
  id: SolanaNetwork;
  label: string;
  /** Null when there is no RPC to talk to (simulation). */
  defaultRpcUrl: string | null;
  /** Whether value on this network has real-world worth. */
  realValue: boolean;
  explorerBase: string | null;
}

export const NETWORKS: Record<SolanaNetwork, NetworkDescriptor> = {
  simulation: {
    id: 'simulation',
    label: 'Simulation',
    defaultRpcUrl: null,
    realValue: false,
    explorerBase: null,
  },
  devnet: {
    id: 'devnet',
    label: 'Devnet',
    defaultRpcUrl: 'https://api.devnet.solana.com',
    realValue: false,
    explorerBase: 'https://explorer.solana.com',
  },
  testnet: {
    id: 'testnet',
    label: 'Testnet',
    defaultRpcUrl: 'https://api.testnet.solana.com',
    realValue: false,
    explorerBase: 'https://explorer.solana.com',
  },
  'mainnet-beta': {
    id: 'mainnet-beta',
    label: 'Mainnet Beta',
    defaultRpcUrl: null, // Deliberately unset: V1 must not reach mainnet.
    realValue: true,
    explorerBase: 'https://explorer.solana.com',
  },
};

export function describeNetwork(network: SolanaNetwork): NetworkDescriptor {
  return NETWORKS[network] ?? NETWORKS.simulation;
}
