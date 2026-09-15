'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Mark } from './mark';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/simulation', label: 'Simulation' },
  { href: '/agents', label: 'Agents' },
  { href: '/evolution', label: 'Evolution' },
  { href: '/generations', label: 'Generations' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/graveyard', label: 'Graveyard' },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-void/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-6 py-3">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <Mark className="h-5 w-5 text-sol transition-opacity group-hover:opacity-80" />
          <span className="font-mono text-xs font-medium uppercase tracking-widest2 text-ink">
            Solaxium
          </span>
        </Link>

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={[
                  'whitespace-nowrap rounded px-2.5 py-1.5 text-2xs font-medium uppercase tracking-widest2 transition-colors',
                  active ? 'bg-raised text-sol' : 'text-ink-faint hover:text-ink-muted',
                ].join(' ')}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <span className="hidden shrink-0 font-mono text-2xs uppercase tracking-widest2 text-ink-faint lg:block">
          Simulated · SOL
        </span>
      </div>
    </header>
  );
}
