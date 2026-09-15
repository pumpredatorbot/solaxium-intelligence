/**
 * Action resolution: turns a validated decision into money.
 *
 * Pure and deterministic given (decision, snapshot, rng). No IO, no database,
 * no clock — which is what lets the whole economy be replayed from a seed.
 */

import {
  ACTION_DEFINITIONS,
  type SimulationConfig,
  type ActionDefinition,
} from '@/config/simulation';
import type { ActionOutcome, ActionType } from '@/lib/types';
import type { SeededRandom } from '@/lib/rng';
import { solToLamports } from '@/lib/sol';
import type { TraitVector } from './traits';
import type { MarketConditions } from './snapshot';

export interface ResolvedAction {
  type: ActionType;
  outcome: ActionOutcome;
  /** Lamports, positive. */
  costLamports: number;
  /** Lamports, positive. */
  revenueLamports: number;
  /** revenue - cost. */
  netLamports: number;
  /** Multiplier added to the agent's momentum by this action. */
  momentumGain: number;
  note: string;
}

export interface ResolveContext {
  traits: TraitVector;
  capitalLamports: number;
  market: MarketConditions;
  /** Current accumulated revenue multiplier, 1 = neutral. */
  momentum: number;
  config: SimulationConfig;
  rng: SeededRandom;
}

/** How strongly an action's driving traits back it, expressed as 0.5..1.5. */
export function traitAlignment(def: ActionDefinition, traits: TraitVector): number {
  if (def.drivenBy.length === 0) return 1;
  let weighted = 0;
  let totalWeight = 0;
  for (const { trait, weight } of def.drivenBy) {
    weighted += (traits[trait] ?? 0.5) * weight;
    totalWeight += weight;
  }
  const mean = totalWeight > 0 ? weighted / totalWeight : 0.5;
  return 0.5 + mean; // 0.5 (trait=0) .. 1.5 (trait=1)
}

/** Cost is sampled first: an agent must be able to pay before it can act. */
export function sampleCostLamports(
  type: ActionType,
  config: SimulationConfig,
  rng: SeededRandom,
): number {
  const range = config.EXPENSE_RANGES[type];
  return solToLamports(rng.float(range.min, range.max));
}

export function resolveAction(type: ActionType, ctx: ResolveContext): ResolvedAction {
  const def = ACTION_DEFINITIONS[type];
  const alignment = traitAlignment(def, ctx.traits);

  const costLamports = Math.min(sampleCostLamports(type, ctx.config, ctx.rng), ctx.capitalLamports);

  // Success probability: base rate, lifted by trait alignment and the market,
  // clamped so nothing is ever a sure thing (or a sure loss). alignment is
  // 0.5..1.5, so the trait term spans 0.8x..1.2x.
  const successRate = clamp(
    def.baseSuccessRate * (0.6 + 0.4 * alignment) * (0.85 + 0.15 * ctx.market.multiplier),
    0.05,
    0.88,
  );

  const roll = ctx.rng.next();
  const outcome: ActionOutcome =
    roll < successRate ? 'SUCCESS' : roll < successRate + (1 - successRate) * 0.45 ? 'PARTIAL' : 'FAILURE';

  // Skewed draw: the top of the published range is reachable but rare.
  const revenueRange = ctx.config.REVENUE_RANGES[type];
  const roll01 = ctx.rng.next();
  const grossSol =
    revenueRange.min +
    (revenueRange.max - revenueRange.min) * Math.pow(roll01, def.revenueSkew);

  let yieldFactor: number;
  if (outcome === 'SUCCESS') yieldFactor = 1;
  else if (outcome === 'PARTIAL') yieldFactor = def.partialYield;
  else yieldFactor = 0;

  const revenueLamports = Math.max(
    0,
    Math.round(
      solToLamports(grossSol) *
        yieldFactor *
        alignment *
        ctx.market.multiplier *
        ctx.momentum *
        ctx.config.REVENUE_SCALE,
    ),
  );

  const momentumGain =
    outcome === 'FAILURE' || !def.effect?.revenueBoost
      ? 0
      : def.effect.revenueBoost * (outcome === 'PARTIAL' ? 0.5 : 1) * alignment;

  return {
    type,
    outcome,
    costLamports,
    revenueLamports,
    netLamports: revenueLamports - costLamports,
    momentumGain,
    note: buildNote(type, outcome),
  };
}

function buildNote(type: ActionType, outcome: ActionOutcome): string {
  const verb =
    outcome === 'SUCCESS' ? 'landed' : outcome === 'PARTIAL' ? 'partially landed' : 'failed';
  return `${ACTION_DEFINITIONS[type].label} ${verb}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Momentum decays back towards 1 every cycle. */
export function decayMomentum(momentum: number, config: SimulationConfig): number {
  const excess = momentum - 1;
  const decay = Object.values(ACTION_DEFINITIONS).reduce(
    (acc, d) => Math.max(acc, d.effect?.boostDecay ?? 0),
    0.1,
  );
  void config;
  return 1 + Math.max(0, excess * (1 - decay));
}

/** Market multiplier for a cycle: a smooth, seed-independent oscillation. */
export function marketAt(cycle: number, config: SimulationConfig): MarketConditions {
  const phase = (2 * Math.PI * cycle) / config.MARKET_PERIOD_CYCLES;
  const multiplier = 1 + config.MARKET_AMPLITUDE * Math.sin(phase);
  return { multiplier, label: labelFor(multiplier), cycle };
}

function labelFor(multiplier: number): MarketConditions['label'] {
  if (multiplier < 0.85) return 'RECESSION';
  if (multiplier < 0.96) return 'SLOWDOWN';
  if (multiplier <= 1.04) return 'STABLE';
  if (multiplier <= 1.15) return 'GROWTH';
  return 'BOOM';
}
