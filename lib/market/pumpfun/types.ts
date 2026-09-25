/**
 * pump.fun payload shapes, and the arithmetic that turns them into prices.
 *
 * Everything here is parsing and unit conversion — no network, no state — so
 * it is fully testable against captured payloads. The parsers are deliberately
 * tolerant: pump.fun is not a versioned public API, it renames fields, and a
 * recorder that throws on an unexpected key loses a capture window that cannot
 * be re-recorded. Unknown fields are ignored, numbers arrive as strings about
 * half the time, and both camelCase (websocket) and snake_case (REST) spellings
 * are accepted for the same value.
 *
 * NO REAL VALUE MOVES: this module reads public market data. It never signs,
 * sends, or holds anything.
 */

import { z } from 'zod';

/** pump.fun mints carry 6 decimals, so one token is 1e6 base units. */
export const TOKEN_DECIMALS = 6;
export const TOKEN_BASE_UNITS = 10 ** TOKEN_DECIMALS;
/** Every pump.fun bonding curve mints the same total supply. */
export const PUMPFUN_TOTAL_SUPPLY = 1_000_000_000;

/**
 * Price unit for recorded markets: lamports per 1e6 tokens.
 *
 * A pump.fun token launches around 2.8e-8 SOL, which is 28 lamports per single
 * token — coarse enough that a token down 99% would round to nothing and a
 * rug would be indistinguishable from a halving. Quoting a million tokens at a
 * time keeps a launch at ~2.8e7 and leaves precision intact all the way down.
 *
 * The engine only ever divides one price by another, so the scale is free; it
 * matters only that a dataset is internally consistent.
 */
export const PRICE_LOT = 1_000_000;

/** Accepts a number, a numeric string, or null. */
const num = z.union([z.number(), z.string()]).nullish().transform((v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
});

const text = z.union([z.string(), z.number()]).nullish().transform((v) =>
  v === null || v === undefined ? null : String(v),
);

/**
 * A trade as the REST history endpoint returns it.
 *
 * `timestamp` is what makes this path valuable: it carries real wall-clock
 * time, so a backfill reconstructs a token's actual lifecycle rather than the
 * arrival order of a live stream.
 */
export const RestTradeSchema = z
  .object({
    signature: text.optional(),
    mint: text,
    sol_amount: num.optional(),
    solAmount: num.optional(),
    token_amount: num.optional(),
    tokenAmount: num.optional(),
    is_buy: z.boolean().nullish(),
    isBuy: z.boolean().nullish(),
    user: text.optional(),
    traderPublicKey: text.optional(),
    timestamp: num.optional(),
    virtual_sol_reserves: num.optional(),
    vSolInBondingCurve: num.optional(),
    virtual_token_reserves: num.optional(),
    vTokensInBondingCurve: num.optional(),
    slot: num.optional(),
  })
  .passthrough();

export const RestCoinSchema = z
  .object({
    mint: text,
    name: text.optional(),
    symbol: text.optional(),
    created_timestamp: num.optional(),
    createdTimestamp: num.optional(),
    virtual_sol_reserves: num.optional(),
    virtual_token_reserves: num.optional(),
    total_supply: num.optional(),
    market_cap: num.optional(),
    complete: z.boolean().nullish(),
  })
  .passthrough();

/**
 * A pumpportal.fun websocket message.
 *
 * Note what is missing: no timestamp. A live stream is timestamped on arrival
 * by the recorder, which is the only honest option and is recorded as such in
 * the dataset's provenance.
 */
export const StreamMessageSchema = z
  .object({
    signature: text.optional(),
    mint: text,
    txType: text.optional(),
    traderPublicKey: text.optional(),
    solAmount: num.optional(),
    tokenAmount: num.optional(),
    initialBuy: num.optional(),
    vSolInBondingCurve: num.optional(),
    vTokensInBondingCurve: num.optional(),
    marketCapSol: num.optional(),
    name: text.optional(),
    symbol: text.optional(),
    pool: text.optional(),
  })
  .passthrough();

/** The normalised form everything downstream works with. */
export interface RawTrade {
  mint: string;
  /** Wall-clock milliseconds. */
  at: number;
  isBuy: boolean;
  solLamports: number;
  /** Trader address, used to count distinct wallets. Null when not exposed. */
  trader: string | null;
  /** Price in lamports per PRICE_LOT tokens, from the bonding curve reserves. */
  priceLamports: number;
  mcapLamports: number;
  signature: string | null;
}

export interface RawLaunch {
  mint: string;
  symbol: string;
  name: string;
  /** Wall-clock milliseconds. */
  launchedAt: number;
  initialMcapLamports: number;
  initialPriceLamports: number;
}

/**
 * Price from the bonding curve, in lamports per PRICE_LOT tokens.
 *
 * The curve is the price: pump.fun has no order book, so the virtual reserves
 * at the moment of a trade are the quote everyone traded against. Deriving it
 * from reserves rather than from `sol_amount / token_amount` matters, because
 * the latter is the average fill of one trade and drifts with trade size.
 */
export function priceFromReserves(
  solReservesLamports: number | null,
  tokenReservesBaseUnits: number | null,
): number | null {
  if (!solReservesLamports || !tokenReservesBaseUnits) return null;
  if (solReservesLamports <= 0 || tokenReservesBaseUnits <= 0) return null;
  // lamports per base unit, scaled to PRICE_LOT whole tokens.
  const perBaseUnit = solReservesLamports / tokenReservesBaseUnits;
  const price = perBaseUnit * TOKEN_BASE_UNITS * PRICE_LOT;
  return Number.isFinite(price) && price > 0 ? Math.round(price) : null;
}

/** Market cap implied by a PRICE_LOT price, in lamports. */
export function mcapFromPrice(priceLamports: number, totalSupply = PUMPFUN_TOTAL_SUPPLY): number {
  return Math.round((priceLamports * totalSupply) / PRICE_LOT);
}

export function solToLamportsFloat(sol: number): number {
  return Math.round(sol * 1e9);
}

/** REST timestamps arrive in seconds or milliseconds depending on the field. */
export function toMillis(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  // Anything below this is seconds; 1e12 ms is the year 2001.
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}

export function normaliseRestTrade(input: unknown): RawTrade | null {
  const parsed = RestTradeSchema.safeParse(input);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (!r.mint) return null;

  const at = toMillis(r.timestamp ?? null);
  if (at === null) return null;

  const price = priceFromReserves(
    r.virtual_sol_reserves ?? r.vSolInBondingCurve ?? null,
    r.virtual_token_reserves ?? r.vTokensInBondingCurve ?? null,
  );
  if (price === null) return null;

  const isBuy = r.is_buy ?? r.isBuy;
  if (typeof isBuy !== 'boolean') return null;

  const solLamports = Math.abs(Math.round(r.sol_amount ?? r.solAmount ?? 0));

  return {
    mint: r.mint,
    at,
    isBuy,
    solLamports,
    trader: r.user ?? r.traderPublicKey ?? null,
    priceLamports: price,
    mcapLamports: mcapFromPrice(price),
    signature: r.signature ?? null,
  };
}

/**
 * A websocket message into a trade.
 *
 * `at` is supplied by the caller because the stream carries no timestamp: the
 * recorder passes its own arrival clock, and that choice is recorded in the
 * dataset provenance so nobody later mistakes it for exchange time.
 */
export function normaliseStreamTrade(input: unknown, arrivedAt: number): RawTrade | null {
  const parsed = StreamMessageSchema.safeParse(input);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (!r.mint) return null;

  const kind = (r.txType ?? '').toLowerCase();
  if (kind !== 'buy' && kind !== 'sell' && kind !== 'create') return null;

  const price = priceFromReserves(
    // The stream quotes SOL and tokens in whole units, not base units.
    r.vSolInBondingCurve === null || r.vSolInBondingCurve === undefined
      ? null
      : solToLamportsFloat(r.vSolInBondingCurve),
    r.vTokensInBondingCurve === null || r.vTokensInBondingCurve === undefined
      ? null
      : r.vTokensInBondingCurve * TOKEN_BASE_UNITS,
  );
  if (price === null) return null;

  const mcap =
    r.marketCapSol !== null && r.marketCapSol !== undefined
      ? solToLamportsFloat(r.marketCapSol)
      : mcapFromPrice(price);

  return {
    mint: r.mint,
    at: arrivedAt,
    // A creation's initial buy is a buy.
    isBuy: kind !== 'sell',
    solLamports: Math.abs(solToLamportsFloat(r.solAmount ?? r.initialBuy ?? 0)),
    trader: r.traderPublicKey ?? null,
    priceLamports: price,
    mcapLamports: mcap,
    signature: r.signature ?? null,
  };
}

export function normaliseStreamLaunch(input: unknown, arrivedAt: number): RawLaunch | null {
  const parsed = StreamMessageSchema.safeParse(input);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (!r.mint || (r.txType ?? '').toLowerCase() !== 'create') return null;

  const trade = normaliseStreamTrade(input, arrivedAt);
  const price = trade?.priceLamports ?? null;
  if (price === null) return null;

  return {
    mint: r.mint,
    symbol: (r.symbol ?? r.mint.slice(0, 6)).toUpperCase(),
    name: r.name ?? r.symbol ?? r.mint.slice(0, 8),
    launchedAt: arrivedAt,
    initialMcapLamports: trade?.mcapLamports ?? mcapFromPrice(price),
    initialPriceLamports: price,
  };
}

export function normaliseRestCoin(input: unknown): RawLaunch | null {
  const parsed = RestCoinSchema.safeParse(input);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (!r.mint) return null;

  const launchedAt = toMillis(r.created_timestamp ?? r.createdTimestamp ?? null);
  if (launchedAt === null) return null;

  // A coin's *current* reserves are not its launch price; the launch price is
  // recovered from its first trade during aggregation. This is a placeholder
  // that aggregation overwrites, and is only used if the coin has no trades.
  const price =
    priceFromReserves(r.virtual_sol_reserves ?? null, r.virtual_token_reserves ?? null) ?? 0;

  return {
    mint: r.mint,
    symbol: (r.symbol ?? r.mint.slice(0, 6)).toUpperCase(),
    name: r.name ?? r.symbol ?? r.mint.slice(0, 8),
    launchedAt,
    initialMcapLamports: price > 0 ? mcapFromPrice(price) : 0,
    initialPriceLamports: price,
  };
}
