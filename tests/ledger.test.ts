import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { solToLamports, toNum } from '@/lib/sol';
import { createSimulation } from '@/lib/engine/engine';
import { postEntry, recomputeCapital, totalExpenses, totalRevenue } from '@/lib/engine/ledger';
import { resetDatabase } from './helpers';

let simulationId: string;
let agentId: string;

describe('economic ledger', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    const result = await createSimulation({ name: 'ledger', seed: 'ledger-1', founderCount: 1 });
    simulationId = result.simulationId;
    agentId = result.founderIds[0];
  });

  it('seeds initial capital through a ledger entry, not a bare column write', async () => {
    const transactions = await prisma.transaction.findMany({ where: { agentId } });
    expect(transactions).toHaveLength(1);
    expect(transactions[0].type).toBe('INITIAL_CAPITAL');
    expect(toNum(transactions[0].amountLamports)).toBe(solToLamports(1));
    expect(toNum(transactions[0].balanceBeforeLamports)).toBe(0);
    expect(toNum(transactions[0].balanceAfterLamports)).toBe(solToLamports(1));
  });

  it('keeps the stored balance equal to the sum of the ledger', async () => {
    for (let i = 0; i < 25; i++) {
      await postEntry(prisma, {
        agentId,
        simulationId,
        type: i % 2 === 0 ? 'REVENUE' : 'EXPENSE',
        amountLamports: i % 2 === 0 ? solToLamports(0.13) : -solToLamports(0.07),
        cycle: i,
      });
    }

    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    const recomputed = await recomputeCapital(prisma, agentId);
    expect(toNum(agent.capitalLamports)).toBe(recomputed);
  });

  it('records balanceBefore and balanceAfter as a continuous chain', async () => {
    for (let i = 0; i < 10; i++) {
      await postEntry(prisma, {
        agentId,
        simulationId,
        type: 'REVENUE',
        amountLamports: solToLamports(0.05),
        cycle: i,
      });
    }

    const rows = await prisma.transaction.findMany({
      where: { agentId },
      orderBy: [{ cycle: 'asc' }, { createdAt: 'asc' }],
    });
    for (let i = 1; i < rows.length; i++) {
      expect(toNum(rows[i].balanceBeforeLamports)).toBe(toNum(rows[i - 1].balanceAfterLamports));
    }
  });

  it('clamps a debit so capital can never go negative', async () => {
    const result = await postEntry(prisma, {
      agentId,
      simulationId,
      type: 'EXPENSE',
      amountLamports: -solToLamports(999),
      cycle: 1,
    });

    expect(result.balanceAfter).toBe(0);
    // The clamped amount is what is written, so the invariant still holds.
    expect(result.applied).toBe(-solToLamports(1));
    expect(await recomputeCapital(prisma, agentId)).toBe(0);
  });

  it('tracks lifetime revenue and expenses separately from endowments', async () => {
    await postEntry(prisma, {
      agentId,
      simulationId,
      type: 'REVENUE',
      amountLamports: solToLamports(0.4),
      cycle: 1,
    });
    await postEntry(prisma, {
      agentId,
      simulationId,
      type: 'EXPENSE',
      amountLamports: -solToLamports(0.1),
      cycle: 1,
    });

    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    // The 1 SOL seed capital is an endowment and must not count as revenue.
    expect(toNum(agent.totalRevenueLamports)).toBe(solToLamports(0.4));
    expect(toNum(agent.totalExpensesLamports)).toBe(solToLamports(0.1));
    expect(await totalRevenue(prisma, agentId)).toBe(solToLamports(0.4));
    expect(await totalExpenses(prisma, agentId)).toBe(solToLamports(0.1));
  });

  it('tracks peak capital as a high-water mark', async () => {
    await postEntry(prisma, {
      agentId,
      simulationId,
      type: 'REVENUE',
      amountLamports: solToLamports(4),
      cycle: 1,
    });
    await postEntry(prisma, {
      agentId,
      simulationId,
      type: 'EXPENSE',
      amountLamports: -solToLamports(4.5),
      cycle: 2,
    });

    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    expect(toNum(agent.capitalLamports)).toBe(solToLamports(0.5));
    expect(toNum(agent.peakCapitalLamports)).toBe(solToLamports(5));
  });

  it('rolls back the whole entry if the transaction fails', async () => {
    const before = await recomputeCapital(prisma, agentId);

    await expect(
      prisma.$transaction(async (tx) => {
        await postEntry(tx, {
          agentId,
          simulationId,
          type: 'REVENUE',
          amountLamports: solToLamports(5),
          cycle: 1,
        });
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
    expect(await recomputeCapital(prisma, agentId)).toBe(before);
    expect(toNum(agent.capitalLamports)).toBe(before);
  });

  it('rejects an entry for an unknown agent', async () => {
    await expect(
      postEntry(prisma, {
        agentId: 'does-not-exist',
        simulationId,
        type: 'REVENUE',
        amountLamports: 1,
        cycle: 0,
      }),
    ).rejects.toThrow(/unknown agent/i);
  });
});
