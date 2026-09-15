/**
 * Balance lookups routed through the internal ledger.
 *
 * This is what makes the Solana abstraction honest in V1: `getBalance()` is
 * not a stub returning a constant, it resolves the agent's wallet address and
 * returns its real (simulated) capital computed from the ledger.
 */

import { prisma } from '@/lib/db';
import { toNum } from '@/lib/sol';
import type { BalanceSource } from './simulation-provider';

export const ledgerBalanceSource: BalanceSource = {
  async lamportsFor(address: string): Promise<number | null> {
    const wallet = await prisma.agentWallet.findFirst({
      where: { publicAddress: address },
      select: { agent: { select: { capitalLamports: true } } },
    });
    if (!wallet) return null;
    return toNum(wallet.agent.capitalLamports);
  },
};
