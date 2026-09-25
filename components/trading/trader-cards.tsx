'use client';

import Link from 'next/link';
import { pct, signedSol, useTrading } from './trading-provider';
import type { TraderCard } from '@/lib/repo/trading';

/**
 * One card per agent: its genome's outcome, in full.
 *
 * Every figure is stored on the agent or counted from its positions. Fitness is
 * shown next to the measures it is built from — return, consistency, risk,
 * execution, survival — because a single number that nobody can decompose is
 * exactly the naive "it made money so it is good" the fitness system exists to
 * replace. An agent can be profitable and still rank poorly for taking
 * enormous risk, and the drawdown column is where that shows.
 */

export function TraderCards({ limit }: { limit?: number }) {
  const { traders, mode } = useTrading();
  const shown = limit ? traders.slice(0, limit) : traders;

  if (mode && mode !== 'TRADING') {
    return (
      <section className="panel">
        <header className="panel-head">
          <h2 className="label-bright">Traders</h2>
        </header>
        <p className="px-3.5 py-6 text-center text-2xs text-ink-faint">
          Available for paper-trading runs.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <div className="flex items-baseline gap-2.5">
          <h2 className="label-bright">Traders</h2>
          <span className="label">ranked by fitness</span>
        </div>
        <span className="label">{traders.length} shown</span>
      </header>

      {shown.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-2xs text-ink-faint">
          No agents yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 p-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((agent) => (
            <Card key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </section>
  );
}

function Card({ agent }: { agent: TraderCard }) {
  const dead = agent.status === 'DEAD';

  return (
    <Link
      href={`/agents/${agent.id}`}
      className={`group block min-w-0 rounded border p-2.5 transition-colors
                  ${dead
                    ? 'border-line bg-raised/40 opacity-70 hover:opacity-100'
                    : 'border-line-strong bg-raised/70 hover:border-cy-deep'}`}
    >
      <header className="flex items-baseline gap-2">
        <span className="metric text-2xs text-ink">{agent.code}</span>
        <span className="label">G{agent.generation}</span>
        <span
          className={`chip ml-auto border ${
            dead ? 'border-line-strong text-ink-ghost' : 'border-good/35 bg-good/[0.06] text-good'
          }`}
        >
          {dead ? `✕ dead s${agent.diedAtStep ?? '—'}` : `● live`}
        </span>
      </header>

      <p className="mt-1 truncate font-mono text-3xs uppercase tracking-wider text-ink-muted">
        {agent.strategy.replace(/_/g, ' ')}
        {agent.parentCode ? (
          <span className="text-ink-ghost"> ← {agent.parentCode}</span>
        ) : (
          <span className="text-ink-ghost"> · founder</span>
        )}
      </p>

      {/* Fitness first: it is what selection actually acts on. */}
      <div className="mt-2 flex items-baseline gap-2">
        <span className="label">fitness</span>
        <span className="metric text-sm text-ink">{agent.fitness.toFixed(3)}</span>
        <span className="text-3xs text-ink-ghost">raw {agent.rawFitness.toFixed(3)}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-elevated">
        <div
          className="h-full bg-cy/60"
          style={{ width: `${Math.max(0, Math.min(1, agent.fitness)) * 100}%` }}
        />
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
        <Row label="capital" value={`${agent.capitalSol.toFixed(4)}`} />
        <Row
          label="P&L"
          value={signedSol(agent.pnlSol)}
          tone={agent.pnlSol > 0 ? 'text-good' : agent.pnlSol < 0 ? 'text-bad' : undefined}
        />
        <Row label="trades" value={String(agent.trades)} />
        <Row label="win rate" value={agent.trades > 0 ? pct(agent.winRate, 0) : '—'} />
        <Row label="avg hold" value={agent.trades > 0 ? `${agent.avgHoldSteps.toFixed(1)}s` : '—'} />
        <Row
          label="drawdown"
          value={agent.trades > 0 ? pct(agent.maxDrawdown, 0) : '—'}
          tone={agent.maxDrawdown > 0.5 ? 'text-warn' : undefined}
        />
      </dl>

      <footer className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        <Tag label="TP2" value={agent.tp2Hits} tone="text-good" />
        <Tag label="TP1" value={agent.tp1Hits} tone="text-viz-good" />
        <Tag label="STOP" value={agent.stops} tone="text-bad" />
        <Tag label="TIME" value={agent.timeouts} tone="text-ink-muted" />
        {agent.openPositions > 0 ? (
          <span className="chip border-cy-deep bg-cy/[0.07] text-cy">
            {agent.openPositions} open
          </span>
        ) : null}
        {agent.clonesCreated > 0 ? (
          <span className="chip ml-auto border-vi/40 bg-vi/[0.07] text-vi">
            ⎇ {agent.clonesCreated}
          </span>
        ) : null}
      </footer>
    </Link>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-1.5">
      <dt className="label">{label}</dt>
      <dd className={`metric text-2xs ${tone ?? 'text-ink-muted'}`}>{value}</dd>
    </div>
  );
}

function Tag({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="label">{label}</span>
      <span className={`metric text-3xs ${value > 0 ? tone : 'text-ink-ghost'}`}>{value}</span>
    </span>
  );
}
