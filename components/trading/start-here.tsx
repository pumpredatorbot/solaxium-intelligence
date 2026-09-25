'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTrading } from './trading-provider';

/**
 * One button that does the whole thing.
 *
 * Getting a run going used to take three correct choices in the right order —
 * seed a market, pick it from a list, create a run — and picking wrong left you
 * on a synthetic market wondering where the pump.fun tokens were. Every step it
 * needs, it does; every step it cannot do, it says why.
 *
 * It prefers a real pump.fun capture, falls back to a generated market, and is
 * explicit about which one it used. That honesty is the point: the difference
 * between real and generated data is the single most important fact about a
 * result, and it must never be something the viewer has to work out.
 */
export function StartHere() {
  const router = useRouter();
  const { datasets, simulation, mode, stats, refresh } = useTrading();
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const real = datasets.find((d) => d.source === 'RECORDED' && d.meta?.source === 'pump.fun');
  const generated = datasets.find((d) => d.source === 'RECORDED');
  const hasRun = mode === 'TRADING' && simulation !== null;
  const started = hasRun && (stats?.closedTrades ?? 0) > 0;

  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? payload?.error ?? `status ${response.status}`);
    }
    return payload;
  }

  async function go() {
    setError(null);
    try {
      // 1. A market with stored ticks, so the token flow has something to read.
      let datasetId = real?.id ?? generated?.id ?? null;
      if (!datasetId) {
        setStep('Building a market…');
        datasetId = (await post('/api/market/demo', { tokens: 160 })).datasetId;
      }

      // 2. A population on it.
      setStep('Seeding 80 agents…');
      await post('/api/simulation/start', {
        mode: 'TRADING',
        datasetId,
        founderCount: 80,
        name: real ? 'pump.fun paper run' : 'paper run',
      });

      // 3. The console's clock takes it from here: it notices the run is not
      //    advancing on its own and drives it.
      setStep(null);
      await refresh();
      router.refresh();
    } catch (cause) {
      setStep(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  // Once a run is producing trades this panel has done its job and gets out of
  // the way; Run control below handles everything after that.
  if (started) return null;

  return (
    <section className="panel panel-lit">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="metric text-sm text-ink">
            {hasRun ? 'Run created — nothing has traded yet' : 'Start a population'}
          </h2>
          <p className="mt-1 text-2xs leading-relaxed text-ink-muted">
            {hasRun
              ? 'Press play in the bar above. The run advances and positions start opening.'
              : '80 agents, 1 SOL each, no strategy. They trade launches, take profit at ×1.5 or ×2.0, and live or die by the result. One button does the whole setup.'}
          </p>
          <p className="mt-1.5 text-3xs text-ink-faint">
            {real
              ? `Market: real pump.fun capture (${real.tokenCount} tokens).`
              : generated
                ? `Market: generated locally (${generated.tokenCount} tokens) — not real data. ` +
                  'Run npm run record for a real pump.fun capture.'
                : 'No market yet — one will be generated. It is not real data; a real pump.fun ' +
                  'capture needs network access to pump.fun.'}
          </p>
        </div>

        {!hasRun ? (
          <button
            type="button"
            className="btn btn-primary shrink-0 px-5 py-2.5"
            disabled={step !== null}
            onClick={() => void go()}
          >
            {step ?? 'Start a run'}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="border-t border-line px-4 py-2 text-2xs text-bad">{error}</p>
      ) : null}
    </section>
  );
}
