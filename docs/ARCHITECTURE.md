# Architecture

## The one rule

**The simulation engine is framework-free.** It imports Prisma and an AI provider interface, and
nothing else. No React, no Next.js, no request object, no `window`. That is what lets the same
code run behind an API route, inside a wall-clock loop, in a test, and in a headless CLI script
without a single branch.

Everything below follows from that.

---

## Layers

```
┌───────────────────────────────────────────────────────────────┐
│ app/                    Next.js App Router                     │
│   pages (RSC)           read through lib/repo/queries.ts only  │
│   api/ routes           thin wrappers over lib/engine/*        │
│   components/           presentational; two client components  │
└───────────────────────────────────────────────────────────────┘
                              │
┌───────────────────────────────────────────────────────────────┐
│ lib/repo/               read model                             │
│   queries.ts            every dashboard number, defined once   │
│   serialize.ts          BigInt lamports → SOL DTOs             │
└───────────────────────────────────────────────────────────────┘
                              │
┌───────────────────────────────────────────────────────────────┐
│ lib/engine/             the simulation                         │
│   engine.ts             lifecycle · cycle · death · cloning    │
│   ledger.ts             append-only economic ledger            │
│   actions.ts            pure action resolution                 │
│   mutation.ts           pure inheritance + drift               │
│   memory.ts             bounded memory with summarisation      │
│   runner.ts             wall-clock loop (the only stateful bit)│
│   snapshot.ts           the ONLY thing a brain ever sees       │
└───────────────────────────────────────────────────────────────┘
          │                                    │
┌──────────────────────┐          ┌───────────────────────────────┐
│ lib/ai/              │          │ lib/solana/                   │
│   provider.ts        │          │   provider.ts   (interface)   │
│   demo.ts   (default)│          │   simulation-provider.ts      │
│   claude.ts (server) │          │   wallet · balance · tx       │
│   agent-brain.ts     │          │                               │
└──────────────────────┘          └───────────────────────────────┘
                              │
┌───────────────────────────────────────────────────────────────┐
│ PostgreSQL via Prisma                                          │
└───────────────────────────────────────────────────────────────┘
```

### Dependency direction

Arrows only ever point downward. `lib/engine` never imports from `app/` or `lib/repo/`. The pure
modules (`actions.ts`, `mutation.ts`, `traits.ts`, `strategy.ts`, `rng.ts`, `sol.ts`) do not even
import Prisma, which is why `scripts/balance.ts` can run the entire economy in memory at ~1000x
the speed of the database-backed engine.

---

## Key design decisions

### 1. Integer lamports, never floating-point SOL

The whole economy is computed in integer lamports (1 SOL = 10⁹). SOL floats appear only at the
boundaries — configuration in, display out.

```ts
solToLamports(0.1) + solToLamports(0.2) === solToLamports(0.3)  // true
0.1 + 0.2 === 0.3                                                // false
```

Without this, `sum(ledger) === agent.capital` would drift within a few hundred cycles and the
ledger would stop being an audit trail.

### 2. A counter-based PRNG, not a state-chaining one

`nth draw = hash(seed, n)`. The complete RNG state is therefore a single integer (`rngCursor`),
persisted on the `Simulation` row after every cycle.

This is what makes a run reproducible *through a pause*, a server restart, or a process crash. A
conventional `xorshift` would require serialising opaque internal state; here, resuming is
`createRng(seed, cursor)`.

Asserted in `tests/reproducibility.test.ts`: two runs of the same seed produce byte-identical
agents and actions.

### 3. The ledger is the source of truth

`Agent.capitalLamports` is a materialised balance. It is only ever written inside the same
database transaction that appends the `Transaction` row. `GET /api/agents/[id]/history` returns
both the stored balance and the balance recomputed from the ledger, plus a `ledgerConsistent`
flag — the invariant is auditable from outside the process.

### 4. A brain proposes; the engine decides

`AgentSnapshot` is the complete, sanitised world-view handed to a brain. It contains no database
handle, no environment variable, no key, no path and no engine internals. Whatever comes back is
re-validated against the agent's own allowlist by `validateAction()` before anything executes.

This boundary exists now, while the money is fake, so it is load-bearing and tested before the
money is real.

### 5. Deterministic iteration order

Agents are processed `ORDER BY code ASC` every cycle. Postgres makes no ordering guarantee without
an `ORDER BY`, and an unstable order would break reproducibility even with a fixed seed.

---

## The live runner

`lib/engine/runner.ts` holds a `Map<simulationId, RunnerEntry>` on `globalThis` (so Next.js HMR
cannot spawn a duplicate loop) and drives `runCycle` on an interval chosen by the speed setting.

- **Overlap protection.** A `busy` flag makes a slow cycle skip its beat rather than overlapping,
  which would corrupt the RNG cursor.
- **Self-healing.** A cycle that throws stops the loop and pauses the simulation, rather than
  leaving a dangling interval that fails forever.
- **Authoritative status.** Every tick re-reads `Simulation.status`; a simulation paused through
  another process stops this loop too.

This design assumes a single long-lived Node process. On a serverless platform, drive the engine
by calling `POST /api/simulation/tick` from an external scheduler instead — the engine does not
care which one advances it.

---

## The UI

Pages are React Server Components that read through `lib/repo/queries.ts`. Only two components are
client-side:

- `components/activity-feed.tsx` — polls `/api/events?afterSeq=N`, transferring only the delta.
  The feed is append-only, so there is nothing to reconcile after a reconnect.
- `components/simulation-controls.tsx` — posts to the control routes and calls `router.refresh()`
  so the server-rendered pages pick up the new state.

Charts are hand-rolled SVG (`components/charts.tsx`). A charting library would add ~150KB to every
page for what is, in practice, a polyline.

---

## Database

Nine models; see `prisma/schema.prisma` for the annotated source.

| Model | Purpose |
|---|---|
| `Simulation` | Run identity, status, seed, `rngCursor`, config overrides |
| `Agent` | Identity, lineage, economics, lifecycle state |
| `AgentTrait` | The genome, one row per trait |
| `AgentMemory` | Bounded memory, compacted into `SUMMARY` rows past the budget |
| `AgentAction` | Every decision: type, outcome, cost, revenue, reasoning, provider |
| `Transaction` | The append-only ledger |
| `Clone` | Parent → child, with the exact mutation applied at birth |
| `Generation` | Cohort statistics, recomputed as agents are born and die |
| `SimulationEvent` | The activity feed, ordered by an autoincrement `seq` |
| `AgentWallet` | A virtual address. No keypair exists — see `docs/SECURITY.md` |

Cascade deletes hang off `Simulation`, so deleting a run removes everything it produced.

---

## Testing

141 tests across 11 files.

| File | Covers |
|---|---|
| `rng.test.ts` | Determinism, cursor resume, distribution bounds |
| `sol.test.ts` | Lamport arithmetic and formatting |
| `mutation.test.ts` | Trait bounds, drift, inheritance, strategy derivation |
| `ledger.test.ts` | Balance invariant, clamping, atomicity, rollback |
| `engine.test.ts` | Birth, cycles, death, no-action-after-death, cloning, caps, generations |
| `lifecycle.test.ts` | Start / pause / resume / stop / reset, idempotency |
| `reproducibility.test.ts` | Whole-run replay from a seed |
| `brain.test.ts` | Decision validity, survival pressure, genome effects, prompt hygiene |
| `solana.test.ts` | Simulation provider, wallets, real-value guards |
| `queries.test.ts` | Dashboard, leaderboard, graveyard, generations, tree, events |
| `evolution.test.ts` | That selection actually moves the population |

`tests/evolution.test.ts` is the one that matters most: it asserts the project's load-bearing
claim. If it fails, SOLAXIUM is a random number generator with a nice dashboard.
