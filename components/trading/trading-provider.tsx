'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { SimulationSummary } from '@/lib/repo/queries';
import type { RunnerState } from '@/lib/engine/runner';
import type {
  ClosedTrade, DatasetRow, FlowToken, GenerationBand, OpenPosition, TraderCard, TradingStats,
} from '@/lib/repo/trading';

/**
 * One poller for the trading console.
 *
 * Same reasoning as the economic console: panels that poll independently drift
 * out of step with each other mid-market-step, and a viewer sees a population
 * of 41 next to a tree of 39.
 */

export interface TradingSnapshot {
  simulation: SimulationSummary | null;
  mode: string | null;
  runner: RunnerState | null;
  dataset: {
    id: string; key: string; source: string; tokenCount: number; steps: number;
    meta: Record<string, unknown> | null;
  } | null;
  stats: TradingStats | null;
  tree: GenerationBand[];
  trades: ClosedTrade[];
  open: OpenPosition[];
  traders: TraderCard[];
  flow: { tokens: FlowToken[]; source: string; origin: string | null; priceUnit: string } | null;
  datasets: DatasetRow[];
}

const EMPTY: TradingSnapshot = {
  simulation: null, mode: null, runner: null, dataset: null, stats: null,
  tree: [], trades: [], open: [], traders: [], flow: null, datasets: [],
};

interface TradingContextValue extends TradingSnapshot {
  loading: boolean;
  error: string | null;
  /** Trade ids seen for the first time in the latest poll, for the tape's flash. */
  freshTradeIds: Set<string>;
  refresh: () => Promise<void>;
}

const TradingContext = createContext<TradingContextValue | null>(null);

export function TradingProvider({
  children,
  initial,
  pollMs = 1200,
}: {
  children: React.ReactNode;
  initial: TradingSnapshot;
  pollMs?: number;
}) {
  const [snapshot, setSnapshot] = useState<TradingSnapshot>(initial ?? EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshTradeIds, setFreshTradeIds] = useState<Set<string>>(new Set());
  const knownTrades = useRef<Set<string>>(new Set(initial?.trades.map((t) => t.id) ?? []));
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const response = await fetch('/api/trading', { cache: 'no-store' });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = await response.json();
      const next: TradingSnapshot = body.data ?? body;

      // Which trades are new since the last poll. Used only for a one-shot
      // highlight; the tape itself is always the server's ordering.
      const fresh = new Set<string>();
      for (const trade of next.trades ?? []) {
        if (!knownTrades.current.has(trade.id)) fresh.add(trade.id);
      }
      knownTrades.current = new Set((next.trades ?? []).map((t) => t.id));

      setSnapshot({ ...EMPTY, ...next });
      setFreshTradeIds(fresh);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  return (
    <TradingContext.Provider value={{ ...snapshot, loading, error, freshTradeIds, refresh }}>
      {children}
    </TradingContext.Provider>
  );
}

export function useTrading(): TradingContextValue {
  const context = useContext(TradingContext);
  if (!context) throw new Error('useTrading must be used inside a TradingProvider');
  return context;
}

/** Signed SOL, always with its sign, so a loss is never read as a gain. */
export function signedSol(value: number, decimals = 4): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(decimals)}`;
}

export function pct(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}
