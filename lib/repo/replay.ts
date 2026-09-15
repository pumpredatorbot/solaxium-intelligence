/**
 * Replay: reconstructing the population as it stood at an arbitrary cycle.
 *
 * This is possible only because the ledger is append-only and every row records
 * the balance it produced. A snapshot is therefore a *query*, not a stored
 * checkpoint — there is no separate recording that could disagree with the
 * live data.
 */

import { prisma } from '@/lib/db';
import { lamportsToSol } from '@/lib/sol';
import { toEventDTO, type EventDTO } from './serialize';

export interface ReplayAgent {
  id: string;
  code: string;
  generation: number;
  parentId: string | null;
  /** Status *at the replayed cycle*, not the agent's status today. */
  status: 'ALIVE' | 'DEAD';
  capitalSol: number;
  strategy: string;
}

export interface ReplaySnapshot {
  cycle: number;
  maxCycle: number;
  agents: ReplayAgent[];
  alive: number;
  dead: number;
  bornThisCycle: number;
  diedThisCycle: number;
  totalCapitalSol: number;
  generations: number;
  events: EventDTO[];
}

interface BalanceRow {
  agentId: string;
  balance: bigint | string;
}

/**
 * Rebuilds the population at `cycle`.
 *
 * An agent existed at that cycle if it was born at or before it and had not
 * yet died. Its capital is the balance left by the last ledger row at or
 * before that cycle — `DISTINCT ON` gives us that in one query rather than one
 * per agent.
 */
export async function getReplaySnapshot(
  simulationId: string,
  requestedCycle: number,
): Promise<ReplaySnapshot | null> {
  const simulation = await prisma.simulation.findUnique({
    where: { id: simulationId },
    select: { cycle: true },
  });
  if (!simulation) return null;

  const maxCycle = simulation.cycle;
  const cycle = Math.max(0, Math.min(Math.floor(requestedCycle), maxCycle));

  const [existing, balances, events] = await Promise.all([
    prisma.agent.findMany({
      where: { simulationId, bornAtCycle: { lte: cycle } },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        generation: true,
        parentId: true,
        strategy: true,
        bornAtCycle: true,
        diedAtCycle: true,
      },
    }),
    prisma.$queryRaw<BalanceRow[]>`
      SELECT DISTINCT ON (t."agentId")
        t."agentId",
        t."balanceAfterLamports" AS "balance"
      FROM "Transaction" t
      WHERE t."simulationId" = ${simulationId} AND t."cycle" <= ${cycle}
      ORDER BY t."agentId", t."cycle" DESC, t."createdAt" DESC
    `,
    prisma.simulationEvent.findMany({
      where: { simulationId, cycle },
      orderBy: { seq: 'asc' },
      take: 120,
    }),
  ]);

  const balanceAt = new Map(
    balances.map((b) => {
      const n = Number(b.balance);
      return [b.agentId, Number.isFinite(n) ? n : 0] as const;
    }),
  );

  let alive = 0;
  let dead = 0;
  let totalCapital = 0;
  let bornThisCycle = 0;
  let diedThisCycle = 0;
  const generations = new Set<number>();

  const agents: ReplayAgent[] = existing.map((agent) => {
    const isDead = agent.diedAtCycle !== null && agent.diedAtCycle <= cycle;
    const capital = isDead ? 0 : (balanceAt.get(agent.id) ?? 0);

    if (isDead) dead++;
    else {
      alive++;
      totalCapital += capital;
    }
    if (agent.bornAtCycle === cycle) bornThisCycle++;
    if (agent.diedAtCycle === cycle) diedThisCycle++;
    generations.add(agent.generation);

    return {
      id: agent.id,
      code: agent.code,
      generation: agent.generation,
      parentId: agent.parentId,
      status: isDead ? ('DEAD' as const) : ('ALIVE' as const),
      capitalSol: lamportsToSol(capital),
      strategy: agent.strategy,
    };
  });

  return {
    cycle,
    maxCycle,
    agents,
    alive,
    dead,
    bornThisCycle,
    diedThisCycle,
    totalCapitalSol: lamportsToSol(totalCapital),
    generations: generations.size,
    events: events.map(toEventDTO),
  };
}
