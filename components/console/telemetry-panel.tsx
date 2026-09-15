'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { TELEMETRY_TONE } from '@/lib/telemetry';
import { useConsole } from './console-provider';

/**
 * Live telemetry.
 *
 * Each line is one step of a recorded AGENT_ACTION — the decision and its
 * confidence, the reasoning the brain returned, the execution outcome, the
 * cashflow, the resulting balance. Nothing here is synthesised; see
 * lib/telemetry.ts.
 */
export function TelemetryPanel({ height = 'h-[300px]' }: { height?: string }) {
  const { telemetry, running, telemetryLagging } = useConsole();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [telemetry, follow]);

  return (
    <section className="panel flex min-w-0 flex-col overflow-hidden">
      <div className="panel-head">
        <h2 className="label flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              running ? 'animate-breathe bg-cy' : 'bg-ink-ghost'
            }`}
          />
          Live telemetry
        </h2>
        <div className="flex items-center gap-2.5">
          {telemetryLagging && (
            <span
              className="label text-warn"
              title="The engine is producing events faster than this feed consumes them, so telemetry shows a trailing window. Lifecycle events remain complete."
            >
              Trailing
            </span>
          )}
          <button
            type="button"
            onClick={() => setFollow((v) => !v)}
            className={`label transition-colors hover:text-ink ${follow ? 'text-cy' : ''}`}
            aria-pressed={follow}
          >
            {running ? 'Streaming' : 'Idle'}
          </button>
        </div>
      </div>

      <div ref={scrollRef} className={`overflow-y-auto ${height}`}>
        {telemetry.length === 0 ? (
          <p className="px-3 py-10 text-center font-mono text-2xs text-ink-faint">
            Telemetry appears once agents begin acting.
          </p>
        ) : (
          <ul className="divide-y divide-line/50">
            {telemetry.map((line) => (
              <li
                key={line.id}
                className="flex animate-slide-in items-baseline gap-2.5 px-3 py-[5px] font-mono text-3xs leading-relaxed"
              >
                <span className="tabular w-9 shrink-0 text-ink-ghost">c{line.cycle}</span>
                {line.agentId ? (
                  <Link
                    href={`/agents/${line.agentId}`}
                    className="w-14 shrink-0 text-ink transition-colors hover:text-cy"
                  >
                    {line.agentCode}
                  </Link>
                ) : (
                  <span className="w-14 shrink-0 text-ink-ghost">SYSTEM</span>
                )}
                <span
                  className={`w-[76px] shrink-0 uppercase tracking-wider ${TELEMETRY_TONE[line.kind]}`}
                >
                  {line.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-muted" title={line.message}>
                  {line.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
