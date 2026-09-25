'use client';

import { SPEED_MULTIPLIERS, type SpeedMultiplier } from '@/config/simulation';
import { formatClock, useConsole } from './console-provider';
import { IconPause, IconPlay, IconReset, IconStep, IconStop } from './nav-icons';

/**
 * Mission control.
 *
 * Every control here drives the real engine through /api/simulation/*. The
 * simulation clock counts cycles at the configured cadence; the real clock
 * counts wall time this client has observed the run for.
 */
export function Topbar() {
  const {
    simulation,
    stats,
    runner,
    running,
    busy,
    error,
    clearError,
    realElapsedMs,
    start,
    pause,
    stop,
    reset,
    step,
    setSpeed,
    solana,
    browserClock,
    browserClockRate,
  } = useConsole();

  const speed = runner?.speed ?? 1;
  const cycle = simulation?.cycle ?? 0;
  // The simulation clock is derived, not stored: cycles elapsed at 1 cycle
  // per simulated second.
  const simulatedMs = cycle * 1000;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-abyss/90 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 pl-14 lg:pl-4">
        {/* --- mode ------------------------------------------------------- */}
        <div
          className="flex items-center gap-0.5 rounded border border-line-strong bg-raised/60 p-0.5"
          role="group"
          aria-label="Execution mode"
        >
          <span className="flex items-center gap-1.5 rounded bg-cy/[0.1] px-2.5 py-1 font-mono text-3xs uppercase tracking-widest2 text-cy">
            <span className="h-1.5 w-1.5 rounded-full bg-cy" />
            Simulation
          </span>
          <span
            className="flex cursor-not-allowed items-center gap-1.5 px-2.5 py-1 font-mono text-3xs uppercase tracking-widest2 text-ink-ghost"
            title="Live Solana is not implemented in V1. No wallet, no keypair, no broadcast transaction."
            aria-disabled="true"
          >
            <span className="h-1.5 w-1.5 rounded-full border border-ink-ghost" />
            Live Solana
            <span className="ml-0.5 rounded border border-line-strong px-1 text-[9px] leading-[14px]">
              V2
            </span>
          </span>
        </div>

        {/* --- clocks ------------------------------------------------------ */}
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded border border-line bg-surface/70 px-3.5 py-1.5">
          <Clock label="Sim time" value={formatClock(simulatedMs)} />
          <Clock label="Real time" value={formatClock(realElapsedMs)} />
          <Clock label="Cycle" value={cycle.toLocaleString()} accent />
          <Clock label="Gen" value={String(stats?.generations ?? 0)} />
        </dl>

        {/* --- transport --------------------------------------------------- */}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto lg:ml-auto">
          <span
            className={[
              'flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-3xs uppercase tracking-widest2',
              running
                ? 'border-good/40 bg-good/[0.08] text-good'
                : 'border-line-strong text-ink-faint',
            ].join(' ')}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${running ? 'animate-breathe bg-good' : 'bg-ink-ghost'}`} />
            {simulation?.status ?? 'No run'}
          </span>

          {/* Said out loud, because the page silently advancing the run would
              be worse than the run not advancing at all. */}
          {browserClock ? (
            <span
              className="flex items-center gap-1.5 rounded border border-cy-deep bg-cy/[0.08] px-2 py-1
                         font-mono text-3xs uppercase tracking-widest2 text-cy"
              title="This host freezes the engine's own timer between requests, so this page is advancing the run. It keeps running only while this tab is open."
            >
              <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-cy" />
              Driven here · {browserClockRate.toFixed(1)}/s
            </span>
          ) : null}

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy !== null || running}
              className="btn-icon"
              title={simulation ? 'Start / resume' : 'Create and start a simulation'}
              aria-label="Start"
            >
              <IconPlay />
            </button>
            <button
              type="button"
              onClick={() => void pause()}
              disabled={busy !== null || !running}
              className="btn-icon"
              title="Pause"
              aria-label="Pause"
            >
              <IconPause />
            </button>
            <button
              type="button"
              onClick={() => void step()}
              disabled={busy !== null || !simulation || running}
              className="btn-icon"
              title="Advance one cycle"
              aria-label="Step one cycle"
            >
              <IconStep />
            </button>
            <button
              type="button"
              onClick={() => void stop()}
              disabled={busy !== null || !simulation || simulation.status === 'STOPPED'}
              className="btn-icon hover:border-bad/50 hover:text-bad"
              title="Stop (terminal)"
              aria-label="Stop"
            >
              <IconStop />
            </button>
            <button
              type="button"
              onClick={() => void reset()}
              disabled={busy !== null || !simulation}
              className="btn-icon hover:border-bad/50 hover:text-bad"
              title="Reset to cycle 0"
              aria-label="Reset"
            >
              <IconReset />
            </button>
          </div>

          <div
            className="flex items-center gap-0.5 rounded border border-line-strong bg-raised/60 p-0.5"
            role="group"
            aria-label="Playback speed"
          >
            {SPEED_MULTIPLIERS.map((multiplier) => (
              <button
                key={multiplier}
                type="button"
                onClick={() => void setSpeed(multiplier as SpeedMultiplier)}
                aria-pressed={speed === multiplier}
                className={[
                  'rounded px-1.5 py-1 font-mono text-3xs tabular transition-colors',
                  speed === multiplier
                    ? 'bg-cy/[0.12] text-cy'
                    : 'text-ink-faint hover:text-ink-muted',
                ].join(' ')}
              >
                {multiplier}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* --- notices ------------------------------------------------------- */}
      {error && (
        <div className="flex items-center gap-3 border-t border-bad/25 bg-bad/[0.06] px-4 py-1.5">
          <span className="font-mono text-3xs uppercase tracking-widest2 text-bad">Engine</span>
          <span className="min-w-0 flex-1 truncate font-mono text-2xs text-ink-muted">{error}</span>
          <button type="button" onClick={clearError} className="label hover:text-ink">
            Dismiss
          </button>
        </div>
      )}
      {solana.realValueEnabled && (
        <div className="border-t border-warn/30 bg-warn/[0.08] px-4 py-1.5 font-mono text-2xs text-warn">
          Real-value mode is enabled. V1 is not built for this.
        </div>
      )}
    </header>
  );
}

function Clock({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col leading-none">
      <dt className="label">{label}</dt>
      <dd className={`tabular mt-1 font-mono text-xs ${accent ? 'text-cy' : 'text-ink'}`}>
        {value}
      </dd>
    </div>
  );
}
