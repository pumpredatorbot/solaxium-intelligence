'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useConsole } from './console-provider';

/**
 * Lifecycle events, straight from the persisted SimulationEvent table.
 *
 * The per-cycle cashflow rows are filtered out here — they are already the
 * substance of the telemetry feed, and repeating them would bury the births,
 * deaths and clones this panel exists to surface.
 */

const SHOWN = new Set([
  'AGENT_BORN',
  'AGENT_DEAD',
  'CLONE_CREATED',
  'GENERATION_STARTED',
  'GENERATION_ENDED',
  'SIMULATION_STARTED',
  'SIMULATION_PAUSED',
  'SIMULATION_STOPPED',
  'SIMULATION_COMPLETED',
  'SIMULATION_CREATED',
]);

/** Short, accurate labels — "CLONE_CREATED" must not read as "CREATED". */
const LABEL: Record<string, string> = {
  AGENT_BORN: 'BORN',
  AGENT_DEAD: 'DIED',
  CLONE_CREATED: 'CLONED',
  GENERATION_STARTED: 'GEN OPEN',
  GENERATION_ENDED: 'GEN END',
  SIMULATION_STARTED: 'RUN START',
  SIMULATION_PAUSED: 'RUN PAUSE',
  SIMULATION_STOPPED: 'RUN STOP',
  SIMULATION_COMPLETED: 'EXTINCT',
  SIMULATION_CREATED: 'RUN NEW',
};

const TONE: Record<string, { dot: string; text: string; verb: string }> = {
  AGENT_BORN: { dot: 'bg-good', text: 'text-good', verb: 'born' },
  AGENT_DEAD: { dot: 'bg-bad', text: 'text-bad', verb: 'died' },
  CLONE_CREATED: { dot: 'bg-mg', text: 'text-mg', verb: 'cloned' },
  GENERATION_STARTED: { dot: 'bg-warn', text: 'text-warn', verb: 'generation' },
  GENERATION_ENDED: { dot: 'bg-warn', text: 'text-warn', verb: 'generation' },
  SIMULATION_STARTED: { dot: 'bg-cy', text: 'text-cy', verb: 'run' },
  SIMULATION_PAUSED: { dot: 'bg-warn', text: 'text-warn', verb: 'run' },
  SIMULATION_STOPPED: { dot: 'bg-bad', text: 'text-bad', verb: 'run' },
  SIMULATION_COMPLETED: { dot: 'bg-bad', text: 'text-bad', verb: 'run' },
  SIMULATION_CREATED: { dot: 'bg-ink-faint', text: 'text-ink-muted', verb: 'run' },
};

export function EventsPanel({ height = 'h-[250px]' }: { height?: string }) {
  const { lifecycleEvents } = useConsole();
  const scrollRef = useRef<HTMLDivElement>(null);
  const visible = lifecycleEvents.filter((event) => SHOWN.has(event.type)).slice(-120);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visible.length]);

  return (
    <section className="panel flex min-w-0 flex-col overflow-hidden">
      <div className="panel-head">
        <h2 className="label">Live events</h2>
        <span className="tabular font-mono text-3xs text-ink-ghost">{visible.length}</span>
      </div>

      <div ref={scrollRef} className={`overflow-y-auto ${height}`}>
        {visible.length === 0 ? (
          <p className="px-3 py-10 text-center font-mono text-2xs text-ink-faint">
            Births, deaths and clones appear here.
          </p>
        ) : (
          <ul className="divide-y divide-line/50">
            {visible.map((event) => {
              const tone = TONE[event.type] ?? TONE.SIMULATION_CREATED;
              return (
                <li
                  key={event.seq}
                  className="flex animate-slide-in items-center gap-2.5 px-3 py-1.5 font-mono text-3xs"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                  <span className="tabular w-9 shrink-0 text-ink-ghost">c{event.cycle}</span>
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
                  <span className={`w-[68px] shrink-0 uppercase tracking-wider ${tone.text}`}>
                    {LABEL[event.type] ?? event.type.replace(/_/g, ' ')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-ghost" title={event.message}>
                    {event.message}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
