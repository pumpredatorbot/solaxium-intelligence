/**
 * DEMO brain — a real local decision engine, not a random number printer.
 *
 * It scores every affordable action against the agent's traits, its memory of
 * what has worked, the market, and how close it is to death or to the clone
 * threshold, then samples from the resulting distribution with the simulation's
 * seeded RNG. Two agents with different genomes reliably behave differently,
 * and a lineage that inherits good traits reliably out-earns one that does not.
 */

import { ACTION_DEFINITIONS } from '@/config/simulation';
import type { ActionType, RiskLevel } from '@/lib/types';
import type { AgentDecision, AgentSnapshot } from '@/lib/engine/snapshot';
import { traitAlignment } from '@/lib/engine/actions';
import type { AIProvider, DecisionRequest } from './provider';

const RISK_APPETITE: Record<RiskLevel, number> = { LOW: 0.2, MEDIUM: 0.5, HIGH: 0.85 };

export function scoreAction(type: ActionType, snapshot: AgentSnapshot): number {
  const def = ACTION_DEFINITIONS[type];
  const traits = snapshot.traits;

  // 1. Genome fit — the agent's traits pushing it towards this action.
  let score = traitAlignment(def, traits);

  // 2. Expected value, normalised against the agent's capital.
  const midRevenue = (def.potentialRevenue.min + def.potentialRevenue.max) / 2;
  const midCost = (def.cost.min + def.cost.max) / 2;
  const expected = (midRevenue * def.baseSuccessRate - midCost) * snapshot.market.multiplier;
  score += expected * 1.4;

  // 3. Risk appetite: an agent only takes risks it has the tolerance for.
  const appetiteGap = Math.abs(traits.riskTolerance - RISK_APPETITE[def.risk]);
  score -= appetiteGap * 1.1;

  // 4. Survival pressure. Short runway collapses the search onto cheap,
  //    reliable actions — this is what makes near-death behaviour legible.
  if (snapshot.runwayCycles < 4) {
    const desperation = (4 - snapshot.runwayCycles) / 4;
    score -= midCost * desperation * 9;
    if (def.risk === 'LOW') score += desperation * 0.9;
    if (type === 'REST') score += desperation * 0.35;
    if (type === 'SAVE') score -= desperation * 0.6;
  }

  // 5. Ambition. With runway to spare and the clone threshold in sight, push.
  const distanceToClone = snapshot.cloneThresholdSol - snapshot.capitalSol;
  if (snapshot.runwayCycles > 12 && distanceToClone > 0) {
    if (def.risk !== 'LOW') score += traits.aggressiveness * 0.5;
    if (type === 'REST') score -= 0.8;
  }

  // 6. Memory: what has actually paid for this agent, and what has not.
  score += memoryBias(type, snapshot) * 1.2;

  // 7. Anti-rut: repeating the same action every cycle is penalised so
  //    strategies diversify instead of collapsing onto one move.
  const streak = countTrailing(snapshot.recentActions.map((a) => a.type), type);
  score -= streak * 0.22;

  // 8. Cannot afford it at all.
  if (snapshot.capitalSol < def.cost.min) score -= 12;

  // 9. Product sales need products to sell.
  if (type === 'SELL_PRODUCT') {
    const built = snapshot.recentActions.filter((a) => a.type === 'CREATE_PRODUCT').length;
    score += built > 0 ? 0.55 : -0.7;
  }

  return score;
}

function memoryBias(type: ActionType, snapshot: AgentSnapshot): number {
  const relevant = snapshot.recentActions.filter((a) => a.type === type);
  if (relevant.length === 0) return 0;
  const avgNet = relevant.reduce((sum, a) => sum + a.netSol, 0) / relevant.length;
  // Scaled so a consistently +0.3 SOL action gets a meaningful, bounded lift.
  return Math.max(-1, Math.min(1, avgNet * 2.5));
}

function countTrailing(history: ActionType[], type: ActionType): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] !== type) break;
    n++;
  }
  return n;
}

export class DemoProvider implements AIProvider {
  readonly name = 'demo' as const;

  isAvailable(): boolean {
    return true;
  }

  async decide({ snapshot, rng }: DecisionRequest): Promise<AgentDecision> {
    const candidates = snapshot.availableActions.map((a) => a.type);
    const scores = candidates.map((type) => scoreAction(type, snapshot));

    // Softmax-style sampling: the best action usually wins, but not always —
    // exploration is what lets a lineage discover a strategy its parent missed.
    const temperature = 0.35 + snapshot.traits.innovation * 0.55;
    const max = Math.max(...scores);
    const weights = scores.map((s) => Math.exp((s - max) / temperature));

    const chosen = rng.weighted(candidates, weights);
    const chosenIndex = candidates.indexOf(chosen);
    const def = ACTION_DEFINITIONS[chosen];

    const total = weights.reduce((a, b) => a + b, 0);
    const confidence = clamp(total > 0 ? weights[chosenIndex] / total : 0.5, 0.05, 0.99);

    return {
      action: chosen,
      reasoning: explain(chosen, snapshot),
      riskLevel: def.risk,
      confidence: Math.round(confidence * 100) / 100,
    };
  }
}

function explain(type: ActionType, snapshot: AgentSnapshot): string {
  const def = ACTION_DEFINITIONS[type];
  const parts: string[] = [];

  if (snapshot.runwayCycles < 4) {
    parts.push(`runway is ${snapshot.runwayCycles.toFixed(1)} cycles, prioritising survival`);
  } else if (snapshot.capitalSol >= snapshot.cloneThresholdSol) {
    parts.push('clone threshold reached, consolidating capital');
  } else {
    const gap = snapshot.cloneThresholdSol - snapshot.capitalSol;
    parts.push(`${gap.toFixed(2)} SOL from the clone threshold`);
  }

  parts.push(`market is ${snapshot.market.label.toLowerCase()}`);

  const driver = def.drivenBy[0];
  if (driver) {
    parts.push(`${driver.trait} at ${(snapshot.traits[driver.trait] ?? 0.5).toFixed(2)}`);
  }

  const past = snapshot.recentActions.filter((a) => a.type === type);
  if (past.length > 0) {
    const avg = past.reduce((s, a) => s + a.netSol, 0) / past.length;
    parts.push(`${type} averaged ${avg >= 0 ? '+' : ''}${avg.toFixed(3)} SOL for me`);
  }

  return `${def.label}: ${parts.join('; ')}.`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
