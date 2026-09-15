import { NextRequest, NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { prisma } from '@/lib/db';
import { toActionDTO } from '@/lib/repo/serialize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const exists = await prisma.agent.count({ where: { id } });
  if (!exists) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? 100), 500);

  return handle(async () => {
    const rows = await prisma.agentAction.findMany({
      where: { agentId: id },
      orderBy: { cycle: 'desc' },
      take: limit,
    });
    return { actions: rows.map(toActionDTO) };
  });
}
