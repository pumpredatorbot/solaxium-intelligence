'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Driving a run from the browser.
 *
 * WHY THIS EXISTS: the engine's own runner is an in-process timer. On a
 * long-lived Node host it ticks on its own, which is the right design. On a
 * serverless host — Vercel, and any platform that freezes a function between
 * requests — that timer stops the moment a response is sent, so a run marked
 * RUNNING sits at the same step forever while the console shows a live badge
 * over a frozen simulation. That is exactly the symptom of SIM TIME advancing a
 * few seconds while REAL TIME reads zero.
 *
 * So the browser becomes the clock: while this is on, the page asks the server
 * to advance the run. It is honest about what it is — the run only advances
 * while someone has the page open — and it is explicitly a toggle rather than
 * something that happens silently, because a clock that runs when nobody
 * expects it is worse than no clock.
 *
 * Each request advances a batch of steps. One step per round trip would cap the
 * run at the network's latency, not the engine's speed.
 */

export interface ClockState {
  running: boolean;
  /** Steps advanced by this clock in this session. */
  advanced: number;
  /** Measured steps per second, from the last few batches. */
  rate: number;
  error: string | null;
  finished: boolean;
}

const BATCH_BY_SPEED: Record<number, number> = { 1: 4, 2: 8, 5: 16, 10: 28, 25: 40 };

export function useBrowserClock(simulationId: string | null, onAdvance: () => void) {
  const [state, setState] = useState<ClockState>({
    running: false, advanced: 0, rate: 0, error: null, finished: false,
  });
  const [speed, setSpeed] = useState(5);

  const loop = useRef<{ cancelled: boolean } | null>(null);
  const onAdvanceRef = useRef(onAdvance);
  onAdvanceRef.current = onAdvance;

  const stop = useCallback(() => {
    if (loop.current) loop.current.cancelled = true;
    loop.current = null;
    setState((s) => ({ ...s, running: false }));
  }, []);

  const start = useCallback(() => {
    if (!simulationId || loop.current) return;
    const token = { cancelled: false };
    loop.current = token;
    setState((s) => ({ ...s, running: true, error: null, finished: false }));

    (async () => {
      const samples: number[] = [];

      while (!token.cancelled) {
        const batch = BATCH_BY_SPEED[speed] ?? 8;
        const startedAt = performance.now();

        try {
          const response = await fetch('/api/simulation/tick', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ simulationId, steps: batch, force: true }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload?.error?.message ?? payload?.error ?? `status ${response.status}`);
          }

          const report = payload.data ?? payload;
          const advanced: number = report.advanced ?? 1;
          const elapsed = (performance.now() - startedAt) / 1000;
          samples.push(advanced / Math.max(elapsed, 0.001));
          if (samples.length > 5) samples.shift();

          if (token.cancelled) break;
          setState((s) => ({
            ...s,
            advanced: s.advanced + advanced,
            rate: samples.reduce((a, b) => a + b, 0) / samples.length,
          }));
          onAdvanceRef.current();

          if (report.status && report.status !== 'RUNNING') {
            setState((s) => ({ ...s, running: false, finished: true }));
            break;
          }
        } catch (cause) {
          if (token.cancelled) break;
          setState((s) => ({
            ...s,
            running: false,
            error: cause instanceof Error ? cause.message : String(cause),
          }));
          break;
        }

        // A breath between batches, so a fast engine does not saturate the
        // connection and starve the console's own polling.
        await new Promise((resolve) => setTimeout(resolve, 120));
      }

      if (loop.current === token) loop.current = null;
    })();
  }, [simulationId, speed]);

  // Never leave a loop running behind a closed page.
  useEffect(() => stop, [stop]);
  // A different run means the old clock is meaningless.
  useEffect(() => { stop(); }, [simulationId, stop]);

  return { ...state, speed, setSpeed, start, stop };
}
