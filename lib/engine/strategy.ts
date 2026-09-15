/**
 * Strategy labels are a readable summary of a trait vector: they let the UI and
 * the leaderboard talk about *what kind of agent* this is without dumping eight
 * floats, and they give the family tree something legible to inherit.
 */

import type { StrategyLabel } from '@/config/simulation';
import type { TraitVector } from './traits';

export function deriveStrategy(traits: TraitVector): StrategyLabel {
  // Strategies score on how far a trait sits from neutral, not on its absolute
  // value — otherwise a perfectly average genome would still "look like" the
  // strategy whose formula happens to have the largest coefficients.
  const d = (key: keyof TraitVector) => traits[key] - 0.5;

  const scores: Record<Exclude<StrategyLabel, 'BALANCED'>, number> = {
    SERVICE_GRINDER: d('patience') * 0.6 + d('salesFocus') * 0.5 - d('riskTolerance') * 0.3,
    PRODUCT_BUILDER: d('innovation') * 0.8 + d('patience') * 0.3,
    GROWTH_HUNTER: d('riskTolerance') * 0.7 + d('aggressiveness') * 0.6,
    CONSERVATIVE: d('savingBehavior') * 0.8 - d('riskTolerance') * 0.4,
    MARKET_PUSHER: d('marketingFocus') * 0.85 + d('aggressiveness') * 0.3,
    RESEARCHER: d('researchFocus') * 0.85 + d('patience') * 0.3,
  };

  // Below this, no instinct is pronounced enough to name.
  const BALANCED_THRESHOLD = 0.06;

  let best: StrategyLabel = 'BALANCED';
  let bestScore = BALANCED_THRESHOLD;
  for (const [label, score] of Object.entries(scores) as [StrategyLabel, number][]) {
    if (score > bestScore) {
      bestScore = score;
      best = label;
    }
  }
  return best;
}

export const STRATEGY_DESCRIPTIONS: Record<StrategyLabel, string> = {
  BALANCED: 'No dominant instinct. Reads the situation, takes what the market offers.',
  SERVICE_GRINDER: 'Trades time for SOL. Low ceiling, low variance, hard to kill.',
  PRODUCT_BUILDER: 'Spends early to build, then harvests. Fragile in the first cycles.',
  GROWTH_HUNTER: 'Deploys capital aggressively. Reaches the clone threshold fastest, dies fastest.',
  CONSERVATIVE: 'Hoards. Survives recessions that wipe out its siblings, rarely reproduces.',
  MARKET_PUSHER: 'Buys attention, then converts it. Momentum-dependent.',
  RESEARCHER: 'Compounds small edges. Slow, quietly durable.',
};
