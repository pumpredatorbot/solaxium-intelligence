/**
 * Read model. Every page and API route reads through here so the shape of a
 * dashboard number is defined once.
 */

import { prisma } from '@/lib/db';
import { lamportsToSol, toNum } from '@/lib/sol';
import { resolveConfig } from '@/lib/engine/config';
import { traitsFromRows, type TraitVector } from '@/lib/engine/traits';
import {
  toActionDTO,
  toAgentDTO,
  toEventDTO,
  toGenerationDTO,
  toTransactionDTO,
  type ActionDTO,
  type AgentDTO,
  type EventDTO,
  type GenerationDTO,
  type TransactionDTO,
} from './serialize';
import type { SimulationStatus } from '@/lib/types';

const AGENT_SELECT = {
  id: true,
  code: true,
  name: true,
  generation: true,
  parentId: true,
  status: true,
  capitalLamports: true,
  startingCapitalLamports: true,
  peakCapitalLamports: true,
  totalRevenueLamports: true,
  totalExpensesLamports: true,
  cycles: true,
  bornAtCycle: true,
  diedAtCycle: true,
  clonesCreated: true,
  strategy: true,
  momentum: true,
  createdAt: true,
  diedAt: true,
} as const;

export interface SimulationSummary {
  id: string;
  name: string;
  seed: string;
  status: SimulationStatus;
  cycle: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  config: Record<string, number>;
}

/**
 * The simulation the UI defaults to: the most recently touched one. Everything
 * accepts an explicit `simulationId` override.
 */
export async function getActiveSimulation(
  simulationId?: string | null,
): Promise<SimulationSummary | null> {
  const row = simulationId
    ? await prisma.simulation.findUnique({ where: { id: simulationId } })
    : await prisma.simulation.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    seed: row.seed,
    status: row.status as SimulationStatus,
    cycle: row.cycle,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    config: (row.config as Record<string, number>) ?? {},
  };
}

export async function listSimulations(limit = 20): Promise<SimulationSummary[]> {
  const rows = await prisma.simulation.findMany({
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    seed: row.seed,
    status: row.status as SimulationStatus,
    cycle: row.cycle,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    config: (row.config as Record<string, number>) ?? {},
  }));
}

export interface DashboardStats {
  liveAgents: number;
  deadAgents: number;
  totalAgents: number;
  totalCapitalSol: number;
  totalRevenueSol: number;
  totalExpensesSol: number;
  totalProfitSol: number;
  generations: number;
  totalClones: number;
  survivalRate: number;
  cycle: number;
  bestAgent: AgentDTO | null;
}

export async function getDashboardStats(simulationId: string, cycle: number): Promise<DashboardStats> {
  const [alive, dead, sums, generations, clones, best] = await Promise.all([
    prisma.agent.count({ where: { simulationId, status: 'ALIVE' } }),
    prisma.agent.count({ where: { simulationId, status: 'DEAD' } }),
    prisma.agent.aggregate({
      where: { simulationId },
      _sum: {
        capitalLamports: true,
        totalRevenueLamports: true,
        totalExpensesLamports: true,
        startingCapitalLamports: true,
      },
    }),
    prisma.generation.count({ where: { simulationId } }),
    prisma.clone.count({ where: { simulationId } }),
    prisma.agent.findFirst({
      where: { simulationId },
      orderBy: { capitalLamports: 'desc' },
      select: AGENT_SELECT,
    }),
  ]);

  const totalCapital = toNum(sums._sum.capitalLamports ?? 0n);
  const totalStarting = toNum(sums._sum.startingCapitalLamports ?? 0n);
  const totalAgents = alive + dead;

  return {
    liveAgents: alive,
    deadAgents: dead,
    totalAgents,
    totalCapitalSol: lamportsToSol(totalCapital),
    totalRevenueSol: lamportsToSol(toNum(sums._sum.totalRevenueLamports ?? 0n)),
    totalExpensesSol: lamportsToSol(toNum(sums._sum.totalExpensesLamports ?? 0n)),
    totalProfitSol: lamportsToSol(totalCapital - totalStarting),
    generations,
    totalClones: clones,
    survivalRate: totalAgents > 0 ? alive / totalAgents : 0,
    cycle,
    bestAgent: best ? toAgentDTO(best, cycle) : null,
  };
}

export interface ListAgentsOptions {
  status?: 'ALIVE' | 'DEAD';
  generation?: number;
  orderBy?: 'capital' | 'profit' | 'lifetime' | 'clones' | 'code' | 'roi';
  limit?: number;
  offset?: number;
}

export async function listAgents(
  simulationId: string,
  cycle: number,
  options: ListAgentsOptions = {},
): Promise<{ agents: AgentDTO[]; total: number }> {
  const where = {
    simulationId,
    ...(options.status ? { status: options.status } : {}),
    ...(options.generation !== undefined ? { generation: options.generation } : {}),
  };

  const orderBy = (() => {
    switch (options.orderBy) {
      case 'capital':
        return { capitalLamports: 'desc' } as const;
      case 'lifetime':
        return { cycles: 'desc' } as const;
      case 'clones':
        return { clonesCreated: 'desc' } as const;
      case 'code':
        return { code: 'asc' } as const;
      default:
        return { capitalLamports: 'desc' } as const;
    }
  })();

  const [rows, total] = await Promise.all([
    prisma.agent.findMany({
      where,
      orderBy,
      take: options.limit ?? 100,
      skip: options.offset ?? 0,
      select: AGENT_SELECT,
    }),
    prisma.agent.count({ where }),
  ]);

  let agents = rows.map((row) => toAgentDTO(row, cycle));

  // Profit and ROI are derived, so they cannot be ordered in SQL without
  // duplicating the formula; the page sizes here are small enough to sort here.
  if (options.orderBy === 'profit') {
    agents = agents.sort((a, b) => b.totalProfitSol - a.totalProfitSol);
  } else if (options.orderBy === 'roi') {
    agents = agents.sort((a, b) => b.roi - a.roi);
  }

  return { agents, total };
}

export interface AgentDetail {
  agent: AgentDTO;
  traits: TraitVector;
  parent: { id: string; code: string; generation: number } | null;
  children: { id: string; code: string; generation: number; status: string; capitalSol: number }[];
  actions: ActionDTO[];
  transactions: TransactionDTO[];
  memory: { kind: string; content: string; importance: number; cycle: number }[];
  capitalSeries: { cycle: number; capitalSol: number }[];
  wallet: { publicAddress: string; network: string; provider: string } | null;
  mutations: { trait: string; from: number; to: number; delta: number }[] | null;
}

export async function getAgentDetail(
  agentId: string,
  currentCycle: number,
): Promise<AgentDetail | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { ...AGENT_SELECT, simulationId: true },
  });
  if (!agent) return null;

  const [traitRows, parent, children, actions, transactions, memory, wallet, cloneRecord] =
    await Promise.all([
      prisma.agentTrait.findMany({ where: { agentId }, select: { key: true, value: true } }),
      agent.parentId
        ? prisma.agent.findUnique({
            where: { id: agent.parentId },
            select: { id: true, code: true, generation: true },
          })
        : Promise.resolve(null),
      prisma.agent.findMany({
        where: { parentId: agentId },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, generation: true, status: true, capitalLamports: true },
      }),
      prisma.agentAction.findMany({
        where: { agentId },
        orderBy: { cycle: 'desc' },
        take: 40,
      }),
      prisma.transaction.findMany({
        where: { agentId },
        orderBy: [{ cycle: 'desc' }, { createdAt: 'desc' }],
        take: 60,
      }),
      prisma.agentMemory.findMany({
        where: { agentId },
        orderBy: [{ importance: 'desc' }, { cycle: 'desc' }],
        take: 20,
        select: { kind: true, content: true, importance: true, cycle: true },
      }),
      prisma.agentWallet.findUnique({
        where: { agentId },
        select: { publicAddress: true, network: true, provider: true },
      }),
      prisma.clone.findUnique({ where: { childId: agentId }, select: { mutations: true } }),
    ]);

  // Capital over time, reconstructed from the ledger — the chart is the ledger,
  // not a separate recording that could disagree with it.
  const series = await prisma.transaction.findMany({
    where: { agentId },
    orderBy: [{ cycle: 'asc' }, { createdAt: 'asc' }],
    select: { cycle: true, balanceAfterLamports: true },
  });
  const byCycle = new Map<number, number>();
  for (const row of series) byCycle.set(row.cycle, lamportsToSol(row.balanceAfterLamports));

  return {
    agent: toAgentDTO(agent, currentCycle),
    traits: traitsFromRows(traitRows),
    parent,
    children: children.map((c) => ({
      id: c.id,
      code: c.code,
      generation: c.generation,
      status: c.status,
      capitalSol: lamportsToSol(c.capitalLamports),
    })),
    actions: actions.map(toActionDTO),
    transactions: transactions.map(toTransactionDTO),
    memory,
    capitalSeries: [...byCycle.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([cycle, capitalSol]) => ({ cycle, capitalSol })),
    wallet,
    mutations: (cloneRecord?.mutations as AgentDetail['mutations']) ?? null,
  };
}

export async function listGenerations(simulationId: string): Promise<GenerationDTO[]> {
  const rows = await prisma.generation.findMany({
    where: { simulationId },
    orderBy: { number: 'asc' },
  });
  return rows.map(toGenerationDTO);
}

export async function listEvents(
  simulationId: string,
  options: { limit?: number; afterSeq?: number; types?: string[] } = {},
): Promise<EventDTO[]> {
  const rows = await prisma.simulationEvent.findMany({
    where: {
      simulationId,
      ...(options.afterSeq !== undefined ? { seq: { gt: options.afterSeq } } : {}),
      ...(options.types?.length ? { type: { in: options.types as never[] } } : {}),
    },
    orderBy: { seq: options.afterSeq !== undefined ? 'asc' : 'desc' },
    take: options.limit ?? 60,
  });
  const events = rows.map(toEventDTO);
  return options.afterSeq !== undefined ? events : events.reverse();
}

export type LeaderboardCategory =
  | 'MOST_PROFITABLE'
  | 'HIGHEST_CAPITAL'
  | 'LONGEST_SURVIVAL'
  | 'MOST_CLONES'
  | 'BEST_ROI';

export interface LeaderboardEntry extends AgentDTO {
  metric: number;
  metricLabel: string;
}

export async function getLeaderboard(
  simulationId: string | null,
  category: LeaderboardCategory,
  options: { generation?: number; limit?: number } = {},
): Promise<LeaderboardEntry[]> {
  const where = {
    ...(simulationId ? { simulationId } : {}),
    ...(options.generation !== undefined ? { generation: options.generation } : {}),
  };

  // Over-fetch on derived metrics so the in-memory sort sees the real top N.
  const take = options.limit ?? 25;
  const rows = await prisma.agent.findMany({
    where,
    orderBy:
      category === 'HIGHEST_CAPITAL'
        ? { peakCapitalLamports: 'desc' }
        : category === 'LONGEST_SURVIVAL'
          ? { cycles: 'desc' }
          : category === 'MOST_CLONES'
            ? { clonesCreated: 'desc' }
            : { capitalLamports: 'desc' },
    take: category === 'MOST_PROFITABLE' || category === 'BEST_ROI' ? 400 : take,
    select: AGENT_SELECT,
  });

  const simulation = simulationId
    ? await prisma.simulation.findUnique({
        where: { id: simulationId },
        select: { cycle: true },
      })
    : null;
  const cycle = simulation?.cycle ?? 0;

  const dtos = rows.map((row) => toAgentDTO(row, cycle));

  const withMetric: LeaderboardEntry[] = dtos.map((agent) => {
    switch (category) {
      case 'MOST_PROFITABLE':
        return { ...agent, metric: agent.totalProfitSol, metricLabel: 'PROFIT' };
      case 'HIGHEST_CAPITAL':
        return { ...agent, metric: agent.peakCapitalSol, metricLabel: 'PEAK CAPITAL' };
      case 'LONGEST_SURVIVAL':
        return { ...agent, metric: agent.cycles, metricLabel: 'CYCLES' };
      case 'MOST_CLONES':
        return { ...agent, metric: agent.clonesCreated, metricLabel: 'CLONES' };
      case 'BEST_ROI':
        return { ...agent, metric: agent.roi, metricLabel: 'ROI' };
    }
  });

  return withMetric.sort((a, b) => b.metric - a.metric).slice(0, take);
}

export interface TreeNode {
  id: string;
  code: string;
  generation: number;
  status: string;
  capitalSol: number;
  profitSol: number;
  strategy: string;
  children: TreeNode[];
}

/** Builds the full lineage forest for a simulation in one query. */
export async function getFamilyTree(simulationId: string): Promise<TreeNode[]> {
  const rows = await prisma.agent.findMany({
    where: { simulationId },
    orderBy: { code: 'asc' },
    select: {
      id: true,
      code: true,
      generation: true,
      status: true,
      parentId: true,
      strategy: true,
      capitalLamports: true,
      startingCapitalLamports: true,
    },
  });

  const nodes = new Map<string, TreeNode>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      code: row.code,
      generation: row.generation,
      status: row.status,
      capitalSol: lamportsToSol(row.capitalLamports),
      profitSol: lamportsToSol(row.capitalLamports) - lamportsToSol(row.startingCapitalLamports),
      strategy: row.strategy,
      children: [],
    });
  }

  const roots: TreeNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    const parent = row.parentId ? nodes.get(row.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function getSimulationConfig(simulationId: string) {
  const row = await prisma.simulation.findUnique({
    where: { id: simulationId },
    select: { config: true },
  });
  return resolveConfig(row?.config);
}

// ---------------------------------------------------------------------------
// Core visualisation feed
// ---------------------------------------------------------------------------

/**
 * A compact population snapshot for the Core visualisation.
 *
 * Deliberately terse: this rides on the status poll, so it is fetched as often
 * as once a second. Short keys and a hard cap keep the payload small, and
 * because it is a full snapshot rather than a diff the visualisation
 * self-heals if a client misses events at high playback speeds.
 */
export interface CoreNode {
  /** id */ i: string;
  /** code */ c: string;
  /** generation */ g: number;
  /** alive (1) or dead (0) */ a: 0 | 1;
  /** capital, SOL */ k: number;
  /** parent id */ p: string | null;
}

export async function getCorePopulation(
  simulationId: string,
  limit = 260,
): Promise<CoreNode[]> {
  const rows = await prisma.agent.findMany({
    where: { simulationId },
    // Living agents first, then the most recently deceased: a long run's
    // ancient dead are not worth the bytes.
    orderBy: [{ status: 'asc' }, { bornAtCycle: 'desc' }],
    take: limit,
    select: {
      id: true,
      code: true,
      generation: true,
      status: true,
      parentId: true,
      capitalLamports: true,
    },
  });

  return rows.map((row) => ({
    i: row.id,
    c: row.code,
    g: row.generation,
    a: row.status === 'ALIVE' ? 1 : 0,
    k: Math.round(lamportsToSol(row.capitalLamports) * 1000) / 1000,
    p: row.parentId,
  }));
}
