# The agent system

## Identity

Every agent carries:

| Field | Meaning |
|---|---|
| `code` | `SX-001` — sequential, unique within a simulation |
| `name` | A seeded two-word name (`Axiom Foundry`) |
| `generation` | 0 for founders; `parent.generation + 1` for clones |
| `parentId` | `null` for founders (displayed as `ORIGIN`) |
| `status` | `ALIVE` or `DEAD` |
| `capitalSol` | Current capital — a materialised view of the ledger |
| `startingCapitalSol` | What it was born with |
| `totalRevenueSol` / `totalExpensesSol` | Lifetime earned / spent, endowments excluded |
| `peakCapitalSol` | High-water mark, preserved after death |
| `cycles` / `lifetime` | Cycles acted / cycles between birth and death |
| `clonesCreated` | Offspring produced, capped at `MAX_CLONES_PER_AGENT` |
| `traits` | Eight values in `[0, 1]` — the genome |
| `strategy` | A readable label derived from the genome |
| `momentum` | Accumulated revenue multiplier, decaying towards 1 |
| `memory` | Bounded, summarised past |

```
SX-001                          Capital     1.42 SOL
Generation 0                    Revenue     3.81 SOL
Parent: ORIGIN                  Expenses    2.39 SOL
Strategy: MARKET_PUSHER         Profit      1.42 SOL
                                Status      ALIVE
```

---

## Traits — the genome

Eight values in `[0, 1]`, stored one row per trait:

`riskTolerance` · `innovation` · `marketingFocus` · `researchFocus` · `savingBehavior` ·
`aggressiveness` · `patience` · `salesFocus`

Founders are drawn from `N(0.5, 0.22)` and clamped — a population of identical founders would have
nothing to select between.

Traits do two things:

**1. Bias the decision.** Each action declares which traits drive it and how strongly.
`INVEST_IN_GROWTH` is driven by `riskTolerance` (weight 1.0) and `aggressiveness` (0.6).

**2. Scale the outcome.** `traitAlignment()` maps the weighted mean of an action's driving traits
onto `[0.5, 1.5]`, which multiplies both revenue and success probability. A genome suited to what
it is doing earns up to 3× what an unsuited one does for the same action.

That second point is what makes evolution meaningful rather than decorative: inheriting good
traits is *measurably* worth more SOL.

### Strategy labels

A readable summary of a trait vector, scored on **deviation from neutral** (not absolute value, or
an average genome would still "look like" whichever strategy had the largest coefficients):

`BALANCED` · `SERVICE_GRINDER` · `PRODUCT_BUILDER` · `GROWTH_HUNTER` · `CONSERVATIVE` ·
`MARKET_PUSHER` · `RESEARCHER`

A clone inherits its parent's label with probability `STRATEGY_INHERITANCE` (0.75); otherwise it
re-derives one from its own mutated traits. That is how a lineage changes course.

---

## The brain

```
AgentSnapshot ──▶ AIProvider.decide() ──▶ AgentDecision ──▶ validateAction() ──▶ executed
                     (PROPOSES)                                (ENGINE DECIDES)
```

`AgentSnapshot` is the complete world an agent can perceive: its own economics, its traits, market
conditions, its memory, its recent actions, and the list of actions it can currently afford.

It contains **no** database handle, environment variable, key, path, or engine internal. This is
enforced by construction — the type simply has no field for such a thing — and asserted in
`tests/brain.test.ts`, which sets a secret in `process.env` and checks it cannot appear in a
prompt.

### DEMO provider (default)

A real local decision engine, not a random picker. For each affordable action it computes:

| Factor | Effect |
|---|---|
| **Genome fit** | `traitAlignment` — what this agent is built for |
| **Expected value** | `midRevenue × baseSuccessRate − midCost`, scaled by the market |
| **Risk appetite** | Penalty proportional to the gap between `riskTolerance` and the action's risk |
| **Survival pressure** | Under ~4 cycles of runway, expensive actions are heavily penalised and cheap reliable ones boosted |
| **Ambition** | With runway to spare and the clone threshold in sight, risk gets a bonus |
| **Memory** | The agent's own realised net from this action, bounded to `[-1, +1]` |
| **Anti-rut** | A penalty per consecutive repeat, so strategies diversify |
| **Prerequisites** | `SELL_PRODUCT` is penalised without a recent `CREATE_PRODUCT` |

Scores go through a softmax whose temperature rises with `innovation` — high-innovation agents
explore more. The pick is drawn from the simulation's seeded RNG, so the whole thing is
deterministic.

Observable consequences, all asserted in `tests/brain.test.ts`:

- A near-death agent shifts to cheap, reliable actions.
- A high-`riskTolerance` genome prefers `INVEST_IN_GROWTH`; a high-`savingBehavior` one prefers `SAVE`.
- An agent that has profited from an action repeats it more.
- An agent stuck on one action gradually looks elsewhere.

### CLAUDE provider

```bash
AI_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-…
```

Server-side only. The prompt is built entirely from the snapshot. The response must be a JSON
object naming an action from the allowlist; anything else — unparseable output, an unknown action,
an action outside the allowlist, an API error — falls back to the demo brain for that cycle. A
degraded model call can never stall the economy.

Swapping providers requires no engine change: both satisfy `AIProvider`.

**Trade-off:** a network-backed brain is not part of the seeded stream, so `AI_PROVIDER=claude`
forfeits reproducibility.

---

## Memory

Each agent accumulates memories: its founding strategy, per-cycle successes and failures,
milestones (crossing the clone threshold, dying).

Memory is **bounded**. Past `MEMORY_LIMIT` (40) entries, the oldest low-importance batch is
compacted into one `SUMMARY` row. Entries with `importance >= 0.8` are preserved verbatim, and
`SUMMARY` rows are never re-compacted.

Without this, a 500-cycle run would grow both the prompt and the table without limit. Asserted in
`tests/queries.test.ts`.

`recallForPrompt()` returns the most *important* memories, then re-sorts them chronologically —
so the brain sees a coherent narrative rather than a relevance-ranked jumble.

---

## Death

```
capital <= DEATH_THRESHOLD_SOL  →  status = DEAD
```

Permanent. A dead agent is excluded from the next cycle's query, so it cannot act, earn, spend or
reproduce — this is structural, not a guard that could be forgotten. It is tested explicitly
anyway.

Everything is kept: ledger, actions, memory, traits, lineage, peak capital. The graveyard shows
final capital, total revenue, total expenses, profit, cycles, lifetime, generation, parent and
offspring. Dead agents remain eligible for the leaderboard — a short, brilliant run still counts.

---

## Cloning

An agent becomes `ELIGIBLE_TO_CLONE` when **all** of:

```
capital     >= CLONE_THRESHOLD_SOL       (5 SOL)
clones      <  MAX_CLONES_PER_AGENT      (3)
generation + 1 <= MAX_GENERATIONS        (12)
cycles      >= MIN_AGE_FOR_CLONING       (3)
live agents <  MAX_LIVE_AGENTS           (120)
```

At most one offspring per parent per cycle.

The clone receives `INITIAL_CAPITAL_SOL` from the simulated treasury, recorded as a `CLONE_BONUS`
ledger entry. **The parent's capital is not deducted** — this is the specified behaviour, and it
is why total system capital grows over a run. `CLONE_PARENT_COST_SOL` exists as a config knob and
defaults to 0.

`MIN_AGE_FOR_CLONING` prevents a lucky first cycle from triggering immediate reproduction;
`MAX_LIVE_AGENTS` stops a boom from filling the database.

> **Note on configuration.** `resolveConfig` enforces `CLONE_THRESHOLD_SOL > INITIAL_CAPITAL_SOL`.
> If you set a threshold at or below starting capital, it is rewritten to `2 × INITIAL_CAPITAL_SOL`
> — otherwise every newborn would be instantly eligible and the population would explode on cycle 1.

---

## Mutation

```
child_trait = clamp01(parent_trait + N(0, MUTATION_RATE))   with probability MUTATION_CHANCE
```

Defaults: `MUTATION_RATE = 0.08`, `MUTATION_CHANCE = 0.6`. Small enough that a lineage stays
recognisable; large enough that ten generations of selection visibly move the population.

Every mutation is recorded on the `Clone` row as `{ trait, from, to, delta }` and rendered on the
child's agent page. `tests/engine.test.ts` verifies the record matches the traits the child
actually carries.

### Does it work?

Averaged over 24 seeds of 120 cycles:

```
GEN   SURVIVAL   salesFocus   patience   riskTolerance
  0        48%        0.477      0.507           0.482
  2        57%        0.678      0.555           0.435
  4        72%        0.785      0.676           0.441
  6        73%        0.856      0.670           0.393
  8        90%        0.858      0.765           0.549
```

Founders start neutral. Eight generations later the population has roughly doubled its
`salesFocus`, raised `patience`, slightly reduced `riskTolerance`, and nearly doubled its survival
rate.

Nothing in the code tells agents that selling works. Selection finds it, because
`traitAlignment` makes a well-matched genome genuinely richer, and richer agents are the ones that
reproduce. Asserted in `tests/evolution.test.ts`.
