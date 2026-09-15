import { describe, expect, it } from 'vitest';
import { ACTION_DEFINITIONS, DEFAULT_SIMULATION_CONFIG } from '@/config/simulation';
import { createRng } from '@/lib/rng';
import { DemoProvider, scoreAction } from '@/lib/ai/demo';
import { buildUserPrompt, parseDecision } from '@/lib/ai/claude';
import { resolveProviderName, think } from '@/lib/ai/agent-brain';
import { founderTraits } from '@/lib/engine/traits';
import { marketAt, resolveAction, traitAlignment } from '@/lib/engine/actions';
import type { AgentSnapshot } from '@/lib/engine/snapshot';
import { ACTION_TYPES, type ActionType } from '@/lib/types';

const CONFIG = DEFAULT_SIMULATION_CONFIG;

function snapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    code: 'SX-001',
    name: 'Test Agent',
    generation: 0,
    parentCode: null,
    strategy: 'BALANCED',
    cycles: 5,
    clonesCreated: 0,
    maxClones: 3,
    capitalSol: 2,
    startingCapitalSol: 1,
    totalRevenueSol: 3,
    totalExpensesSol: 2,
    totalProfitSol: 1,
    roi: 1,
    cloneThresholdSol: 5,
    deathThresholdSol: 0,
    cycleCostSol: 0.15,
    runwayCycles: 13.3,
    traits: founderTraits(),
    market: marketAt(1, CONFIG),
    momentum: 1,
    memory: [],
    recentActions: [],
    availableActions: Object.values(ACTION_DEFINITIONS).map((def) => ({
      type: def.type,
      label: def.label,
      description: def.description,
      estimatedCostSol: def.cost,
      potentialRevenueSol: def.potentialRevenue,
      risk: def.risk,
      affordable: true,
    })),
    ...overrides,
  };
}

describe('DEMO brain', () => {
  it('always proposes an action from the allowlist', async () => {
    const provider = new DemoProvider();
    const rng = createRng('demo-1');
    for (let i = 0; i < 200; i++) {
      const decision = await provider.decide({ snapshot: snapshot(), rng });
      expect(ACTION_TYPES).toContain(decision.action);
      expect(decision.confidence).toBeGreaterThan(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
      expect(decision.reasoning.length).toBeGreaterThan(10);
    }
  });

  it('never proposes an action that is not available', async () => {
    const provider = new DemoProvider();
    const rng = createRng('demo-2');
    const restrictive = snapshot({
      availableActions: [
        {
          type: 'REST',
          label: 'Rest',
          description: '',
          estimatedCostSol: { min: 0, max: 0 },
          potentialRevenueSol: { min: 0, max: 0 },
          risk: 'LOW',
          affordable: true,
        },
      ],
    });
    for (let i = 0; i < 50; i++) {
      expect((await provider.decide({ snapshot: restrictive, rng })).action).toBe('REST');
    }
  });

  it('is deterministic for a given seed', async () => {
    const provider = new DemoProvider();
    const a = await provider.decide({ snapshot: snapshot(), rng: createRng('same') });
    const b = await provider.decide({ snapshot: snapshot(), rng: createRng('same') });
    expect(a).toEqual(b);
  });

  it('collapses onto cheap, safe actions when the runway is short', () => {
    const desperate = snapshot({ capitalSol: 0.2, runwayCycles: 1.3 });
    const comfortable = snapshot({ capitalSol: 12, runwayCycles: 80 });

    // The expensive, high-variance move must lose ground when death is near.
    const riskyWhenDesperate = scoreAction('INVEST_IN_GROWTH', desperate);
    const riskyWhenSafe = scoreAction('INVEST_IN_GROWTH', comfortable);
    expect(riskyWhenDesperate).toBeLessThan(riskyWhenSafe);

    // …and the cheap, reliable move must gain it.
    expect(scoreAction('OFFER_SERVICE', desperate)).toBeGreaterThan(
      scoreAction('INVEST_IN_GROWTH', desperate),
    );
  });

  it('lets the genome change what the agent prefers', () => {
    const risky = snapshot({
      traits: { ...founderTraits(), riskTolerance: 0.95, aggressiveness: 0.95 },
      runwayCycles: 40,
      capitalSol: 8,
    });
    const cautious = snapshot({
      traits: { ...founderTraits(), riskTolerance: 0.05, savingBehavior: 0.95 },
      runwayCycles: 40,
      capitalSol: 8,
    });

    expect(scoreAction('INVEST_IN_GROWTH', risky)).toBeGreaterThan(
      scoreAction('INVEST_IN_GROWTH', cautious),
    );
    expect(scoreAction('SAVE', cautious)).toBeGreaterThan(scoreAction('SAVE', risky));
  });

  it('learns from what has actually paid', () => {
    const withWins = snapshot({
      recentActions: Array.from({ length: 4 }, (_, i) => ({
        cycle: i,
        type: 'OFFER_SERVICE' as const,
        outcome: 'SUCCESS' as const,
        costSol: 0.03,
        revenueSol: 0.6,
        netSol: 0.57,
      })),
    });
    const withLosses = snapshot({
      recentActions: Array.from({ length: 4 }, (_, i) => ({
        cycle: i,
        type: 'OFFER_SERVICE' as const,
        outcome: 'FAILURE' as const,
        costSol: 0.05,
        revenueSol: 0,
        netSol: -0.05,
      })),
    });

    expect(scoreAction('OFFER_SERVICE', withWins)).toBeGreaterThan(
      scoreAction('OFFER_SERVICE', withLosses),
    );
  });

  it('penalises repeating the same action forever', () => {
    const rut = snapshot({
      recentActions: Array.from({ length: 6 }, (_, i) => ({
        cycle: i,
        type: 'REST' as const,
        outcome: 'SUCCESS' as const,
        costSol: 0,
        revenueSol: 0,
        netSol: 0,
      })),
    });
    expect(scoreAction('REST', rut)).toBeLessThan(scoreAction('REST', snapshot()));
  });
});

describe('agent brain', () => {
  it('falls back to the demo provider when Claude is not configured', () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(resolveProviderName('claude')).toBe('demo');
    if (previous) process.env.ANTHROPIC_API_KEY = previous;
  });

  it('reports which provider made the decision', async () => {
    const result = await think(snapshot(), createRng('brain-1'));
    expect(result.provider).toBe('demo');
  });

  it('replaces an out-of-allowlist proposal with REST', async () => {
    const restricted = snapshot({
      availableActions: [
        {
          type: 'REST',
          label: 'Rest',
          description: '',
          estimatedCostSol: { min: 0, max: 0 },
          potentialRevenueSol: { min: 0, max: 0 },
          risk: 'LOW',
          affordable: true,
        },
      ],
    });
    const result = await think(restricted, createRng('brain-2'));
    expect(result.action).toBe('REST');
  });
});

describe('Claude provider parsing', () => {
  const allowed: ActionType[] = ['OFFER_SERVICE', 'REST'];

  it('parses a clean JSON decision', () => {
    const decision = parseDecision(
      '{"action":"OFFER_SERVICE","reasoning":"Cheap and reliable.","riskLevel":"LOW","confidence":0.82}',
      allowed,
    );
    expect(decision).toEqual({
      action: 'OFFER_SERVICE',
      reasoning: 'Cheap and reliable.',
      riskLevel: 'LOW',
      confidence: 0.82,
    });
  });

  it('extracts JSON from surrounding prose', () => {
    const decision = parseDecision(
      'Let me think.\n```json\n{"action":"REST","reasoning":"Conserving.","riskLevel":"LOW","confidence":0.4}\n```\nDone.',
      allowed,
    );
    expect(decision?.action).toBe('REST');
  });

  it('rejects an action outside the allowlist', () => {
    expect(parseDecision('{"action":"INVEST_IN_GROWTH"}', allowed)).toBeNull();
  });

  it('rejects an unknown action', () => {
    expect(parseDecision('{"action":"DRAIN_TREASURY"}', allowed)).toBeNull();
  });

  it('rejects unparseable output', () => {
    expect(parseDecision('I refuse to answer in JSON.', allowed)).toBeNull();
    expect(parseDecision('{not json}', allowed)).toBeNull();
    expect(parseDecision('', allowed)).toBeNull();
  });

  it('repairs missing or out-of-range fields', () => {
    const decision = parseDecision('{"action":"REST","confidence":5}', allowed);
    expect(decision?.confidence).toBe(1);
    expect(decision?.riskLevel).toBe(ACTION_DEFINITIONS.REST.risk);
    expect(decision?.reasoning).toBe('No reasoning provided.');
  });

  it('builds a prompt from the snapshot and nothing else', () => {
    process.env.SOLAXIUM_TEST_SECRET = 'super-secret-value';
    const prompt = buildUserPrompt(snapshot());

    expect(prompt).toContain('SX-001');
    expect(prompt).toContain('capital');
    expect(prompt).toContain('AVAILABLE ACTIONS');
    // Nothing from the environment may reach an agent.
    expect(prompt).not.toContain('super-secret-value');
    expect(prompt).not.toContain('DATABASE_URL');
    expect(prompt).not.toContain('ANTHROPIC_API_KEY');
    expect(prompt).not.toContain('postgresql://');
    delete process.env.SOLAXIUM_TEST_SECRET;
  });
});

describe('action resolution', () => {
  it('never produces negative revenue or a cost above capital', () => {
    const rng = createRng('resolve-1');
    for (let i = 0; i < 500; i++) {
      const type = ACTION_TYPES[i % ACTION_TYPES.length];
      const capital = 5_000_000; // 0.005 SOL — deliberately tight
      const resolved = resolveAction(type, {
        traits: founderTraits(),
        capitalLamports: capital,
        market: marketAt(i, CONFIG),
        momentum: 1,
        config: CONFIG,
        rng,
      });
      expect(resolved.revenueLamports).toBeGreaterThanOrEqual(0);
      expect(resolved.costLamports).toBeGreaterThanOrEqual(0);
      expect(resolved.costLamports).toBeLessThanOrEqual(capital);
      expect(resolved.netLamports).toBe(resolved.revenueLamports - resolved.costLamports);
      expect(['SUCCESS', 'PARTIAL', 'FAILURE']).toContain(resolved.outcome);
    }
  });

  it('pays a well-aligned genome more than a misaligned one', () => {
    const sample = (traits: ReturnType<typeof founderTraits>) => {
      const rng = createRng('alignment');
      let total = 0;
      for (let i = 0; i < 400; i++) {
        total += resolveAction('INVEST_IN_GROWTH', {
          traits,
          capitalLamports: 10_000_000_000,
          market: marketAt(0, CONFIG),
          momentum: 1,
          config: CONFIG,
          rng,
        }).revenueLamports;
      }
      return total;
    };

    const aligned = sample({ ...founderTraits(), riskTolerance: 1, aggressiveness: 1 });
    const misaligned = sample({ ...founderTraits(), riskTolerance: 0, aggressiveness: 0 });
    expect(aligned).toBeGreaterThan(misaligned * 1.5);
  });

  it('scales trait alignment into 0.5..1.5', () => {
    const def = ACTION_DEFINITIONS.INVEST_IN_GROWTH;
    expect(
      traitAlignment(def, { ...founderTraits(), riskTolerance: 0, aggressiveness: 0 }),
    ).toBeCloseTo(0.5, 5);
    expect(
      traitAlignment(def, { ...founderTraits(), riskTolerance: 1, aggressiveness: 1 }),
    ).toBeCloseTo(1.5, 5);
    expect(traitAlignment(def, founderTraits())).toBeCloseTo(1, 5);
  });

  it('keeps REST free', () => {
    const resolved = resolveAction('REST', {
      traits: founderTraits(),
      capitalLamports: 1_000_000_000,
      market: marketAt(0, CONFIG),
      momentum: 1,
      config: CONFIG,
      rng: createRng('rest'),
    });
    expect(resolved.costLamports).toBe(0);
    expect(resolved.revenueLamports).toBe(0);
  });
});
