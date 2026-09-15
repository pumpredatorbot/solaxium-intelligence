import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TopNav } from '@/components/top-nav';

export const metadata: Metadata = {
  title: {
    default: 'SOLAXIUM INTELLIGENCE',
    template: '%s — SOLAXIUM INTELLIGENCE',
  },
  description:
    'An evolutionary intelligence laboratory where autonomous AI agents must generate wealth to survive.',
};

export const viewport: Viewport = {
  themeColor: '#050505',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="flex min-h-screen flex-col">
          <TopNav />
          <main className="flex-1">{children}</main>
          <footer className="hairline mt-16">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-6 py-6 text-2xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
              <span className="font-mono uppercase tracking-widest2">
                SOLAXIUM INTELLIGENCE — EARN. SURVIVE. EVOLVE.
              </span>
              <span className="font-mono">
                V1 · SIMULATED SOLANA ECONOMY · NO REAL VALUE IS MOVED
              </span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
