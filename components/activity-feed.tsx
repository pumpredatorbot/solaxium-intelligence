'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { EventDTO } from '@/lib/repo/serialize';

const TONE: Record<string, string> = {
  AGENT_BORN: 'text-sol',
  CLONE_CREATED: 'text-sol',
  AGENT_DEAD: 'text-danger',
  AGENT_REVENUE: 'text-ink',
  AGENT_EXPENSE: 'text-ink-faint',
  AGENT_ACTION: 'text-ink-muted',
  GENERATION_STARTED: 'text-warn',
  GENERATION_ENDED: 'text-warn',
  SIMULATION_STARTED: 'text-sol',
  SIMULATION_PAUSED: 'text-warn',
  SIMULATION_STOPPED: 'text-danger',
  SIMULATION_COMPLETED: 'text-danger',
  SIMULATION_CREATED: 'text-ink-muted',
};

/** Events that would drown the feed at TURBO speed. */
const NOISY = new Set(['AGENT_EXPENSE', 'AGENT_REVENUE']);

export function ActivityFeed({
  simulationId,
  initialEvents,
  live,
  height = 'h-[520px]',
  pollMs = 1200,
}: {
  simulationId: string;
  initialEvents: EventDTO[];
  live: boolean;
  height?: string;
  pollMs?: number;
}) {
  const [events, setEvents] = useState<EventDTO[]>(initialEvents);
  const [showNoise, setShowNoise] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSeq = useRef<number>(initialEvents.at(-1)?.seq ?? 0);

  // Poll for new events. A websocket would be nicer, but polling by `afterSeq`
  // transfers only the delta and survives a server restart without reconnect
  // logic — the feed is append-only, so there is nothing to reconcile.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/events?simulationId=${simulationId}&afterSeq=${lastSeq.current}&limit=200`,
          { cache: 'no-store' },
        );
        if (!response.ok) return;
        const data = (await response.json()) as { events: EventDTO[] };
        if (cancelled || data.events.length === 0) return;

        lastSeq.current = data.events.at(-1)!.seq;
        setEvents((current) => [...current, ...data.events].slice(-600));
      } catch {
        // Transient failure; the next tick retries.
      }
    };

    const timer = setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live, simulationId, pollMs]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const visible = showNoise ? events : events.filter((e) => !NOISY.has(e.type));

  return (
    <div>
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <div className="flex items-center gap-2">
          {live && <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-sol" />}
          <span className="label">{live ? 'Live' : 'Paused'}</span>
          <span className="tabular font-mono text-2xs text-ink-faint">{visible.length} events</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowNoise((v) => !v)}
            className="label transition-colors hover:text-ink"
          >
            {showNoise ? 'Hide cashflow' : 'Show cashflow'}
          </button>
          <button
            type="button"
            onClick={() => setAutoScroll((v) => !v)}
            className={`label transition-colors hover:text-ink ${autoScroll ? 'text-sol' : ''}`}
          >
            Auto-scroll
          </button>
        </div>
      </div>

      <div ref={scrollRef} className={`overflow-y-auto ${height}`}>
        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center text-2xs text-ink-faint">
            No events yet. Start the simulation to see agents act.
          </div>
        ) : (
          <ul className="divide-y divide-line/60">
            {visible.map((event) => (
              <li key={event.seq} className="animate-fade-in px-4 py-2 font-mono text-2xs leading-relaxed">
                <div className="flex items-start gap-2.5">
                  <span className="tabular w-10 shrink-0 text-ink-faint">c{event.cycle}</span>
                  <span
                    className={`w-[112px] shrink-0 uppercase tracking-wider ${TONE[event.type] ?? 'text-ink-muted'}`}
                  >
                    {event.type.replace(/_/g, ' ')}
                  </span>
                  <span className="min-w-0 flex-1 text-ink-muted">
                    {event.agentId ? (
                      <Link
                        href={`/agents/${event.agentId}`}
                        className="text-ink transition-colors hover:text-sol"
                      >
                        {event.agentCode}
                      </Link>
                    ) : null}{' '}
                    {stripLeadingCode(event.message, event.agentCode)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The agent code is rendered as a link, so drop it from the message text. */
function stripLeadingCode(message: string, code: string | null): string {
  if (!code) return message;
  return message.startsWith(`${code} `) ? message.slice(code.length + 1) : message;
}
