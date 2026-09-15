/**
 * Agent memory.
 *
 * Memory is bounded: once an agent exceeds MEMORY_LIMIT entries, the oldest
 * low-importance batch is compacted into a single SUMMARY row. Without this a
 * long run grows the per-agent prompt (and the table) without limit.
 */

import type { SimulationConfig } from '@/config/simulation';
import type { MemoryKind } from '@/lib/types';
import type { DbClient } from './ledger';

export interface MemoryInput {
  agentId: string;
  kind: MemoryKind;
  content: string;
  importance?: number;
  cycle: number;
}

export async function remember(db: DbClient, input: MemoryInput): Promise<void> {
  await db.agentMemory.create({
    data: {
      agentId: input.agentId,
      kind: input.kind,
      content: input.content.slice(0, 500),
      importance: clamp01(input.importance ?? 0.5),
      cycle: input.cycle,
    },
  });
}

/**
 * Compacts memory if it has grown past the configured budget.
 *
 * SUMMARY rows are never compacted again, and high-importance entries
 * (>= 0.8, e.g. "reached the clone threshold") are preserved verbatim.
 */
export async function compactMemory(
  db: DbClient,
  agentId: string,
  cycle: number,
  config: SimulationConfig,
): Promise<boolean> {
  const count = await db.agentMemory.count({ where: { agentId } });
  if (count <= config.MEMORY_LIMIT) return false;

  const candidates = await db.agentMemory.findMany({
    where: { agentId, kind: { not: 'SUMMARY' }, importance: { lt: 0.8 } },
    orderBy: { cycle: 'asc' },
    take: config.MEMORY_SUMMARY_BATCH,
  });
  if (candidates.length < 2) return false;

  const summary = summarise(candidates);
  const ids = candidates.map((c) => c.id);

  await db.agentMemory.deleteMany({ where: { id: { in: ids } } });
  await db.agentMemory.create({
    data: {
      agentId,
      kind: 'SUMMARY',
      content: summary,
      importance: 0.6,
      cycle: candidates[0].cycle,
    },
  });
  void cycle;
  return true;
}

function summarise(entries: { kind: string; content: string; cycle: number }[]): string {
  const from = entries[0].cycle;
  const to = entries[entries.length - 1].cycle;
  const byKind = new Map<string, number>();
  for (const e of entries) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  const breakdown = [...byKind.entries()].map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ');
  return `Cycles ${from}-${to} compacted: ${breakdown}. ${entries[entries.length - 1].content}`;
}

/** The most useful memories to hand a brain: important first, then recent. */
export async function recallForPrompt(
  db: DbClient,
  agentId: string,
  limit = 8,
): Promise<{ kind: MemoryKind; content: string; importance: number; cycle: number }[]> {
  const rows = await db.agentMemory.findMany({
    where: { agentId },
    orderBy: [{ importance: 'desc' }, { cycle: 'desc' }],
    take: limit,
    select: { kind: true, content: true, importance: true, cycle: true },
  });
  return rows.sort((a, b) => a.cycle - b.cycle);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
