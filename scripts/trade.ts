/**
 * Headless paper-trading run.
 *
 *   npm run trade -- --steps 400 --founders 80 --seed t1
 *
 * Drives the persisted engine without Next.js, and checks the ledger invariant
 * at the end: every agent's balance must still be recomputable from its own
 * transactions.
 */

import { prisma } from '@/lib/db';
import { createTradingRun, runTradingStep } from '@/lib/engine/trading-engine';
import { recomputeCapital } from '@/lib/engine/ledger';
import { lamportsToSol, toNum } from '@/lib/sol';
import { TRADING_TRAIT_KEYS } from '@/config/trading';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const steps = Number(arg('steps', '400'));
  const founders = Number(arg('founders', '80'));
  const seed = arg('seed', 't1');

  const run = await createTradingRun({
    name: `CLI ${seed}`,
    seed,
    founderCount: founders,
    steps: steps + 50,
  });
  await prisma.simulation.update({
    where: { id: run.simulationId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  console.log(`\nsimulation ${run.simulationId}`);
  console.log(`seed ${run.seed} · market ${run.marketSeed} · founders ${founders}\n`);

  const started = Date.now();
  for (let i = 0; i < steps; i++) {
    const report = await runTradingStep(run.simulationId);
    if (report.opened || report.closed || report.births || report.deaths) {
      console.log(
        `s${String(report.step).padStart(4)} open ${String(report.opened).padStart(3)} ` +
          `close ${String(report.closed).padStart(3)} pnl ${report.realisedPnlSol.toFixed(4).padStart(9)} ` +
          `born ${report.births} died ${report.deaths} alive ${report.aliveAfter}`,
      );
    }
    if (report.status !== 'RUNNING') {
      console.log(`\nrun ended at step ${report.step}: ${report.status}`);
      break;
    }
  }
  const elapsed = (Date.now() - started) / 1000;

  // --- generations --------------------------------------------------------
  const agents = await prisma.agent.findMany({
    where: { simulationId: run.simulationId },
    include: { traits: true },
  });
  const maxGen = agents.reduce((m, a) => Math.max(m, a.generation), 0);

  console.log('\nGEN   N  ALIVE  SURV   FITNESS  TRADES  WINRATE │ entrySpeed  pressure');
  for (let g = 0; g <= maxGen; g++) {
    const cohort = agents.filter((a) => a.generation === g);
    if (cohort.length === 0) continue;
    const alive = cohort.filter((a) => a.status === 'ALIVE').length;
    const traded = cohort.filter((a) => a.tradesClosed > 0);
    const trait = (k: string) =>
      cohort.reduce((s, a) => s + (a.traits.find((t) => t.key === k)?.value ?? 0.5), 0) / cohort.length;
    console.log(
      `${String(g).padStart(3)} ${String(cohort.length).padStart(3)}  ${String(alive).padStart(5)}  ` +
        `${((alive / cohort.length) * 100).toFixed(0).padStart(4)}%  ` +
        `${(cohort.reduce((s, a) => s + a.fitness, 0) / cohort.length).toFixed(3).padStart(7)}  ` +
        `${(cohort.reduce((s, a) => s + a.tradesClosed, 0) / cohort.length).toFixed(0).padStart(6)}  ` +
        `${traded.length ? ((traded.reduce((s, a) => s + a.wins / Math.max(1, a.tradesClosed), 0) / traded.length) * 100).toFixed(0).padStart(6) : '     -'}% │ ` +
        `${trait('entrySpeed').toFixed(3).padStart(10)}  ${trait('pressureFilter').toFixed(3).padStart(8)}`,
    );
  }

  // --- the invariant ------------------------------------------------------
  let drift = 0;
  for (const agent of agents) {
    const recomputed = await recomputeCapital(prisma, agent.id);
    if (toNum(agent.capitalLamports) !== recomputed) drift++;
  }
  const positions = await prisma.position.count({ where: { simulationId: run.simulationId } });
  const open = await prisma.position.count({
    where: { simulationId: run.simulationId, status: 'OPEN' },
  });
  const capital = agents.reduce((s, a) => s + toNum(a.capitalLamports), 0);

  console.log(`\nagents ${agents.length} · positions ${positions} (${open} still open)`);
  console.log(`total capital ${lamportsToSol(capital).toFixed(4)} SOL`);
  console.log(`ledger invariant: ${drift === 0 ? 'HOLDS for every agent' : `BROKEN on ${drift} agents`}`);
  console.log(`${steps} steps in ${elapsed.toFixed(1)}s (${(steps / elapsed).toFixed(1)} steps/s)`);
  void TRADING_TRAIT_KEYS;

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
