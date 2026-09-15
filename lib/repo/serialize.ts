/**
 * Prisma rows -> API/UI DTOs.
 *
 * Two jobs: turn BigInt lamports into SOL numbers (BigInt is not JSON
 * serialisable and React cannot render it), and make sure nothing internal
 * leaks into a response.
 */

import { lamportsToSol } from '@/lib/sol';
import type { AgentStatus, ActionType, ActionOutcome, EventType, RiskLevel } from '@/lib/types';

export interface AgentDTO {
  id: string;
  code: string;
  name: string;
  generation: number;
  parentId: string | null;
  status: AgentStatus;
  capitalSol: number;
  startingCapitalSol: number;
  peakCapitalSol: number;
  totalRevenueSol: number;
  totalExpensesSol: number;
  totalProfitSol: number;
  roi: number;
  cycles: number;
  bornAtCycle: number;
  diedAtCycle: number | null;
  lifetimeCycles: number;
  clonesCreated: number;
  strategy: string;
  momentum: number;
  createdAt: string;
  diedAt: string | null;
}

interface AgentRow {
  id: string;
  code: string;
  name: string;
  generation: number;
  parentId: string | null;
  status: string;
  capitalLamports: bigint;
  startingCapitalLamports: bigint;
  peakCapitalLamports: bigint;
  totalRevenueLamports: bigint;
  totalExpensesLamports: bigint;
  cycles: number;
  bornAtCycle: number;
  diedAtCycle: number | null;
  clonesCreated: number;
  strategy: string;
  momentum: number;
  createdAt: Date;
  diedAt: Date | null;
}

export function toAgentDTO(row: AgentRow, currentCycle?: number): AgentDTO {
  const capitalSol = lamportsToSol(row.capitalLamports);
  const startingCapitalSol = lamportsToSol(row.startingCapitalLamports);
  const profit = capitalSol - startingCapitalSol;
  const endCycle = row.diedAtCycle ?? currentCycle ?? row.bornAtCycle + row.cycles;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    generation: row.generation,
    parentId: row.parentId,
    status: row.status as AgentStatus,
    capitalSol,
    startingCapitalSol,
    peakCapitalSol: lamportsToSol(row.peakCapitalLamports),
    totalRevenueSol: lamportsToSol(row.totalRevenueLamports),
    totalExpensesSol: lamportsToSol(row.totalExpensesLamports),
    totalProfitSol: profit,
    roi: startingCapitalSol > 0 ? profit / startingCapitalSol : 0,
    cycles: row.cycles,
    bornAtCycle: row.bornAtCycle,
    diedAtCycle: row.diedAtCycle,
    lifetimeCycles: Math.max(0, endCycle - row.bornAtCycle),
    clonesCreated: row.clonesCreated,
    strategy: row.strategy,
    momentum: row.momentum,
    createdAt: row.createdAt.toISOString(),
    diedAt: row.diedAt ? row.diedAt.toISOString() : null,
  };
}

export interface EventDTO {
  seq: number;
  type: EventType;
  cycle: number;
  agentId: string | null;
  agentCode: string | null;
  message: string;
  data: unknown;
  createdAt: string;
}

export function toEventDTO(row: {
  seq: number;
  type: string;
  cycle: number;
  agentId: string | null;
  agentCode: string | null;
  message: string;
  data: unknown;
  createdAt: Date;
}): EventDTO {
  return {
    seq: row.seq,
    type: row.type as EventType,
    cycle: row.cycle,
    agentId: row.agentId,
    agentCode: row.agentCode,
    message: row.message,
    data: row.data ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ActionDTO {
  id: string;
  cycle: number;
  type: ActionType;
  outcome: ActionOutcome;
  riskLevel: RiskLevel;
  costSol: number;
  revenueSol: number;
  netSol: number;
  confidence: number;
  reasoning: string;
  provider: string;
  createdAt: string;
}

export function toActionDTO(row: {
  id: string;
  cycle: number;
  type: string;
  outcome: string;
  riskLevel: string;
  costLamports: bigint;
  revenueLamports: bigint;
  netLamports: bigint;
  confidence: number;
  reasoning: string;
  provider: string;
  createdAt: Date;
}): ActionDTO {
  return {
    id: row.id,
    cycle: row.cycle,
    type: row.type as ActionType,
    outcome: row.outcome as ActionOutcome,
    riskLevel: row.riskLevel as RiskLevel,
    costSol: lamportsToSol(row.costLamports),
    revenueSol: lamportsToSol(row.revenueLamports),
    netSol: lamportsToSol(row.netLamports),
    confidence: row.confidence,
    reasoning: row.reasoning,
    provider: row.provider,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface TransactionDTO {
  id: string;
  type: string;
  amountSol: number;
  balanceBeforeSol: number;
  balanceAfterSol: number;
  cycle: number;
  metadata: unknown;
  createdAt: string;
}

export function toTransactionDTO(row: {
  id: string;
  type: string;
  amountLamports: bigint;
  balanceBeforeLamports: bigint;
  balanceAfterLamports: bigint;
  cycle: number;
  metadata: unknown;
  createdAt: Date;
}): TransactionDTO {
  return {
    id: row.id,
    type: row.type,
    amountSol: lamportsToSol(row.amountLamports),
    balanceBeforeSol: lamportsToSol(row.balanceBeforeLamports),
    balanceAfterSol: lamportsToSol(row.balanceAfterLamports),
    cycle: row.cycle,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface GenerationDTO {
  number: number;
  agentCount: number;
  aliveCount: number;
  deadCount: number;
  survivalRate: number;
  totalCapitalSol: number;
  totalRevenueSol: number;
  totalExpensesSol: number;
  averageCapitalSol: number;
  averageProfitSol: number;
  bestAgentId: string | null;
  bestAgentCode: string | null;
  startedAtCycle: number;
  endedAtCycle: number | null;
}

export function toGenerationDTO(row: {
  number: number;
  agentCount: number;
  aliveCount: number;
  deadCount: number;
  totalCapitalLamports: bigint;
  totalRevenueLamports: bigint;
  totalExpensesLamports: bigint;
  averageCapitalLamports: bigint;
  averageProfitLamports: bigint;
  bestAgentId: string | null;
  bestAgentCode: string | null;
  startedAtCycle: number;
  endedAtCycle: number | null;
}): GenerationDTO {
  return {
    number: row.number,
    agentCount: row.agentCount,
    aliveCount: row.aliveCount,
    deadCount: row.deadCount,
    survivalRate: row.agentCount > 0 ? row.aliveCount / row.agentCount : 0,
    totalCapitalSol: lamportsToSol(row.totalCapitalLamports),
    totalRevenueSol: lamportsToSol(row.totalRevenueLamports),
    totalExpensesSol: lamportsToSol(row.totalExpensesLamports),
    averageCapitalSol: lamportsToSol(row.averageCapitalLamports),
    averageProfitSol: lamportsToSol(row.averageProfitLamports),
    bestAgentId: row.bestAgentId,
    bestAgentCode: row.bestAgentCode,
    startedAtCycle: row.startedAtCycle,
    endedAtCycle: row.endedAtCycle,
  };
}
