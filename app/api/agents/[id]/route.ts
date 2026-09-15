import { handle } from '@/lib/api';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAgentDetail } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { simulation: { select: { cycle: true } } },
  });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  return handle(async () => getAgentDetail(id, agent.simulation.cycle));
}
