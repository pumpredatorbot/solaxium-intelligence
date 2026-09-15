/**
 * Headless simulation runner.
 *
 *   npm run simulate -- --cycles 60 --seed demo-1 --name "CLI run"
 *
 * Runs a full simulation without Next.js and prints a generation report. This
 * is the fastest way to sanity-check the economy after tuning /config.
 */

import { createSimulation, runCycle, startSimulation } from '@/lib/engine/engine';
import { prisma } from '@/lib/db';
import { lamportsToSol } from '@/lib/sol';

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const cycles = Number(arg('cycles', '60'));
  const seed = arg('seed');
  const name = arg('name', 'CLI run');
  const founders = Number(arg('founders', '3'));
  const verbose = process.argv.includes('--verbose');

  const overrides: Record<string, number> = {};
  for (const [flag, key] of [
    ['revenue-scale', 'REVENUE_SCALE'],
    ['cycle-cost', 'CYCLE_COST_SOL'],
    ['clone-threshold', 'CLONE_THRESHOLD_SOL'],
    ['initial-capital', 'INITIAL_CAPITAL_SOL'],
    ['max-live', 'MAX_LIVE_AGENTS'],
  ] as const) {
    const value = arg(flag);
    if (value !== undefined) overrides[key] = Number(value);
  }

  const { simulationId, seed: usedSeed } = await createSimulation({
    name,
    seed,
    founderCount: founders,
    config: overrides,
  });
  await startSimulation(simulationId);

  console.log(`\nSOLAXIUM INTELLIGENCE — headless run`);
  console.log(`simulation ${simulationId}`);
  console.log(`seed       ${usedSeed}`);
  console.log(`founders   ${founders}\n`);

  for (let i = 0; i < cycles; i++) {
    const report = await runCycle(simulationId);
    if (verbose) {
      for (const a of report.agents) {
        console.log(
          `c${String(report.cycle).padStart(3)} ${a.code} ${a.action.padEnd(17)} ${a.outcome.padEnd(8)} ` +
            `${a.capitalBeforeSol.toFixed(3)} → ${a.capitalAfterSol.toFixed(3)} SOL` +
            `${a.died ? '  💀 DEAD' : ''}${a.cloned ? `  ⧉ ${a.cloned.childCode}` : ''}`,
        );
      }
    } else if (report.births || report.deaths) {
      console.log(
        `c${String(report.cycle).padStart(3)} births ${report.births} deaths ${report.deaths} alive ${report.aliveAfter}`,
      );
    }
    if (report.status !== 'RUNNING') {
      console.log(`\nSimulation ended at cycle ${report.cycle}: ${report.status}`);
      break;
    }
  }

  const generations = await prisma.generation.findMany({
    where: { simulationId },
    orderBy: { number: 'asc' },
  });

  console.log('\nGEN  AGENTS  ALIVE  DEAD   AVG CAPITAL   AVG PROFIT   BEST');
  for (const g of generations) {
    console.log(
      `${String(g.number).padStart(3)}  ${String(g.agentCount).padStart(6)}  ${String(g.aliveCount).padStart(5)}  ${String(g.deadCount).padStart(4)}   ` +
        `${lamportsToSol(g.averageCapitalLamports).toFixed(4).padStart(11)}   ` +
        `${lamportsToSol(g.averageProfitLamports).toFixed(4).padStart(10)}   ${g.bestAgentCode ?? '-'}`,
    );
  }

  const agents = await prisma.agent.count({ where: { simulationId } });
  const alive = await prisma.agent.count({ where: { simulationId, status: 'ALIVE' } });
  const clones = await prisma.clone.count({ where: { simulationId } });
  console.log(
    `\ntotal agents ${agents} | alive ${alive} | dead ${agents - alive} | clones ${clones} | generations ${generations.length}`,
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
