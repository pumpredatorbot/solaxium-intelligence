import { ConsoleHeader } from '@/components/console/page-header';
import { TradingProvider, type TradingSnapshot } from '@/components/trading/trading-provider';
import { TradingKpis } from '@/components/trading/trading-kpis';
import { GenerationTree } from '@/components/trading/generation-tree';
import { TokenFlow } from '@/components/trading/token-flow';
import { TradeTape } from '@/components/trading/trade-tape';
import { OpenPositions } from '@/components/trading/open-positions';
import { TraderCards } from '@/components/trading/trader-cards';
import { RunLauncher } from '@/components/trading/run-launcher';
import { prisma } from '@/lib/db';
import { getActiveSimulation } from '@/lib/repo/queries';
import { getRunnerState } from '@/lib/engine/runner';
import {
  getClosedTrades, getGenerationTree, getOpenPositions, getTokenFlow,
  getTraderCards, getTradingStats, listDatasets,
} from '@/lib/repo/trading';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Paper trading' };

/**
 * The paper-trading console.
 *
 * Rendered on the server so the first paint already carries real figures, then
 * handed to one poller. Everything on this page is read back out of what the
 * engine wrote: no panel models, estimates or fills in a number.
 */
export default async function TradingPage() {
  const simulation = await getActiveSimulation();

  const snapshot: TradingSnapshot = {
    simulation, mode: null, runner: null, dataset: null, stats: null,
    tree: [], trades: [], open: [], traders: [], flow: null,
    datasets: await listDatasets(),
  };

  if (simulation) {
    const row = await prisma.simulation.findUniqueOrThrow({
      where: { id: simulation.id },
      select: {
        mode: true,
        dataset: {
          select: { id: true, key: true, source: true, tokenCount: true, steps: true, meta: true },
        },
      },
    });
    snapshot.mode = row.mode;
    snapshot.runner = getRunnerState(simulation.id);

    if (row.mode === 'TRADING') {
      const [stats, tree, trades, open, traders, flow] = await Promise.all([
        getTradingStats(simulation.id),
        getGenerationTree(simulation.id),
        getClosedTrades(simulation.id),
        getOpenPositions(simulation.id),
        getTraderCards(simulation.id),
        getTokenFlow(simulation.id),
      ]);
      Object.assign(snapshot, {
        dataset: row.dataset
          ? { ...row.dataset, meta: (row.dataset.meta as Record<string, unknown>) ?? null }
          : null,
        stats, tree, trades, open, traders, flow,
      });
    }
  }

  return (
    <TradingProvider initial={snapshot}>
      <ConsoleHeader
        eyebrow="Paper execution on real pump.fun launches"
        title="Paper trading"
      />

      <div className="space-y-3">
        <TradingKpis />

        {/* The three live surfaces: what the market offered, what was decided,
            and what it settled at. */}
        <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="min-w-0 space-y-3">
            <TokenFlow />
            <OpenPositions />
          </div>
          <div className="min-w-0 space-y-3">
            <TradeTape />
            <RunLauncher />
          </div>
        </div>

        <GenerationTree />
        <TraderCards />
      </div>
    </TradingProvider>
  );
}
