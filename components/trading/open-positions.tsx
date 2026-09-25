'use client';

import { signedSol, useTrading } from './trading-provider';

/**
 * Positions currently held.
 *
 * Marked to the last price the token printed where the dataset stores ticks, and
 * left blank where it does not — an unmarked position shows a dash, not a zero,
 * because "we don't know" and "flat" are different facts.
 */
export function OpenPositions({ height = 'max-h-[260px]' }: { height?: string }) {
  const { open, stats, dataset, mode } = useTrading();
  if (mode && mode !== 'TRADING') return null;

  const marked = open.some((p) => p.unrealisedSol !== null);

  return (
    <section className="panel">
      <header className="panel-head">
        <div className="flex items-baseline gap-2.5">
          <h2 className="label-bright">Open positions</h2>
          <span className="label">{open.length} held</span>
        </div>
        {stats && marked ? (
          <span
            className={`metric text-2xs ${
              stats.unrealisedPnlSol > 0 ? 'text-good' : stats.unrealisedPnlSol < 0 ? 'text-bad' : 'text-ink-muted'
            }`}
          >
            {signedSol(stats.unrealisedPnlSol)} SOL unrealised
          </span>
        ) : null}
      </header>

      {open.length === 0 ? (
        <p className="px-3.5 py-5 text-center text-2xs text-ink-faint">
          Nothing held right now.
        </p>
      ) : (
        <div className={`overflow-y-auto ${height}`}>
          <table className="w-full border-collapse text-2xs">
            <thead className="sticky top-0 bg-surface/95 backdrop-blur">
              <tr className="border-b border-line">
                <th className="label px-3 py-1.5 text-left font-medium">Agent</th>
                <th className="label px-2 py-1.5 text-left font-medium">Token</th>
                <th className="label px-2 py-1.5 text-right font-medium">Size</th>
                <th className="label px-2 py-1.5 text-right font-medium">Age</th>
                <th className="label px-2 py-1.5 text-right font-medium">Targets</th>
                <th className="label px-3 py-1.5 text-right font-medium">Mark</th>
              </tr>
            </thead>
            <tbody>
              {open.map((position) => (
                <tr key={position.id} className="row-hover border-b border-line/50">
                  <td className="metric whitespace-nowrap px-3 py-1.5 text-2xs text-ink">
                    {position.agentCode}
                  </td>
                  <td className="metric whitespace-nowrap px-2 py-1.5 text-2xs text-ink-muted">
                    ${position.symbol}
                  </td>
                  <td className="metric px-2 py-1.5 text-right text-2xs text-ink-muted">
                    {position.sizeSol.toFixed(3)}
                  </td>
                  <td className="metric px-2 py-1.5 text-right text-2xs text-ink-muted">
                    {position.ageSteps}/{position.maxHoldSteps}s
                  </td>
                  <td className="metric px-2 py-1.5 text-right text-3xs text-ink-faint">
                    ×{position.takeProfitMultiple.toFixed(2)} / ×{position.stopMultiple.toFixed(2)}
                  </td>
                  <td
                    className={`metric px-3 py-1.5 text-right text-2xs ${
                      position.unrealisedSol === null
                        ? 'text-ink-ghost'
                        : position.unrealisedSol > 0
                          ? 'text-good'
                          : position.unrealisedSol < 0
                            ? 'text-bad'
                            : 'text-ink-muted'
                    }`}
                  >
                    {position.markMultiple === null
                      ? '—'
                      : `×${position.markMultiple.toFixed(2)} ${signedSol(position.unrealisedSol ?? 0, 3)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open.length > 0 && !marked ? (
        <p className="border-t border-line px-3.5 py-2 text-3xs leading-relaxed text-ink-faint">
          Unrealised P&amp;L needs stored prices to mark against.{' '}
          {dataset?.source === 'FIXTURE'
            ? 'This run trades a synthetic market, which is regenerated from a seed rather than stored.'
            : 'None are available for this dataset.'}
        </p>
      ) : null}
    </section>
  );
}
