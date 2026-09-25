import { NextRequest } from 'next/server';
import { fail, handle, readJson } from '@/lib/api';
import { prisma } from '@/lib/db';
import { runCycle } from '@/lib/engine/engine';
import { runTradingStep } from '@/lib/engine/trading-engine';
import { getActiveSimulation } from '@/lib/repo/queries';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Advances a simulation.
 *
 * `steps` advances several in one request, which matters on a serverless host:
 * there the in-process runner is frozen between invocations, so the browser has
 * to be the clock, and one network round trip per step would cap the run at
 * roughly two steps a second regardless of how fast the engine is.
 *
 * `force` single-steps a paused simulation. Which engine advances is a property
 * of the run, not of this route.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request);
  const simulationId =
    typeof body.simulationId === 'string'
      ? body.simulationId
      : (await getActiveSimulation())?.id;

  if (!simulationId) return fail('No simulation to advance', 404);

  const requested = typeof body.steps === 'number' ? Math.floor(body.steps) : 1;
  // Capped so one request cannot outlive a serverless invocation's budget.
  const steps = Math.max(1, Math.min(requested, 40));
  const force = body.force === true;

  return handle(async () => {
    const simulation = await prisma.simulation.findUnique({
      where: { id: simulationId },
      select: { mode: true },
    });
    // Thrown, not returned: `handle` serialises whatever the callback returns,
    // so returning a Response here would ship the Response object as JSON.
    if (!simulation) throw new Error(`Unknown simulation ${simulationId}`);

    if (simulation.mode === 'TRADING') {
      let report = await runTradingStep(simulationId, { force });
      let advanced = 1;
      // A completed run stops here rather than throwing on the next step.
      while (advanced < steps && report.status === 'RUNNING') {
        report = await runTradingStep(simulationId, { force });
        advanced++;
      }
      return { ...report, advanced };
    }

    let report = await runCycle(simulationId, {
      force,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
    });
    let advanced = 1;
    while (advanced < steps && report.status === 'RUNNING') {
      report = await runCycle(simulationId, { force });
      advanced++;
    }
    return { ...report, advanced };
  });
}
