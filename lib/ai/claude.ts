/**
 * CLAUDE brain — server-side only.
 *
 * Security properties this file is responsible for (docs/SECURITY.md):
 *   - ANTHROPIC_API_KEY is read from process.env here and nowhere else, and
 *     this module is never imported from a client component.
 *   - The prompt is built exclusively from the AgentSnapshot. No environment,
 *     no credentials, no database handle, no source, no system rules.
 *   - The response is parsed and validated against the action allowlist. An
 *     unparseable or out-of-allowlist reply falls back to the DEMO brain
 *     rather than failing the cycle — the model can never stall the economy.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ACTION_DEFINITIONS } from '@/config/simulation';
import { ACTION_TYPES, type ActionType, type RiskLevel } from '@/lib/types';
import type { AgentDecision, AgentSnapshot } from '@/lib/engine/snapshot';
import type { AIProvider, DecisionRequest } from './provider';
import { DemoProvider } from './demo';

const SYSTEM_PROMPT = `You are the decision core of an autonomous economic agent inside SOLAXIUM INTELLIGENCE, a simulated Solana economy.

You must generate more SOL than you burn. If your capital reaches 0 you die permanently. If you reach the clone threshold you may reproduce and pass your traits on.

Rules:
- Choose exactly ONE action from the provided list of available actions.
- You may only propose. A simulation engine validates and executes; you never touch money, storage or systems directly.
- Reason from the numbers you are given: capital, runway, market conditions, your traits, and what has actually worked for you before.
- Respond with a single JSON object and nothing else.

Response format:
{"action":"<ACTION_TYPE>","reasoning":"<one or two sentences>","riskLevel":"LOW|MEDIUM|HIGH","confidence":<0..1>}`;

export function buildUserPrompt(snapshot: AgentSnapshot): string {
  const lines: string[] = [];

  lines.push(`AGENT ${snapshot.code} — ${snapshot.name}`);
  lines.push(`Generation ${snapshot.generation}, parent ${snapshot.parentCode ?? 'ORIGIN'}`);
  lines.push(`Strategy: ${snapshot.strategy}`);
  lines.push('');
  lines.push('ECONOMY (SOL)');
  lines.push(`  capital            ${snapshot.capitalSol.toFixed(4)}`);
  lines.push(`  starting capital   ${snapshot.startingCapitalSol.toFixed(4)}`);
  lines.push(`  total revenue      ${snapshot.totalRevenueSol.toFixed(4)}`);
  lines.push(`  total expenses     ${snapshot.totalExpensesSol.toFixed(4)}`);
  lines.push(`  profit             ${snapshot.totalProfitSol.toFixed(4)}`);
  lines.push(`  roi                ${(snapshot.roi * 100).toFixed(1)}%`);
  lines.push(`  cycle upkeep       ${snapshot.cycleCostSol.toFixed(4)}`);
  lines.push(`  runway             ${snapshot.runwayCycles.toFixed(1)} cycles`);
  lines.push(`  death at           ${snapshot.deathThresholdSol.toFixed(4)}`);
  lines.push(`  clone threshold    ${snapshot.cloneThresholdSol.toFixed(4)}`);
  lines.push(`  clones             ${snapshot.clonesCreated}/${snapshot.maxClones}`);
  lines.push(`  cycles lived       ${snapshot.cycles}`);
  lines.push('');
  lines.push(`MARKET: ${snapshot.market.label} (revenue x${snapshot.market.multiplier.toFixed(2)})`);
  lines.push(`MOMENTUM: x${snapshot.momentum.toFixed(2)}`);
  lines.push('');
  lines.push('TRAITS (0..1)');
  for (const [key, value] of Object.entries(snapshot.traits)) {
    lines.push(`  ${key.padEnd(16)} ${value.toFixed(2)}`);
  }

  if (snapshot.memory.length > 0) {
    lines.push('');
    lines.push('MEMORY');
    for (const m of snapshot.memory) {
      lines.push(`  [${m.kind}] c${m.cycle}: ${m.content}`);
    }
  }

  if (snapshot.recentActions.length > 0) {
    lines.push('');
    lines.push('RECENT ACTIONS');
    for (const a of snapshot.recentActions) {
      lines.push(
        `  c${a.cycle} ${a.type} ${a.outcome} cost ${a.costSol.toFixed(3)} revenue ${a.revenueSol.toFixed(3)} net ${a.netSol >= 0 ? '+' : ''}${a.netSol.toFixed(3)}`,
      );
    }
  }

  lines.push('');
  lines.push('AVAILABLE ACTIONS');
  for (const a of snapshot.availableActions) {
    lines.push(
      `  ${a.type} — ${a.description} cost ${a.estimatedCostSol.min}-${a.estimatedCostSol.max} SOL, revenue 0-${a.potentialRevenueSol.max} SOL, risk ${a.risk}${a.affordable ? '' : ' (TIGHT: you may not afford the high end)'}`,
    );
  }

  lines.push('');
  lines.push('Choose one action. Respond with JSON only.');

  return lines.join('\n');
}

/** Extracts the first JSON object in a model response. */
export function parseDecision(
  raw: string,
  allowed: ActionType[],
): AgentDecision | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  const action = typeof obj.action === 'string' ? obj.action.trim().toUpperCase() : '';
  if (!ACTION_TYPES.includes(action as ActionType)) return null;
  if (!allowed.includes(action as ActionType)) return null;

  const riskRaw = typeof obj.riskLevel === 'string' ? obj.riskLevel.toUpperCase() : '';
  const riskLevel: RiskLevel = ['LOW', 'MEDIUM', 'HIGH'].includes(riskRaw)
    ? (riskRaw as RiskLevel)
    : ACTION_DEFINITIONS[action as ActionType].risk;

  const confidenceRaw = typeof obj.confidence === 'number' ? obj.confidence : 0.5;
  const confidence = Math.min(1, Math.max(0, confidenceRaw));

  const reasoning =
    typeof obj.reasoning === 'string' && obj.reasoning.trim().length > 0
      ? obj.reasoning.trim().slice(0, 600)
      : 'No reasoning provided.';

  return { action: action as ActionType, reasoning, riskLevel, confidence };
}

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude' as const;
  private client: Anthropic | null = null;
  private readonly fallback = new DemoProvider();

  isAvailable(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  async decide(request: DecisionRequest): Promise<AgentDecision> {
    if (!this.isAvailable()) return this.fallback.decide(request);

    const allowed = request.snapshot.availableActions.map((a) => a.type);

    try {
      const response = await this.getClient().messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(request.snapshot) }],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      const decision = parseDecision(text, allowed);
      if (decision) return decision;
    } catch (error) {
      console.error('[ai/claude] decision failed, falling back to demo brain:', error);
    }

    // A degraded model call must never stall the economy.
    return this.fallback.decide(request);
  }
}
