/**
 * AI provider contract.
 *
 * The simulation engine talks to this interface and nothing else, so swapping
 * DEMO for CLAUDE (or anything else later) never touches engine code.
 *
 * A provider PROPOSES. It never executes, never writes to the database and
 * never sees anything beyond the AgentSnapshot it is handed.
 */

import type { AgentDecision, AgentSnapshot } from '@/lib/engine/snapshot';
import type { SeededRandom } from '@/lib/rng';

export type ProviderName = 'demo' | 'claude';

export interface DecisionRequest {
  snapshot: AgentSnapshot;
  /**
   * The simulation's seeded RNG. Deterministic providers must draw from it;
   * a network-backed provider may ignore it (and forfeits reproducibility,
   * which is why DEMO is the default).
   */
  rng: SeededRandom;
}

export interface AIProvider {
  readonly name: ProviderName;
  /** True when the provider can run right now (key present, etc.). */
  isAvailable(): boolean;
  decide(request: DecisionRequest): Promise<AgentDecision>;
}
