'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SPEEDS, type SpeedName } from '@/config/simulation';
import type { RunnerState } from '@/lib/engine/runner';
import type { SimulationSummary } from '@/lib/repo/queries';
import type { DashboardStats } from '@/lib/repo/queries';

interface StatusResponse {
  simulation: SimulationSummary | null;
  runner: RunnerState | null;
  stats: DashboardStats | null;
  aiProvider: string;
  solana: { mode: string; network: string; realValueEnabled: boolean };
}

export function SimulationControls({
  initial,
  simulationId,
}: {
  initial: StatusResponse;
  simulationId: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusResponse>(initial);
  const [speed, setSpeedState] = useState<SpeedName>(initial.runner?.speed ?? 'NORMAL');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const activeId = status.simulation?.id ?? simulationId;
  const running = status.simulation?.status === 'RUNNING';

  const refresh = useCallback(async () => {
    try {
      const query = activeId ? `?simulationId=${activeId}` : '';
      const response = await fetch(`/api/simulation/status${query}`, { cache: 'no-store' });
      if (!response.ok) return;
      setStatus(await response.json());
    } catch {
      // Ignore: the next poll retries.
    }
  }, [activeId]);

  // Poll while running so cycle/capital counters track the engine.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const call = async (
    endpoint: string,
    body: Record<string, unknown> = {},
    label = endpoint,
  ) => {
    setBusy(label);
    setError(null);
    try {
      const response = await fetch(`/api/simulation/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulationId: activeId, ...body }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'Request failed');
        return null;
      }
      await refresh();
      // Server components (agent lists, generations) need the new data too.
      startTransition(() => router.refresh());
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const onStart = async () => {
    const data = await call('start', { speed, founderCount: 3 }, 'start');
    if (data?.simulation?.id && data.simulation.id !== activeId) {
      router.push(`/simulation?simulationId=${data.simulation.id}`);
    }
  };

  const onSpeed = async (next: SpeedName) => {
    setSpeedState(next);
    if (activeId && running) await call('speed', { speed: next }, `speed-${next}`);
  };

  const simulation = status.simulation;
  const stats = status.stats;

  return (
    <div className="space-y-3">
      <div className="panel">
        <div className="panel-head">
          <h2 className="label">Controls</h2>
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${running ? 'animate-pulse-soft bg-sol' : 'bg-ink-faint'}`}
            />
            <span className="font-mono text-2xs uppercase tracking-widest2 text-ink-muted">
              {simulation?.status ?? 'NO SIMULATION'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 p-4">
          <button
            type="button"
            onClick={onStart}
            disabled={busy !== null || running}
            className="btn btn-primary"
          >
            {busy === 'start' ? 'Starting…' : simulation ? 'Start / Resume' : 'Create & start'}
          </button>
          <button
            type="button"
            onClick={() => call('pause', {}, 'pause')}
            disabled={busy !== null || !running}
            className="btn"
          >
            Pause
          </button>
          <button
            type="button"
            onClick={() => call('tick', { force: true }, 'tick')}
            disabled={busy !== null || !simulation || running}
            className="btn"
            title="Advance exactly one cycle"
          >
            Step
          </button>
          <button
            type="button"
            onClick={() => call('stop', {}, 'stop')}
            disabled={busy !== null || !simulation || simulation.status === 'STOPPED'}
            className="btn btn-danger"
          >
            Stop
          </button>
          <button
            type="button"
            onClick={() => call('reset', { founderCount: 3 }, 'reset')}
            disabled={busy !== null || !simulation}
            className="btn btn-danger"
          >
            Reset
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <span className="label mr-1">Speed</span>
          {SPEEDS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onSpeed(name)}
              className={[
                'rounded border px-2.5 py-1 font-mono text-2xs uppercase tracking-wider transition-colors',
                speed === name
                  ? 'border-sol-deep bg-sol-wash text-sol'
                  : 'border-line-strong text-ink-faint hover:text-ink-muted',
              ].join(' ')}
            >
              {name}
            </button>
          ))}
        </div>

        {error && (
          <div className="border-t border-line px-4 py-2.5 font-mono text-2xs text-danger">
            {error}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2 className="label">Run</h2>
          <span className="font-mono text-2xs text-ink-faint">
            {status.aiProvider.toUpperCase()} BRAIN
          </span>
        </div>
        <dl className="divide-y divide-line">
          {[
            ['Simulation', simulation?.name ?? '—'],
            ['Seed', simulation?.seed ?? '—'],
            ['Cycle', simulation ? String(simulation.cycle) : '—'],
            ['Live agents', stats ? String(stats.liveAgents) : '—'],
            ['Dead agents', stats ? String(stats.deadAgents) : '—'],
            ['Generations', stats ? String(stats.generations) : '—'],
            ['Total capital', stats ? `${stats.totalCapitalSol.toFixed(4)} SOL` : '—'],
            ['Solana mode', status.solana.mode],
          ].map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 px-4 py-2">
              <dt className="label">{label}</dt>
              <dd className="tabular truncate font-mono text-2xs text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
