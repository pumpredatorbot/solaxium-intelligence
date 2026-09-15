'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReplaySnapshot } from '@/lib/repo/replay';
import { useConsole } from './console-provider';
import { IconPause, IconPlay } from './nav-icons';

/**
 * Replay.
 *
 * Scrubbing asks the server to rebuild the population as it stood at a chosen
 * cycle. That reconstruction is a query over the append-only ledger, not a
 * stored checkpoint — so replay can never disagree with the live data, and any
 * cycle of a finished run is reachable.
 */

const PLAYBACK_MS = 420;

export function ReplayPanel({
  initialSnapshot,
  compact = false,
}: {
  initialSnapshot: ReplaySnapshot | null;
  compact?: boolean;
}) {
  const { simulation, running } = useConsole();
  const [snapshot, setSnapshot] = useState<ReplaySnapshot | null>(initialSnapshot);
  const [cycle, setCycle] = useState(initialSnapshot?.cycle ?? 0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const requestId = useRef(0);

  const maxCycle = snapshot?.maxCycle ?? simulation?.cycle ?? 0;

  const load = useCallback(
    async (target: number) => {
      if (!simulation) return;
      const id = ++requestId.current;
      setLoading(true);
      try {
        const response = await fetch(
          `/api/replay?simulationId=${simulation.id}&cycle=${target}`,
          { cache: 'no-store' },
        );
        if (!response.ok) return;
        const data = (await response.json()) as { snapshot: ReplaySnapshot | null };
        // Drop a response that a later scrub has already superseded.
        if (id === requestId.current && data.snapshot) setSnapshot(data.snapshot);
      } catch {
        // Transient.
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [simulation],
  );

  // In live mode the scrubber tracks the engine's head.
  useEffect(() => {
    if (mode !== 'live' || !simulation) return;
    setCycle(simulation.cycle);
  }, [mode, simulation]);

  useEffect(() => {
    if (mode !== 'replay') return;
    void load(cycle);
  }, [mode, cycle, load]);

  // Playback walks forward one cycle at a time and stops at the head.
  useEffect(() => {
    if (!playing || mode !== 'replay') return;
    const timer = setInterval(() => {
      setCycle((current) => {
        if (current >= maxCycle) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, PLAYBACK_MS);
    return () => clearInterval(timer);
  }, [playing, mode, maxCycle]);

  const enterReplay = () => {
    setMode('replay');
    void load(cycle);
  };

  if (!simulation) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2 className="label">Replay</h2>
        </div>
        <p className="px-3 py-8 text-center font-mono text-2xs text-ink-faint">
          No run to replay yet.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="label">Replay</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setMode('live');
              setPlaying(false);
            }}
            className={`chip ${mode === 'live' ? 'chip-active' : ''}`}
            aria-pressed={mode === 'live'}
          >
            Live
          </button>
          <button
            type="button"
            onClick={enterReplay}
            className={`chip ${mode === 'replay' ? 'chip-active' : ''}`}
            aria-pressed={mode === 'replay'}
          >
            Replay
          </button>
        </div>
      </div>

      <div className="space-y-3 p-3.5">
        {/* --- timeline --- */}
        <div>
          <div className="flex items-baseline justify-between font-mono text-3xs text-ink-faint">
            <span>cycle 0</span>
            <span className="tabular text-ink">
              {mode === 'live' ? `LIVE · c${simulation.cycle}` : `c${cycle}`}
              {loading && <span className="ml-1.5 text-ink-ghost">…</span>}
            </span>
            <span>cycle {maxCycle}</span>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(0, maxCycle)}
            value={cycle}
            disabled={mode === 'live'}
            onChange={(event) => {
              setPlaying(false);
              setCycle(Number(event.target.value));
            }}
            aria-label="Replay position in cycles"
            className="mt-2 h-1 w-full cursor-pointer appearance-none rounded-full bg-raised accent-cy disabled:cursor-not-allowed disabled:opacity-40
                       [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none
                       [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cy
                       [&::-webkit-slider-thumb]:shadow-[0_0_10px_-1px_rgba(34,224,240,0.9)]"
          />
        </div>

        {/* --- transport --- */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            disabled={mode !== 'replay'}
            className="btn-icon"
            aria-label={playing ? 'Pause replay' : 'Play replay'}
          >
            {playing ? <IconPause /> : <IconPlay />}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setCycle(0);
            }}
            disabled={mode !== 'replay'}
            className="btn"
          >
            Start
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setCycle(maxCycle);
            }}
            disabled={mode !== 'replay'}
            className="btn"
          >
            End
          </button>
          {running && mode === 'replay' && (
            <span className="ml-auto font-mono text-3xs text-ink-ghost">
              engine still running
            </span>
          )}
        </div>

        {/* --- reconstructed state --- */}
        {snapshot && (
          <dl className="grid grid-cols-4 gap-px overflow-hidden rounded border border-line bg-line">
            {[
              ['Alive', String(snapshot.alive), 'text-good'],
              ['Dead', String(snapshot.dead), 'text-bad'],
              ['Capital', snapshot.totalCapitalSol.toFixed(2), 'text-ink'],
              ['Gens', String(snapshot.generations), 'text-ink'],
            ].map(([label, value, tone]) => (
              <div key={label} className="bg-surface px-2.5 py-2">
                <dt className="label">{label}</dt>
                <dd className={`tabular mt-1 font-mono text-xs ${tone}`}>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {!compact && snapshot && snapshot.events.length > 0 && (
          <div>
            <div className="label mb-1.5">
              What happened at cycle {snapshot.cycle}
            </div>
            <ul className="max-h-[150px] space-y-1 overflow-y-auto">
              {snapshot.events.slice(0, 40).map((event) => (
                <li key={event.seq} className="flex gap-2 font-mono text-3xs">
                  {event.agentId ? (
                    <Link
                      href={`/agents/${event.agentId}`}
                      className="w-14 shrink-0 text-ink transition-colors hover:text-cy"
                    >
                      {event.agentCode}
                    </Link>
                  ) : (
                    <span className="w-14 shrink-0 text-ink-ghost">SYSTEM</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-ink-faint">{event.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
