/**
 * Live simulation runner.
 *
 * Owns the wall-clock loop that repeatedly calls `runCycle`. It is a
 * process-level singleton parked on globalThis so Next.js HMR cannot spawn a
 * second loop for the same simulation.
 *
 * The loop is self-healing: a cycle that throws pauses the run and records the
 * error rather than leaving a dangling interval that keeps failing.
 */

import {
  DEFAULT_SPEED,
  speedSchedule,
  type SpeedMultiplier,
} from '@/config/simulation';
import { prisma } from '@/lib/db';
import { pauseSimulation, runCycle, type CycleReport } from './engine';

export interface RunnerState {
  simulationId: string;
  /** Cycles per second. */
  speed: SpeedMultiplier;
  running: boolean;
  lastCycleAt: number | null;
  lastError: string | null;
  cyclesRun: number;
}

interface RunnerEntry extends RunnerState {
  timer: NodeJS.Timeout | null;
  busy: boolean;
}

const globalForRunner = globalThis as unknown as {
  __solaxiumRunners?: Map<string, RunnerEntry>;
};

const runners: Map<string, RunnerEntry> = (globalForRunner.__solaxiumRunners ??= new Map());

function entryFor(simulationId: string): RunnerEntry {
  let entry = runners.get(simulationId);
  if (!entry) {
    entry = {
      simulationId,
      speed: DEFAULT_SPEED,
      running: false,
      lastCycleAt: null,
      lastError: null,
      cyclesRun: 0,
      timer: null,
      busy: false,
    };
    runners.set(simulationId, entry);
  }
  return entry;
}

export function getRunnerState(simulationId: string): RunnerState {
  const { timer: _timer, busy: _busy, ...state } = entryFor(simulationId);
  return state;
}

export function setSpeed(simulationId: string, speed: SpeedMultiplier): RunnerState {
  const entry = entryFor(simulationId);
  entry.speed = speed;
  if (entry.running) {
    schedule(entry); // re-arm at the new interval
  }
  return getRunnerState(simulationId);
}

/** Starts (or re-arms) the loop. Safe to call when already running. */
export function startRunner(simulationId: string, speed?: SpeedMultiplier): RunnerState {
  const entry = entryFor(simulationId);
  if (speed) entry.speed = speed;
  entry.lastError = null;
  entry.running = true;
  schedule(entry);
  return getRunnerState(simulationId);
}

export function stopRunner(simulationId: string): RunnerState {
  const entry = entryFor(simulationId);
  entry.running = false;
  if (entry.timer) {
    clearInterval(entry.timer);
    entry.timer = null;
  }
  return getRunnerState(simulationId);
}

export function stopAllRunners(): void {
  for (const id of runners.keys()) stopRunner(id);
}

/**
 * Waits for an in-flight cycle to finish.
 *
 * `stopRunner` only clears the timer; a cycle already running keeps going and
 * will happily write to rows a concurrent reset is deleting. Anything that
 * mutates a simulation out from under the loop must drain it first.
 */
export async function drainRunner(simulationId: string, timeoutMs = 8000): Promise<boolean> {
  const entry = runners.get(simulationId);
  if (!entry) return true;

  const deadline = Date.now() + timeoutMs;
  while (entry.busy && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !entry.busy;
}

function schedule(entry: RunnerEntry): void {
  if (entry.timer) clearInterval(entry.timer);
  const { intervalMs } = speedSchedule(entry.speed);
  entry.timer = setInterval(() => void tick(entry), intervalMs);
  if (typeof entry.timer.unref === 'function') entry.timer.unref();
}

async function tick(entry: RunnerEntry): Promise<void> {
  // A slow cycle must not stack: skip this beat rather than overlapping runs,
  // which would corrupt the RNG cursor.
  if (entry.busy || !entry.running) return;
  entry.busy = true;

  try {
    const simulation = await prisma.simulation.findUnique({
      where: { id: entry.simulationId },
      select: { status: true },
    });

    if (!simulation || simulation.status !== 'RUNNING') {
      stopRunner(entry.simulationId);
      return;
    }

    const { batch } = speedSchedule(entry.speed);
    let report: CycleReport | null = null;
    for (let i = 0; i < batch; i++) {
      report = await runCycle(entry.simulationId);
      entry.cyclesRun++;
      if (report.status !== 'RUNNING') break;
    }

    entry.lastCycleAt = Date.now();
    if (report && report.status !== 'RUNNING') stopRunner(entry.simulationId);
  } catch (error) {
    entry.lastError = error instanceof Error ? error.message : String(error);
    console.error(`[runner:${entry.simulationId}] cycle failed:`, error);
    stopRunner(entry.simulationId);
    try {
      await pauseSimulation(entry.simulationId);
    } catch {
      // The simulation may already be gone; nothing further to do.
    }
  } finally {
    entry.busy = false;
  }
}
