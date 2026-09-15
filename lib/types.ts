/**
 * Domain types shared by the engine, the API and the UI.
 *
 * These deliberately mirror the Prisma enums but are declared independently so
 * that pure-logic modules (engine, brain, mutation) never import the database
 * client — that keeps them testable and React-free.
 */

export type SimulationStatus = 'CREATED' | 'RUNNING' | 'PAUSED' | 'STOPPED' | 'COMPLETED';

export type AgentStatus = 'ALIVE' | 'DEAD';

export type ActionType =
  | 'CREATE_PRODUCT'
  | 'SELL_PRODUCT'
  | 'OFFER_SERVICE'
  | 'MARKETING'
  | 'RESEARCH'
  | 'REST'
  | 'INVEST_IN_GROWTH'
  | 'SAVE';

export const ACTION_TYPES: ActionType[] = [
  'CREATE_PRODUCT',
  'SELL_PRODUCT',
  'OFFER_SERVICE',
  'MARKETING',
  'RESEARCH',
  'REST',
  'INVEST_IN_GROWTH',
  'SAVE',
];

export type ActionOutcome = 'SUCCESS' | 'PARTIAL' | 'FAILURE';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type TransactionType =
  | 'INITIAL_CAPITAL'
  | 'REVENUE'
  | 'EXPENSE'
  | 'CLONE_BONUS'
  | 'ADJUSTMENT';

export type EventType =
  | 'SIMULATION_CREATED'
  | 'SIMULATION_STARTED'
  | 'SIMULATION_PAUSED'
  | 'SIMULATION_STOPPED'
  | 'SIMULATION_COMPLETED'
  | 'GENERATION_STARTED'
  | 'GENERATION_ENDED'
  | 'AGENT_BORN'
  | 'AGENT_ACTION'
  | 'AGENT_REVENUE'
  | 'AGENT_EXPENSE'
  | 'AGENT_DEAD'
  | 'CLONE_CREATED';

export type MemoryKind = 'STRATEGY' | 'SUCCESS' | 'FAILURE' | 'INSIGHT' | 'MILESTONE' | 'SUMMARY';

/** An agent that has reached the clone threshold but has not yet reproduced. */
export type AgentLifecycleState = 'ALIVE' | 'ELIGIBLE_TO_CLONE' | 'DEAD';
