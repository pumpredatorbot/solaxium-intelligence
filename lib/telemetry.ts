/**
 * Telemetry derivation.
 *
 * The engine records one AGENT_ACTION row per agent per cycle, carrying the
 * decision, its reasoning, the confidence, the market it was taken in and the
 * capital before and after. The telemetry feed renders that single row as the
 * sequence of steps it actually represents.
 *
 * Every line below is backed by a real recorded field. Nothing is invented: if
 * a field is absent the line is not emitted.
 */

import type { EventDTO } from '@/lib/repo/serialize';

export type TelemetryKind =
  | 'PERCEPTION'
  | 'ANALYSIS'
  | 'DECISION'
  | 'EXECUTION'
  | 'REVENUE'
  | 'EXPENSE'
  | 'CAPITAL'
  | 'MEMORY'
  | 'LEARNING'
  | 'ADAPTATION'
  | 'LIFECYCLE';

export interface TelemetryLine {
  id: string;
  seq: number;
  cycle: number;
  agentCode: string | null;
  agentId: string | null;
  kind: TelemetryKind;
  message: string;
  /** Ordering within one source event. */
  order: number;
}

interface ActionData {
  action?: string;
  outcome?: string;
  costSol?: number;
  revenueSol?: number;
  capitalBeforeSol?: number;
  capitalAfterSol?: number;
  reasoning?: string;
  confidence?: number;
  provider?: string;
  riskLevel?: string;
}

const LEARNING_ACTIONS = new Set(['RESEARCH']);
const ANALYSIS_ACTIONS = new Set(['CREATE_PRODUCT', 'MARKETING']);

/** Expands one persisted event into the telemetry steps it represents. */
export function deriveTelemetry(event: EventDTO): TelemetryLine[] {
  const base = {
    seq: event.seq,
    cycle: event.cycle,
    agentCode: event.agentCode,
    agentId: event.agentId,
  };
  const line = (order: number, kind: TelemetryKind, message: string): TelemetryLine => ({
    ...base,
    id: `${event.seq}-${order}`,
    kind,
    message,
    order,
  });

  switch (event.type) {
    case 'AGENT_ACTION': {
      const data = (event.data ?? {}) as ActionData;
      const out: TelemetryLine[] = [];

      if (typeof data.confidence === 'number' && data.action) {
        out.push(
          line(
            0,
            'DECISION',
            `Decision ${data.action} · confidence ${(data.confidence * 100).toFixed(0)}%`,
          ),
        );
      }
      if (data.reasoning) {
        const kind: TelemetryKind = LEARNING_ACTIONS.has(data.action ?? '')
          ? 'LEARNING'
          : ANALYSIS_ACTIONS.has(data.action ?? '')
            ? 'ANALYSIS'
            : 'PERCEPTION';
        out.push(line(1, kind, truncate(data.reasoning, 110)));
      }
      if (data.action && data.outcome) {
        out.push(line(2, 'EXECUTION', `Executed ${data.action} → ${data.outcome}`));
      }
      if (typeof data.revenueSol === 'number' && data.revenueSol > 0) {
        out.push(line(3, 'REVENUE', `Revenue +${data.revenueSol.toFixed(4)} SOL`));
      }
      if (typeof data.costSol === 'number' && data.costSol > 0) {
        out.push(line(4, 'EXPENSE', `Cost −${data.costSol.toFixed(4)} SOL`));
      }
      if (
        typeof data.capitalBeforeSol === 'number' &&
        typeof data.capitalAfterSol === 'number'
      ) {
        out.push(
          line(
            5,
            'CAPITAL',
            `Capital ${data.capitalBeforeSol.toFixed(4)} → ${data.capitalAfterSol.toFixed(4)} SOL`,
          ),
        );
      }
      return out;
    }

    case 'AGENT_BORN':
      return [line(0, 'LIFECYCLE', event.message)];

    case 'AGENT_DEAD':
      return [line(0, 'LIFECYCLE', event.message)];

    case 'CLONE_CREATED':
      return [line(0, 'ADAPTATION', event.message)];

    case 'GENERATION_STARTED':
    case 'GENERATION_ENDED':
      return [line(0, 'ADAPTATION', event.message)];

    // Revenue and expense events are already covered by the AGENT_ACTION
    // expansion above; emitting them again would double every cashflow.
    case 'AGENT_REVENUE':
    case 'AGENT_EXPENSE':
      return [];

    default:
      return [line(0, 'PERCEPTION', event.message)];
  }
}

export const TELEMETRY_TONE: Record<TelemetryKind, string> = {
  PERCEPTION: 'text-ink-muted',
  ANALYSIS: 'text-az',
  DECISION: 'text-cy',
  EXECUTION: 'text-vi',
  REVENUE: 'text-good',
  EXPENSE: 'text-ink-faint',
  CAPITAL: 'text-ink',
  MEMORY: 'text-ink-muted',
  LEARNING: 'text-az',
  ADAPTATION: 'text-mg',
  LIFECYCLE: 'text-warn',
};

/**
 * Which cognitive module a persisted event lights up in the Core. The mapping
 * is fixed and derived from the event type, so the ring reflects what the
 * population is actually doing.
 */
export const MODULE_BY_KIND: Record<TelemetryKind, string> = {
  PERCEPTION: 'PERCEPTION',
  ANALYSIS: 'ANALYSIS',
  DECISION: 'DECISION',
  EXECUTION: 'EXECUTION',
  REVENUE: 'EXECUTION',
  EXPENSE: 'EXECUTION',
  CAPITAL: 'JUDGMENT',
  MEMORY: 'MEMORY',
  LEARNING: 'LEARNING',
  ADAPTATION: 'ADAPTATION',
  LIFECYCLE: 'MEMORY',
};

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
