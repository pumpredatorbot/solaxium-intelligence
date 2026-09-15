/**
 * The "engine" view of an agent: what it is doing right now.
 *
 * Status is derived from the agent's most recent recorded action rather than
 * invented — an agent that last ran RESEARCH really is learning, one that last
 * ran SELL_PRODUCT really is executing. The mapping is the only interpretive
 * step, and it is one-to-one with `ActionType`.
 */

import { prisma } from '@/lib/db';
import { lamportsToSol } from '@/lib/sol';
import type { ActionType } from '@/lib/types';

export type EngineStatus =
  | 'ACTIVE'
  | 'EXECUTING'
  | 'LEARNING'
  | 'ANALYZING'
  | 'RESTING'
  | 'DEAD';

const STATUS_BY_ACTION: Record<ActionType, EngineStatus> = {
  SELL_PRODUCT: 'EXECUTING',
  OFFER_SERVICE: 'EXECUTING',
  INVEST_IN_GROWTH: 'EXECUTING',
  RESEARCH: 'LEARNING',
  CREATE_PRODUCT: 'ANALYZING',
  MARKETING: 'ANALYZING',
  REST: 'RESTING',
  SAVE: 'RESTING',
};

export interface EngineCard {
  id: string;
  code: string;
  name: string;
  generation: number;
  status: EngineStatus;
  capitalSol: number;
  profitSol: number;
  roi: number;
  /** Null until the agent has taken its first action. */
  action: { type: ActionType; outcome: string; cycle: number; reasoning: string } | null;
  confidence: number | null;
  cycles: number;
  clonesCreated: number;
  strategy: string;
  /** Recent capital readings, oldest first, for the card's sparkline. */
  spark: number[];
  /** Cycles of runway left at the configured burn rate. */
  runwayCycles: number | null;
}

export async function listEngines(
  simulationId: string,
  options: { limit?: number; status?: 'ALIVE' | 'DEAD'; cycleCostSol?: number } = {},
): Promise<EngineCard[]> {
  const agents = await prisma.agent.findMany({
    where: { simulationId, ...(options.status ? { status: options.status } : {}) },
    orderBy: [{ status: 'asc' }, { capitalLamports: 'desc' }],
    take: options.limit ?? 24,
    select: {
      id: true,
      code: true,
      name: true,
      generation: true,
      status: true,
      strategy: true,
      cycles: true,
      clonesCreated: true,
      capitalLamports: true,
      startingCapitalLamports: true,
      actions: {
        orderBy: { cycle: 'desc' },
        take: 1,
        select: { type: true, outcome: true, cycle: true, reasoning: true, confidence: true },
      },
      transactions: {
        orderBy: [{ cycle: 'desc' }, { createdAt: 'desc' }],
        take: 24,
        select: { balanceAfterLamports: true },
      },
    },
  });

  return agents.map((agent) => {
    const last = agent.actions[0] ?? null;
    const capitalSol = lamportsToSol(agent.capitalLamports);
    const startingSol = lamportsToSol(agent.startingCapitalLamports);
    const profit = capitalSol - startingSol;

    const status: EngineStatus =
      agent.status === 'DEAD'
        ? 'DEAD'
        : last
          ? STATUS_BY_ACTION[last.type as ActionType]
          : 'ACTIVE';

    return {
      id: agent.id,
      code: agent.code,
      name: agent.name,
      generation: agent.generation,
      status,
      capitalSol,
      profitSol: profit,
      roi: startingSol > 0 ? profit / startingSol : 0,
      action: last
        ? {
            type: last.type as ActionType,
            outcome: last.outcome,
            cycle: last.cycle,
            reasoning: last.reasoning,
          }
        : null,
      confidence: last?.confidence ?? null,
      cycles: agent.cycles,
      clonesCreated: agent.clonesCreated,
      strategy: agent.strategy,
      spark: agent.transactions
        .map((t) => lamportsToSol(t.balanceAfterLamports))
        .reverse(),
      runwayCycles:
        agent.status === 'DEAD' || !options.cycleCostSol
          ? null
          : capitalSol / options.cycleCostSol,
    };
  });
}
