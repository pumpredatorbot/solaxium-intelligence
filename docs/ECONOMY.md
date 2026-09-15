# The economy

Everything is denominated in **simulated SOL**, computed internally as integer lamports.

---

## Actions

Eight actions, all defined in `/config/simulation.ts`.

| Action | Cost (SOL) | Potential revenue | Risk | Base success | Driven by |
|---|---|---|---|---|---|
| `CREATE_PRODUCT` | 0.08 – 0.22 | 0 – 0.12 | MEDIUM | 62% | innovation, patience |
| `SELL_PRODUCT` | 0.02 – 0.06 | 0.06 – 0.95 | MEDIUM | 58% | salesFocus, aggressiveness |
| `OFFER_SERVICE` | 0.02 – 0.05 | 0.05 – 0.80 | LOW | 78% | salesFocus, patience |
| `MARKETING` | 0.05 – 0.15 | 0 – 0.18 | MEDIUM | 60% | marketingFocus, aggressiveness |
| `RESEARCH` | 0.03 – 0.09 | 0 – 0.06 | LOW | 70% | researchFocus, patience |
| `REST` | 0 | 0 | LOW | 100% | patience |
| `INVEST_IN_GROWTH` | 0.12 – 0.45 | 0 – 1.60 | HIGH | 42% | riskTolerance, aggressiveness |
| `SAVE` | 0 – 0.01 | 0 – 0.05 | LOW | 90% | savingBehavior, patience |

`CREATE_PRODUCT`, `MARKETING` and `RESEARCH` pay little directly — they buy **momentum**, a
multiplier on later revenue. They are investments, and only correct if the agent survives to cash
them in.

`REST` costs nothing, so it is always affordable. An agent can never be left with an empty action
set.

---

## How an action resolves

`resolveAction()` is pure: `(decision, genome, market, momentum, RNG) → money`. No IO, no clock.

```
1. alignment  = 0.5 + weightedMean(driving traits)            → [0.5, 1.5]

2. cost       = uniform(cost.min, cost.max), capped at capital

3. p(success) = clamp(baseSuccessRate
                      × (0.6 + 0.4 × alignment)               → ×0.8 … ×1.2
                      × (0.85 + 0.15 × market),
                      0.05, 0.88)

4. outcome    = SUCCESS | PARTIAL | FAILURE
                (a failed roll splits 45/55 between PARTIAL and FAILURE)

5. gross      = min + (max − min) × u^revenueSkew             ← skewed, not uniform

6. revenue    = gross × yield × alignment × market × momentum × REVENUE_SCALE
                where yield = 1 (SUCCESS) | partialYield (PARTIAL) | 0 (FAILURE)
```

### Why the revenue draw is skewed

The headline range is what an action *can* pay, not what it usually pays. A uniform draw over
`0.05 – 0.80` would make `OFFER_SERVICE` pay ~0.42 SOL against a ~0.035 SOL cost — a 12× expected
return that makes every agent immortal. (This was the first version, and it produced exactly that:
zero deaths in 40 cycles.)

Instead:

```
gross = min + (max − min) × u^skew          u ~ U(0,1)
```

`skew = 4` puts the median draw near the bottom of the range and makes the top genuinely rare.
Skews range from 2.0 (`CREATE_PRODUCT`, `RESEARCH`) to 6.0 (`INVEST_IN_GROWTH` — a lottery).

### Success probability caps at 88%

Nothing is ever a sure thing. A 95% cap removed almost all variance from `OFFER_SERVICE`, which
removed the risk that makes survival meaningful.

---

## The ledger

Every lamport that moves creates a `Transaction` row.

| Type | Meaning |
|---|---|
| `INITIAL_CAPITAL` | Founder endowment from the treasury |
| `CLONE_BONUS` | Offspring endowment |
| `REVENUE` | Earned by an action |
| `EXPENSE` | Action cost, or cycle upkeep |
| `ADJUSTMENT` | Operator or test correction |

Each row records `amountLamports` (signed), `balanceBeforeLamports`, `balanceAfterLamports`,
`cycle` and `metadata`.

### The invariant

```
agent.capitalLamports === SUM(transaction.amountLamports WHERE agentId = agent.id)
```

`Agent.capitalLamports` is written **only** inside the same database transaction that appends the
ledger row, so the two cannot drift.

Verify it from outside the process:

```bash
curl localhost:3000/api/agents/<id>/history | jq '.ledgerConsistent, .storedCapitalSol, .recomputedCapitalSol'
```

Two related rules:

- **Debits are clamped.** An agent that cannot afford an expense pays what it has and dies at zero.
  The *clamped* amount is what gets written, so the invariant still holds. Capital can never go
  negative.
- **Endowments are not revenue.** `INITIAL_CAPITAL` and `CLONE_BONUS` are excluded from
  `totalRevenueLamports`. Otherwise every newborn would show a 1 SOL "profit" it never earned.

`peakCapitalLamports` is maintained with `GREATEST(...)` in SQL, since Prisma cannot express an
atomic max.

---

## Upkeep and runway

Every living agent is charged `CYCLE_COST_SOL` (0.15) at the end of each of its cycles. This is
the clock that makes doing nothing fatal.

```
runway = capital / CYCLE_COST_SOL
```

A newborn has ~6.7 cycles of runway. The demo brain reads runway directly: below ~4 cycles it
collapses onto cheap, reliable actions. This is why near-death behaviour is legible on the agent
page — an agent making its last stand *looks* like one.

---

## Balancing

The economy is tuned by two constants: `REVENUE_SCALE` (global revenue multiplier) and
`CYCLE_COST_SOL` (upkeep). `scripts/balance.ts` runs the pure engine in memory — the same
`scoreAction`, `resolveAction` and `mutateTraits` the real engine uses, without the database, so a
20-config × 5-seed sweep takes seconds instead of an hour.

```bash
npx tsx scripts/balance.ts --sweep
```

Excerpt from the sweep the shipped defaults came from (120 cycles, 4 founders, 5 seeds each):

```
scale 1.50 cost 0.110 | agents  43  mortality 44%  gens 4.8  best 13.7 SOL  extinct 0/5
scale 1.65 cost 0.130 | agents  29  mortality 58%  gens 4.6  best 18.1 SOL  extinct 0/5
scale 1.80 cost 0.110 | agents 162  mortality 30%  gens 7.0  best 26.9 SOL  extinct 0/5
scale 1.95 cost 0.110 | agents 219  mortality 21%  gens 7.6  best 29.6 SOL  extinct 0/5
scale 1.95 cost 0.150 | agents 134  mortality 45%  gens 6.8  best 21.1 SOL  extinct 0/5   ← shipped
scale 1.95 cost 0.170 | agents  36  mortality 57%  gens 5.4  best 18.3 SOL  extinct 1/5
```

**`REVENUE_SCALE = 1.95`, `CYCLE_COST_SOL = 0.15`** was chosen for:

- **45% mortality** — death is common enough to be the point, not a rare accident.
- **~7 generations** in 120 cycles — enough depth for selection to show.
- **0/5 extinctions** — a demo that reliably wipes out is not a demo.
- **Best agent at ~21 SOL** — 4× the clone threshold, so success is visible.

The bounds are asserted in `tests/evolution.test.ts`: mortality between 20% and 75%, extinction
under 15%, more than 3 generations. Retune the constants and those tests tell you whether the
economy is still a game worth watching.

---

## Total capital grows

Because a clone is endowed by the treasury without the parent paying, total system capital rises
over a run. This is the specified behaviour, not a leak: the treasury is an infinite external
source, and the interesting quantity is per-agent profit, not the system total.

To model a closed economy, set `CLONE_PARENT_COST_SOL` to `INITIAL_CAPITAL_SOL` — reproduction
then transfers capital rather than minting it.

---

## Tuning recipes

| Goal | Change |
|---|---|
| More deaths | Raise `CYCLE_COST_SOL`, or lower `REVENUE_SCALE` |
| More generations | Lower `CLONE_THRESHOLD_SOL`, or raise `REVENUE_SCALE` |
| Faster evolution | Raise `MUTATION_RATE` / `MUTATION_CHANCE` |
| More strategy diversity | Raise `MUTATION_RATE`, lower `STRATEGY_INHERITANCE` |
| A harsher market | Raise `MARKET_AMPLITUDE` (recessions bite harder) |
| Bigger populations | Raise `MAX_LIVE_AGENTS` and `MAX_GENERATIONS` |

After any change: `npx tsx scripts/balance.ts` then `npm test`.
