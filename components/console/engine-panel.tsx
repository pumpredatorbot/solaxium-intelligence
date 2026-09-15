'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Sparkline } from '@/components/charts';
import type { EngineCard, EngineStatus } from '@/lib/repo/engines';
import { useConsole } from './console-provider';

/**
 * Live engine cards.
 *
 * Status is derived from each agent's most recent recorded action, so a card
 * showing EXECUTING is showing that the agent's last action really was an
 * execution — not a decorative state machine.
 */

const STATUS_STYLE: Record<EngineStatus, { dot: string; text: string; ring: string }> = {
  ACTIVE: { dot: 'bg-cy', text: 'text-cy', ring: 'border-cy-deep' },
  EXECUTING: { dot: 'bg-vi', text: 'text-vi', ring: 'border-vi-deep' },
  LEARNING: { dot: 'bg-az', text: 'text-az', ring: 'border-az-deep' },
  ANALYZING: { dot: 'bg-mg', text: 'text-mg', ring: 'border-mg-deep' },
  RESTING: { dot: 'bg-ink-faint', text: 'text-ink-faint', ring: 'border-line-strong' },
  DEAD: { dot: 'bg-bad', text: 'text-bad', ring: 'border-bad/30' },
};

export function EnginePanel({
  initialEngines,
  limit = 6,
  showHeader = true,
  height = 'h-[540px]',
}: {
  initialEngines: EngineCard[];
  limit?: number;
  showHeader?: boolean;
  height?: string;
}) {
  const { simulation, running, stats } = useConsole();
  const [engines, setEngines] = useState<EngineCard[]>(initialEngines);

  // Engine cards carry per-agent detail that is too heavy for the status poll,
  // so they refresh on their own slower cadence while the run is live.
  useEffect(() => {
    if (!simulation) return;
    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const response = await fetch(
          `/api/engines?simulationId=${simulation.id}&limit=${limit}`,
          { cache: 'no-store' },
        );
        if (!response.ok) return;
        const data = (await response.json()) as { engines: EngineCard[] };
        setEngines(data.engines);
      } catch {
        // Transient.
      }
    };
    void load();
    if (!running) return;
    const timer = setInterval(load, 2200);
    return () => clearInterval(timer);
  }, [simulation, running, limit]);

  return (
    <section className="panel flex min-w-0 flex-col overflow-hidden">
      {showHeader && (
        <div className="panel-head">
          <h2 className="label">Engines</h2>
          <span className="font-mono text-3xs text-ink-faint">
            <span className="text-good">{stats?.liveAgents ?? 0} active</span>
            <span className="mx-1.5 text-ink-ghost">/</span>
            <span className="text-bad">{stats?.deadAgents ?? 0} dead</span>
          </span>
        </div>
      )}

      <div className={`space-y-2 overflow-y-auto p-2 ${height}`}>
        {engines.length === 0 ? (
          <p className="px-2 py-8 text-center font-mono text-2xs text-ink-faint">
            No engines yet.
          </p>
        ) : (
          engines.map((engine) => <EngineRow key={engine.id} engine={engine} />)
        )}
      </div>
    </section>
  );
}

export function EngineRow({ engine }: { engine: EngineCard }) {
  const style = STATUS_STYLE[engine.status];
  const dead = engine.status === 'DEAD';
  const critical = !dead && engine.runwayCycles !== null && engine.runwayCycles < 4;

  return (
    <Link
      href={`/agents/${engine.id}`}
      className={[
        'group relative block min-w-0 rounded border bg-raised/40 p-2.5 transition-colors hover:bg-raised/80',
        dead ? 'border-bad/20' : 'border-line hover:border-line-strong',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded border ${style.ring} bg-abyss/60`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${style.dot} ${
                dead ? '' : 'animate-breathe'
              }`}
            />
          </span>
          <div className="min-w-0">
            <div className="font-mono text-2xs text-ink transition-colors group-hover:text-cy">
              {engine.code}
            </div>
            <div className="font-mono text-3xs text-ink-ghost">Gen {engine.generation}</div>
          </div>
        </div>

        <span
          className={`shrink-0 font-mono text-3xs uppercase tracking-wider ${style.text}`}
        >
          {engine.status}
        </span>
      </div>

      <dl className="mt-2.5 space-y-1">
        <Row label="Capital" value={`${engine.capitalSol.toFixed(3)} SOL`} />
        <Row
          label="P&L"
          value={`${engine.profitSol >= 0 ? '+' : ''}${engine.profitSol.toFixed(3)} SOL`}
          tone={engine.profitSol >= 0 ? 'text-good' : 'text-bad'}
          extra={`${engine.roi >= 0 ? '+' : ''}${(engine.roi * 100).toFixed(0)}%`}
        />
        <Row
          label="Action"
          value={engine.action ? engine.action.type.replace(/_/g, ' ') : 'Awaiting first cycle'}
          truncate
        />
        <Row
          label="Confidence"
          value={engine.confidence !== null ? `${(engine.confidence * 100).toFixed(0)}%` : '—'}
        />
      </dl>

      <div className="mt-2 flex items-end justify-between gap-2">
        {critical && (
          <span className="font-mono text-3xs uppercase tracking-wider text-warn">
            Runway {engine.runwayCycles!.toFixed(1)}c
          </span>
        )}
        <span className="ml-auto">
          <Sparkline
            points={engine.spark}
            tone={dead ? 'var(--viz-bad)' : 'var(--viz-1)'}
            width={86}
            height={22}
          />
        </span>
      </div>
    </Link>
  );
}

function Row({
  label,
  value,
  tone = 'text-ink',
  extra,
  truncate,
}: {
  label: string;
  value: string;
  tone?: string;
  extra?: string;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="label shrink-0">{label}</dt>
      <dd
        className={`tabular min-w-0 text-right font-mono text-3xs ${tone} ${
          truncate ? 'truncate' : ''
        }`}
      >
        {value}
        {extra && <span className="ml-1.5 text-ink-ghost">{extra}</span>}
      </dd>
    </div>
  );
}
