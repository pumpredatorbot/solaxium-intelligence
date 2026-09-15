/**
 * SimulationSolanaProvider.
 *
 * A faithful stand-in for a Solana RPC that is backed by the internal ledger
 * instead of a cluster. No network socket is opened, no keypair exists, and
 * `sendTransaction` records a virtual receipt rather than broadcasting.
 */

import { assertNoRealMoney } from '@/config/solana';
import { createRng, hashSeed } from '@/lib/rng';
import type {
  LamportBalance,
  SimulatedTransaction,
  SolanaProvider,
  TokenBalance,
  TransactionReceipt,
  TransferRequest,
} from './provider';

/** Flat fee charged by the simulated cluster, in lamports (5000 = 0.000005 SOL). */
export const SIMULATED_FEE_LAMPORTS = 5_000;

export interface BalanceSource {
  /** Resolves a virtual address to its lamport balance, or null if unknown. */
  lamportsFor(address: string): Promise<number | null>;
}

export class SimulationSolanaProvider implements SolanaProvider {
  readonly network = 'simulation' as const;
  readonly realValue = false;

  private readonly receipts = new Map<string, TransactionReceipt>();
  private slot = 0;

  constructor(private readonly balances?: BalanceSource) {}

  async getBalance(address: string): Promise<LamportBalance> {
    const lamports = (await this.balances?.lamportsFor(address)) ?? 0;
    return { address, lamports, network: this.network };
  }

  async getTokenBalance(address: string, mint: string): Promise<TokenBalance> {
    // V1 has no SPL tokens; the shape is here so V2 can fill it in.
    return { address, mint, amount: 0, decimals: 9 };
  }

  async simulateTransaction(request: TransferRequest): Promise<SimulatedTransaction> {
    const logs = [
      `Program 11111111111111111111111111111111 invoke [1]`,
      `Transfer ${request.lamports} lamports ${request.from} -> ${request.to}`,
    ];

    if (request.lamports <= 0) {
      return { ok: false, feeLamports: 0, logs, error: 'Transfer amount must be positive' };
    }

    const available = (await this.balances?.lamportsFor(request.from)) ?? null;
    if (available !== null && available < request.lamports + SIMULATED_FEE_LAMPORTS) {
      return {
        ok: false,
        feeLamports: SIMULATED_FEE_LAMPORTS,
        logs: [...logs, 'Error: insufficient lamports'],
        error: `Insufficient funds: ${available} < ${request.lamports + SIMULATED_FEE_LAMPORTS}`,
      };
    }

    if (request.memo) logs.push(`Memo: ${request.memo}`);
    logs.push('Program 11111111111111111111111111111111 success');
    return { ok: true, feeLamports: SIMULATED_FEE_LAMPORTS, logs };
  }

  /**
   * Records a virtual receipt. It never broadcasts: `assertNoRealMoney` throws
   * for any mode that could move value, and simulation mode short-circuits to
   * a local record.
   */
  async sendTransaction(request: TransferRequest): Promise<TransactionReceipt> {
    const simulated = await this.simulateTransaction(request);
    if (!simulated.ok) {
      throw new Error(`[solana:simulation] transaction rejected: ${simulated.error}`);
    }

    const signature = this.virtualSignature(request);
    const receipt: TransactionReceipt = {
      signature,
      slot: ++this.slot,
      network: this.network,
      feeLamports: simulated.feeLamports,
      confirmed: true,
      simulatedOnly: true,
    };
    this.receipts.set(signature, receipt);
    return receipt;
  }

  async getTransaction(signature: string): Promise<TransactionReceipt | null> {
    return this.receipts.get(signature) ?? null;
  }

  /** Deterministic pseudo-signature derived from the request. */
  private virtualSignature(request: TransferRequest): string {
    const seed = `${request.from}:${request.to}:${request.lamports}:${this.slot}`;
    return `SIMsig${createRng(String(hashSeed(seed))).token(80)}`;
  }
}

/**
 * Guard used by any future code path that would move real value. Calling it in
 * V1 always throws, by design.
 */
export function guardRealTransfer(operation: string): never {
  assertNoRealMoney(operation);
  throw new Error(`[solana] ${operation} is unreachable in V1`);
}
