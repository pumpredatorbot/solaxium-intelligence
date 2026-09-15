/**
 * Economic ledger.
 *
 * Every lamport that enters or leaves an agent passes through `postEntry`.
 * The agent's `capitalLamports` column is a materialised balance: it is only
 * ever written inside the same transaction that appends the ledger row, so the
 * two can never drift. `recomputeCapital` proves it.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { TransactionType } from '@/lib/types';
import { toNum } from '@/lib/sol';

/** Anything that can run queries: the client itself or an interactive tx. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface LedgerEntryInput {
  agentId: string;
  simulationId: string;
  type: TransactionType;
  /** Signed lamports. Positive credits the agent, negative debits it. */
  amountLamports: number;
  cycle: number;
  metadata?: Prisma.InputJsonValue;
}

export interface LedgerEntryResult {
  transactionId: string;
  balanceBefore: number;
  balanceAfter: number;
  applied: number;
}

/**
 * Appends one ledger row and moves the agent's balance atomically.
 *
 * A debit is clamped so capital can never go negative: an agent that cannot
 * afford an expense pays what it has and dies at zero. The clamped amount is
 * what gets written to the ledger, so the invariant still holds.
 */
export async function postEntry(
  db: DbClient,
  entry: LedgerEntryInput,
): Promise<LedgerEntryResult> {
  const agent = await db.agent.findUnique({
    where: { id: entry.agentId },
    select: { capitalLamports: true },
  });
  if (!agent) throw new Error(`postEntry: unknown agent ${entry.agentId}`);

  const before = toNum(agent.capitalLamports);
  const requested = Math.round(entry.amountLamports);
  const applied = requested < 0 ? -Math.min(before, -requested) : requested;
  const after = before + applied;

  const created = await db.transaction.create({
    data: {
      agentId: entry.agentId,
      simulationId: entry.simulationId,
      type: entry.type,
      amountLamports: BigInt(applied),
      balanceBeforeLamports: BigInt(before),
      balanceAfterLamports: BigInt(after),
      cycle: entry.cycle,
      metadata: entry.metadata,
    },
    select: { id: true },
  });

  // Lifetime totals track *earned* and *spent* only: seed capital and the
  // clone bonus are endowments, not revenue.
  const revenueDelta = entry.type === 'REVENUE' && applied > 0 ? applied : 0;
  const expenseDelta = entry.type === 'EXPENSE' && applied < 0 ? -applied : 0;

  await db.agent.update({
    where: { id: entry.agentId },
    data: {
      capitalLamports: BigInt(after),
      totalRevenueLamports: { increment: BigInt(revenueDelta) },
      totalExpensesLamports: { increment: BigInt(expenseDelta) },
    },
  });

  // peak is a max(), which Prisma cannot express as an atomic update.
  await db.$executeRaw`
    UPDATE "Agent"
    SET "peakCapitalLamports" = GREATEST("peakCapitalLamports", "capitalLamports")
    WHERE "id" = ${entry.agentId}
  `;

  return { transactionId: created.id, balanceBefore: before, balanceAfter: after, applied };
}

/** Recomputes an agent's balance from the ledger alone. Used by tests and /api. */
export async function recomputeCapital(db: DbClient, agentId: string): Promise<number> {
  const result = await db.transaction.aggregate({
    where: { agentId },
    _sum: { amountLamports: true },
  });
  return toNum(result._sum.amountLamports ?? 0n);
}

/** Total lamports ever credited to an agent as REVENUE. */
export async function totalRevenue(db: DbClient, agentId: string): Promise<number> {
  const result = await db.transaction.aggregate({
    where: { agentId, type: 'REVENUE' },
    _sum: { amountLamports: true },
  });
  return toNum(result._sum.amountLamports ?? 0n);
}

/** Total lamports ever debited from an agent (returned as a positive number). */
export async function totalExpenses(db: DbClient, agentId: string): Promise<number> {
  const result = await db.transaction.aggregate({
    where: { agentId, type: 'EXPENSE' },
    _sum: { amountLamports: true },
  });
  return -toNum(result._sum.amountLamports ?? 0n);
}
