/**
 * SolanaProvider — the boundary between SOLAXIUM's economy and Solana.
 *
 * V1 has exactly one implementation, SimulationSolanaProvider, which never
 * touches a network. DevnetSolanaProvider / MainnetSolanaProvider are
 * deliberately absent: adding one is a reviewed change that must also flip
 * `realValueEnabled` and pass docs/SECURITY.md's checklist.
 */

import type { SolanaNetwork } from '@/config/solana';

export interface LamportBalance {
  address: string;
  lamports: number;
  network: SolanaNetwork;
}

export interface TokenBalance {
  address: string;
  mint: string;
  amount: number;
  decimals: number;
}

export interface TransferRequest {
  from: string;
  to: string;
  lamports: number;
  memo?: string;
}

export interface SimulatedTransaction {
  /** Whether the transaction would succeed if broadcast. */
  ok: boolean;
  /** Estimated fee in lamports. */
  feeLamports: number;
  logs: string[];
  error?: string;
}

export interface TransactionReceipt {
  signature: string;
  slot: number;
  network: SolanaNetwork;
  feeLamports: number;
  confirmed: boolean;
  simulatedOnly: boolean;
}

export interface SolanaProvider {
  readonly network: SolanaNetwork;
  /** False for every V1 provider. */
  readonly realValue: boolean;

  getBalance(address: string): Promise<LamportBalance>;
  getTokenBalance(address: string, mint: string): Promise<TokenBalance>;
  simulateTransaction(request: TransferRequest): Promise<SimulatedTransaction>;
  sendTransaction(request: TransferRequest): Promise<TransactionReceipt>;
  getTransaction(signature: string): Promise<TransactionReceipt | null>;
}
