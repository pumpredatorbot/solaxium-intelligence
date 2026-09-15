'use client';

import { useConsole } from './console-provider';

/**
 * The Solana integration status.
 *
 * Its job is to be unambiguous: V1 moves no value. The second row is not a
 * toggle and is not wired to anything — `getSolanaProvider()` throws for any
 * mode other than `simulation`.
 */
export function SolanaPanel() {
  const { solana, aiProvider } = useConsole();

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="label">Solana integration</h2>
        <span className="font-mono text-3xs uppercase tracking-wider text-ink-ghost">
          {solana.network}
        </span>
      </div>

      <div className="space-y-2 p-2.5">
        <div className="rounded border border-cy-deep bg-cy/[0.06] p-3">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cy" />
            <span className="font-mono text-2xs uppercase tracking-widest2 text-cy">
              Simulation mode
            </span>
            <span className="ml-auto font-mono text-3xs uppercase tracking-wider text-cy/70">
              Active
            </span>
          </div>
          <p className="mt-2 font-mono text-3xs leading-relaxed text-ink-faint">
            No real funds. No wallet is connected, no keypair exists, no RPC is contacted and no
            transaction is broadcast.
          </p>
        </div>

        <div className="rounded border border-line bg-raised/30 p-3 opacity-60">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full border border-ink-ghost" />
            <span className="font-mono text-2xs uppercase tracking-widest2 text-ink-muted">
              Live Solana
            </span>
            <span className="ml-auto font-mono text-3xs uppercase tracking-wider text-ink-ghost">
              V2 · not wired
            </span>
          </div>
          <p className="mt-2 font-mono text-3xs leading-relaxed text-ink-ghost">
            The provider interface is built and tested; no devnet or mainnet implementation exists.
            Enabling one is a reviewed code change, not a setting.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line">
          {[
            ['Mode', solana.mode],
            ['Real value', solana.realValueEnabled ? 'ENABLED' : 'Disabled'],
            ['RPC', 'none'],
            ['AI brain', aiProvider],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-2.5 py-2">
              <dt className="label">{label}</dt>
              <dd
                className={`mt-1 font-mono text-3xs uppercase ${
                  label === 'Real value' && solana.realValueEnabled ? 'text-bad' : 'text-ink-muted'
                }`}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
