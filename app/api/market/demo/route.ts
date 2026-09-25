import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/api';
import { seedDemoMarket } from '@/lib/market/demo-market';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Generating and writing a few thousand ticks takes longer than a default
// serverless budget.
export const maxDuration = 60;

/**
 * Seeds the locally generated market.
 *
 * Exists as a route, not just a script, because on a serverless host there is
 * no shell to run a script in — and without a dataset that stores its ticks,
 * the recorded-path panels have nothing to show.
 *
 * The data is labelled as synthetic in the dataset's provenance, and the
 * console reads that provenance, so this cannot surface as real pump.fun
 * activity.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  return handle(async () =>
    seedDemoMarket({
      tokens: typeof body.tokens === 'number' ? body.tokens : undefined,
    }),
  );
}
