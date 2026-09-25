'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTrading } from './trading-provider';
import { useBrowserClock } from './browser-clock';

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
  const clock = useBrowserClock(simulation?.id ?? null, refresh);

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
          <>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
              <button
                type="button"
                className="btn"
                disabled={busy !== null || running || clock.running}
                onClick={() => post('/api/simulation/start', { simulationId: simulation.id })}
              >
                Resume
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy !== null || (!running && !clock.running)}
                onClick={() => {
                  clock.stop();
                  void post('/api/simulation/pause', { simulationId: simulation.id });
                }}
              >
                Pause
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy !== null || clock.running}
                onClick={() =>
                  post('/api/simulation/tick', {
                    simulationId: simulation.id, steps: 1, force: true,
                  })
                }
              >
                Step
              </button>
              <span className="label ml-auto">
                {running ? `server runner · ${runner?.speed ?? 1}×` : 'server runner idle'}
              </span>
            </div>

            {/* The browser clock. On a serverless host the server-side runner
                freezes between requests, so this is what actually advances a
                run there. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
              <button
                type="button"
                className={clock.running ? 'btn btn-danger' : 'btn btn-primary'}
                disabled={busy !== null}
                onClick={() => (clock.running ? clock.stop() : clock.start())}
              >
                {clock.running ? 'Stop clock' : 'Run from browser'}
              </button>

              <div className="flex items-center gap-1">
                {[1, 2, 5, 10, 25].map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    className={`chip ${clock.speed === speed ? 'chip-active' : ''}`}
                    onClick={() => clock.setSpeed(speed)}
                  >
                    {speed}×
                  </button>
                ))}
              </div>

              <span className="label ml-auto">
                {clock.running
                  ? `${clock.advanced} steps · ${clock.rate.toFixed(1)}/s`
                  : clock.finished
                    ? `finished · ${clock.advanced} steps`
                    : clock.advanced > 0
                      ? `stopped · ${clock.advanced} steps`
                      : 'idle'}
              </span>
            </div>

            <p className="text-3xs leading-relaxed text-ink-faint">
              The engine&rsquo;s own runner is an in-process timer, so on a serverless
              host it stops the moment a response is sent and a run marked RUNNING
              never advances. <strong className="text-ink-muted">Run from browser</strong>{' '}
              drives it from this page instead — it advances only while this tab is
              open.
            </p>

            {clock.error ? (
              <p className="rounded border border-bad/40 bg-bad/[0.07] px-2 py-1.5 text-2xs text-bad">
                clock: {clock.error}
              </p>
            ) : null}
          </>
        ) : null}

        {recorded.length === 0 ? (
          <div className="space-y-2 border-t border-line pt-2.5">
            <p className="text-3xs leading-relaxed text-ink-faint">
              No market with stored ticks yet, so the token flow and marked open
              positions have nothing to read. Run{' '}
              <code className="font-mono text-ink-muted">npm run record</code> to capture
              real pump.fun launches and their trades — or seed a generated one to see
              that path work now.
            </p>
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() => post('/api/market/demo', { tokens: 140 })}
            >
              {busy === '/api/market/demo' ? 'generating…' : 'Seed a generated market'}
            </button>
            <p className="text-3xs leading-relaxed text-ink-ghost">
              Generated locally, labelled as synthetic everywhere it appears. It is not
              market data and is never shown as pump.fun activity.
            </p>
          </div>
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
