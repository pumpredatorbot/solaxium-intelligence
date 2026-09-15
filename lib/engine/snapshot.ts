/**
 * The agent's view of the world.
 *
 * This is the *only* object an AI brain ever receives. It contains no database
 * handle, no environment variable, no key, no file path and no simulation
 * internals — see docs/SECURITY.md. Anything not on this type is, by
 * construction, invisible to an agent.
 */

import type { ActionType, ActionOutcome, RiskLevel, MemoryKind } from '@/lib/types';
import type { TraitVector } from './traits';

export interface MarketConditions {
  /** Revenue multiplier applied to every action this cycle (≈0.75 .. 1.25). */
  multiplier: number;
  /** Human label derived from the multiplier. */
  label: 'RECESSION' | 'SLOWDOWN' | 'STABLE' | 'GROWTH' | 'BOOM';
  cycle: number;
}

export interface MemoryEntry {
  kind: MemoryKind;
  content: string;
  importance: number;
  cycle: number;
}

export interface ActionHistoryEntry {
  cycle: number;
  type: ActionType;
  outcome: ActionOutcome;
  costSol: number;
  revenueSol: number;
  netSol: number;
}

export interface AvailableAction {
  type: ActionType;
  label: string;
  description: string;
  estimatedCostSol: { min: number; max: number };
  potentialRevenueSol: { min: number; max: number };
  risk: RiskLevel;
  /** False when the agent cannot currently afford the action's maximum cost. */
  affordable: boolean;
}

export interface AgentSnapshot {
  code: string;
  name: string;
  generation: number;
  parentCode: string | null;
  strategy: string;
  cycles: number;
  clonesCreated: number;
  maxClones: number;

  capitalSol: number;
  startingCapitalSol: number;
  totalRevenueSol: number;
  totalExpensesSol: number;
  totalProfitSol: number;
  roi: number;

  cloneThresholdSol: number;
  deathThresholdSol: number;
  cycleCostSol: number;
  /** Cycles of runway left at the current burn rate, if it earns nothing. */
  runwayCycles: number;

  traits: TraitVector;
  market: MarketConditions;
  /** Revenue multiplier accumulated from MARKETING / RESEARCH / CREATE_PRODUCT. */
  momentum: number;

  memory: MemoryEntry[];
  recentActions: ActionHistoryEntry[];
  availableActions: AvailableAction[];
}

/** A brain's proposal. The engine validates it before anything is executed. */
export interface AgentDecision {
  action: ActionType;
  reasoning: string;
  riskLevel: RiskLevel;
  /** 0..1 self-reported confidence. Recorded, never trusted. */
  confidence: number;
}
