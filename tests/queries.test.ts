import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createSimulation, runCycle, startSimulation } from '@/lib/engine/engine';
import {
  getActiveSimulation,
  getAgentDetail,
  getDashboardStats,
  getFamilyTree,
  getLeaderboard,
  listAgents,
  listEvents,
  listGenerations,
  listSimulations,
} from '@/lib/repo/queries';
import { resetDatabase } from './helpers';

let simulationId: string;
let cycle: number;

beforeAll(async () => {
  await resetDatabase();
  const result = await createSimulation({ name: 'read model', seed: 'read-1', founderCount: 4 });
  simulationId = result.simulationId;
  await startSimulation(simulationId);
  for (let i = 0; i < 40; i++) {
    const report = await runCycle(simulationId);
    if (report.status !== 'RUNNING') break;
  }
  cycle = (await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } })).cycle;
}, 120_000);

describe('dashboard stats', () => {
  it('reports a population that actually lived and died', async () => {
    const stats = await getDashboardStats(simulationId, cycle);

    expect(stats.totalAgents).toBe(stats.liveAgents + stats.deadAgents);
    expect(stats.totalAgents).toBeGreaterThan(4); // reproduction happened
    expect(stats.generations).toBeGreaterThan(1);
    expect(stats.totalClones).toBeGreaterThan(0);
    expect(stats.survivalRate).toBeGreaterThanOrEqual(0);
    expect(stats.survivalRate).toBeLessThanOrEqual(1);
    expect(stats.bestAgent).not.toBeNull();
  });

  it('agrees with a direct count of the agent table', async () => {
    const stats = await getDashboardStats(simulationId, cycle);
    expect(stats.liveAgents).toBe(
      await prisma.agent.count({ where: { simulationId, status: 'ALIVE' } }),
    );
    expect(stats.deadAgents).toBe(
      await prisma.agent.count({ where: { simulationId, status: 'DEAD' } }),
    );
  });
});

describe('agent listing', () => {
  it('filters by status', async () => {
    const alive = await listAgents(simulationId, cycle, { status: 'ALIVE', limit: 500 });
    const dead = await listAgents(simulationId, cycle, { status: 'DEAD', limit: 500 });

    expect(alive.agents.every((a) => a.status === 'ALIVE')).toBe(true);
    expect(dead.agents.every((a) => a.status === 'DEAD')).toBe(true);
    expect(alive.total + dead.total).toBe(
      (await listAgents(simulationId, cycle, { limit: 500 })).total,
    );
  });

  it('filters by generation', async () => {
    const generation1 = await listAgents(simulationId, cycle, { generation: 1, limit: 500 });
    expect(generation1.agents.every((a) => a.generation === 1)).toBe(true);
  });

  it('sorts by each supported key', async () => {
    const byCapital = await listAgents(simulationId, cycle, { orderBy: 'capital', limit: 50 });
    for (let i = 1; i < byCapital.agents.length; i++) {
      expect(byCapital.agents[i - 1].capitalSol).toBeGreaterThanOrEqual(
        byCapital.agents[i].capitalSol,
      );
    }

    const byProfit = await listAgents(simulationId, cycle, { orderBy: 'profit', limit: 50 });
    for (let i = 1; i < byProfit.agents.length; i++) {
      expect(byProfit.agents[i - 1].totalProfitSol).toBeGreaterThanOrEqual(
        byProfit.agents[i].totalProfitSol,
      );
    }

    const byCode = await listAgents(simulationId, cycle, { orderBy: 'code', limit: 50 });
    expect([...byCode.agents].sort((a, b) => a.code.localeCompare(b.code))[0].code).toBe(
      byCode.agents[0].code,
    );
  });

  it('derives profit, ROI and lifetime consistently', async () => {
    const { agents } = await listAgents(simulationId, cycle, { limit: 500 });
    for (const agent of agents) {
      expect(agent.totalProfitSol).toBeCloseTo(agent.capitalSol - agent.startingCapitalSol, 9);
      expect(agent.roi).toBeCloseTo(agent.totalProfitSol / agent.startingCapitalSol, 9);
      expect(agent.lifetimeCycles).toBeGreaterThanOrEqual(0);
      if (agent.status === 'DEAD') expect(agent.diedAtCycle).not.toBeNull();
    }
  });
});

describe('leaderboard', () => {
  it('ranks by every category, descending', async () => {
    for (const category of [
      'MOST_PROFITABLE',
      'HIGHEST_CAPITAL',
      'LONGEST_SURVIVAL',
      'MOST_CLONES',
      'BEST_ROI',
    ] as const) {
      const entries = await getLeaderboard(simulationId, category, { limit: 15 });
      expect(entries.length).toBeGreaterThan(0);
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i - 1].metric).toBeGreaterThanOrEqual(entries[i].metric);
      }
      expect(entries[0].metricLabel.length).toBeGreaterThan(0);
    }
  });

  it('includes the dead — a short brilliant run still counts', async () => {
    const entries = await getLeaderboard(simulationId, 'MOST_PROFITABLE', { limit: 500 });
    const deadCount = await prisma.agent.count({ where: { simulationId, status: 'DEAD' } });
    if (deadCount > 0) {
      expect(entries.some((e) => e.status === 'DEAD')).toBe(true);
    }
  });

  it('scopes to a generation when asked', async () => {
    const entries = await getLeaderboard(simulationId, 'HIGHEST_CAPITAL', { generation: 0 });
    expect(entries.every((e) => e.generation === 0)).toBe(true);
  });

  it('spans every simulation when the scope is all-time', async () => {
    const entries = await getLeaderboard(null, 'MOST_PROFITABLE', { limit: 10 });
    expect(entries.length).toBeGreaterThan(0);
  });

  it('actually finds the top profit, not just the top of the first page', async () => {
    const entries = await getLeaderboard(simulationId, 'MOST_PROFITABLE', { limit: 1 });
    const { agents } = await listAgents(simulationId, cycle, { orderBy: 'profit', limit: 500 });
    expect(entries[0].id).toBe(agents[0].id);
  });
});

describe('graveyard', () => {
  it('returns only dead agents, with their final numbers intact', async () => {
    const { agents } = await listAgents(simulationId, cycle, {
      status: 'DEAD',
      orderBy: 'profit',
      limit: 500,
    });

    for (const agent of agents) {
      expect(agent.status).toBe('DEAD');
      expect(agent.capitalSol).toBe(0);
      expect(agent.diedAtCycle).not.toBeNull();
      expect(agent.diedAt).not.toBeNull();
      // History is preserved, not deleted.
      expect(agent.totalRevenueSol).toBeGreaterThanOrEqual(0);
      expect(agent.cycles).toBeGreaterThan(0);
      expect(agent.peakCapitalSol).toBeGreaterThan(0);
    }
  });
});

describe('generations', () => {
  it('reports cohorts in order with consistent counts', async () => {
    const generations = await listGenerations(simulationId);
    expect(generations.length).toBeGreaterThan(1);

    for (let i = 0; i < generations.length; i++) {
      expect(generations[i].number).toBe(i);
      expect(generations[i].aliveCount + generations[i].deadCount).toBe(
        generations[i].agentCount,
      );
      expect(generations[i].survivalRate).toBeCloseTo(
        generations[i].aliveCount / generations[i].agentCount,
        9,
      );
    }
  });
});

describe('family tree', () => {
  it('builds a forest containing every agent exactly once', async () => {
    const roots = await getFamilyTree(simulationId);
    const seen = new Set<string>();

    const walk = (nodes: typeof roots, depth: number) => {
      for (const node of nodes) {
        expect(seen.has(node.id)).toBe(false);
        seen.add(node.id);
        expect(node.generation).toBe(depth);
        walk(node.children, depth + 1);
      }
    };
    walk(roots, 0);

    expect(seen.size).toBe(await prisma.agent.count({ where: { simulationId } }));
    expect(roots).toHaveLength(4); // the four founders
  });
});

describe('events', () => {
  it('returns the newest page in chronological order', async () => {
    const events = await listEvents(simulationId, { limit: 30 });
    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
    }
  });

  it('returns only what is new when polling by afterSeq', async () => {
    const first = await listEvents(simulationId, { limit: 10 });
    const after = await listEvents(simulationId, { afterSeq: first.at(-1)!.seq, limit: 50 });
    expect(after.every((e) => e.seq > first.at(-1)!.seq)).toBe(true);
  });

  it('filters by event type', async () => {
    const births = await listEvents(simulationId, { types: ['AGENT_BORN'], limit: 50 });
    expect(births.length).toBeGreaterThan(0);
    expect(births.every((e) => e.type === 'AGENT_BORN')).toBe(true);
  });
});

describe('agent detail', () => {
  it('assembles the full profile of an agent', async () => {
    const { agents } = await listAgents(simulationId, cycle, { orderBy: 'capital', limit: 1 });
    const detail = await getAgentDetail(agents[0].id, cycle);

    expect(detail).not.toBeNull();
    expect(Object.keys(detail!.traits)).toHaveLength(8);
    expect(detail!.actions.length).toBeGreaterThan(0);
    expect(detail!.transactions.length).toBeGreaterThan(0);
    expect(detail!.capitalSeries.length).toBeGreaterThan(0);
    expect(detail!.wallet?.network).toBe('simulation');

    // The capital chart is the ledger, so it must end at the current balance.
    expect(detail!.capitalSeries.at(-1)!.capitalSol).toBeCloseTo(detail!.agent.capitalSol, 9);
  });

  it('returns null for an unknown agent', async () => {
    expect(await getAgentDetail('nope', cycle)).toBeNull();
  });

  it('bounds memory so it cannot grow without limit', async () => {
    const counts = await prisma.agentMemory.groupBy({
      by: ['agentId'],
      _count: true,
    });
    // MEMORY_LIMIT is 40; compaction keeps agents near it, never far above.
    for (const row of counts) {
      expect(row._count).toBeLessThanOrEqual(60);
    }
  });
});

describe('simulation selection', () => {
  it('defaults to the most recently touched simulation', async () => {
    const active = await getActiveSimulation();
    expect(active?.id).toBe(simulationId);
    expect((await getActiveSimulation(simulationId))?.id).toBe(simulationId);
    expect(await getActiveSimulation('missing')).toBeNull();
  });

  it('lists simulations newest first', async () => {
    const simulations = await listSimulations(10);
    expect(simulations.length).toBeGreaterThan(0);
    expect(simulations[0].seed).toBe('read-1');
  });
});
