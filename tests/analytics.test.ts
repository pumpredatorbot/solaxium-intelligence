import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createSimulation, runCycle, startSimulation } from '@/lib/engine/engine';
import {
  getActionEconomics,
  getCycleSeries,
  getPortfolio,
  getSurvivalStats,
  getTraitEvolution,
} from '@/lib/repo/analytics';
import { listEngines } from '@/lib/repo/engines';
import { getReplaySnapshot } from '@/lib/repo/replay';
import { getDashboardStats } from '@/lib/repo/queries';
import { lamportsToSol, toNum } from '@/lib/sol';
import { resetDatabase } from './helpers';

let simulationId: string;
let cycle: number;

beforeAll(async () => {
  await resetDatabase();
  const result = await createSimulation({ name: 'analytics', seed: 'analytics-1', founderCount: 4 });
  simulationId = result.simulationId;
  await startSimulation(simulationId);
  for (let i = 0; i < 45; i++) {
    const report = await runCycle(simulationId);
    if (report.status !== 'RUNNING') break;
  }
  cycle = (await prisma.simulation.findUniqueOrThrow({ where: { id: simulationId } })).cycle;
}, 120_000);

describe('cycle series', () => {
  /**
   * Regression guard. Postgres SUM() over int8 returns numeric, which Prisma
   * hands back as a *string*. Accumulating those with += silently produces
   * string concatenation and then NaN, poisoning every chart downstream.
   */
  it('never produces NaN from raw SQL aggregates', async () => {
    const series = await getCycleSeries(simulationId);
    expect(series.length).toBeGreaterThan(10);

    for (const point of series) {
      for (const [key, value] of Object.entries(point)) {
        expect(Number.isFinite(value), `${key} at cycle ${point.cycle} is ${value}`).toBe(true);
      }
    }
  });

  it('covers every cycle exactly once, in order', async () => {
    const series = await getCycleSeries(simulationId);
    series.forEach((point, index) => expect(point.cycle).toBe(index));
    expect(series.at(-1)!.cycle).toBe(cycle);
  });

  it('reconstructs total capital to match the agent table', async () => {
    const series = await getCycleSeries(simulationId);
    const agents = await prisma.agent.aggregate({
      where: { simulationId },
      _sum: { capitalLamports: true },
    });

    // The ledger-derived total and the materialised balances must agree.
    expect(series.at(-1)!.capitalSol).toBeCloseTo(
      lamportsToSol(toNum(agents._sum.capitalLamports ?? 0n)),
      6,
    );
  });

  it('tracks the live population against the agent table', async () => {
    const series = await getCycleSeries(simulationId);
    const stats = await getDashboardStats(simulationId, cycle);
    expect(series.at(-1)!.alive).toBe(stats.liveAgents);
    expect(series.at(-1)!.dead).toBe(stats.deadAgents);
  });

  it('separates endowment from earnings when computing profit', async () => {
    const series = await getCycleSeries(simulationId);
    const last = series.at(-1)!;
    const endowments = await prisma.transaction.aggregate({
      where: { simulationId, type: { in: ['INITIAL_CAPITAL', 'CLONE_BONUS'] } },
      _sum: { amountLamports: true },
    });
    expect(last.profitSol).toBeCloseTo(
      last.capitalSol - lamportsToSol(toNum(endowments._sum.amountLamports ?? 0n)),
      6,
    );
  });
});

describe('action economics', () => {
  it('counts every recorded action exactly once', async () => {
    const actions = await getActionEconomics(simulationId);
    const total = actions.reduce((sum, a) => sum + a.count, 0);
    expect(total).toBe(await prisma.agentAction.count({ where: { simulationId } }));
  });

  it('reports outcome rates that sum to one', async () => {
    for (const action of await getActionEconomics(simulationId)) {
      expect(action.successRate + action.partialRate + action.failureRate).toBeCloseTo(1, 6);
      expect(Number.isFinite(action.meanNetSol)).toBe(true);
      expect(action.netSol).toBeCloseTo(action.revenueSol - action.costSol, 6);
    }
  });
});

describe('portfolio', () => {
  it('agrees with the ledger', async () => {
    const portfolio = await getPortfolio(simulationId);
    const revenue = await prisma.transaction.aggregate({
      where: { simulationId, type: 'REVENUE' },
      _sum: { amountLamports: true },
    });
    expect(portfolio.earnedSol).toBeCloseTo(
      lamportsToSol(toNum(revenue._sum.amountLamports ?? 0n)),
      6,
    );
    expect(portfolio.transactionCount).toBe(
      await prisma.transaction.count({ where: { simulationId } }),
    );
  });

  it('holds shares that sum to one across living agents', async () => {
    const portfolio = await getPortfolio(simulationId);
    if (portfolio.holdings.length === 0) return;
    const total = portfolio.holdings.reduce((sum, h) => sum + h.shareOfTotal, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(portfolio.concentrationTop5).toBeLessThanOrEqual(1.000001);
  });
});

describe('survival and traits', () => {
  it('matches cohort sizes to the agent table', async () => {
    for (const stat of await getSurvivalStats(simulationId, cycle)) {
      expect(stat.agentCount).toBe(
        await prisma.agent.count({ where: { simulationId, generation: stat.generation } }),
      );
      expect(stat.survivalRate).toBeGreaterThanOrEqual(0);
      expect(stat.survivalRate).toBeLessThanOrEqual(1);
      expect(stat.avgLifetimeCycles).toBeGreaterThanOrEqual(0);
    }
  });

  it('reports all eight traits per generation, in range', async () => {
    const traits = await getTraitEvolution(simulationId);
    expect(traits.length).toBeGreaterThan(0);
    for (const point of traits) {
      expect(Object.keys(point.traits)).toHaveLength(8);
      for (const value of Object.values(point.traits)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('engines', () => {
  it('derives status from the most recent recorded action', async () => {
    const engines = await listEngines(simulationId, { limit: 50, cycleCostSol: 0.15 });
    expect(engines.length).toBeGreaterThan(0);

    for (const engine of engines) {
      const agent = await prisma.agent.findUniqueOrThrow({
        where: { id: engine.id },
        select: { status: true },
      });
      if (agent.status === 'DEAD') {
        expect(engine.status).toBe('DEAD');
        expect(engine.runwayCycles).toBeNull();
      } else {
        expect(engine.status).not.toBe('DEAD');
        expect(engine.runwayCycles).toBeGreaterThanOrEqual(0);
      }
      expect(engine.profitSol).toBeCloseTo(engine.capitalSol - 1, 6);
    }
  });
});

describe('replay', () => {
  it('rebuilds the head cycle to match live state', async () => {
    const snapshot = await getReplaySnapshot(simulationId, cycle);
    const stats = await getDashboardStats(simulationId, cycle);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.cycle).toBe(cycle);
    expect(snapshot!.alive).toBe(stats.liveAgents);
    expect(snapshot!.totalCapitalSol).toBeCloseTo(stats.totalCapitalSol, 6);
  });

  it('shows only the founders at cycle 0', async () => {
    const snapshot = await getReplaySnapshot(simulationId, 0);
    expect(snapshot!.agents).toHaveLength(4);
    expect(snapshot!.agents.every((a) => a.generation === 0)).toBe(true);
    expect(snapshot!.alive).toBe(4);
    expect(snapshot!.dead).toBe(0);
  });

  it('never shows an agent before it was born', async () => {
    const mid = Math.floor(cycle / 2);
    const snapshot = await getReplaySnapshot(simulationId, mid);

    for (const agent of snapshot!.agents) {
      const row = await prisma.agent.findUniqueOrThrow({
        where: { id: agent.id },
        select: { bornAtCycle: true, diedAtCycle: true },
      });
      expect(row.bornAtCycle).toBeLessThanOrEqual(mid);
      // Status is as-of the replayed cycle, not the agent's status today.
      if (agent.status === 'ALIVE') {
        expect(row.diedAtCycle === null || row.diedAtCycle > mid).toBe(true);
      }
    }
  });

  it('grows monotonically in total agents as the cycle advances', async () => {
    let previous = 0;
    for (const at of [0, Math.floor(cycle / 3), Math.floor((2 * cycle) / 3), cycle]) {
      const snapshot = await getReplaySnapshot(simulationId, at);
      expect(snapshot!.agents.length).toBeGreaterThanOrEqual(previous);
      previous = snapshot!.agents.length;
    }
  });

  it('clamps a cycle outside the recorded range', async () => {
    expect((await getReplaySnapshot(simulationId, -50))!.cycle).toBe(0);
    expect((await getReplaySnapshot(simulationId, cycle + 9999))!.cycle).toBe(cycle);
  });

  it('returns null for an unknown simulation', async () => {
    expect(await getReplaySnapshot('nope', 0)).toBeNull();
  });
});
