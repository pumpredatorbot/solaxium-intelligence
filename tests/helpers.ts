import { prisma } from '@/lib/db';
import { postEntry } from '@/lib/engine/ledger';
import { solToLamports } from '@/lib/sol';

/** Wipes every table. Called between suites so runs cannot see each other. */
export async function resetDatabase(): Promise<void> {
  // Simulation cascades to everything else.
  await prisma.simulation.deleteMany({});
}

/** Deterministic config overrides that make a behaviour easy to provoke. */
export const FAST_DEATH_CONFIG = {
  INITIAL_CAPITAL_SOL: 0.2,
  CYCLE_COST_SOL: 0.5,
  CLONE_THRESHOLD_SOL: 999,
};



/**
 * Credits an agent through the real ledger so it crosses the clone threshold.
 *
 * Tests must not write `capitalLamports` directly — that would bypass the very
 * invariant the engine exists to maintain.
 */
export async function creditAgent(
  agentId: string,
  simulationId: string,
  sol: number,
  cycle = 0,
): Promise<void> {
  await postEntry(prisma, {
    agentId,
    simulationId,
    type: 'ADJUSTMENT',
    amountLamports: solToLamports(sol),
    cycle,
    metadata: { reason: 'test fixture' },
  });
}

/** Config that makes reproduction the only thing that can happen in a cycle. */
export const CLONE_READY_CONFIG = {
  INITIAL_CAPITAL_SOL: 1,
  CLONE_THRESHOLD_SOL: 5,
  CYCLE_COST_SOL: 0,
  MIN_AGE_FOR_CLONING: 0,
};
