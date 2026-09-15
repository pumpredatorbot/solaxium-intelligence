/**
 * Analytical read model.
 *
 * Every series here is reconstructed from rows the engine actually wrote —
 * the ledger, the action log, the agent table. Nothing is sampled, smoothed or
 * synthesised, so a number on a chart can always be traced to a database row.
 */

import { prisma } from '@/lib/db';
import { ACTION_DEFINITIONS } from '@/config/simulation';
import { marketAt } from '@/lib/engine/actions';
import { resolveConfig } from '@/lib/engine/config';
import { lamportsToSol, toNum } from '@/lib/sol';
import type { ActionType } from '@/lib/types';

// ---------------------------------------------------------------------------
// Capital / population over simulated time
// ---------------------------------------------------------------------------

export interface CyclePoint {
  cycle: number;
  /** Total capital held by the whole population at the end of this cycle. */
  capitalSol: number;
  /** Lamports earned as REVENUE during this cycle. */
  revenueSol: number;
  /** Lamports spent as EXPENSE during this cycle. */
  expensesSol: number;
  /** revenue - expenses for this cycle. */
  netSol: number;
  alive: number;
  dead: number;
  born: number;
  died: number;
  /** Cumulative profit: capital minus every lamport ever endowed. */
  profitSol: number;
}

/**
 * Postgres `SUM()` over an int8 column returns `numeric`, which Prisma hands
 * back as a string rather than a bigint. Every aggregate below is therefore
 * cast to ::bigint in SQL *and* coerced here — a silent string would turn the
 * running total into concatenation and poison every downstream chart.
 */
interface LedgerCycleRow {
  cycle: number;
  revenue: bigint | string | null;
  expense: bigint | string | null;
  endowment: bigint | string | null;
  net: bigint | string | null;
}

function num(value: bigint | string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Rebuilds the whole run's economic history from the ledger.
 *
 * One grouped query per concern, then a single pass to accumulate — rather
 * than a query per cycle, which would be thousands of round trips.
 */
export async function getCycleSeries(simulationId: string): Promise<CyclePoint[]> {
  const [ledger, births, deaths, maxCycleRow] = await Promise.all([
    prisma.$queryRaw<LedgerCycleRow[]>`
      SELECT
        "cycle",
        SUM(CASE WHEN "type" = 'REVENUE' THEN "amountLamports" ELSE 0 END)::bigint AS "revenue",
        SUM(CASE WHEN "type" = 'EXPENSE' THEN -"amountLamports" ELSE 0 END)::bigint AS "expense",
        SUM(CASE WHEN "type" IN ('INITIAL_CAPITAL','CLONE_BONUS') THEN "amountLamports" ELSE 0 END)::bigint AS "endowment",
        SUM("amountLamports")::bigint AS "net"
      FROM "Transaction"
      WHERE "simulationId" = ${simulationId}
      GROUP BY "cycle"
      ORDER BY "cycle" ASC
    `,
    prisma.agent.groupBy({
      by: ['bornAtCycle'],
      where: { simulationId },
      _count: { _all: true },
    }),
    prisma.agent.groupBy({
      by: ['diedAtCycle'],
      where: { simulationId, diedAtCycle: { not: null } },
      _count: { _all: true },
    }),
    prisma.simulation.findUnique({ where: { id: simulationId }, select: { cycle: true } }),
  ]);

  const maxCycle = Math.max(
    maxCycleRow?.cycle ?? 0,
    ...ledger.map((r) => r.cycle),
    0,
  );

  const bornAt = new Map(births.map((b) => [b.bornAtCycle, b._count._all]));
  const diedAt = new Map(
    deaths.map((d) => [d.diedAtCycle as number, d._count._all]),
  );
  const ledgerAt = new Map(ledger.map((r) => [r.cycle, r]));

  const points: CyclePoint[] = [];
  let capital = 0;
  let endowed = 0;
  let alive = 0;
  let dead = 0;

  for (let cycle = 0; cycle <= maxCycle; cycle++) {
    const row = ledgerAt.get(cycle);
    const born = bornAt.get(cycle) ?? 0;
    const died = diedAt.get(cycle) ?? 0;

    capital += num(row?.net);
    endowed += num(row?.endowment);
    alive += born - died;
    dead += died;

    const revenue = num(row?.revenue);
    const expenses = num(row?.expense);

    points.push({
      cycle,
      capitalSol: lamportsToSol(capital),
      revenueSol: lamportsToSol(revenue),
      expensesSol: lamportsToSol(expenses),
      netSol: lamportsToSol(revenue - expenses),
      alive,
      dead,
      born,
      died,
      profitSol: lamportsToSol(capital - endowed),
    });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Trait evolution
// ---------------------------------------------------------------------------

export interface TraitGenerationPoint {
  generation: number;
  agentCount: number;
  traits: Record<string, number>;
}

interface TraitRow {
  generation: number;
  key: string;
  mean: number;
  n: bigint | string;
}

/**
 * Mean trait value per generation — the direct measurement of whether
 * selection is moving the population.
 */
export async function getTraitEvolution(
  simulationId: string,
): Promise<TraitGenerationPoint[]> {
  const rows = await prisma.$queryRaw<TraitRow[]>`
    SELECT a."generation", t."key", AVG(t."value")::float8 AS "mean", COUNT(*) AS "n"
    FROM "AgentTrait" t
    JOIN "Agent" a ON a."id" = t."agentId"
    WHERE a."simulationId" = ${simulationId}
    GROUP BY a."generation", t."key"
    ORDER BY a."generation" ASC
  `;

  const byGeneration = new Map<number, TraitGenerationPoint>();
  for (const row of rows) {
    let point = byGeneration.get(row.generation);
    if (!point) {
      point = { generation: row.generation, agentCount: Number(row.n), traits: {} };
      byGeneration.set(row.generation, point);
    }
    point.traits[row.key] = row.mean;
  }

  return [...byGeneration.values()].sort((a, b) => a.generation - b.generation);
}

// ---------------------------------------------------------------------------
// Action economics
// ---------------------------------------------------------------------------

export interface ActionEconomics {
  type: ActionType;
  label: string;
  risk: string;
  count: number;
  successRate: number;
  partialRate: number;
  failureRate: number;
  revenueSol: number;
  costSol: number;
  netSol: number;
  /** Mean net per execution — the number that decides whether it is worth doing. */
  meanNetSol: number;
  avgConfidence: number;
}

export async function getActionEconomics(simulationId: string): Promise<ActionEconomics[]> {
  const [totals, outcomes] = await Promise.all([
    prisma.agentAction.groupBy({
      by: ['type'],
      where: { simulationId },
      _count: { _all: true },
      _sum: { revenueLamports: true, costLamports: true, netLamports: true },
      _avg: { confidence: true },
    }),
    prisma.agentAction.groupBy({
      by: ['type', 'outcome'],
      where: { simulationId },
      _count: { _all: true },
    }),
  ]);

  const outcomeAt = new Map<string, number>();
  for (const row of outcomes) outcomeAt.set(`${row.type}:${row.outcome}`, row._count._all);

  return totals
    .map((row) => {
      const count = row._count._all;
      const rate = (outcome: string) => (count > 0 ? (outcomeAt.get(`${row.type}:${outcome}`) ?? 0) / count : 0);
      const net = toNum(row._sum.netLamports ?? 0n);

      return {
        type: row.type as ActionType,
        label: ACTION_DEFINITIONS[row.type as ActionType].label,
        risk: ACTION_DEFINITIONS[row.type as ActionType].risk,
        count,
        successRate: rate('SUCCESS'),
        partialRate: rate('PARTIAL'),
        failureRate: rate('FAILURE'),
        revenueSol: lamportsToSol(toNum(row._sum.revenueLamports ?? 0n)),
        costSol: lamportsToSol(toNum(row._sum.costLamports ?? 0n)),
        netSol: lamportsToSol(net),
        meanNetSol: count > 0 ? lamportsToSol(net / count) : 0,
        avgConfidence: row._avg.confidence ?? 0,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** The market multiplier series — a pure function of cycle, not a stored row. */
export async function getMarketSeries(
  simulationId: string,
  cycles: number,
): Promise<{ cycle: number; multiplier: number; label: string }[]> {
  const config = await getConfigFor(simulationId);
  const out: { cycle: number; multiplier: number; label: string }[] = [];
  for (let cycle = 0; cycle <= cycles; cycle++) {
    const market = marketAt(cycle, config);
    out.push({ cycle, multiplier: market.multiplier, label: market.label });
  }
  return out;
}

async function getConfigFor(simulationId: string) {
  const row = await prisma.simulation.findUnique({
    where: { id: simulationId },
    select: { config: true },
  });
  return resolveConfig(row?.config);
}

// ---------------------------------------------------------------------------
// Portfolio / treasury
// ---------------------------------------------------------------------------

export interface LedgerBreakdown {
  type: string;
  totalSol: number;
  count: number;
}

export interface PortfolioSummary {
  totalCapitalSol: number;
  endowedSol: number;
  earnedSol: number;
  spentSol: number;
  realisedProfitSol: number;
  ledger: LedgerBreakdown[];
  /** Capital held by each living agent, largest first. */
  holdings: { id: string; code: string; generation: number; capitalSol: number; shareOfTotal: number }[];
  /** Share of total living capital held by the top 5 agents (0..1). */
  concentrationTop5: number;
  transactionCount: number;
}

export async function getPortfolio(simulationId: string): Promise<PortfolioSummary> {
  const [breakdown, agents, txCount] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['type'],
      where: { simulationId },
      _sum: { amountLamports: true },
      _count: { _all: true },
    }),
    prisma.agent.findMany({
      where: { simulationId, status: 'ALIVE' },
      orderBy: { capitalLamports: 'desc' },
      select: { id: true, code: true, generation: true, capitalLamports: true },
    }),
    prisma.transaction.count({ where: { simulationId } }),
  ]);

  const sumFor = (type: string) =>
    toNum(breakdown.find((b) => b.type === type)?._sum.amountLamports ?? 0n);

  const endowed = sumFor('INITIAL_CAPITAL') + sumFor('CLONE_BONUS');
  const earned = sumFor('REVENUE');
  const spent = -sumFor('EXPENSE');
  const adjustments = sumFor('ADJUSTMENT');

  const totalCapital = agents.reduce((sum, a) => sum + toNum(a.capitalLamports), 0);
  const holdings = agents.map((a) => ({
    id: a.id,
    code: a.code,
    generation: a.generation,
    capitalSol: lamportsToSol(a.capitalLamports),
    shareOfTotal: totalCapital > 0 ? toNum(a.capitalLamports) / totalCapital : 0,
  }));

  return {
    totalCapitalSol: lamportsToSol(totalCapital),
    endowedSol: lamportsToSol(endowed),
    earnedSol: lamportsToSol(earned),
    spentSol: lamportsToSol(spent),
    realisedProfitSol: lamportsToSol(earned - spent + adjustments),
    ledger: breakdown
      .map((b) => ({
        type: b.type,
        totalSol: lamportsToSol(toNum(b._sum.amountLamports ?? 0n)),
        count: b._count._all,
      }))
      .sort((a, b) => Math.abs(b.totalSol) - Math.abs(a.totalSol)),
    holdings,
    concentrationTop5:
      totalCapital > 0
        ? holdings.slice(0, 5).reduce((sum, h) => sum + h.shareOfTotal, 0)
        : 0,
    transactionCount: txCount,
  };
}

// ---------------------------------------------------------------------------
// Survival
// ---------------------------------------------------------------------------

export interface SurvivalStats {
  generation: number;
  agentCount: number;
  survivalRate: number;
  /** Mean cycles lived, counting the living up to the current cycle. */
  avgLifetimeCycles: number;
  avgCapitalSol: number;
  cloneRate: number;
}

export async function getSurvivalStats(
  simulationId: string,
  currentCycle: number,
): Promise<SurvivalStats[]> {
  const agents = await prisma.agent.findMany({
    where: { simulationId },
    select: {
      generation: true,
      status: true,
      cycles: true,
      bornAtCycle: true,
      diedAtCycle: true,
      clonesCreated: true,
      capitalLamports: true,
    },
  });

  const byGeneration = new Map<number, typeof agents>();
  for (const agent of agents) {
    const bucket = byGeneration.get(agent.generation) ?? [];
    bucket.push(agent);
    byGeneration.set(agent.generation, bucket);
  }

  return [...byGeneration.entries()]
    .map(([generation, cohort]) => {
      const alive = cohort.filter((a) => a.status === 'ALIVE').length;
      const lifetime = cohort.reduce(
        (sum, a) => sum + ((a.diedAtCycle ?? currentCycle) - a.bornAtCycle),
        0,
      );
      return {
        generation,
        agentCount: cohort.length,
        survivalRate: cohort.length > 0 ? alive / cohort.length : 0,
        avgLifetimeCycles: cohort.length > 0 ? lifetime / cohort.length : 0,
        avgCapitalSol:
          cohort.length > 0
            ? lamportsToSol(
                cohort.reduce((sum, a) => sum + toNum(a.capitalLamports), 0) / cohort.length,
              )
            : 0,
        cloneRate:
          cohort.length > 0
            ? cohort.reduce((sum, a) => sum + a.clonesCreated, 0) / cohort.length
            : 0,
      };
    })
    .sort((a, b) => a.generation - b.generation);
}
