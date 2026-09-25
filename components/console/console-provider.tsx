'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_SPEED, type SpeedMultiplier } from '@/config/simulation';
import type { RunnerState } from '@/lib/engine/runner';
import type { CoreNode, DashboardStats, SimulationSummary } from '@/lib/repo/queries';
import type { EventDTO } from '@/lib/repo/serialize';
import { deriveTelemetry, type TelemetryLine } from '@/lib/telemetry';

/**
 * One poller for the whole console.
 *
 * Every live panel — KPIs, the Core, telemetry, the event feed — reads from
 * this context. Running a poll per panel would multiply requests by the number
 * of panels on screen and let them disagree with each other mid-cycle.
 */

export interface ConsoleStatus {
  simulation: SimulationSummary | null;
  runner: RunnerState | null;
  stats: DashboardStats | null;
  simulations: SimulationSummary[];
  solana: { mode: string; network: string; realValueEnabled: boolean };
  aiProvider: string;
  /** Compact population snapshot driving the Core visualisation. */
  population: CoreNode[];
}

/** One observation of the headline figures, recorded per successful poll. */
export interface StatsSample {
  t: number;
  capitalSol: number;
  revenueSol: number;
  expensesSol: number;
  profitSol: number;
  alive: number;
  dead: number;
}

interface ConsoleContextValue extends ConsoleStatus {
  events: EventDTO[];
  telemetry: TelemetryLine[];
  /** Births, deaths, clones and generation boundaries — never sampled. */
  lifecycleEvents: EventDTO[];
  /**
   * True when the telemetry cursor is behind the engine. At high speeds the
   * engine outruns the feed, so telemetry shows a trailing window rather than
   * the present moment. Lifecycle events are unaffected.
   */
  telemetryLagging: boolean;
  /**
   * Rolling history of the KPI figures as this client observed them. Used for
   * the card sparklines and their change indicator — it is measured, not
   * modelled, and it is explicitly a session-scoped window.
   */
  statsHistory: StatsSample[];
  running: boolean;
  busy: string | null;
  error: string | null;
  /** Wall-clock ms the current run has been observed by this client. */
  realElapsedMs: number;
  /**
   * True when this page is the thing advancing the run.
   *
   * The engine's runner is an in-process timer, so on a serverless host it
   * stops the moment a response is sent and a run marked RUNNING never moves.
   * Rather than leave the play button doing nothing, the page takes over — and
   * says so, because a clock nobody knows about is worse than no clock.
   */
  browserClock: boolean;
  /** Steps per second this page is achieving, when it is driving. */
  browserClockRate: number;
  start: (options?: { founderCount?: number; seed?: string; name?: string }) => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  reset: (options?: { founderCount?: number; seed?: string }) => Promise<void>;
  step: () => Promise<void>;
  setSpeed: (speed: SpeedMultiplier) => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);

/**
 * Lifecycle events are polled on their own cursor.
 *
 * At high playback speeds the population emits thousands of per-cycle cashflow
 * events per second, so a single paged feed is dominated by them and births,
 * deaths and clones never surface. Filtering server-side keeps this stream
 * complete no matter how fast the engine runs.
 */
const LIFECYCLE_TYPES = [
  'AGENT_BORN',
  'AGENT_DEAD',
  'CLONE_CREATED',
  'GENERATION_STARTED',
  'GENERATION_ENDED',
  'SIMULATION_STARTED',
  'SIMULATION_PAUSED',
  'SIMULATION_STOPPED',
  'SIMULATION_COMPLETED',
  'SIMULATION_CREATED',
] as const;

const EVENT_BUFFER = 400;
const TELEMETRY_BUFFER = 300;
const STATS_BUFFER = 80;

function sampleOf(stats: DashboardStats): StatsSample {
  return {
    t: Date.now(),
    capitalSol: stats.totalCapitalSol,
    revenueSol: stats.totalRevenueSol,
    expensesSol: stats.totalExpensesSol,
    profitSol: stats.totalProfitSol,
    alive: stats.liveAgents,
    dead: stats.deadAgents,
  };
}

/** Steps requested per round trip, by speed. */
const BATCH_FOR_SPEED: Record<number, number> = { 0.5: 1, 1: 4, 2: 8, 5: 16, 10: 28, 25: 40 };

export function ConsoleProvider({
  initial,
  initialEvents,
  children,
}: {
  initial: ConsoleStatus;
  initialEvents: EventDTO[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ConsoleStatus>(initial);
  const [events, setEvents] = useState<EventDTO[]>(initialEvents);
  const [telemetry, setTelemetry] = useState<TelemetryLine[]>(() =>
    initialEvents.flatMap(deriveTelemetry).slice(-TELEMETRY_BUFFER),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeedState] = useState<SpeedMultiplier>(
    initial.runner?.speed ?? DEFAULT_SPEED,
  );
  const [realElapsedMs, setRealElapsedMs] = useState(0);
  const [statsHistory, setStatsHistory] = useState<StatsSample[]>(() =>
    initial.stats ? [sampleOf(initial.stats)] : [],
  );

  const [lifecycleEvents, setLifecycleEvents] = useState<EventDTO[]>(() =>
    initialEvents.filter((event) => (LIFECYCLE_TYPES as readonly string[]).includes(event.type)),
  );
  const [telemetryLagging, setTelemetryLagging] = useState(false);

  const lastSeq = useRef<number>(initialEvents.at(-1)?.seq ?? 0);
  const lastLifecycleSeq = useRef<number>(
    initialEvents.filter((e) => (LIFECYCLE_TYPES as readonly string[]).includes(e.type)).at(-1)
      ?.seq ?? 0,
  );
  const [browserClock, setBrowserClock] = useState(false);
  const [browserClockRate, setBrowserClockRate] = useState(0);

  const simulationId = status.simulation?.id ?? null;
  const running = status.simulation?.status === 'RUNNING';
  const cycle = status.simulation?.cycle ?? 0;

  // --- polling ------------------------------------------------------------
  const refresh = useCallback(async () => {
    try {
      const query = simulationId ? `?simulationId=${simulationId}` : '';
      const response = await fetch(`/api/simulation/status${query}`, { cache: 'no-store' });
      if (!response.ok) return;
      const next = (await response.json()) as ConsoleStatus;
      setStatus(next);
      if (next.runner?.speed) setSpeedState(next.runner.speed);
      if (next.stats) {
        const sample = sampleOf(next.stats);
        setStatsHistory((current) => {
          const last = current.at(-1);
          // Only record a reading when something actually moved, so an idle
          // simulation does not fill the buffer with identical points.
          if (
            last &&
            last.capitalSol === sample.capitalSol &&
            last.alive === sample.alive &&
            last.dead === sample.dead
          ) {
            return current;
          }
          return [...current, sample].slice(-STATS_BUFFER);
        });
      }
    } catch {
      // Transient; the next tick retries.
    }
  }, [simulationId]);

  const pollEvents = useCallback(async () => {
    if (!simulationId) return;
    try {
      const response = await fetch(
        `/api/events?simulationId=${simulationId}&afterSeq=${lastSeq.current}&limit=200`,
        { cache: 'no-store' },
      );
      if (!response.ok) return;
      const data = (await response.json()) as { events: EventDTO[] };
      if (data.events.length === 0) return;

      lastSeq.current = data.events.at(-1)!.seq;
      // A full page means more was waiting than we asked for: we are trailing.
      setTelemetryLagging(data.events.length >= 200);
      setEvents((current) => [...current, ...data.events].slice(-EVENT_BUFFER));
      setTelemetry((current) =>
        [...current, ...data.events.flatMap(deriveTelemetry)].slice(-TELEMETRY_BUFFER),
      );
    } catch {
      // Transient.
    }
  }, [simulationId]);

  const pollLifecycle = useCallback(async () => {
    if (!simulationId) return;
    try {
      const response = await fetch(
        `/api/events?simulationId=${simulationId}&afterSeq=${lastLifecycleSeq.current}` +
          `&types=${LIFECYCLE_TYPES.join(',')}&limit=200`,
        { cache: 'no-store' },
      );
      if (!response.ok) return;
      const data = (await response.json()) as { events: EventDTO[] };
      if (data.events.length === 0) return;

      lastLifecycleSeq.current = data.events.at(-1)!.seq;
      setLifecycleEvents((current) => [...current, ...data.events].slice(-EVENT_BUFFER));
    } catch {
      // Transient.
    }
  }, [simulationId]);

  // A running simulation is polled briskly; an idle one barely at all.
  useEffect(() => {
    const interval = running ? 900 : 6000;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refresh();
      if (running) {
        void pollEvents();
        void pollLifecycle();
      }
    }, interval);
    return () => clearInterval(timer);
  }, [running, refresh, pollEvents, pollLifecycle]);

  // Real-time clock, only while the run is live.
  useEffect(() => {
    if (!running) return;
    const started = Date.now() - realElapsedMs;
    const timer = setInterval(() => setRealElapsedMs(Date.now() - started), 1000);
    return () => clearInterval(timer);
    // realElapsedMs intentionally omitted: including it would reset the clock
    // every tick. It is only read to resume from where it paused.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // --- the clock ----------------------------------------------------------
  //
  // A run only advances if something advances it. On a long-lived host that is
  // the engine's own runner. On a serverless host the runner is frozen between
  // requests, so the run sits still under a live badge — which is exactly what
  // a play button that appears to do nothing looks like.
  //
  // So: watch whether the cycle is actually moving. If it is not, this page
  // drives it. Batched, because one step per round trip would cap the run at
  // network latency rather than engine speed.
  const stalledSince = useRef<number | null>(null);
  const lastSeenCycle = useRef(cycle);
  const driving = useRef(false);

  useEffect(() => {
    if (cycle !== lastSeenCycle.current) {
      lastSeenCycle.current = cycle;
      stalledSince.current = null;
    }
  }, [cycle]);

  useEffect(() => {
    if (!running || !simulationId) {
      stalledSince.current = null;
      setBrowserClock(false);
      setBrowserClockRate(0);
      return;
    }

    let cancelled = false;
    const samples: number[] = [];

    const loop = async () => {
      while (!cancelled) {
        // Give the server's own runner a fair chance first: only take over
        // once the cycle has genuinely not moved for a few seconds.
        if (!driving.current) {
          if (stalledSince.current === null) stalledSince.current = Date.now();
          if (Date.now() - stalledSince.current < 3500) {
            await new Promise((r) => setTimeout(r, 700));
            continue;
          }
          driving.current = true;
          setBrowserClock(true);
        }

        const startedAt = performance.now();
        try {
          const response = await fetch('/api/simulation/tick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ simulationId, steps: BATCH_FOR_SPEED[speed] ?? 8 }),
          });
          if (!response.ok) {
            // A finished or paused run answers 409; stop rather than hammer it.
            cancelled = true;
            break;
          }
          const report = await response.json();
          const advanced: number = report?.advanced ?? 1;
          samples.push(advanced / Math.max((performance.now() - startedAt) / 1000, 0.001));
          if (samples.length > 5) samples.shift();
          if (cancelled) break;
          setBrowserClockRate(samples.reduce((a, b) => a + b, 0) / samples.length);
          await refresh();
          if (report?.status && report.status !== 'RUNNING') break;
        } catch {
          break;
        }
        // A breath, so a fast engine cannot starve the console's own polling.
        await new Promise((r) => setTimeout(r, 120));
      }

      driving.current = false;
      if (!cancelled) {
        setBrowserClock(false);
        setBrowserClockRate(0);
      }
    };

    void loop();
    return () => {
      cancelled = true;
      driving.current = false;
      setBrowserClock(false);
      setBrowserClockRate(0);
    };
  }, [running, simulationId, speed, refresh]);

  // --- controls -----------------------------------------------------------
  const call = useCallback(
    async (endpoint: string, body: Record<string, unknown>, label: string) => {
      setBusy(label);
      setError(null);
      try {
        const response = await fetch(`/api/simulation/${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ simulationId, ...body }),
        });
        const data = await response.json();
        if (!response.ok) {
          setError(typeof data?.error === 'string' ? data.error : 'Request failed');
          return null;
        }
        await refresh();
        router.refresh();
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed');
        return null;
      } finally {
        setBusy(null);
      }
    },
    [simulationId, refresh, router],
  );

  const value = useMemo<ConsoleContextValue>(
    () => ({
      ...status,
      events,
      telemetry,
      lifecycleEvents,
      telemetryLagging,
      statsHistory,
      running,
      busy,
      error,
      realElapsedMs,
      browserClock,
      browserClockRate,
      clearError: () => setError(null),
      refresh,
      start: async (options = {}) => {
        const data = await call(
          'start',
          { speed, founderCount: options.founderCount ?? 3, seed: options.seed, name: options.name },
          'start',
        );
        // A fresh run resets the client's view of history.
        if (data?.created) {
          lastSeq.current = 0;
          setEvents([]);
          setTelemetry([]);
          setLifecycleEvents([]);
          setStatsHistory([]);
          setRealElapsedMs(0);
          lastLifecycleSeq.current = 0;
        }
        await Promise.all([pollEvents(), pollLifecycle()]);
      },
      pause: async () => {
        await call('pause', {}, 'pause');
      },
      stop: async () => {
        await call('stop', {}, 'stop');
      },
      reset: async (options = {}) => {
        await call('reset', { founderCount: options.founderCount ?? 3, seed: options.seed }, 'reset');
        lastSeq.current = 0;
        lastLifecycleSeq.current = 0;
        setEvents([]);
        setTelemetry([]);
        setLifecycleEvents([]);
        setStatsHistory([]);
        setRealElapsedMs(0);
        await Promise.all([pollEvents(), pollLifecycle()]);
      },
      step: async () => {
        await call('tick', { force: true }, 'step');
        await Promise.all([pollEvents(), pollLifecycle()]);
      },
      setSpeed: async (next: SpeedMultiplier) => {
        setSpeedState(next);
        if (simulationId && running) await call('speed', { speed: next }, `speed`);
      },
    }),
    [
      status,
      events,
      telemetry,
      lifecycleEvents,
      telemetryLagging,
      statsHistory,
      running,
      busy,
      error,
      realElapsedMs,
      browserClock,
      browserClockRate,
      refresh,
      call,
      speed,
      pollEvents,
      pollLifecycle,
      simulationId,
    ],
  );

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}

export function useConsole(): ConsoleContextValue {
  const context = useContext(ConsoleContext);
  if (!context) throw new Error('useConsole must be used inside <ConsoleProvider>');
  return context;
}

/** Formats milliseconds as HH:MM:SS for the mission clocks. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}
