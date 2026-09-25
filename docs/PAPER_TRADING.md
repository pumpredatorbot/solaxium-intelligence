# Paper trading on pump.fun launches

> **Nothing here moves real value.** There is no wallet, no private key, no
> signature and no transaction anywhere in this path. A position is an
> accounting entry against recorded prices, and capital moves only through the
> internal ledger. The pump.fun code is read-only and touches public market
> data only.

## What the system does

Agents are not given a winning strategy. Each carries a genome of eight traits,
which is decoded into a concrete trading policy — how young a token it will
enter, what buy pressure it demands, how much of its capital it commits, where
it takes profit, where it stops, how long it will hold. Agents that survive
clone with mutation; agents that run out of capital die. Over generations the
population searches for a policy that works.

The pipeline:

```
pump.fun (real launches + trades)
        │  npm run record          ← read-only HTTP / websocket capture
        ▼
MarketDataset + Token + Tick        ← a replayable dataset in Postgres
        │  marketForAsync()
        ▼
Paper execution engine             ← slippage, fees, asymmetric exits
        │
        ▼
Agents #001, #002, #003 …          ← genome → policy → ENTER / SKIP
        │  TP ×1.5 / ×2.0, stop, timeout
        ▼
P&L → ledger → fitness → death / clone → next generation
```

## Capturing real data

```bash
npm run record                  # backfill ~60 recent coins and their trade history
npm run record -- --coins 200   # a wider capture
npm run record -- --live 900    # listen to the live stream for 15 minutes
```

Backfill is the default because a token's **whole lifecycle** is what agents
have to learn, and history already contains complete ones — launch, run, rug.
A live capture has to wait hours for even one, and the pumpportal stream carries
no timestamps, so arrival time has to stand in for exchange time. When that
happens the dataset records it in its provenance, because a strategy tuned on
arrival latency would be learning our network rather than the market.

Hosts used, all read-only:

| Purpose | Host |
| --- | --- |
| Coin list, trade history | `frontend-api-v3.pump.fun` (falls back to v2, v1) |
| Live launches and trades | `wss://pumpportal.fun/api/data` |

If the environment's network policy blocks those hosts, `npm run record` fails
with the hosts it tried and whether the refusal came from the proxy or from
pump.fun. It never falls back to invented data.

### Trading a capture

```bash
npm run trade -- --dataset <id> --founders 80 --steps 400
```

Or from the console: **Trading → Run control → Market**, which lists every
recorded capture.

### Seeing the recorded path without network access

```bash
npm run demo:market
```

…or **Trading → Run control → Seed a generated market**, which exists because a
serverless deployment has no shell to run a script in.

This writes a locally generated market as a `RECORDED` dataset so the stored-tick
panels — the token flow, marked-to-market open positions — can be exercised.
It is **not** real data, its provenance says so, and the console labels a market
by that provenance rather than by `RECORDED`, so it can never be displayed as
real pump.fun activity.

Its archetypes are weighted the way the synthetic market's are (roughly 80%
losers), and each carries a true buy pressure that a snapshot shows blurred by
noise decaying with the token's age. That last part is not decoration: without a
signal correlated with the truth, a market has traps and nothing to learn from
them, and a population can only die. Early on a rug and a runner look alike;
waiting resolves them but costs entry price, and that trade-off is what the
population is evolving to solve.

## Running on a serverless host

The engine's runner is an in-process timer. On a long-lived Node host it ticks
on its own. On a serverless host — Vercel, and anything that freezes a function
between requests — it stops the moment a response is sent, so a run marked
RUNNING sits at the same step forever while the console shows a live badge over
a frozen simulation. The symptom is unmistakable: SIM TIME advances a few
seconds while REAL TIME reads zero.

**Trading → Run control → Run from browser** makes the page the clock instead.
It asks the server to advance a batch of steps at a time — one step per round
trip would cap the run at network latency rather than engine speed — and it is
an explicit toggle, because a clock that runs when nobody expects it is worse
than no clock. Measured at ~9 steps/s over HTTP locally. The run advances only
while the tab is open.

A long-lived host (Railway, Fly, a VM) does not need any of this: there the
in-process runner and the boot-time resume handle it.

## Prices

pump.fun has no order book: the bonding curve **is** the price, so a price is
derived from the virtual reserves at the moment of a trade rather than from one
trade's `sol_amount / token_amount`, which is an average fill and drifts with
trade size.

A single pump.fun token is worth roughly 28 lamports at launch. Quoting per
token would round a 99% collapse down to nothing, so recorded prices are quoted
in **lamports per 1e6 tokens** (`PRICE_LOT`), which puts a launch near 2.8e7 and
keeps resolution intact all the way down. The engine only ever divides one price
by another, so the scale is free; what matters is that a dataset is internally
consistent. Market caps stay in true lamports, because position impact is
computed against them.

Checked against the published curve: 30 virtual SOL against ~1.073e9 virtual
tokens must give a ~28 SOL market cap. `tests/pumpfun.test.ts` asserts it.

## Aggregation: an irregular stream into a regular grid

The engine steps a fixed grid; pump.fun emits trades whenever they happen.
`lib/market/pumpfun/aggregate.ts` bridges the two, and it is a pure function, so
a recorded dataset replays as deterministically as a synthetic one.

Three decisions that change what agents learn:

- **A step is a closing price, not an average.** An agent sees the last print of
  the step, which is the price it could actually have acted on next.
- **Prices carry forward through silence.** A token nobody trades has become
  illiquid, not worthless. Dropping it instead would silently erase open
  positions. Bounded by `maxIdleSteps`.
- **Buys, sells and volume are cumulative since launch.** They are evidence an
  agent accumulates, and this matches the synthetic market's semantics so one
  genome decodes the same way against both.

Tokens with less history than `minTrades` are dropped, and the dataset records
how many and why.

## Execution costs

A paper engine that fills for free reliably evolves agents that are profitable
only because the costs are missing. So:

- slippage is `BASE_SLIPPAGE` plus `IMPACT_COEFFICIENT × size / mcap`, capped at
  45% — a position large relative to a token's market cap moves the price;
- a flat fee is charged on **both** sides;
- a position too small to cover its own round trip is refused rather than opened;
- **exits are asymmetric**: a take-profit fills at the target even when the
  price gapped straight through it, while a stop fills at the price actually
  observed. Optimistic on entry timing and pessimistic on exit fills is the
  only honest direction for a simulator to err in.

`tests/paper-trading.test.ts` asserts a flat round trip loses money.

## Exits

| Exit | Meaning |
| --- | --- |
| `TP2` | Target ≥ ×1.75 — held out for something near the double |
| `TP1` | Target < ×1.75 — banked the quick +50% |
| `STOP` | Fell to the genome's stop multiple |
| `TIMEOUT` | Held past `maxHoldSteps`, or the token stopped quoting |

TP1 and TP2 are **bands**, not two exact constants: the genome sets its target
anywhere between `TP1_MULTIPLE` and `TP2_MULTIPLE`, so a split at the midpoint is
what makes both labels describe a real behaviour.

## Fitness

Profit alone is not fitness. An agent can be highly profitable and have taken
enormous risk to get there, and selecting on profit alone breeds exactly that
agent. `lib/engine/fitness.ts` scores five things:

| Component | Weight | What it measures |
| --- | --- | --- |
| Return | 0.35 | Mean return per trade, through `tanh` so an exceptional agent stays distinguishable from a merely good one |
| Consistency | 0.20 | Mean over dispersion — a Sharpe-like ratio with a floor, so a steady agent beats an erratic one with the same mean |
| Risk | 0.20 | `1 − max drawdown`, walked over the equity curve the trades imply **in the order they closed** |
| Execution | 0.15 | Take-profit rate against stop and timeout rates |
| Survival | 0.10 | Longevity, discounted for the dead |

The raw score is then shrunk towards the population mean by
`trades / (trades + K)`. Without that, an agent with two lucky trades outranks
one with two hundred solid ones, and the population chases noise.

Two bugs the fitness tests caught, both worth knowing about because they were
invisible in aggregate: a zero-variance agent was scored as "unknown
regularity" and lost to an erratic one, and the return score saturated at +20%.

## Determinism

A run is reproducible from its seed on the persisted path, not just in memory —
`tests/trading-engine.test.ts` asserts it, including across a pause with a full
reload of engine state, which is the property that lets a restarted runner
resume identically.

That demanded a total order everywhere a result depends on sequence:

- living agents by `code`;
- the nested open-positions include by `(entryStep, mint)`;
- an agent's closed positions by `(exitStep, mint)` — max drawdown walks them as
  a sequence, so an unordered read reported a drawdown the agent never suffered;
- the population mean by `code` — it is a float sum, and summing the same values
  in a different order differs in the last bits, which then propagates into
  every shrunk score;
- recorded launches within a step by `mint`.

Prisma and Postgres guarantee no ordering without an explicit `ORDER BY`, and
each of these was a real reproducibility defect before it was one.
