/**
 * Process bootstrap: re-arm runners for simulations that were live.
 *
 * `Simulation.status` is persistent but the runner is an in-process timer, so
 * a restart — a redeploy, a crash, a platform migration — leaves a row saying
 * RUNNING with nothing actually advancing it. The console would then show a
 * live badge over a frozen simulation.
 *
 * This reconciles the two: on boot, every simulation the database still
 * considers RUNNING gets its loop back.
 *
 * It deliberately does not touch the engine. It only decides *which* runners
 * to arm; `runCycle` and the economy are untouched, and a resumed run
 * continues on its persisted RNG cursor exactly as a pause/resume would.
 */

import { prisma } from '@/lib/db';
import { getRunnerState, startRunner } from './runner';

export interface ResumeReport {
  /** Simulations whose loop was re-armed by this call. */
  resumed: string[];
  /** Simulations already being driven by a live runner in this process. */
  alreadyRunning: string[];
  /** Set when the database could not be reached; boot continues regardless. */
  error: string | null;
}

/**
 * Guard against a second bootstrap in the same process.
 *
 * Parked on globalThis because Next.js re-evaluates modules on hot reload, so
 * module-level state is not a reliable latch.
 */
const globalForBootstrap = globalThis as unknown as {
  __solaxiumBootstrapped?: boolean;
};

export async function resumeRunningSimulations(): Promise<ResumeReport> {
  const report: ResumeReport = { resumed: [], alreadyRunning: [], error: null };

  try {
    const live = await prisma.simulation.findMany({
      where: { status: 'RUNNING' },
      select: { id: true, name: true },
    });

    for (const simulation of live) {
      // Idempotence, first line of defence: never arm a loop that already
      // exists. (startRunner also clears any prior timer, so even a double
      // call cannot leave two intervals behind.)
      if (getRunnerState(simulation.id).running) {
        report.alreadyRunning.push(simulation.id);
        continue;
      }

      startRunner(simulation.id);
      report.resumed.push(simulation.id);
      console.log(
        `[bootstrap] resumed runner for "${simulation.name}" (${simulation.id})`,
      );
    }
  } catch (error) {
    // A database that is not up yet must never stop the web server from
    // starting — on Railway the app frequently boots before Postgres accepts
    // connections. The runner can be restarted from the UI.
    report.error = error instanceof Error ? error.message : String(error);
    console.error('[bootstrap] could not resume runners:', report.error);
  }

  return report;
}

/** Runs `resumeRunningSimulations` at most once per process. */
export async function bootstrapOnce(): Promise<ResumeReport | null> {
  if (globalForBootstrap.__solaxiumBootstrapped) return null;
  globalForBootstrap.__solaxiumBootstrapped = true;
  return resumeRunningSimulations();
}

/** Test seam: clears the once-per-process latch. */
export function resetBootstrapLatch(): void {
  globalForBootstrap.__solaxiumBootstrapped = false;
}
