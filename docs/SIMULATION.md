# The simulation

## Lifecycle

```
CREATED ──start──▶ RUNNING ⇄ PAUSED
                      │
                      ├──stop──▶ STOPPED      (terminal)
                      └──────────▶ COMPLETED  (terminal: extinction)

any state ──reset──▶ CREATED at cycle 0
```

| Transition | Effect |
|---|---|
| `createSimulation` | Row created, founders spawned, generation 0 opened |
| `startSimulation` | `RUNNING`; `startedAt` set on first start, preserved on resume |
| `pauseSimulation` | `RUNNING → PAUSED`; the cycle counter and RNG cursor freeze |
| `stopSimulation` | Terminal. `startSimulation` on a stopped run throws |
| `resetSimulation` | Cascade-deletes the population, returns to cycle 0, respawns founders |
| *(automatic)* | `COMPLETED` when the last living agent dies |

`STOPPED` and `COMPLETED` are deliberately terminal. A run that has ended is a historical record;
re-running it would make its leaderboard entries meaningless. Use reset, which is explicit.

---

## The cycle

One cycle advances every living agent exactly once.

```
 1. Load living agents, ORDER BY code ASC       ← deterministic iteration
 2. Compute this cycle's market multiplier
 3. For each agent:
      a. Build its AgentSnapshot                ← the only thing the brain sees
      b. brain.decide(snapshot, rng)            ← a PROPOSAL
      c. validateAction(proposal, snapshot)     ← the engine's veto
      d. resolveAction(...)                     ← pure: decision + genome + market + RNG
      e. ATOMIC TRANSACTION:
           - EXPENSE  (action cost)
           - REVENUE  (action revenue)
           - EXPENSE  (cycle upkeep)
           - AgentAction row
           - cycles += 1, momentum updated
      f. Emit AGENT_ACTION / AGENT_REVENUE / AGENT_EXPENSE
      g. Write a memory; compact if over budget
      h. Death check:  capital <= DEATH_THRESHOLD  → DEAD, permanently
      i. Clone check:  eligible → one offspring
 4. Refresh statistics for every generation touched
 5. Persist cycle number and RNG cursor
 6. If no agent is alive → COMPLETED
```

Step **e** is one `prisma.$transaction`. Either every movement lands or none does; the ledger can
never be left half-written. `tests/ledger.test.ts` asserts this with a forced rollback.

### Order matters

Death is checked **before** cloning. An agent that spends itself to zero cannot reproduce on its
way out, even if its capital crossed the threshold earlier in the same cycle.

A dead agent is excluded from the next cycle's query, so the "no actions after death" rule is
structural rather than a guard that could be forgotten. It is still tested explicitly.

---

## Market conditions

A smooth sinusoid over cycle number — deliberately **not** seeded, so two runs with different
seeds still face the same economic weather and are comparable.

```ts
multiplier = 1 + MARKET_AMPLITUDE * sin(2π · cycle / MARKET_PERIOD_CYCLES)
```

Defaults give a multiplier in `[0.75, 1.25]` over a 40-cycle period, labelled `RECESSION`,
`SLOWDOWN`, `STABLE`, `GROWTH`, `BOOM`. The multiplier scales revenue and nudges success
probability, so a conservative genome that looks mediocre in a boom can be the one that survives
the recession.

---

## Momentum

`MARKETING`, `RESEARCH` and `CREATE_PRODUCT` produce no meaningful direct revenue. They add
**momentum** — a multiplier on subsequent revenue that decays back towards 1 each cycle, clamped
to `[0.5, 3]`.

This is what makes investment strategies coherent: spending on marketing is only correct if the
agent survives long enough to convert it.

---

## Speed

| Setting | Interval | Cycles per tick |
|---|---|---|
| `SLOW` | 2000 ms | 1 |
| `NORMAL` | 900 ms | 1 |
| `FAST` | 350 ms | 1 |
| `TURBO` | 120 ms | 3 |

Speed is a property of the *runner*, not the simulation, so changing it never affects the
outcome — only how fast you watch it. A run stepped by hand produces exactly the same history as
one run at TURBO.

---

## Reproducibility

Every random draw goes through `SeededRandom`. The generator is counter-based, so the complete
state is one integer:

```ts
nth draw = splitmix32(hash(seed), n)
```

`Simulation.rngCursor` is persisted after every cycle. Resuming is `createRng(seed, cursor)`.

**Consequences**

- Same seed + same config → byte-identical run, including which agents die and when.
- A paused run resumes on the exact same stream; pausing changes nothing.
- A reset with the same seed reproduces the original population exactly.
- `AI_PROVIDER=claude` **forfeits** this: model responses are not part of the seeded stream. This
  is the main reason `demo` is the default.

```bash
npm run simulate -- --seed reproduce-me --cycles 50
npm run simulate -- --seed reproduce-me --cycles 50   # identical
```

---

## Driving the engine

Four ways in, all calling the same `runCycle`:

**1. The live runner** (`lib/engine/runner.ts`) — what the UI uses.

**2. The API**
```bash
curl -X POST localhost:3000/api/simulation/tick -d '{"force":true}'
```
`force` single-steps a paused simulation, for operators and tests.

**3. Headless**
```bash
npm run simulate -- --cycles 200 --founders 4 --verbose
```

**4. Directly**
```ts
import { createSimulation, startSimulation, runCycle } from '@/lib/engine/engine';

const { simulationId } = await createSimulation({ seed: 'x', founderCount: 3 });
await startSimulation(simulationId);
const report = await runCycle(simulationId);
```

---

## Events

Every state change is persisted to `SimulationEvent`, ordered by an autoincrement `seq`.

`SIMULATION_CREATED` · `SIMULATION_STARTED` · `SIMULATION_PAUSED` · `SIMULATION_STOPPED` ·
`SIMULATION_COMPLETED` · `GENERATION_STARTED` · `GENERATION_ENDED` · `AGENT_BORN` ·
`AGENT_ACTION` · `AGENT_REVENUE` · `AGENT_EXPENSE` · `AGENT_DEAD` · `CLONE_CREATED`

The activity feed polls `/api/events?afterSeq=N`, so it transfers only the delta. Because the feed
is append-only and `seq` is monotonic, there is nothing to reconcile after a dropped connection —
the client just asks for everything past the last `seq` it saw.

---

## Population dynamics

With the shipped defaults, over 120 cycles from 4 founders (averaged over 24 seeds):

| | |
|---|---|
| Total agents produced | ~60 |
| Mortality | ~45% |
| Generations reached | ~6 |
| Median lifetime | ~24 cycles |
| Best agent's capital | ~21 SOL |
| Extinction rate | 0/5 |

Tuned with `scripts/balance.ts`, which runs the pure engine in memory. See
[`ECONOMY.md`](ECONOMY.md) for how these numbers were chosen.
