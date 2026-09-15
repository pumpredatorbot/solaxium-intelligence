/**
 * Transaction helpers.
 *
 * V1 maps an internal ledger movement to the *shape* of a Solana transfer so
 * that V2 can swap the provider without changing the caller. Nothing here
 * signs or broadcasts.
 */

import type { SolanaProvider, TransferRequest, TransactionReceipt } from './provider';

/** Virtual address representing the simulated treasury that seeds newborns. */
export const TREASURY_ADDRESS = 'SIMxTREASURY0000000000000000000000000000000';

export interface TransferOutcome {
  receipt: TransactionReceipt | null;
  ok: boolean;
  error?: string;
}

/**
 * Simulates first, then "sends". Simulating before sending is the pattern V2
 * must keep: never broadcast a transaction that has not been dry-run.
 */
export async function transfer(
  provider: SolanaProvider,
  request: TransferRequest,
): Promise<TransferOutcome> {
  const simulated = await provider.simulateTransaction(request);
  if (!simulated.ok) {
    return { receipt: null, ok: false, error: simulated.error };
  }
  const receipt = await provider.sendTransaction(request);
  return { receipt, ok: receipt.confirmed };
}
