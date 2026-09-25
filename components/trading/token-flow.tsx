'use client';

import { pct, signedSol, useTrading } from './trading-provider';
import type { FlowToken } from '@/lib/repo/trading';

/**
 * The live token flow: what the market is offering, and what the population did
 * about it.
 *
 * ENTER is read from positions the engine actually opened. SKIP is the living
 * population minus the agents who entered. Neither is re-derived from a strategy
 * model here — if the engine did not record a decision, no decision is shown.
 *
 * A synthetic market stores no tokens (it is regenerated from a seed), so this
 * panel says so instead of inventing a flow.
 */

export function TokenFlow({ height = 'max-h-[440px]' }: { height?: string }) {
  const { flow, dataset, mode } = useTrading();

  if (mode && mode !== 'TRADING') {
    return (
      <Shell note="Available for paper-trading runs." />
    );
  }
  if (!flow || flow.source !== 'RECORDED') {
    return (
      <Shell
        note={
          dataset?.source === 'FIXTURE'
            ? 'This run trades a synthetic market, which is regenerated from its seed rather than stored, so there is no token table to read. Record a pump.fun capture to see the real flow here.'
            : 'No market attached to this run.'
        }
      />
    );
  }
  if (flow.tokens.length === 0) {
    return <Shell note="No token is live at the current step." />;
  }

  // Labelled by what was actually captured, so a synthetic or test capture is
  // never presented as real pump.fun data.
  const realPumpFun = flow.origin === 'pump.fun';

  return (
    <section className="panel panel-lit">
      <header className="panel-head">
        <div className="flex items-baseline gap-2.5">
          <h2 className="label-bright">New token detected</h2>
          <span className={`label ${realPumpFun ? 'text-cy' : ''}`}>
            {realPumpFun ? 'pump.fun · real mints' : `recorded · ${flow.origin ?? 'unattributed capture'}`}
          </span>
        </div>
        <span className="label">{flow.tokens.length} live</span>
      </header>

      <div className={`divide-y divide-line/60 overflow-y-auto ${height}`}>
        {flow.tokens.map((token) => (
          <TokenRow key={token.mint} token={token} />
        ))}
      </div>
    </section>
  );
}

function TokenRow({ token }: { token: FlowToken }) {
  const hot = token.momentum >= 1.5;
  const bleeding = token.momentum <= 0.7;

  return (
    <article className="px-3.5 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="metric text-xs text-ink">${token.symbol}</span>
        <span className="font-mono text-3xs text-ink-ghost" title={token.mint}>
          {token.mint.slice(0, 6)}…{token.mint.slice(-4)}
        </span>
        <span
          className={`chip border ${
            hot
              ? 'border-good/40 bg-good/[0.08] text-good'
              : bleeding
                ? 'border-bad/40 bg-bad/[0.08] text-bad'
                : 'border-line-strong text-ink-muted'
          }`}
        >
          ×{token.momentum.toFixed(2)}
        </span>
        <span className="label ml-auto">age {token.ageSteps}s</span>
      </div>

      <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
        <Field label="mcap" value={`${token.mcapSol.toFixed(1)} SOL`} />
        <Field label="buys" value={String(token.buys)} />
        <Field label="sells" value={String(token.sells)} />
        <Field label="pressure" value={pct(token.buyRatio, 0)} />
        <Field label="vol" value={`${token.volumeSol.toFixed(2)} SOL`} />
        <Field label="holders" value={String(token.holders)} />
      </dl>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {token.entered.length === 0 ? (
          <span className="chip border-line-strong text-ink-ghost">
            → SKIP · whole population passed
          </span>
        ) : (
          <>
            {token.entered.map((entry) => (
              <span
                key={`${entry.code}-${entry.step}`}
                className="chip border border-cy-deep bg-cy/[0.07] text-cy"
                title={`entered at step ${entry.step} with ${entry.sizeSol.toFixed(3)} SOL`}
              >
                → ENTER {entry.code.replace(/^SX-/, '')} · {entry.sizeSol.toFixed(3)}
              </span>
            ))}
            {token.skipped > 0 ? (
              <span className="chip border-line-strong text-ink-ghost">
                → SKIP ×{token.skipped}
              </span>
            ) : null}
          </>
        )}

        {token.closedTrades > 0 ? (
          <span
            className={`chip ml-auto border ${
              token.realisedPnlSol > 0
                ? 'border-good/40 bg-good/[0.08] text-good'
                : token.realisedPnlSol < 0
                  ? 'border-bad/40 bg-bad/[0.08] text-bad'
                  : 'border-line-strong text-ink-muted'
            }`}
          >
            {token.closedTrades} settled · {signedSol(token.realisedPnlSol, 3)} SOL
          </span>
        ) : null}
      </div>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="label">{label}</dt>
      <dd className="metric text-2xs text-ink-muted">{value}</dd>
    </div>
  );
}

function Shell({ note }: { note: string }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="label-bright">New token detected</h2>
        <span className="label">pump.fun</span>
      </header>
      <p className="px-3.5 py-6 text-2xs leading-relaxed text-ink-faint">{note}</p>
    </section>
  );
}
