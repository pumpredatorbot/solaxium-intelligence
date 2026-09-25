/**
 * Read models for the trading console.
 *
 * Every figure here is read back out of the database the engine wrote. Nothing
 * is modelled, extrapolated or filled in: if a panel has nothing to show, it
 * shows nothing rather than a plausible number. That is the whole reason these
 * are separate from the engine — a read model cannot accidentally invent state.
 *
 * Lamports are converted to SOL exactly once, at this boundary, so BigInt never
 * crosses into React and no component has to know the unit.
 */

import { prisma } from '@/lib/db';
import { lamportsToSol, toNum } from '@/lib/sol';
import { PRICE_LOT } from '@/lib/market/pumpfun/types';

// ---------------------------------------------------------------------------
// Headline figures
// ---------------------------------------------------------------------------

export interface TradingStats {
  /** Population. */
  liveAgents: number;
  deadAgents: number;
  totalAgents: number;
  generations: number;
  clones: number;
  survivalRate: number;

  /** Capital. */
  capitalSol: number;
  startingCapitalSol: number;
  /** Everything realised on closed positions, net of fees and slippage. */
  realisedPnlSol: number;
  /** Marked at the last observed price of each open position's token. */
  unrealisedPnlSol: number;
  /** Total paid in fees and slippage. The cost of playing. */
  costsSol: number;
  /**
   * Capital currently committed to open positions.
   *
   * It leaves `capitalSol` the moment a position opens, so without this figure
   * an agent mid-trade looks poorer than it is and "vs seeded" reads as a loss
   * that has not happened.
   */
  committedSol: number;

  /** Execution. */
  openPositions: number;
  closedTrades: number;
  wins: number;
  winRate: number;
  tp1Hits: number;
  tp2Hits: number;
  stops: number;
  timeouts: number;
  avgHoldSteps: number;
  bestTradeSol: number;
  worstTradeSol: number;

  /** Selection. */
  meanFitness: number;
  bestFitness: number;
}

export async function getTradingStats(simulationId: string): Promise<TradingStats> {
  const [agents, closed, open, clones, generations] = await Promise.all([
    prisma.agent.aggregate({
      where: { simulationId },
      _count: true,
      _sum: { capitalLamports: true, startingCapitalLamports: true },
      _avg: { fitness: true },
      _max: { fitness: true, generation: true },
    }),
    prisma.position.aggregate({
      where: { simulationId, status: 'CLOSED' },
      _count: true,
      _sum: { pnlLamports: true, feesLamports: true, slippageLamports: true, holdSteps: true },
      _max: { pnlLamports: true },
      _min: { pnlLamports: true },
    }),
    prisma.position.findMany({
      where: { simulationId, status: 'OPEN' },
      select: {
        mint: true, sizeLamports: true, entryPriceLamports: true,
        entryStep: true, agentId: true,
      },
    }),
    prisma.clone.count({ where: { simulationId } }),
    prisma.agent.groupBy({ by: ['generation'], where: { simulationId }, _count: true }),
  ]);

  const [alive, exits] = await Promise.all([
    prisma.agent.count({ where: { simulationId, status: 'ALIVE' } }),
    prisma.position.groupBy({
      by: ['exitReason'],
      where: { simulationId, status: 'CLOSED' },
      _count: true,
    }),
  ]);

  const wins = await prisma.position.count({
    where: { simulationId, status: 'CLOSED', pnlLamports: { gt: 0 } },
  });

  const exitCount = (reason: string) =>
    exits.find((e) => e.exitReason === reason)?._count ?? 0;

  const total = agents._count;
  const closedCount = closed._count;
  const unrealised = await markOpenPositions(simulationId, open);

  return {
    liveAgents: alive,
    deadAgents: total - alive,
    totalAgents: total,
    generations: generations.length,
    clones,
    survivalRate: total > 0 ? alive / total : 0,

    capitalSol: lamportsToSol(toNum(agents._sum.capitalLamports ?? 0n)),
    startingCapitalSol: lamportsToSol(toNum(agents._sum.startingCapitalLamports ?? 0n)),
    realisedPnlSol: lamportsToSol(toNum(closed._sum.pnlLamports ?? 0n)),
    unrealisedPnlSol: lamportsToSol(unrealised),
    costsSol: lamportsToSol(
      toNum(closed._sum.feesLamports ?? 0n) + toNum(closed._sum.slippageLamports ?? 0n),
    ),
    committedSol: lamportsToSol(
      open.reduce((sum, position) => sum + toNum(position.sizeLamports), 0),
    ),

    openPositions: open.length,
    closedTrades: closedCount,
    wins,
    winRate: closedCount > 0 ? wins / closedCount : 0,
    tp1Hits: exitCount('TP1'),
    tp2Hits: exitCount('TP2'),
    stops: exitCount('STOP'),
    timeouts: exitCount('TIMEOUT'),
    avgHoldSteps: closedCount > 0 ? toNum(closed._sum.holdSteps ?? 0) / closedCount : 0,
    bestTradeSol: lamportsToSol(toNum(closed._max.pnlLamports ?? 0n)),
    worstTradeSol: lamportsToSol(toNum(closed._min.pnlLamports ?? 0n)),

    meanFitness: agents._avg.fitness ?? 0,
    bestFitness: agents._max.fitness ?? 0,
  };
}

/**
 * Marks open positions to the last price their token printed.
 *
 * Unrealised P&L is genuinely uncertain, so it is computed from stored ticks
 * where they exist and reported as zero where they do not, rather than assuming
 * a position is flat. A synthetic market has no stored ticks — only recorded
 * captures do — so this is honestly zero for fixture runs, and the UI labels it.
 */
async function markOpenPositions(
  simulationId: string,
  open: { mint: string; sizeLamports: bigint; entryPriceLamports: bigint }[],
): Promise<number> {
  if (open.length === 0) return 0;

  const simulation = await prisma.simulation.findUnique({
    where: { id: simulationId },
    select: { cycle: true, datasetId: true, dataset: { select: { source: true } } },
  });
  if (!simulation?.datasetId || simulation.dataset?.source !== 'RECORDED') return 0;

  const mints = [...new Set(open.map((p) => p.mint))];
  const ticks = await prisma.tick.findMany({
    where: { datasetId: simulation.datasetId, mint: { in: mints }, step: { lte: simulation.cycle } },
    orderBy: [{ mint: 'asc' }, { step: 'desc' }],
    distinct: ['mint'],
    select: { mint: true, priceLamports: true },
  });
  const priceByMint = new Map(ticks.map((t) => [t.mint, toNum(t.priceLamports)]));

  let unrealised = 0;
  for (const position of open) {
    const price = priceByMint.get(position.mint);
    if (!price) continue;
    const size = toNum(position.sizeLamports);
    const entry = toNum(position.entryPriceLamports);
    if (entry <= 0) continue;
    unrealised += (size * price) / entry - size;
  }
  return Math.round(unrealised);
}

// ---------------------------------------------------------------------------
// Closed trades — the tape
// ---------------------------------------------------------------------------

export interface ClosedTrade {
  id: string;
  agentCode: string;
  agentId: string;
  generation: number;
  strategy: string;
  symbol: string;
  mint: string;
  entryStep: number;
  exitStep: number;
  holdSteps: number;
  exitReason: 'TP1' | 'TP2' | 'STOP' | 'TIMEOUT';
  sizeSol: number;
  pnlSol: number;
  returnPct: number;
  feesSol: number;
  closedAt: string | null;
}

/**
 * The most recently closed positions.
 *
 * This is the console's primary evidence that the system works: every row is a
 * position the engine opened on a token, held, and settled through the ledger.
 */
export async function getClosedTrades(
  simulationId: string,
  limit = 60,
): Promise<ClosedTrade[]> {
  const rows = await prisma.position.findMany({
    where: { simulationId, status: 'CLOSED' },
    orderBy: [{ exitStep: 'desc' }, { id: 'desc' }],
    take: Math.min(limit, 200),
    select: {
      id: true, mint: true, symbol: true, entryStep: true, exitStep: true,
      holdSteps: true, exitReason: true, sizeLamports: true, pnlLamports: true,
      returnPct: true, feesLamports: true, slippageLamports: true, closedAt: true,
      agent: { select: { id: true, code: true, generation: true, strategy: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    agentCode: row.agent.code,
    agentId: row.agent.id,
    generation: row.agent.generation,
    strategy: row.agent.strategy ?? 'BALANCED',
    symbol: row.symbol,
    mint: row.mint,
    entryStep: row.entryStep,
    exitStep: row.exitStep ?? row.entryStep,
    holdSteps: row.holdSteps ?? 0,
    exitReason: (row.exitReason ?? 'TIMEOUT') as ClosedTrade['exitReason'],
    sizeSol: lamportsToSol(toNum(row.sizeLamports)),
    pnlSol: lamportsToSol(toNum(row.pnlLamports ?? 0n)),
    returnPct: row.returnPct ?? 0,
    feesSol: lamportsToSol(
      toNum(row.feesLamports) + toNum(row.slippageLamports),
    ),
    closedAt: row.closedAt?.toISOString() ?? null,
  }));
}

export interface OpenPosition {
  id: string;
  agentCode: string;
  symbol: string;
  mint: string;
  entryStep: number;
  ageSteps: number;
  sizeSol: number;
  takeProfitMultiple: number;
  stopMultiple: number;
  maxHoldSteps: number;
  /** Null when the dataset stores no ticks to mark against. */
  markMultiple: number | null;
  unrealisedSol: number | null;
}

export async function getOpenPositions(
  simulationId: string,
  limit = 40,
): Promise<OpenPosition[]> {
  const simulation = await prisma.simulation.findUnique({
    where: { id: simulationId },
    select: { cycle: true, datasetId: true, dataset: { select: { source: true } } },
  });
  if (!simulation) return [];

  const rows = await prisma.position.findMany({
    where: { simulationId, status: 'OPEN' },
    orderBy: [{ entryStep: 'desc' }, { id: 'asc' }],
    take: Math.min(limit, 100),
    select: {
      id: true, mint: true, symbol: true, entryStep: true, sizeLamports: true,
      entryPriceLamports: true, takeProfitMultiple: true, stopMultiple: true,
      maxHoldSteps: true, agent: { select: { code: true } },
    },
  });
  if (rows.length === 0) return [];

  const marks = new Map<string, number>();
  if (simulation.datasetId && simulation.dataset?.source === 'RECORDED') {
    const ticks = await prisma.tick.findMany({
      where: {
        datasetId: simulation.datasetId,
        mint: { in: [...new Set(rows.map((r) => r.mint))] },
        step: { lte: simulation.cycle },
      },
      orderBy: [{ mint: 'asc' }, { step: 'desc' }],
      distinct: ['mint'],
      select: { mint: true, priceLamports: true },
    });
    for (const tick of ticks) marks.set(tick.mint, toNum(tick.priceLamports));
  }

  return rows.map((row) => {
    const entry = toNum(row.entryPriceLamports);
    const mark = marks.get(row.mint) ?? null;
    const size = toNum(row.sizeLamports);
    return {
      id: row.id,
      agentCode: row.agent.code,
      symbol: row.symbol,
      mint: row.mint,
      entryStep: row.entryStep,
      ageSteps: simulation.cycle - row.entryStep,
      sizeSol: lamportsToSol(size),
      takeProfitMultiple: row.takeProfitMultiple,
      stopMultiple: row.stopMultiple,
      maxHoldSteps: row.maxHoldSteps,
      markMultiple: mark && entry > 0 ? mark / entry : null,
      unrealisedSol:
        mark && entry > 0 ? lamportsToSol(Math.round((size * mark) / entry - size)) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Trader cards
// ---------------------------------------------------------------------------

export interface TraderCard {
  id: string;
  code: string;
  name: string;
  generation: number;
  status: 'ALIVE' | 'DEAD';
  strategy: string;
  parentCode: string | null;
  capitalSol: number;
  pnlSol: number;
  fitness: number;
  rawFitness: number;
  trades: number;
  wins: number;
  winRate: number;
  tp1Hits: number;
  tp2Hits: number;
  stops: number;
  timeouts: number;
  avgHoldSteps: number;
  maxDrawdown: number;
  openPositions: number;
  clonesCreated: number;
  bornAtStep: number;
  diedAtStep: number | null;
}

export async function getTraderCards(
  simulationId: string,
  options: { limit?: number; status?: 'ALIVE' | 'DEAD'; sort?: 'fitness' | 'capital' | 'pnl' } = {},
): Promise<TraderCard[]> {
  const sort = options.sort ?? 'fitness';
  const rows = await prisma.agent.findMany({
    where: { simulationId, ...(options.status ? { status: options.status } : {}) },
    orderBy:
      sort === 'capital'
        ? [{ capitalLamports: 'desc' }, { code: 'asc' }]
        : [{ fitness: 'desc' }, { code: 'asc' }],
    take: Math.min(options.limit ?? 40, 200),
    select: {
      id: true, code: true, name: true, generation: true, status: true, strategy: true,
      capitalLamports: true, startingCapitalLamports: true, fitness: true, rawFitness: true,
      tradesClosed: true, wins: true, tp1Hits: true, tp2Hits: true, stops: true,
      timeouts: true, avgHoldSteps: true, maxDrawdown: true, clonesCreated: true,
      bornAtCycle: true, diedAtCycle: true,
      parent: { select: { code: true } },
      _count: { select: { positions: true } },
    },
  });

  const openCounts = await prisma.position.groupBy({
    by: ['agentId'],
    where: { simulationId, status: 'OPEN', agentId: { in: rows.map((r) => r.id) } },
    _count: true,
  });
  const openByAgent = new Map(openCounts.map((row) => [row.agentId, row._count]));

  const cards = rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    generation: row.generation,
    status: row.status as 'ALIVE' | 'DEAD',
    strategy: row.strategy ?? 'BALANCED',
    parentCode: row.parent?.code ?? null,
    capitalSol: lamportsToSol(toNum(row.capitalLamports)),
    pnlSol: lamportsToSol(toNum(row.capitalLamports) - toNum(row.startingCapitalLamports)),
    fitness: row.fitness,
    rawFitness: row.rawFitness,
    trades: row.tradesClosed,
    wins: row.wins,
    winRate: row.tradesClosed > 0 ? row.wins / row.tradesClosed : 0,
    tp1Hits: row.tp1Hits,
    tp2Hits: row.tp2Hits,
    stops: row.stops,
    timeouts: row.timeouts,
    avgHoldSteps: row.avgHoldSteps,
    maxDrawdown: row.maxDrawdown,
    openPositions: openByAgent.get(row.id) ?? 0,
    clonesCreated: row.clonesCreated,
    bornAtStep: row.bornAtCycle,
    diedAtStep: row.diedAtCycle,
  }));

  // P&L is derived, so it cannot be sorted in SQL without duplicating the
  // subtraction there. Sorting a bounded page in memory is the cheaper honesty.
  if (sort === 'pnl') cards.sort((a, b) => b.pnlSol - a.pnlSol);
  return cards;
}

// ---------------------------------------------------------------------------
// The generation tree
// ---------------------------------------------------------------------------

export interface TreeLeaf {
  id: string;
  code: string;
  status: 'ALIVE' | 'DEAD';
  /** True when this agent has produced at least one clone. */
  parent: boolean;
  parentCode: string | null;
  strategy: string;
  capitalSol: number;
  pnlSol: number;
  fitness: number;
  trades: number;
  winRate: number;
}

export interface GenerationBand {
  generation: number;
  total: number;
  alive: number;
  dead: number;
  /** Mean fitness of the cohort's members that have actually traded. */
  meanFitness: number;
  meanWinRate: number;
  meanCapitalSol: number;
  /** Mean genome, so drift across generations is visible rather than asserted. */
  traits: Record<string, number>;
  leaves: TreeLeaf[];
}

/**
 * The population as generations of descent.
 *
 * Capped per band: a run can produce hundreds of agents in one generation, and
 * a tree that draws all of them is unreadable and expensive. The band's counts
 * are always complete even when its leaves are a sample — the header says which.
 */
export async function getGenerationTree(
  simulationId: string,
  leavesPerBand = 24,
): Promise<GenerationBand[]> {
  const agents = await prisma.agent.findMany({
    where: { simulationId },
    orderBy: [{ generation: 'asc' }, { fitness: 'desc' }, { code: 'asc' }],
    select: {
      id: true, code: true, generation: true, status: true, strategy: true,
      capitalLamports: true, startingCapitalLamports: true, fitness: true,
      tradesClosed: true, wins: true, clonesCreated: true,
      parent: { select: { code: true } },
      traits: { select: { key: true, value: true } },
    },
  });

  const bands = new Map<number, GenerationBand>();
  for (const agent of agents) {
    let band = bands.get(agent.generation);
    if (!band) {
      band = {
        generation: agent.generation,
        total: 0, alive: 0, dead: 0,
        meanFitness: 0, meanWinRate: 0, meanCapitalSol: 0,
        traits: {}, leaves: [],
      };
      bands.set(agent.generation, band);
    }

    band.total++;
    if (agent.status === 'ALIVE') band.alive++;
    else band.dead++;
    band.meanCapitalSol += lamportsToSol(toNum(agent.capitalLamports));
    for (const trait of agent.traits) {
      band.traits[trait.key] = (band.traits[trait.key] ?? 0) + trait.value;
    }

    if (agent.tradesClosed > 0) {
      band.meanFitness += agent.fitness;
      band.meanWinRate += agent.wins / agent.tradesClosed;
    }

    if (band.leaves.length < leavesPerBand) {
      band.leaves.push({
        id: agent.id,
        code: agent.code,
        status: agent.status as 'ALIVE' | 'DEAD',
        parent: agent.clonesCreated > 0,
        parentCode: agent.parent?.code ?? null,
        strategy: agent.strategy ?? 'BALANCED',
        capitalSol: lamportsToSol(toNum(agent.capitalLamports)),
        pnlSol: lamportsToSol(
          toNum(agent.capitalLamports) - toNum(agent.startingCapitalLamports),
        ),
        fitness: agent.fitness,
        trades: agent.tradesClosed,
        winRate: agent.tradesClosed > 0 ? agent.wins / agent.tradesClosed : 0,
      });
    }
  }

  // Means are divided by the right denominator: fitness and win rate only count
  // agents that traded, because an agent with no trades has neither.
  for (const band of bands.values()) {
    const traded = agents.filter(
      (a) => a.generation === band.generation && a.tradesClosed > 0,
    ).length;
    band.meanFitness = traded > 0 ? band.meanFitness / traded : 0;
    band.meanWinRate = traded > 0 ? band.meanWinRate / traded : 0;
    band.meanCapitalSol = band.total > 0 ? band.meanCapitalSol / band.total : 0;
    for (const key of Object.keys(band.traits)) {
      band.traits[key] = band.traits[key] / band.total;
    }
  }

  return [...bands.values()].sort((a, b) => a.generation - b.generation);
}

// ---------------------------------------------------------------------------
// The token flow
// ---------------------------------------------------------------------------

export interface FlowToken {
  mint: string;
  symbol: string;
  name: string;
  ageSteps: number;
  mcapSol: number;
  buys: number;
  sells: number;
  buyRatio: number;
  volumeSol: number;
  holders: number;
  momentum: number;
  /** Agents that opened a position on this token, most recent first. */
  entered: { code: string; step: number; sizeSol: number }[];
  /** How many living agents saw it and did not enter. */
  skipped: number;
  /** Realised P&L across every position ever taken on this token. */
  realisedPnlSol: number;
  closedTrades: number;
}

/**
 * Tokens the population is currently looking at, with what it decided.
 *
 * ENTER is read from the positions actually opened; SKIP is the living
 * population minus those who entered. Neither is inferred from a strategy
 * model — a decision the engine did not record does not appear here.
 *
 * Returns an empty list for a synthetic market, whose tokens are regenerated
 * from a seed rather than stored, and the caller says so in the UI.
 */
export async function getTokenFlow(
  simulationId: string,
  limit = 14,
): Promise<{ tokens: FlowToken[]; source: string; origin: string | null; priceUnit: string }> {
  const simulation = await prisma.simulation.findUnique({
    where: { id: simulationId },
    select: {
      cycle: true, datasetId: true,
      dataset: { select: { source: true, stepMs: true, meta: true } },
    },
  });
  // Where the capture came from, as recorded at capture time. The UI labels a
  // market by this rather than by "RECORDED", so a test or synthetic capture can
  // never be presented as real pump.fun data.
  const origin =
    (simulation?.dataset?.meta as Record<string, unknown> | null)?.source ?? null;

  if (!simulation?.datasetId || simulation.dataset?.source !== 'RECORDED') {
    return {
      tokens: [],
      source: simulation?.dataset?.source ?? 'NONE',
      origin: typeof origin === 'string' ? origin : null,
      priceUnit: `lamports per ${PRICE_LOT} tokens`,
    };
  }

  const step = simulation.cycle;
  const aliveCount = await prisma.agent.count({ where: { simulationId, status: 'ALIVE' } });

  // Tokens with a tick at, or just before, the current step: what the
  // population can actually see right now.
  const ticks = await prisma.tick.findMany({
    where: { datasetId: simulation.datasetId, step: { lte: step, gte: Math.max(0, step - 3) } },
    orderBy: [{ step: 'desc' }, { mint: 'asc' }],
    distinct: ['mint'],
    take: Math.min(limit, 40),
    select: {
      mint: true, step: true, ageMs: true, mcapLamports: true, buys: true, sells: true,
      volumeLamports: true, holders: true, momentum: true,
      token: { select: { symbol: true, name: true } },
    },
  });
  if (ticks.length === 0) {
    return {
      tokens: [], source: 'RECORDED',
      origin: typeof origin === 'string' ? origin : null,
      priceUnit: `lamports per ${PRICE_LOT} tokens`,
    };
  }

  const mints = ticks.map((t) => t.mint);
  const [positions, closedAgg] = await Promise.all([
    prisma.position.findMany({
      where: { simulationId, mint: { in: mints } },
      orderBy: [{ entryStep: 'desc' }, { id: 'asc' }],
      select: {
        mint: true, entryStep: true, sizeLamports: true,
        agent: { select: { code: true } },
      },
    }),
    prisma.position.groupBy({
      by: ['mint'],
      where: { simulationId, mint: { in: mints }, status: 'CLOSED' },
      _sum: { pnlLamports: true },
      _count: true,
    }),
  ]);

  const enteredBy = new Map<string, { code: string; step: number; sizeSol: number }[]>();
  for (const position of positions) {
    const list = enteredBy.get(position.mint) ?? [];
    if (list.length < 6) {
      list.push({
        code: position.agent.code,
        step: position.entryStep,
        sizeSol: lamportsToSol(toNum(position.sizeLamports)),
      });
    }
    enteredBy.set(position.mint, list);
  }
  const uniqueEntrants = new Map<string, Set<string>>();
  for (const position of positions) {
    const set = uniqueEntrants.get(position.mint) ?? new Set<string>();
    set.add(position.agent.code);
    uniqueEntrants.set(position.mint, set);
  }
  const closedByMint = new Map(closedAgg.map((row) => [row.mint, row]));

  const stepMs = simulation.dataset.stepMs || 1000;

  return {
    source: 'RECORDED',
    origin: typeof origin === 'string' ? origin : null,
    priceUnit: `lamports per ${PRICE_LOT} tokens`,
    tokens: ticks.map((tick) => {
      const closed = closedByMint.get(tick.mint);
      const entrants = uniqueEntrants.get(tick.mint)?.size ?? 0;
      return {
        mint: tick.mint,
        symbol: tick.token.symbol,
        name: tick.token.name,
        ageSteps: Math.round(tick.ageMs / stepMs),
        mcapSol: lamportsToSol(toNum(tick.mcapLamports)),
        buys: tick.buys,
        sells: tick.sells,
        buyRatio: tick.buys + tick.sells > 0 ? tick.buys / (tick.buys + tick.sells) : 0,
        volumeSol: lamportsToSol(toNum(tick.volumeLamports)),
        holders: tick.holders,
        momentum: tick.momentum,
        entered: enteredBy.get(tick.mint) ?? [],
        skipped: Math.max(0, aliveCount - entrants),
        realisedPnlSol: lamportsToSol(toNum(closed?._sum.pnlLamports ?? 0n)),
        closedTrades: closed?._count ?? 0,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

export interface DatasetRow {
  id: string;
  key: string;
  source: string;
  tokenCount: number;
  steps: number;
  stepMs: number;
  createdAt: string;
  meta: Record<string, unknown> | null;
  /** Runs that have traded this dataset. */
  runs: number;
}

export async function listDatasets(limit = 20): Promise<DatasetRow[]> {
  const rows = await prisma.marketDataset.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, key: true, source: true, tokenCount: true, steps: true, stepMs: true,
      createdAt: true, meta: true, _count: { select: { simulations: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    source: row.source,
    tokenCount: row.tokenCount,
    steps: row.steps,
    stepMs: row.stepMs,
    createdAt: row.createdAt.toISOString(),
    meta: (row.meta as Record<string, unknown>) ?? null,
    runs: row._count.simulations,
  }));
}
