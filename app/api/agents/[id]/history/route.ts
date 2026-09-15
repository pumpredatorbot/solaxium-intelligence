import { NextRequest, NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { prisma } from '@/lib/db';
import { recomputeCapital } from '@/lib/engine/ledger';
import { toTransactionDTO } from '@/lib/repo/serialize';
import { lamportsToSol } from '@/lib/sol';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The agent's full ledger, plus the balance recomputed from it. The two must
 * agree — exposing both makes the invariant auditable from outside the process.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { capitalLamports: true },
  });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 200), 1000);

  return handle(async () => {
    const rows = await prisma.transaction.findMany({
      where: { agentId: id },
      orderBy: [{ cycle: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });
    const recomputedLamports = await recomputeCapital(prisma, id);

    return {
      transactions: rows.map(toTransactionDTO),
      storedCapitalSol: lamportsToSol(agent.capitalLamports),
      recomputedCapitalSol: lamportsToSol(recomputedLamports),
      ledgerConsistent: Number(agent.capitalLamports) === recomputedLamports,
    };
  });
}
