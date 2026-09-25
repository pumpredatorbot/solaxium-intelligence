/**
 * A real pump.fun capture, replayed.
 *
 * Implements the same MarketFeed the synthetic market implements, so the engine
 * cannot tell the difference — which is the property that lets the population
 * evolve against real memecoin behaviour without a single line of the engine
 * changing.
 *
 * Ticks are loaded once and held in memory. A capture is tens of thousands of
 * rows, and the engine reads a few hundred of them per step; querying per step
 * would make the database the bottleneck for data that never changes.
 *
 * NO REAL VALUE MOVES: these are recorded observations. Nothing here can trade.
 */

import type { DatasetSummary, MarketFeed, MarketTick, TokenLaunch } from './types';

export interface RecordedToken {
  launch: TokenLaunch;
  launchStep: number;
  ticks: MarketTick[];
}

export interface RecordedMarketInput {
  datasetId: string;
  key: string;
  steps: number;
  stepMs: number;
  tokens: RecordedToken[];
}

export class RecordedMarket implements MarketFeed {
  readonly source = 'RECORDED' as const;
  readonly datasetId: string;
  readonly key: string;
  readonly length: number;
  readonly stepMs: number;

  private readonly launchesByStep = new Map<number, TokenLaunch[]>();
  private readonly byMint = new Map<string, RecordedToken>();

  constructor(input: RecordedMarketInput) {
    this.datasetId = input.datasetId;
    this.key = input.key;
    this.length = input.steps;
    this.stepMs = input.stepMs;

    for (const token of input.tokens) {
      this.byMint.set(token.launch.mint, token);
      const list = this.launchesByStep.get(token.launchStep);
      if (list) list.push(token.launch);
      else this.launchesByStep.set(token.launchStep, [token.launch]);
    }

    // Launch order inside a step is fixed by mint, so two replays of the same
    // dataset present candidates to agents in the same order.
    for (const list of this.launchesByStep.values()) {
      list.sort((a, b) => a.mint.localeCompare(b.mint));
    }
  }

  launches(step: number): TokenLaunch[] {
    return this.launchesByStep.get(step) ?? [];
  }

  tickAt(mint: string, step: number): MarketTick | null {
    const token = this.byMint.get(mint);
    if (!token) return null;
    const offset = step - token.launchStep;
    if (offset < 0 || offset >= token.ticks.length) return null;
    return token.ticks[offset];
  }

  get tokenCount(): number {
    return this.byMint.size;
  }

  summary(): DatasetSummary {
    let doubled = 0;
    let rugged = 0;
    for (const token of this.byMint.values()) {
      const launch = token.ticks[0]?.priceLamports ?? 1;
      let peak = 0;
      for (const tick of token.ticks) peak = Math.max(peak, tick.priceLamports);
      if (peak / launch >= 2) doubled++;
      const final = token.ticks[token.ticks.length - 1]?.priceLamports ?? launch;
      if (final / launch <= 0.5) rugged++;
    }
    const n = this.byMint.size || 1;
    return {
      datasetId: this.datasetId,
      source: this.source,
      tokenCount: this.byMint.size,
      steps: this.length,
      stepMs: this.stepMs,
      doubleRate: doubled / n,
      rugRate: rugged / n,
    };
  }
}
