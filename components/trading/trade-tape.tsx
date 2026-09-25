'use client';

import Link from 'next/link';
import { pct, signedSol, useTrading } from './trading-provider';
import type { ClosedTrade } from '@/lib/repo/trading';

/**
 * Closed positions, newest first.
 *
 * The console's primary evidence: every row is a position the engine opened on
 * a token, held for a recorded number of steps, and settled through the ledger.
 * Nothing here is derived from a model of what should have happened.
 *
 * Exit reasons carry a label as well as a colour, per the project's own rule
 * that status is never encoded in colour alone — a red-green tape is unreadable
 * for a substantial fraction of viewers.
 */

const EXIT_STYLE: Record<ClosedTrade['exitReason'], { label: string; cls: string }> = {
  // TP1 and TP2 are bands: the genome sets its target anywhere between ×1.5 and
  // ×2.0, and the label says which half it chose.
  TP2: { label: 'TP2 held', cls: 'text-good border-good/40 bg-good/[0.08]' },
  TP1: { label: 'TP1 banked', cls: 'text-viz-good border-viz-good/40 bg-viz-good/[0.08]' },
  STOP: { label: 'STOP', cls: 'text-bad border-bad/40 bg-bad/[0.08]' },
  TIMEOUT: { label: 'TIME', cls: 'text-ink-muted border-line-strong bg-raised/60' },
};

export function TradeTape({ height = 'max-h-[420px]' }: { height?: string }) {
  const { trades, stats, freshTradeIds, mode } = useTrading();

  if (mode && mode !== 'TRADING') {
    return (
      <section className="panel">
        <header className="panel-head">
          <h2 className="label-bright">Closed P&amp;L</h2>
        </header>
        <p className="px-3.5 py-6 text-center text-2xs text-ink-faint">
          The active run is an {mode.toLowerCase()} simulation, which takes no positions.
        </p>
      </section>
    );
  }

  return (
    <section className="panel panel-lit">
      <header className="panel-head">
        <div className="flex items-baseline gap-2.5">
          <h2 className="label-bright">Closed P&amp;L</h2>
          {stats ? (
            <span className="label">
              {stats.closedTrades} settled · {pct(stats.winRate, 0)} win
            </span>
          ) : null}
        </div>
        {stats ? (
          <span
            className={`metric text-xs ${
              stats.realisedPnlSol > 0 ? 'text-good' : stats.realisedPnlSol < 0 ? 'text-bad' : 'text-ink-muted'
            }`}
          >
            {signedSol(stats.realisedPnlSol)} SOL
          </span>
        ) : null}
      </header>

      {trades.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-2xs text-ink-faint">
          No position has closed yet. Start the run and the tape fills as positions settle.
        </p>
      ) : (
        <div className={`overflow-y-auto ${height}`}>
          <table className="w-full border-collapse text-2xs">
            <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
              <tr className="border-b border-line">
                <th className="label px-3 py-1.5 text-left font-medium">Agent</th>
                <th className="label px-2 py-1.5 text-left font-medium">Token</th>
                <th className="label px-2 py-1.5 text-right font-medium">Size</th>
                <th className="label px-2 py-1.5 text-right font-medium">Hold</th>
                <th className="label px-2 py-1.5 text-left font-medium">Exit</th>
                <th className="label px-2 py-1.5 text-right font-medium">Return</th>
                <th className="label px-3 py-1.5 text-right font-medium">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => {
                const style = EXIT_STYLE[trade.exitReason];
                const fresh = freshTradeIds.has(trade.id);
                return (
                  <tr
                    key={trade.id}
                    className={`row-hover border-b border-line/50 ${fresh ? 'animate-slide-in' : ''}`}
                  >
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <Link
                        href={`/agents/${trade.agentId}`}
                        className="metric text-2xs text-cy hover:underline"
                      >
                        {trade.agentCode}
                      </Link>
                      <span className="ml-1.5 text-3xs text-ink-ghost">G{trade.generation}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className="metric text-2xs text-ink">${trade.symbol}</span>
                      <span
                        className="ml-1.5 font-mono text-3xs text-ink-ghost"
                        title={trade.mint}
                      >
                        {trade.mint.slice(0, 4)}…
                      </span>
                    </td>
                    <td className="metric px-2 py-1.5 text-right text-2xs text-ink-muted">
                      {trade.sizeSol.toFixed(3)}
                    </td>
                    <td className="metric px-2 py-1.5 text-right text-2xs text-ink-muted">
                      {trade.holdSteps}s
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`chip border ${style.cls}`}>{style.label}</span>
                    </td>
                    <td
                      className={`metric px-2 py-1.5 text-right text-2xs ${
                        trade.returnPct > 0 ? 'text-good' : trade.returnPct < 0 ? 'text-bad' : 'text-ink-muted'
                      }`}
                    >
                      {signedSol(trade.returnPct * 100, 1)}%
                    </td>
                    <td
                      className={`metric px-3 py-1.5 text-right text-2xs font-medium ${
                        trade.pnlSol > 0 ? 'text-good' : trade.pnlSol < 0 ? 'text-bad' : 'text-ink-muted'
                      }`}
                    >
                      {signedSol(trade.pnlSol)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {stats && stats.closedTrades > 0 ? (
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3.5 py-2">
          <Breakdown label="TP2" value={stats.tp2Hits} total={stats.closedTrades} tone="text-good" />
          <Breakdown label="TP1" value={stats.tp1Hits} total={stats.closedTrades} tone="text-viz-good" />
          <Breakdown label="Stop" value={stats.stops} total={stats.closedTrades} tone="text-bad" />
          <Breakdown label="Time" value={stats.timeouts} total={stats.closedTrades} tone="text-ink-muted" />
          <span className="label ml-auto">
            best {signedSol(stats.bestTradeSol, 3)} · worst {signedSol(stats.worstTradeSol, 3)} · costs{' '}
            {stats.costsSol.toFixed(3)} SOL
          </span>
        </footer>
      ) : null}
    </section>
  );
}

function Breakdown({
  label, value, total, tone,
}: { label: string; value: number; total: number; tone: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="label">{label}</span>
      <span className={`metric text-2xs ${tone}`}>{value}</span>
      <span className="text-3xs text-ink-ghost">
        {total > 0 ? `${((value / total) * 100).toFixed(0)}%` : '—'}
      </span>
    </span>
  );
}
