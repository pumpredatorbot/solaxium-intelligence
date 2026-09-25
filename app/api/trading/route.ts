import { NextRequest } from 'next/server';
import { handle } from '@/lib/api';
import { getActiveSimulation } from '@/lib/repo/queries';
import { getRunnerState } from '@/lib/engine/runner';
import {
  getClosedTrades,
  getGenerationTree,
  getOpenPositions,
  getTokenFlow,
  getTraderCards,
  getTradingStats,
  listDatasets,
} from '@/lib/repo/trading';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One poll for the whole trading console.
 *
 * Same reasoning as the status route: a panel-per-request console makes panels
 * disagree with each other mid-step, and multiplies load by the number of
 * panels on screen.
 */
export async function GET(request: NextRequest) {
  return handle(async () => {
    const params = request.nextUrl.searchParams;
    const simulation = await getActiveSimulation(params.get('simulationId'));

    if (!simulation) {
      return {
        simulation: null, runner: null, dataset: null, stats: null,
        tree: [], trades: [], open: [], traders: [], flow: null,
        datasets: await listDatasets(),
      };
    }

    const row = await prisma.simulation.findUniqueOrThrow({
      where: { id: simulation.id },
      select: { mode: true, dataset: { select: { id: true, key: true, source: true, tokenCount: true, steps: true, meta: true } } },
    });

    // The trading panels read trading tables. An economic run has none, and
    // saying so is better than rendering a screen of zeroes.
    if (row.mode !== 'TRADING') {
      return {
        simulation, mode: row.mode, runner: getRunnerState(simulation.id),
        dataset: null, stats: null, tree: [], trades: [], open: [], traders: [],
        flow: null, datasets: await listDatasets(),
      };
    }

    const [stats, tree, trades, open, traders, flow, datasets] = await Promise.all([
      getTradingStats(simulation.id),
      getGenerationTree(simulation.id),
      getClosedTrades(simulation.id, Number(params.get('trades')) || 60),
      getOpenPositions(simulation.id),
      getTraderCards(simulation.id, { limit: Number(params.get('traders')) || 36 }),
      getTokenFlow(simulation.id),
      listDatasets(),
    ]);

    return {
      simulation,
      mode: row.mode,
      runner: getRunnerState(simulation.id),
      dataset: row.dataset,
      stats, tree, trades, open, traders, flow, datasets,
    };
  });
}
