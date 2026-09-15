'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { SolaxiumMark, SolaxiumWordmark } from '@/components/brand';
import { useConsole } from './console-provider';
import {
  IconAgents,
  IconAnalytics,
  IconEngines,
  IconMarket,
  IconOverview,
  IconPortfolio,
  IconReplay,
  IconSettings,
} from './nav-icons';

const NAV = [
  { href: '/overview', label: 'Overview', Icon: IconOverview },
  { href: '/agents', label: 'Agents', Icon: IconAgents },
  { href: '/engines', label: 'Engines', Icon: IconEngines },
  { href: '/market', label: 'Market', Icon: IconMarket },
  { href: '/portfolio', label: 'Portfolio', Icon: IconPortfolio },
  { href: '/analytics', label: 'Analytics', Icon: IconAnalytics },
  { href: '/replay', label: 'Replay', Icon: IconReplay },
  { href: '/settings', label: 'Settings', Icon: IconSettings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { running, simulation } = useConsole();
  const [open, setOpen] = useState(false);

  const operational = simulation !== null;

  const links = (
    <nav className="flex flex-1 flex-col gap-0.5 px-2.5 py-3">
      {NAV.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={[
              'group relative flex items-center gap-2.5 rounded px-2.5 py-2 text-xs transition-colors',
              active
                ? 'bg-cy/[0.07] text-ink'
                : 'text-ink-faint hover:bg-raised/60 hover:text-ink-muted',
            ].join(' ')}
          >
            {active && (
              <span className="absolute inset-y-1.5 left-0 w-px bg-cy shadow-[0_0_8px_0_rgba(34,224,240,0.8)]" />
            )}
            <Icon className={active ? 'text-cy' : ''} />
            <span className="font-mono uppercase tracking-widest2">{label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-line px-4 py-4">
      <div className="flex items-center gap-2.5">
        <SolaxiumMark size={24} />
        <div className="min-w-0">
          <div className="font-mono text-3xs uppercase tracking-widest2 text-ink-muted">
            Solaxium Intelligence
          </div>
          <div className="mt-0.5 font-mono text-3xs uppercase tracking-widest2 text-ink-ghost">
            AI Economic Ecosystem
          </div>
        </div>
      </div>
      <div className="mt-3.5 flex items-center gap-2 border-t border-line pt-3">
        <span
          className={[
            'h-1.5 w-1.5 rounded-full',
            operational ? 'bg-good' : 'bg-ink-ghost',
            running ? 'animate-breathe' : '',
          ].join(' ')}
        />
        <span className="font-mono text-3xs uppercase tracking-widest2 text-ink-faint">
          System
        </span>
        <span
          className={`ml-auto font-mono text-3xs uppercase tracking-widest2 ${
            operational ? 'text-good' : 'text-ink-faint'
          }`}
        >
          {operational ? 'Operational' : 'Standby'}
        </span>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile trigger, pinned clear of the topbar. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
        className="btn-icon fixed left-3 top-3 z-50 lg:hidden"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3">
          {open ? <path d="m4 4 8 8M12 4l-8 8" /> : <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />}
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-void/80 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-[218px] flex-col border-r border-line bg-abyss/95 backdrop-blur-md transition-transform duration-200',
          open ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0',
        ].join(' ')}
      >
        <Link
          href="/"
          className="flex items-center gap-2.5 border-b border-line px-4 py-4 transition-opacity hover:opacity-80"
        >
          <SolaxiumMark size={30} />
          <SolaxiumWordmark />
        </Link>
        {links}
        {footer}
      </aside>
    </>
  );
}
