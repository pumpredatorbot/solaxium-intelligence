/**
 * Captures a real pump.fun market into a replayable dataset.
 *
 *   npm run record                    # backfill 60 recent coins (default)
 *   npm run record -- --coins 150
 *   npm run record -- --live 600      # listen to the live stream for 600s
 *
 * READ-ONLY. This reads public pump.fun market data and writes rows to the
 * local database. It holds no key and cannot place an order.
 */

import { backfillPumpFun, captureLivePumpFun } from '@/lib/market/pumpfun/recorder';
import { PumpFunUnreachableError } from '@/lib/market/pumpfun/client';
import { prisma } from '@/lib/db';

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? '' : null;
}

async function main() {
  const live = arg('live');
  const note = (text: string) => console.log(`  ${text}`);

  console.log('SOLAXIUM · pump.fun capture (read-only, no wallet, no transaction)\n');

  const result = live
    ? await captureLivePumpFun({ durationSec: Number(live) || 600, onProgress: note })
    : await backfillPumpFun({
        coins: Number(arg('coins')) || 60,
        maxTradesPerCoin: Number(arg('max-trades')) || 2000,
        minTrades: Number(arg('min-trades')) || 4,
        onProgress: note,
      });

  console.log(`
dataset    ${result.key}
id         ${result.datasetId}
window     ${result.windowStart.toISOString()} → ${result.windowEnd.toISOString()}
tokens     ${result.tokenCount}  (dropped ${result.dropped} with too little history)
ticks      ${result.tickCount}
trades     ${result.tradeCount}
steps      ${result.steps} @ ${result.stepMs}ms
doubled    ${(result.doubleRate * 100).toFixed(1)}%
rugged     ${(result.rugRate * 100).toFixed(1)}%
median peak ${result.medianPeakMultiple.toFixed(2)}x

Trade it:  npm run trade -- --dataset ${result.datasetId}
`);
}

main()
  .catch((error) => {
    if (error instanceof PumpFunUnreachableError) {
      console.error(`\n${error.message}\n`);
      process.exitCode = 2;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
