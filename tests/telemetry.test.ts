import { describe, expect, it } from 'vitest';
import { deriveTelemetry, MODULE_BY_KIND, TELEMETRY_TONE } from '@/lib/telemetry';
import { isSpeedMultiplier, speedSchedule, SPEED_MULTIPLIERS } from '@/config/simulation';
import type { EventDTO } from '@/lib/repo/serialize';

function event(partial: Partial<EventDTO> & Pick<EventDTO, 'type'>): EventDTO {
  return {
    seq: 1,
    cycle: 7,
    agentId: 'agent-1',
    agentCode: 'SX-001',
    message: 'a message',
    data: null,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe('telemetry derivation', () => {
  it('expands one recorded action into its real steps', () => {
    const lines = deriveTelemetry(
      event({
        type: 'AGENT_ACTION',
        data: {
          action: 'OFFER_SERVICE',
          outcome: 'SUCCESS',
          costSol: 0.03,
          revenueSol: 0.41,
          capitalBeforeSol: 1.24,
          capitalAfterSol: 1.62,
          reasoning: 'Cheap and reliable given a short runway.',
          confidence: 0.82,
        },
      }),
    );

    const kinds = lines.map((l) => l.kind);
    expect(kinds).toEqual(['DECISION', 'PERCEPTION', 'EXECUTION', 'REVENUE', 'EXPENSE', 'CAPITAL']);
    expect(lines[0].message).toContain('82%');
    expect(lines[3].message).toContain('0.4100');
    expect(lines[5].message).toContain('1.2400');
    expect(lines[5].message).toContain('1.6200');
    // Ordering keys must be unique so React keys are stable.
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
  });

  /** The feed must never state something the event did not record. */
  it('omits a step whose field is absent', () => {
    const lines = deriveTelemetry(
      event({ type: 'AGENT_ACTION', data: { action: 'REST', outcome: 'SUCCESS' } }),
    );
    const kinds = lines.map((l) => l.kind);

    expect(kinds).toContain('EXECUTION');
    expect(kinds).not.toContain('REVENUE');
    expect(kinds).not.toContain('EXPENSE');
    expect(kinds).not.toContain('CAPITAL');
    expect(kinds).not.toContain('DECISION'); // no confidence recorded
  });

  it('emits nothing for a zero cashflow', () => {
    const lines = deriveTelemetry(
      event({
        type: 'AGENT_ACTION',
        data: { action: 'REST', outcome: 'SUCCESS', costSol: 0, revenueSol: 0 },
      }),
    );
    expect(lines.map((l) => l.kind)).not.toContain('REVENUE');
    expect(lines.map((l) => l.kind)).not.toContain('EXPENSE');
  });

  it('does not double-count cashflow already covered by the action', () => {
    expect(deriveTelemetry(event({ type: 'AGENT_REVENUE' }))).toHaveLength(0);
    expect(deriveTelemetry(event({ type: 'AGENT_EXPENSE' }))).toHaveLength(0);
  });

  it('routes lifecycle and adaptation events to the right kind', () => {
    expect(deriveTelemetry(event({ type: 'AGENT_BORN' }))[0].kind).toBe('LIFECYCLE');
    expect(deriveTelemetry(event({ type: 'AGENT_DEAD' }))[0].kind).toBe('LIFECYCLE');
    expect(deriveTelemetry(event({ type: 'CLONE_CREATED' }))[0].kind).toBe('ADAPTATION');
    expect(deriveTelemetry(event({ type: 'GENERATION_STARTED' }))[0].kind).toBe('ADAPTATION');
  });

  it('classifies research as learning and marketing as analysis', () => {
    const research = deriveTelemetry(
      event({ type: 'AGENT_ACTION', data: { action: 'RESEARCH', reasoning: 'Studying.' } }),
    );
    expect(research.find((l) => l.message === 'Studying.')?.kind).toBe('LEARNING');

    const marketing = deriveTelemetry(
      event({ type: 'AGENT_ACTION', data: { action: 'MARKETING', reasoning: 'Buying reach.' } }),
    );
    expect(marketing.find((l) => l.message === 'Buying reach.')?.kind).toBe('ANALYSIS');
  });

  it('truncates long reasoning rather than breaking the layout', () => {
    const lines = deriveTelemetry(
      event({ type: 'AGENT_ACTION', data: { action: 'REST', reasoning: 'x'.repeat(400) } }),
    );
    expect(lines[0].message.length).toBeLessThanOrEqual(110);
    expect(lines[0].message.endsWith('…')).toBe(true);
  });

  it('carries the agent identity through every derived line', () => {
    const lines = deriveTelemetry(
      event({
        type: 'AGENT_ACTION',
        agentCode: 'SX-042',
        agentId: 'abc',
        cycle: 19,
        data: { action: 'SAVE', outcome: 'SUCCESS', confidence: 0.5 },
      }),
    );
    for (const line of lines) {
      expect(line.agentCode).toBe('SX-042');
      expect(line.agentId).toBe('abc');
      expect(line.cycle).toBe(19);
    }
  });

  it('has a tone and a Core module for every kind it can emit', () => {
    const kinds = new Set(
      [
        ...deriveTelemetry(
          event({
            type: 'AGENT_ACTION',
            data: {
              action: 'RESEARCH',
              outcome: 'SUCCESS',
              costSol: 1,
              revenueSol: 1,
              capitalBeforeSol: 1,
              capitalAfterSol: 1,
              reasoning: 'r',
              confidence: 0.5,
            },
          }),
        ),
        ...deriveTelemetry(event({ type: 'AGENT_BORN' })),
        ...deriveTelemetry(event({ type: 'CLONE_CREATED' })),
      ].map((l) => l.kind),
    );

    for (const kind of kinds) {
      expect(TELEMETRY_TONE[kind]).toBeTruthy();
      expect(MODULE_BY_KIND[kind]).toBeTruthy();
    }
  });
});

describe('playback speed', () => {
  it('accepts only the published multipliers', () => {
    for (const multiplier of SPEED_MULTIPLIERS) expect(isSpeedMultiplier(multiplier)).toBe(true);
    for (const bad of [0, -1, 3, 100, '5', null, undefined, Number.NaN]) {
      expect(isSpeedMultiplier(bad)).toBe(false);
    }
  });

  it('reconstructs the requested rate from interval and batch', () => {
    for (const multiplier of SPEED_MULTIPLIERS) {
      const { intervalMs, batch } = speedSchedule(multiplier);
      expect(intervalMs).toBeGreaterThanOrEqual(80);
      expect(batch).toBeGreaterThanOrEqual(1);
      // cycles per second = batch / (interval / 1000)
      expect((batch * 1000) / intervalMs).toBeCloseTo(multiplier, 1);
    }
  });

  it('batches instead of scheduling an unservable timer', () => {
    expect(speedSchedule(25).batch).toBeGreaterThan(1);
    expect(speedSchedule(1).batch).toBe(1);
    expect(speedSchedule(0.5).intervalMs).toBe(2000);
  });

  it('falls back to a sane schedule for a nonsense rate', () => {
    expect(speedSchedule(0).intervalMs).toBe(1000);
    expect(speedSchedule(-4).intervalMs).toBe(1000);
  });
});
