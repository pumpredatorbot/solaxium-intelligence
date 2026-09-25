/**
 * Paper execution.
 *
 * Turns a decision plus real market ticks into a filled position and a
 * realised P&L. Pure and deterministic: same position, same ticks, same
 * result — which is what makes a whole run reproducible from a dataset and a
 * seed.
 *
 * NO REAL VALUE MOVES. A position here is an accounting entry against
 * recorded or synthetic prices. There is no wallet, no key, no transaction.
 *
 * Two modelling choices carry most of the honesty of this file:
 *
 *  1. **Costs are charged on both sides.** Slippage scales with position size
 *     relative to the token's market cap, so an agent that sizes up in a thin
 *     launch pays for it. Without this the population reliably evolves towards
 *     maximum position size, which is an artefact of the simulator rather than
 *     a strategy.
 *
 *  2. **Exits are asymmetric, in the market's favour.** A take-profit fills at
 *     the target, never at a gapped-through better price; a stop fills at the
 *     price actually observed, which may be far worse than the stop level.
 *     Modelling it the other way round quietly inflates every result.
 */

import type { TradingConfig } from '@/config/trading';
import type { DecodedStrategy } from '@/config/trading';
import { solToLamports } from '@/lib/sol';
import type { MarketTick, TokenSnapshot } from '@/lib/market/types';
import type { ExitReason } from './fitness';

export interface PaperPosition {
  mint: string;
  symbol: string;
  entryStep: number;
  /** Quoted price before costs. */
  quotedEntryLamports: number;
  /** Price actually paid, after slippage. */
  entryPriceLamports: number;
  /** Capital committed, in lamports. */
  sizeLamports: number;
  takeProfitMultiple: number;
  stopMultiple: number;
  maxHoldSteps: number;
  entryFeeLamports: number;
  entrySlippageLamports: number;
}

export interface PositionOutcome {
  exitReason: ExitReason;
  exitStep: number;
  holdSteps: number;
  quotedExitLamports: number;
  exitPriceLamports: number;
  /** Lamports returned to the agent, after costs. */
  proceedsLamports: number;
  /** proceeds - size. Signed. */
  pnlLamports: number;
  /** Net return on capital committed. 0.5 = +50%. */
  returnPct: number;
  totalFeesLamports: number;
  totalSlippageLamports: number;
}

/** Slippage fraction for a fill, given size relative to the token's mcap. */
export function slippageFor(
  sizeLamports: number,
  mcapLamports: number,
  config: TradingConfig,
): number {
  const impact = mcapLamports > 0 ? (sizeLamports / mcapLamports) * config.IMPACT_COEFFICIENT : 0;
  // Capped: beyond this the fill model stops being meaningful and the position
  // should simply have been rejected as too large.
  return Math.min(0.45, config.BASE_SLIPPAGE + impact);
}

/**
 * Whether this agent would enter, given its decoded strategy.
 *
 * Deliberately mechanical: the genome *is* the rule. The brain's job is to
 * choose among eligible tokens and to explore, not to re-implement the filter.
 */
export function passesEntryFilter(
  snapshot: TokenSnapshot,
  strategy: DecodedStrategy,
  stepMs: number,
): boolean {
  const ageSteps = Math.round(snapshot.ageMs / stepMs);
  if (ageSteps !== strategy.entryAgeSteps) return false;
  if (snapshot.buyRatio < strategy.minBuyRatio) return false;
  if (snapshot.momentum > strategy.maxMomentum) return false;
  return true;
}

/** Opens a paper position, or returns null when the agent cannot afford one. */
export function openPosition(
  input: {
    tick: MarketTick;
    symbol: string;
    step: number;
    capitalLamports: number;
    strategy: DecodedStrategy;
    config: TradingConfig;
  },
): PaperPosition | null {
  const { tick, symbol, step, capitalLamports, strategy, config } = input;

  const feeLamports = solToLamports(config.FEE_SOL);
  const sizeLamports = Math.floor(capitalLamports * strategy.positionFraction);

  // A position must be worth more than the round-trip fees to be worth taking.
  if (sizeLamports <= feeLamports * 3) return null;
  if (sizeLamports + feeLamports > capitalLamports) return null;

  const slippage = slippageFor(sizeLamports, tick.mcapLamports, config);
  const entryPrice = Math.max(1, Math.round(tick.priceLamports * (1 + slippage)));

  return {
    mint: tick.mint,
    symbol,
    entryStep: step,
    quotedEntryLamports: tick.priceLamports,
    entryPriceLamports: entryPrice,
    sizeLamports,
    takeProfitMultiple: strategy.takeProfitMultiple,
    stopMultiple: strategy.stopMultiple,
    maxHoldSteps: strategy.maxHoldSteps,
    entryFeeLamports: feeLamports,
    entrySlippageLamports: Math.round(sizeLamports * slippage),
  };
}

/**
 * Tests a single tick against a position's exit rules.
 *
 * This is the streaming primitive: the live engine holds open positions and
 * feeds each new tick through here, rather than re-scanning a growing array
 * every step. `resolvePosition` below is the batch form, for tests.
 *
 * Returns null while the position should stay open.
 */
export function stepPosition(
  position: PaperPosition,
  tick: MarketTick,
  currentStep: number,
  config: TradingConfig,
): PositionOutcome | null {
  const takeProfitPrice = position.entryPriceLamports * position.takeProfitMultiple;
  const stopPrice = position.entryPriceLamports * position.stopMultiple;
  const heldSteps = currentStep - position.entryStep;

  let exitReason: ExitReason | null = null;
  let quotedExit = tick.priceLamports;

  if (tick.priceLamports >= takeProfitPrice) {
    quotedExit = Math.round(takeProfitPrice);
    // TP1 and TP2 are bands, not two exact constants. The take-profit target is
    // a continuum the genome sets anywhere between TP1_MULTIPLE and
    // TP2_MULTIPLE, so requiring exact equality with ×2.0 to earn the TP2 label
    // made it reachable only by a genome whose bias was precisely zero — the
    // whole category was effectively dead, and every patient agent was reported
    // as if it had banked fast. Splitting at the midpoint makes both labels
    // describe a real behaviour: TP1 banked the quick +50%, TP2 held out for
    // something near the double.
    const band = (config.TP1_MULTIPLE + config.TP2_MULTIPLE) / 2;
    exitReason = position.takeProfitMultiple >= band ? 'TP2' : 'TP1';
  } else if (tick.priceLamports <= stopPrice) {
    exitReason = 'STOP';
  } else if (heldSteps >= position.maxHoldSteps) {
    exitReason = 'TIMEOUT';
  }

  if (!exitReason) return null;

  return settle(position, exitReason, quotedExit, tick.mcapLamports, currentStep, config);
}

/** Closes a position at a given quote, applying exit slippage and fees. */
export function settle(
  position: PaperPosition,
  exitReason: ExitReason,
  quotedExit: number,
  mcapAtExit: number,
  exitStep: number,
  config: TradingConfig,
): PositionOutcome {
  const exitSlippage = slippageFor(position.sizeLamports, mcapAtExit, config);
  const exitPrice = Math.max(1, Math.round(quotedExit * (1 - exitSlippage)));

  const grossProceeds = (position.sizeLamports * exitPrice) / position.entryPriceLamports;
  const exitFee = solToLamports(config.FEE_SOL);
  const proceeds = Math.max(0, Math.round(grossProceeds - exitFee));

  const totalCommitted = position.sizeLamports + position.entryFeeLamports;
  const pnl = proceeds - totalCommitted;

  return {
    exitReason,
    exitStep,
    holdSteps: Math.max(1, exitStep - position.entryStep),
    quotedExitLamports: quotedExit,
    exitPriceLamports: exitPrice,
    proceedsLamports: proceeds,
    pnlLamports: pnl,
    returnPct: totalCommitted > 0 ? pnl / totalCommitted : 0,
    totalFeesLamports: position.entryFeeLamports + exitFee,
    totalSlippageLamports:
      position.entrySlippageLamports + Math.round(position.sizeLamports * exitSlippage),
  };
}

/**
 * Resolves a position against the ticks that followed it.
 *
 * `ticks` must be in step order starting the step after entry. A position with
 * no further ticks — the token stopped being tracked — is closed at its last
 * observed price as a TIMEOUT, never silently discarded.
 */
export function resolvePosition(
  position: PaperPosition,
  ticks: MarketTick[],
  config: TradingConfig,
): PositionOutcome {
  let last: MarketTick | null = null;

  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i];
    last = tick;
    const outcome = stepPosition(position, tick, position.entryStep + i + 1, config);
    if (outcome) return outcome;
  }

  // The token stopped being tracked. Close at the last price seen rather than
  // discarding the position, which would silently erase a loss.
  return settle(
    position,
    'TIMEOUT',
    last ? last.priceLamports : position.quotedEntryLamports,
    last ? last.mcapLamports : 0,
    position.entryStep + Math.max(1, ticks.length),
    config,
  );
}

/** Builds the snapshot an agent is shown. It never sees the token's archetype. */
export function toSnapshot(
  tick: MarketTick,
  symbol: string,
  observations: number,
): TokenSnapshot {
  const flow = tick.buys + tick.sells;
  return {
    mint: tick.mint,
    symbol,
    ageMs: tick.ageMs,
    priceLamports: tick.priceLamports,
    mcapLamports: tick.mcapLamports,
    buys: tick.buys,
    sells: tick.sells,
    buyRatio: flow > 0 ? tick.buys / flow : 0.5,
    volumeLamports: tick.volumeLamports,
    holders: tick.holders,
    momentum: tick.momentum,
    observations,
  };
}
