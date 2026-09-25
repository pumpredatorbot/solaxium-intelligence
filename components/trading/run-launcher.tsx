'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTrading } from './trading-provider';

/**
 * Starting a paper-trading run on a chosen market.
 *
 * Recorded pump.fun captures are listed first and labelled as real, because
 * which market a run traded is the single most important fact about its result
 * and must not be something the viewer has to infer.
 */
export function RunLauncher() {
  const router = useRouter();
  const { datasets, simulation, runner, mode, refresh } = useTrading();
  const recorded = datasets.filter((d) => d.source === 'RECORDED');

  const [datasetId, setDatasetId] = useState<string>(recorded[0]?.id ?? '');
  const [founders, setFounders] = useState(80);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = runner?.running ?? false;
  const isTrading = mode === 'TRADING';

  async function post(path: string, body: Record<string, unknown> = {}) {
    setBusy(path);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? payload?.error ?? `status ${response.status}`);
      }
      await refresh();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="label-bright">Run control</h2>
        <span className="label">
          {simulation ? `${simulation.name} · step ${simulation.cycle}` : 'no run'}
        </span>
      </header>

      <div className="space-y-2.5 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="label">Market</span>
            <select
              value={datasetId}
              onChange={(event) => setDatasetId(event.target.value)}
              className="min-w-0 rounded border border-line-strong bg-raised px-2 py-1.5
                         font-mono text-2xs text-ink focus:border-cy-deep focus:outline-none"
            >
              {recorded.length === 0 ? (
                <option value="">No pump.fun capture recorded yet</option>
              ) : null}
              {recorded.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  pump.fun · {dataset.key} · {dataset.tokenCount} tokens
                </option>
              ))}
              <option value="">Synthetic market (generated from a seed)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="label">Founders</span>
            <input
              type="number"
              min={4}
              max={200}
              value={founders}
              onChange={(event) => setFounders(Number(event.target.value) || 80)}
              className="w-20 rounded border border-line-strong bg-raised px-2 py-1.5
                         font-mono text-2xs text-ink focus:border-cy-deep focus:outline-none"
            />
          </label>

          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() =>
              post('/api/simulation/start', {
                mode: 'TRADING',
                datasetId: datasetId || undefined,
                founderCount: founders,
                name: datasetId ? 'pump.fun paper run' : 'synthetic paper run',
              })
            }
          >
            {busy === '/api/simulation/start' ? 'starting…' : 'New run'}
          </button>
        </div>

        {simulation && isTrading ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
            <button
              type="button"
              className="btn"
              disabled={busy !== null || running}
              onClick={() => post('/api/simulation/start', { simulationId: simulation.id })}
            >
              Resume
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy !== null || !running}
              onClick={() => post('/api/simulation/pause', { simulationId: simulation.id })}
            >
              Pause
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy !== null || running}
              onClick={() => post('/api/simulation/tick', { simulationId: simulation.id })}
            >
              Step
            </button>
            <span className="label ml-auto">
              {running ? `running · ${runner?.speed ?? 1}×` : 'paused'}
            </span>
          </div>
        ) : null}

        {recorded.length === 0 ? (
          <p className="border-t border-line pt-2.5 text-3xs leading-relaxed text-ink-faint">
            No real market captured yet. Run{' '}
            <code className="font-mono text-ink-muted">npm run record</code> to capture live
            pump.fun launches and their trades into a replayable dataset, then it appears here.
          </p>
        ) : null}

        {error ? (
          <p className="rounded border border-bad/40 bg-bad/[0.07] px-2 py-1.5 text-2xs text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
