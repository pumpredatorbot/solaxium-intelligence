/**
 * Synthetic launch market.
 *
 * This exists so the whole engine — execution, fitness, selection — can be
 * built and tested deterministically before any real pump.fun data is
 * recorded, and so tests never depend on a network.
 *
 * THE DESIGN POINT, and the reason this file matters more than it looks:
 *
 * Each token is assigned a hidden archetype that decides its price path, and
 * the *observable* signals (buy pressure, volume, holders, momentum) are
 * correlated with that archetype — but imperfectly, and with the correlation
 * strengthening as the token ages.
 *
 *   - If signals predicted the archetype perfectly, evolution would be
 *     trivial: one generation would find the rule and there would be nothing
 *     to observe.
 *   - If they predicted nothing, evolution would be impossible and fitness
 *     would be pure luck.
 *
 * An imperfect, decaying-noise signal is what makes "find a strategy" a real
 * search problem, and it is what the sample-size confidence in the fitness
 * function is defending against.
 *
 * The archetype mix is loosely calibrated to how launch markets actually
 * behave: most tokens go to zero, a minority spike, very few sustain.
 */

import { createRng, type SeededRandom } from '@/lib/rng';
import { solToLamports } from '@/lib/sol';
import type {
  DatasetSummary,
  MarketFeed,
  MarketTick,
  TokenLaunch,
} from './types';

export type Archetype = 'RUG' | 'FIZZLE' | 'PUMP' | 'MOONER';

/**
 * Population mix. Deliberately brutal: a strategy that enters everything must
 * lose, or the simulation would reward recklessness.
 */
const ARCHETYPE_MIX: { archetype: Archetype; weight: number }[] = [
  { archetype: 'RUG', weight: 0.46 },
  { archetype: 'FIZZLE', weight: 0.34 },
  { archetype: 'PUMP', weight: 0.16 },
  { archetype: 'MOONER', weight: 0.04 },
];

interface ArchetypeShape {
  /** Peak multiple of the launch price. */
  peak: [number, number];
  /** Step at which the peak is reached. */
  peakStep: [number, number];
  /** Multiple the price settles at after the peak. */
  floor: [number, number];
  /** Baseline buy pressure, 0..1, before noise. */
  buyPressure: [number, number];
}

const SHAPES: Record<Archetype, ArchetypeShape> = {
  // A deceptive spike, then to near zero. Rugs that never pumped would be
  // trivially avoidable: it is the ones that look exactly like a winner for
  // the first few seconds that make sniping a hard problem, so their peak
  // range deliberately overlaps PUMP and the low end of MOONER.
  RUG: { peak: [1.1, 4.2], peakStep: [1, 8], floor: [0.02, 0.15], buyPressure: [0.44, 0.74] },
  // Never really moves, bleeds out.
  FIZZLE: { peak: [1.05, 1.6], peakStep: [2, 12], floor: [0.25, 0.7], buyPressure: [0.42, 0.62] },
  // A real spike, then gives most of it back.
  PUMP: { peak: [1.9, 5.0], peakStep: [4, 20], floor: [0.5, 1.4], buyPressure: [0.56, 0.82] },
  // Sustains. Rare.
  MOONER: { peak: [3.5, 14.0], peakStep: [10, 40], floor: [2.0, 7.0], buyPressure: [0.62, 0.9] },
};

const SYMBOL_PARTS = [
  'PEPE', 'DOGE', 'MOON', 'BONK', 'WIF', 'CHAD', 'GIGA', 'TURBO', 'SOL', 'AI',
  'CAT', 'FROG', 'BASED', 'WOJAK', 'MEME', 'PUMP', 'ROCKET', 'DIAMOND', 'APE', 'FOMO',
];

interface FixtureToken {
  launch: TokenLaunch;
  archetype: Archetype;
  launchStep: number;
  /** Price multiple at each step of the token's life. */
  path: number[];
  /** Observable signal strength at each step, 0..1. */
  signal: number[];
  launchPriceLamports: number;
}

export interface FixtureMarketOptions {
  seed: string;
  /** Steps of market time to generate. */
  steps?: number;
  /** Milliseconds of market time per step. */
  stepMs?: number;
  /** Mean tokens launching per step. */
  launchRate?: number;
  /** Steps a token stays tracked after launch. */
  tokenLifespan?: number;
  /**
   * How much the observable signal is corrupted at a token's first tick.
   * 0 = signals reveal the archetype immediately, 1 = pure noise at entry.
   * The default leaves a real but hard-won edge.
   */
  signalNoise?: number;
}

export class FixtureMarket implements MarketFeed {
  readonly source = 'FIXTURE' as const;
  readonly datasetId: string;
  readonly length: number;
  readonly stepMs: number;

  private readonly tokens: FixtureToken[] = [];
  private readonly byMint = new Map<string, FixtureToken>();
  private readonly launchesByStep = new Map<number, TokenLaunch[]>();
  private readonly lifespan: number;

  constructor(options: FixtureMarketOptions) {
    const {
      seed,
      steps = 600,
      stepMs = 1000,
      launchRate = 0.9,
      tokenLifespan = 60,
      signalNoise = 0.55,
    } = options;

    this.datasetId = `fixture:${seed}`;
    this.length = steps;
    this.stepMs = stepMs;
    this.lifespan = tokenLifespan;

    const rng = createRng(seed);
    let counter = 0;

    for (let step = 0; step < steps; step++) {
      // Poisson-ish arrivals: usually zero or one launch, occasionally a burst.
      const launches = rng.next() < launchRate ? (rng.next() < 0.12 ? 2 : 1) : 0;

      for (let i = 0; i < launches; i++) {
        const token = this.createToken(rng, step, ++counter, signalNoise);
        this.tokens.push(token);
        this.byMint.set(token.launch.mint, token);
        const bucket = this.launchesByStep.get(step) ?? [];
        bucket.push(token.launch);
        this.launchesByStep.set(step, bucket);
      }
    }
  }

  private createToken(
    rng: SeededRandom,
    launchStep: number,
    index: number,
    signalNoise: number,
  ): FixtureToken {
    const archetype = rng.weighted(
      ARCHETYPE_MIX.map((m) => m.archetype),
      ARCHETYPE_MIX.map((m) => m.weight),
    );
    const shape = SHAPES[archetype];

    const peak = rng.float(shape.peak[0], shape.peak[1]);
    const peakStep = Math.round(rng.float(shape.peakStep[0], shape.peakStep[1]));
    const floor = rng.float(shape.floor[0], shape.floor[1]);
    const basePressure = rng.float(shape.buyPressure[0], shape.buyPressure[1]);

    // --- price path -------------------------------------------------------
    const path: number[] = [];
    const signal: number[] = [];
    for (let t = 0; t <= this.lifespan; t++) {
      let multiple: number;
      if (t <= peakStep) {
        // Rise to the peak, eased so early steps move fastest — snipers are
        // competing for exactly this window.
        const progress = peakStep === 0 ? 1 : t / peakStep;
        multiple = 1 + (peak - 1) * Math.pow(progress, 0.55);
      } else {
        // Decay from peak towards the floor.
        const decay = 1 - Math.exp(-(t - peakStep) / 8);
        multiple = peak + (floor - peak) * decay;
      }
      // Tick noise, tighter on bigger moves so paths stay recognisable.
      multiple *= 1 + rng.normal(0, 0.05);
      path.push(Math.max(0.01, multiple));

      // --- observable signal --------------------------------------------
      // The truth the agent is trying to infer, blurred by noise that shrinks
      // as the token ages: waiting buys information but costs entry price.
      const truth = archetype === 'MOONER' ? 0.92 : archetype === 'PUMP' ? 0.72 : archetype === 'FIZZLE' ? 0.42 : 0.28;
      const noiseNow = signalNoise * Math.exp(-t / 10);
      signal.push(clamp01(truth + rng.normal(0, noiseNow)));
    }

    const symbol = `${rng.pick(SYMBOL_PARTS)}${rng.int(1, 999)}`;
    const launchPriceLamports = Math.max(1, Math.round(rng.float(18, 260)));

    return {
      archetype,
      launchStep,
      path,
      signal,
      launchPriceLamports,
      launch: {
        mint: `FIXm${String(index).padStart(5, '0')}${rng.token(28)}`,
        symbol,
        name: `${symbol} Token`,
        launchedAt: launchStep * this.stepMs,
        initialMcapLamports: solToLamports(rng.float(4, 30)),
      },
    };
  }

  launches(step: number): TokenLaunch[] {
    return this.launchesByStep.get(step) ?? [];
  }

  tickAt(mint: string, step: number): MarketTick | null {
    const token = this.byMint.get(mint);
    if (!token) return null;

    const age = step - token.launchStep;
    if (age < 0 || age > this.lifespan) return null;

    const multiple = token.path[age];
    const pressure = token.signal[age];

    // Flow scales with age and with how strong the move is, so a hot token
    // genuinely looks busy.
    const activity = Math.max(1, Math.round((age + 1) * multiple * 2.2));
    const buys = Math.round(activity * pressure * 1.8) + 1;
    const sells = Math.round(activity * (1 - pressure) * 1.8);

    return {
      mint,
      ageMs: age * this.stepMs,
      at: step * this.stepMs,
      priceLamports: Math.max(1, Math.round(token.launchPriceLamports * multiple)),
      mcapLamports: Math.round(token.launch.initialMcapLamports * multiple),
      buys,
      sells,
      volumeLamports: Math.round(token.launch.initialMcapLamports * multiple * 0.18 * (age + 1)),
      holders: Math.max(1, Math.round(buys * 0.62)),
      momentum: multiple,
    };
  }

  /** The hidden truth. Tests use it; the engine and agents never see it. */
  archetypeOf(mint: string): Archetype | null {
    return this.byMint.get(mint)?.archetype ?? null;
  }

  summary(): DatasetSummary {
    const doubled = this.tokens.filter((t) => Math.max(...t.path) >= 2).length;
    const rugged = this.tokens.filter((t) => t.path.at(-1)! <= 0.5).length;

    return {
      datasetId: this.datasetId,
      source: this.source,
      tokenCount: this.tokens.length,
      steps: this.length,
      stepMs: this.stepMs,
      doubleRate: this.tokens.length > 0 ? doubled / this.tokens.length : 0,
      rugRate: this.tokens.length > 0 ? rugged / this.tokens.length : 0,
    };
  }

  /** Archetype counts, for dataset provenance in the UI. */
  archetypeBreakdown(): Record<Archetype, number> {
    const out: Record<Archetype, number> = { RUG: 0, FIZZLE: 0, PUMP: 0, MOONER: 0 };
    for (const token of this.tokens) out[token.archetype]++;
    return out;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
