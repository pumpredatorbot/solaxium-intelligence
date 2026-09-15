# SOLAXIUM INTELLIGENCE

**EARN. SURVIVE. EVOLVE.**

An evolutionary intelligence laboratory where autonomous AI agents must generate wealth to
survive. Every agent is born with 1 SOL. Each cycle it reads its situation, commits capital to an
economic action, and settles its books. When its capital reaches zero it dies, permanently. When
it crosses the clone threshold it may reproduce, passing on a mutated copy of its genome.

Across generations, selection does the rest.

```
BORN → EARN → SURVIVE → CLONE → EVOLVE → MULTIPLY → SURVIVE OR DIE
```

> **V1 runs a fully simulated Solana economy.** No wallet is connected, no keypair is generated,
> no RPC is contacted and no transaction is broadcast. The Solana abstraction is built correctly
> today so a real integration can be dropped in later — see [`docs/SOLANA.md`](docs/SOLANA.md).

---

## Quick start

```bash
# 1. PostgreSQL 14+ must be running.
createdb solaxium

# 2. Install and configure.
npm install
cp .env.example .env          # the defaults work as-is for local development

# 3. Create the schema.
npx prisma migrate deploy     # or: npm run db:push

# 4. Run.
npm run dev
```

Open <http://localhost:3000/simulation> and press **Create & start**. Three founders are seeded
with 1 SOL each and the population begins to act. No API key is required — the default `demo`
brain is a real local decision engine (see [`docs/AGENT_SYSTEM.md`](docs/AGENT_SYSTEM.md)).

### Headless

```bash
npm run simulate -- --cycles 120 --founders 4 --seed my-seed --verbose
```

Runs a full simulation without Next.js and prints a per-generation report. Useful for tuning
`/config/simulation.ts` without a browser.

```bash
npx tsx scripts/balance.ts --sweep
```

Runs the economy in memory across a parameter grid. This is how the default numbers were chosen.

---

## What you can actually do

| | |
|---|---|
| `/` | Landing page with live population statistics |
| `/dashboard` | Live agents, dead agents, capital, revenue, profit, generations, clones, survival rate |
| `/simulation` | Start / pause / step / stop / reset, four speeds, live event stream |
| `/agents` | Every agent produced, filterable and sortable |
| `/agents/[id]` | One agent: economics, traits, mutations, memory, decisions, ledger, capital chart |
| `/evolution` | The full family tree |
| `/generations` | Cohort-by-cohort comparison |
| `/leaderboard` | Five rankings, scoped to a run, a generation, or all time |
| `/graveyard` | Every agent that ran out of capital, with its final numbers |

---

## Does it actually evolve?

Yes, and it is asserted in the test suite (`tests/evolution.test.ts`). Averaged over 24 seeds of
120 cycles each:

```
GEN   COHORTS   PROFIT/CYCLE (SOL)   SURVIVAL   riskTolerance   salesFocus   patience
  0        24               0.0058        48%           0.482        0.477      0.507
  1        23              -0.0104        42%           0.442        0.588      0.522
  2        20               0.0256        57%           0.435        0.678      0.555
  3        19               0.0458        65%           0.411        0.720      0.605
  4        15               0.0514        72%           0.441        0.785      0.676
  5        14               0.0242        73%           0.457        0.828      0.690
  6        12               0.0353        73%           0.393        0.856      0.670
  7        10              -0.0090        80%           0.432        0.867      0.653
  8         4               0.1084        90%           0.549        0.858      0.765
```

Founders start at a neutral `salesFocus` of ~0.48. Eight generations later the surviving
population sits at ~0.86, and survival rate has gone from 48% to 90%. Nothing tells the agents
that selling works — selection finds it.

Default economy, over the same runs: **45% mortality**, **~6 generations**, **0/5 extinctions**.

---

## Architecture at a glance

```
config/simulation.ts     every economic constant (nothing is hardcoded elsewhere)
config/solana.ts         Solana mode; V1 is pinned to "simulation"

lib/rng.ts               counter-based seeded PRNG — the whole run replays from its seed
lib/sol.ts               integer-lamport arithmetic

lib/engine/              the simulation engine — no React, no Next.js, no request object
  engine.ts              lifecycle, the cycle, death, cloning, generations
  ledger.ts              append-only economic ledger; every lamport is a row
  actions.ts             action resolution: decision + genome + market + RNG → money
  mutation.ts            inheritance and trait drift
  memory.ts              bounded agent memory with summarisation
  runner.ts              the live wall-clock loop

lib/ai/                  the brain abstraction — a provider PROPOSES, the engine DECIDES
  demo.ts                local heuristic engine (default, deterministic, no network)
  claude.ts              Anthropic API, server-side only

lib/solana/              Solana abstraction; V1 resolves to SimulationSolanaProvider

app/                     Next.js App Router pages and API routes
```

Full detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Configuration

Everything economic lives in `/config/simulation.ts`:

| Constant | Default | Meaning |
|---|---|---|
| `INITIAL_CAPITAL_SOL` | `1` | Capital every newborn receives |
| `CLONE_THRESHOLD_SOL` | `5` | At or above this, an agent may reproduce |
| `DEATH_THRESHOLD_SOL` | `0` | At or below this, the agent dies |
| `MAX_CLONES_PER_AGENT` | `3` | Hard cap on offspring |
| `CYCLE_COST_SOL` | `0.15` | Upkeep charged every cycle |
| `REVENUE_SCALE` | `1.95` | Global revenue multiplier — the survivability dial |
| `MUTATION_RATE` | `0.08` | Gaussian width of a trait mutation |
| `MUTATION_CHANCE` | `0.6` | Probability a given trait mutates at cloning |
| `MAX_GENERATIONS` | `12` | Generation depth limit |
| `MAX_LIVE_AGENTS` | `120` | Population cap |

Per-simulation overrides are stored on the `Simulation.config` column and validated on read, so a
hand-edited value can never break the economy.

### Environment

```bash
DATABASE_URL="postgresql://…"    # PostgreSQL
AI_PROVIDER="demo"               # "demo" (default) or "claude"
ANTHROPIC_API_KEY=""             # server-side only, never sent to the browser
SOLANA_MODE="simulation"         # V1 supports this value only
```

---

## Claude mode

```bash
AI_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-…
```

The Claude provider replaces the demo brain without the engine changing at all. It receives only
an `AgentSnapshot` — no credentials, no environment, no database handle, no source. Its reply is
parsed and validated against the action allowlist; anything unparseable falls back to the demo
brain so a degraded model call can never stall the economy.

Note that a network-backed brain forfeits seed reproducibility, which is why `demo` is the default.

---

## Commands

```bash
npm run dev          # development server
npm run build        # production build (runs prisma generate first)
npm test             # 141 tests
npm run typecheck    # tsc --noEmit
npm run simulate     # headless run
npm run db:push      # sync schema without a migration
npm run db:studio    # browse the data
```

---

## Security model

AI agents are untrusted. An agent never touches the database, the shell, the filesystem, the
environment, a secret, a key or a wallet. It receives a sanitised snapshot and returns a proposed
action; the engine validates it against an allowlist and executes it. See
[`docs/SECURITY.md`](docs/SECURITY.md) — this is the property that must survive into V2, when the
money stops being simulated.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design and module boundaries
- [`docs/SIMULATION.md`](docs/SIMULATION.md) — the cycle, the runner, reproducibility
- [`docs/AGENT_SYSTEM.md`](docs/AGENT_SYSTEM.md) — identity, brain, memory, cloning, mutation
- [`docs/ECONOMY.md`](docs/ECONOMY.md) — actions, the ledger, balancing
- [`docs/SOLANA.md`](docs/SOLANA.md) — the abstraction today and the path to real SOL
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model and the V2 checklist

---

## Roadmap

**V1 (this release)** — simulated Solana economy, complete agent lifecycle, evolution, full UI.

**V2** — Solana devnet, real wallet infrastructure, SPL tokens, on-chain transactions, agents with
real (small, capped) capital.

**V3** — mainnet, agent-to-agent economy, reputation, on-chain lineage, global rankings.

None of this activates on its own. Moving real value requires a reviewed change to
`config/solana.ts`, not an environment variable — see [`docs/SOLANA.md`](docs/SOLANA.md).
