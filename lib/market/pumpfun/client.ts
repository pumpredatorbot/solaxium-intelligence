/**
 * Talking to pump.fun.
 *
 * Deliberately the thinnest layer in the market stack: fetch, parse, hand off.
 * Every decision about what the data *means* lives in aggregate.ts, which is
 * pure and tested; this file is the part that can only be validated against the
 * live service, so it is kept small enough to read in one sitting.
 *
 * READ-ONLY, AND ONLY PUBLIC DATA. There is no key, no signature, no wallet and
 * no transaction anywhere in this module. It cannot buy or sell: it asks public
 * endpoints what already happened.
 *
 * pump.fun is not a versioned public API. Endpoints move and fields get
 * renamed, so every request is tolerant, every parse failure is counted rather
 * than thrown, and the recorder reports what it skipped.
 */

import {
  normaliseRestCoin,
  normaliseRestTrade,
  normaliseStreamLaunch,
  normaliseStreamTrade,
  type RawLaunch,
  type RawTrade,
} from './types';

/**
 * Hosts, in the order they are tried.
 *
 * More than one because pump.fun has repeatedly moved its frontend API between
 * these; a recorder that knows only one host stops working on a rename.
 */
export const REST_HOSTS = [
  'https://frontend-api-v3.pump.fun',
  'https://frontend-api-v2.pump.fun',
  'https://frontend-api.pump.fun',
] as const;

export const STREAM_URL = 'wss://pumpportal.fun/api/data';

export interface ClientOptions {
  hosts?: readonly string[];
  timeoutMs?: number;
  /** Delay between requests. pump.fun rate-limits, and a recorder is not in a hurry. */
  throttleMs?: number;
  onNote?: (note: string) => void;
}

export class PumpFunUnreachableError extends Error {
  constructor(readonly attempts: { host: string; reason: string }[]) {
    super(
      `pump.fun could not be reached. Tried:\n` +
        attempts.map((a) => `  ${a.host} — ${a.reason}`).join('\n') +
        `\n\nIf this is a 403 from the proxy rather than from pump.fun, the ` +
        `environment's network policy is blocking the host, not pump.fun refusing.`,
    );
    this.name = 'PumpFunUnreachableError';
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class PumpFunClient {
  private readonly hosts: readonly string[];
  private readonly timeoutMs: number;
  private readonly throttleMs: number;
  private readonly note: (note: string) => void;
  /** The host that last answered, so we stop paying for failures. */
  private preferred: string | null = null;

  constructor(options: ClientOptions = {}) {
    this.hosts = options.hosts ?? REST_HOSTS;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.throttleMs = options.throttleMs ?? 260;
    this.note = options.onNote ?? (() => {});
  }

  /** GETs a path from the first host that answers, and returns parsed JSON. */
  private async get(path: string): Promise<unknown> {
    const order = this.preferred
      ? [this.preferred, ...this.hosts.filter((h) => h !== this.preferred)]
      : [...this.hosts];
    const attempts: { host: string; reason: string }[] = [];

    for (const host of order) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${host}${path}`, {
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            // Identifying the caller honestly; no credentials of any kind.
            'user-agent': 'solaxium-intelligence/1.0 (paper-trading research; read-only)',
          },
        });
        if (!response.ok) {
          attempts.push({ host, reason: `HTTP ${response.status}` });
          continue;
        }
        this.preferred = host;
        return await response.json();
      } catch (error) {
        attempts.push({ host, reason: error instanceof Error ? error.message : String(error) });
      } finally {
        clearTimeout(timer);
      }
    }
    throw new PumpFunUnreachableError(attempts);
  }

  /** The most recently created coins. */
  async recentCoins(limit = 50, offset = 0): Promise<RawLaunch[]> {
    const raw = await this.get(
      `/coins?offset=${offset}&limit=${Math.min(limit, 100)}` +
        `&sort=created_timestamp&order=DESC&includeNsfw=false`,
    );
    const rows = Array.isArray(raw) ? raw : [];
    const launches: RawLaunch[] = [];
    let skipped = 0;
    for (const row of rows) {
      const launch = normaliseRestCoin(row);
      if (launch) launches.push(launch);
      else skipped++;
    }
    if (skipped > 0) this.note(`skipped ${skipped} unparseable coin records`);
    return launches;
  }

  /**
   * Every trade recorded for a mint, oldest first.
   *
   * Paged, because a token that ran can have thousands of trades and the
   * endpoint caps a page at 200.
   */
  async tradesFor(mint: string, maxTrades = 3000): Promise<RawTrade[]> {
    const out: RawTrade[] = [];
    const seen = new Set<string>();
    let offset = 0;
    let skipped = 0;

    while (out.length < maxTrades) {
      const raw = await this.get(
        `/trades/all/${mint}?limit=200&offset=${offset}&minimumSize=0`,
      );
      const rows = Array.isArray(raw) ? raw : [];
      if (rows.length === 0) break;

      for (const row of rows) {
        const trade = normaliseRestTrade(row);
        if (!trade) {
          skipped++;
          continue;
        }
        // The endpoint overlaps pages when new trades land mid-walk.
        const key = trade.signature ?? `${trade.at}:${trade.solLamports}:${trade.priceLamports}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trade);
      }

      if (rows.length < 200) break;
      offset += rows.length;
      await sleep(this.throttleMs);
    }

    if (skipped > 0) this.note(`${mint}: skipped ${skipped} unparseable trades`);
    out.sort((a, b) => a.at - b.at);
    return out;
  }

  /** One cheap call, to fail fast and clearly before a long capture starts. */
  async healthCheck(): Promise<{ ok: true; host: string; coins: number }> {
    const coins = await this.recentCoins(1);
    return { ok: true, host: this.preferred ?? this.hosts[0], coins: coins.length };
  }
}

// ---------------------------------------------------------------------------
// Live stream
// ---------------------------------------------------------------------------

export interface StreamHandlers {
  onLaunch: (launch: RawLaunch) => void;
  onTrade: (trade: RawTrade) => void;
  onNote?: (note: string) => void;
}

/**
 * Subscribes to new launches and to the trades of every launch it sees.
 *
 * The stream carries no timestamps, so arrival time is used and recorded as
 * such. Resolves when `signal` aborts, which is how the recorder bounds a
 * capture window.
 *
 * Uses the global WebSocket (Node 22), so no dependency is added for it.
 */
export async function streamPumpFun(
  handlers: StreamHandlers,
  signal: AbortSignal,
  url = STREAM_URL,
): Promise<{ launches: number; trades: number }> {
  const note = handlers.onNote ?? (() => {});
  if (typeof WebSocket === 'undefined') {
    throw new Error('No global WebSocket; Node 22 or newer is required for live capture.');
  }

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const watching = new Set<string>();
    let launches = 0;
    let trades = 0;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        // Already closing; nothing to do.
      }
      resolve({ launches, trades });
    };

    signal.addEventListener('abort', finish, { once: true });

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ method: 'subscribeNewToken' }));
      note('subscribed to new launches');
    });

    socket.addEventListener('message', (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }
      const arrivedAt = Date.now();

      const launch = normaliseStreamLaunch(payload, arrivedAt);
      if (launch) {
        launches++;
        handlers.onLaunch(launch);
        if (!watching.has(launch.mint)) {
          watching.add(launch.mint);
          socket.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [launch.mint] }));
        }
      }

      const trade = normaliseStreamTrade(payload, arrivedAt);
      if (trade) {
        trades++;
        handlers.onTrade(trade);
      }
    });

    socket.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Live stream to ${url} failed. If the environment's network policy blocks ` +
            `pumpportal.fun, this cannot succeed from here.`,
        ),
      );
    });

    socket.addEventListener('close', finish);
  });
}
