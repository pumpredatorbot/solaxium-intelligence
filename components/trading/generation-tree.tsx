'use client';

import Link from 'next/link';
import { pct, signedSol, useTrading } from './trading-provider';
import type { GenerationBand, TreeLeaf } from '@/lib/repo/trading';

/**
 * SOLAXIUM CORE — the population as generations of descent.
 *
 * This is the brain of the run made literal: each band is a generation, each
 * leaf an agent, and the leaves are ordered by fitness so the shape of
 * selection is visible at a glance. A band's counts are always the true totals;
 * its leaves may be the fittest sample, and the header says which.
 *
 * Status is drawn with a glyph and a label as well as a colour: LIVE, DEAD and
 * a parent that has cloned must be distinguishable without colour vision.
 */

const LEAF_STYLE = {
  live: 'border-good/35 bg-good/[0.06] text-good',
  clone: 'border-cy-deep bg-cy/[0.07] text-cy',
  dead: 'border-line-strong bg-raised/50 text-ink-ghost',
} as const;

function leafKind(leaf: TreeLeaf): keyof typeof LEAF_STYLE {
  if (leaf.status === 'DEAD') return 'dead';
  return leaf.parent ? 'clone' : 'live';
}

export function GenerationTree() {
  const { tree, stats, mode } = useTrading();

  if (mode && mode !== 'TRADING') {
    return (
      <section className="panel">
        <header className="panel-head">
          <h2 className="label-bright">Solaxium Core · generation tree</h2>
        </header>
        <p className="px-3.5 py-8 text-center text-2xs text-ink-faint">
          Available for paper-trading runs.
        </p>
      </section>
    );
  }

  return (
    <section className="panel panel-lit">
      <header className="panel-head">
        <div className="flex items-baseline gap-2.5">
          <h2 className="label-bright">Solaxium Core</h2>
          <span className="label">population brain · generations of descent</span>
        </div>
        {stats ? (
          <div className="flex items-center gap-3">
            <Legend kind="live" label="Live" />
            <Legend kind="clone" label="Cloned" />
            <Legend kind="dead" label="Dead" />
          </div>
        ) : null}
      </header>

      {tree.length === 0 ? (
        <p className="px-3.5 py-10 text-center text-2xs text-ink-faint">
          No population yet. Start a run to seed generation 0.
        </p>
      ) : (
        <div className="space-y-0">
          {tree.map((band, index) => (
            <Band key={band.generation} band={band} last={index === tree.length - 1} />
          ))}
        </div>
      )}
    </section>
  );
}

function Band({ band, last }: { band: GenerationBand; last: boolean }) {
  const survival = band.total > 0 ? band.alive / band.total : 0;
  const sampled = band.leaves.length < band.total;

  return (
    <div className={`px-3.5 py-3 ${last ? '' : 'border-b border-line'}`}>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="metric text-xs tracking-widest2 text-ink">GEN {band.generation}</span>
        <span className="label">
          {band.total} agents · {band.alive} live · {band.dead} dead
        </span>
        <span className="label">survival {pct(survival, 0)}</span>
        <span className="label">fitness {band.meanFitness.toFixed(3)}</span>
        <span className="label">win {pct(band.meanWinRate, 0)}</span>
        <span className="label ml-auto">
          {/* The two traits that carried the search in every run measured so far. */}
          entry {(band.traits.entrySpeed ?? 0).toFixed(3)} · pressure{' '}
          {(band.traits.pressureFilter ?? 0).toFixed(3)}
        </span>
      </div>

      {/* Survival bar: the band's shape, not a decoration. */}
      <div className="mb-2.5 flex h-1 overflow-hidden rounded-full bg-raised">
        <div className="bg-good/70" style={{ width: `${survival * 100}%` }} />
        <div className="flex-1 bg-bad/40" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {band.leaves.map((leaf) => (
          <Leaf key={leaf.id} leaf={leaf} />
        ))}
        {sampled ? (
          <span className="chip border-line-strong text-ink-ghost">
            +{band.total - band.leaves.length} more
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Leaf({ leaf }: { leaf: TreeLeaf }) {
  const kind = leafKind(leaf);
  const glyph = kind === 'dead' ? '✕' : kind === 'clone' ? '⎇' : '●';

  return (
    <Link
      href={`/agents/${leaf.id}`}
      className={`group inline-flex items-center gap-1.5 rounded border px-1.5 py-1 font-mono
                  text-3xs transition-colors hover:border-cy-dim ${LEAF_STYLE[kind]}`}
      title={
        `${leaf.code} · ${leaf.strategy}\n` +
        `capital ${leaf.capitalSol.toFixed(4)} SOL · P&L ${signedSol(leaf.pnlSol)} SOL\n` +
        `fitness ${leaf.fitness.toFixed(3)} · ${leaf.trades} trades · win ${pct(leaf.winRate, 0)}` +
        (leaf.parentCode ? `\nfrom ${leaf.parentCode}` : '')
      }
    >
      <span aria-hidden>{glyph}</span>
      <span className="tabular">{leaf.code.replace(/^SX-/, '')}</span>
      <span className={leaf.pnlSol > 0 ? 'text-good' : leaf.pnlSol < 0 ? 'text-bad' : 'text-ink-ghost'}>
        {signedSol(leaf.pnlSol, 2)}
      </span>
    </Link>
  );
}

function Legend({ kind, label }: { kind: keyof typeof LEAF_STYLE; label: string }) {
  const glyph = kind === 'dead' ? '✕' : kind === 'clone' ? '⎇' : '●';
  return (
    <span className={`chip border ${LEAF_STYLE[kind]}`}>
      <span aria-hidden>{glyph}</span>
      {label}
    </span>
  );
}
