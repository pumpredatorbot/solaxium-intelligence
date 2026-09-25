/**
 * Seeds a locally generated market as a RECORDED dataset.
 *
 *   npm run demo:market
 *   npm run demo:market -- --tokens 240
 *
 * This is NOT real market data — see lib/market/demo-market.ts. For the real
 * thing, use `npm run record`.
 */

import { seedDemoMarket } from '@/lib/market/demo-market';
import { prisma } from '@/lib/db';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

seedDemoMarket({ tokens: Number(arg('tokens', '140')) })
  .then((result) => {
    console.log(`
dataset    ${result.key}
id         ${result.datasetId}
tokens     ${result.tokenCount}
ticks      ${result.tickCount}
steps      ${result.steps} @ ${result.stepMs}ms
doubled    ${(result.doubleRate * 100).toFixed(1)}%
rugged     ${(result.rugRate * 100).toFixed(1)}%

This is NOT real pump.fun data. Run "npm run record" for that.
Trade it:  npm run trade -- --dataset ${result.datasetId}
`);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
