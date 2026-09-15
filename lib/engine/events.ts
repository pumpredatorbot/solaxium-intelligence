/**
 * Simulation events — the persisted activity feed.
 *
 * Every state change the UI narrates goes through here, so `/api/events` is a
 * faithful replay of what happened rather than a re-derivation.
 */

import type { Prisma } from '@prisma/client';
import type { EventType } from '@/lib/types';
import type { DbClient } from './ledger';

export interface EventInput {
  simulationId: string;
  type: EventType;
  cycle: number;
  message: string;
  agentId?: string | null;
  agentCode?: string | null;
  /** Arbitrary JSON payload; serialised as-is into the event row. */
  data?: unknown;
}

export async function emit(db: DbClient, event: EventInput): Promise<void> {
  await db.simulationEvent.create({
    data: {
      simulationId: event.simulationId,
      type: event.type,
      cycle: event.cycle,
      message: event.message,
      agentId: event.agentId ?? null,
      agentCode: event.agentCode ?? null,
      data: toJson(event.data),
    },
  });
}

export async function emitMany(db: DbClient, events: EventInput[]): Promise<void> {
  if (events.length === 0) return;
  await db.simulationEvent.createMany({
    data: events.map((event) => ({
      simulationId: event.simulationId,
      type: event.type,
      cycle: event.cycle,
      message: event.message,
      agentId: event.agentId ?? null,
      agentCode: event.agentCode ?? null,
      data: toJson(event.data),
    })),
  });
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}
