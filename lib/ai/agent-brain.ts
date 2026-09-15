/**
 * Agent brain: the single entry point the engine calls to obtain a decision.
 *
 * It owns provider selection, the sanitised snapshot contract, and the final
 * safety net — whatever happens upstream, this always returns a legal action.
 */

import type { AgentDecision, AgentSnapshot } from '@/lib/engine/snapshot';
import type { SeededRandom } from '@/lib/rng';
import { ACTION_DEFINITIONS } from '@/config/simulation';
import type { AIProvider, ProviderName } from './provider';
import { DemoProvider } from './demo';
import { ClaudeProvider } from './claude';

const providers: Record<ProviderName, AIProvider> = {
  demo: new DemoProvider(),
  claude: new ClaudeProvider(),
};

export function resolveProviderName(requested?: string): ProviderName {
  const raw = (requested ?? process.env.AI_PROVIDER ?? 'demo').toLowerCase();
  if (raw === 'claude' && providers.claude.isAvailable()) return 'claude';
  return 'demo';
}

export function getProvider(requested?: string): AIProvider {
  return providers[resolveProviderName(requested)];
}

export interface BrainResult extends AgentDecision {
  provider: ProviderName;
}

export async function think(
  snapshot: AgentSnapshot,
  rng: SeededRandom,
  requestedProvider?: string,
): Promise<BrainResult> {
  const provider = getProvider(requestedProvider);

  let decision: AgentDecision;
  try {
    decision = await provider.decide({ snapshot, rng });
  } catch (error) {
    console.error('[ai] provider threw, defaulting to REST:', error);
    decision = {
      action: 'REST',
      reasoning: 'Decision provider unavailable; defaulting to the zero-cost action.',
      riskLevel: 'LOW',
      confidence: 0,
    };
  }

  // Final validation. The engine re-validates too, but a brain should never
  // hand back something outside the allowlist in the first place.
  const allowed = new Set(snapshot.availableActions.map((a) => a.type));
  if (!allowed.has(decision.action)) {
    decision = {
      action: 'REST',
      reasoning: `Proposed action "${decision.action}" is not available this cycle.`,
      riskLevel: ACTION_DEFINITIONS.REST.risk,
      confidence: 0,
    };
  }

  return { ...decision, provider: provider.name };
}
