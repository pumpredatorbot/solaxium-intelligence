# Security model

## The premise

**AI agents are untrusted code paths.**

Not because a model is malicious, but because the boundary has to hold regardless: a model can be
confused, prompt-injected through data it reads, or simply wrong. An architecture that is only
safe when the model behaves correctly is not safe.

In V1 the money is simulated, so the stakes are low. The boundary is built and tested **now**,
while it is cheap, precisely so it is load-bearing before V2 makes it expensive.

---

## What an agent can do

Exactly one thing: **return a proposed action from a fixed list of eight.**

```
AgentSnapshot ──▶ AIProvider.decide() ──▶ AgentDecision ──▶ validateAction() ──▶ engine executes
                     (untrusted)                                (trusted)
```

## What an agent cannot do

| | |
|---|---|
| Database | No client, no connection string, no query. It receives a plain object. |
| Shell / filesystem | No `child_process`, no `fs`. Not restricted — simply never given. |
| Secrets | `ANTHROPIC_API_KEY` is read in `lib/ai/claude.ts` and never placed in a prompt. |
| Environment | `AgentSnapshot` has no field for it. |
| Keys / wallets | None exist in V1. `AgentWalletDescriptor` has no secret field. |
| Source code | Never read or sent. |
| System rules | The system prompt is a fixed constant, never assembled from agent-controlled text. |
| Other agents | An agent sees only itself. There is no inter-agent channel. |
| The engine | It cannot write capital, kill an agent, create a clone, or change config. |

---

## The snapshot boundary

`lib/engine/snapshot.ts` defines everything an agent can perceive:

```ts
interface AgentSnapshot {
  code, name, generation, parentCode, strategy, cycles, clonesCreated, maxClones,
  capitalSol, startingCapitalSol, totalRevenueSol, totalExpensesSol, totalProfitSol, roi,
  cloneThresholdSol, deathThresholdSol, cycleCostSol, runwayCycles,
  traits, market, momentum,
  memory, recentActions, availableActions,
}
```

This is enforced **by construction**. There is no field for a secret, so no leak requires a
runtime check to prevent — it requires someone to add a field, in a diff, on purpose.

It is also asserted. `tests/brain.test.ts` sets a secret in `process.env`, builds a prompt, and
checks the value cannot appear:

```ts
process.env.SOLAXIUM_TEST_SECRET = 'super-secret-value';
const prompt = buildUserPrompt(snapshot());
expect(prompt).not.toContain('super-secret-value');
expect(prompt).not.toContain('ANTHROPIC_API_KEY');
expect(prompt).not.toContain('postgresql://');
```

---

## The validation boundary

A proposal is validated three times before anything happens:

**1. In the provider.** `parseDecision()` requires valid JSON, a known `ActionType`, and
membership of the agent's current allowlist. Anything else returns `null` and falls back.

**2. In the brain.** `think()` re-checks membership and substitutes `REST` if the check fails.
It also catches a throwing provider and defaults to `REST` rather than failing the cycle.

**3. In the engine.** `validateAction()` is the final veto. Even a correct proposal is re-checked
against the snapshot the engine holds.

Three layers because the cost is a set lookup and the failure mode is an agent performing an
action it could not afford — which would corrupt the economy silently.

### Failure is never fatal

An unavailable model, a malformed response, a timeout, a rate limit: each falls back to the demo
brain or to `REST`. A degraded provider cannot stall the economy or crash the runner.

---

## Economic containment

Even a perfectly-behaved agent is bounded by the engine:

| Bound | Enforced by |
|---|---|
| Cannot spend more than it has | `resolveAction` caps cost at capital; `postEntry` clamps debits |
| Cannot go negative | Debit clamping — capital floors at 0, and then the agent dies |
| Cannot act after death | Excluded from the next cycle's query — structural, not a guard |
| Cannot exceed 3 offspring | `MAX_CLONES_PER_AGENT`, checked in `isEligibleToClone` |
| Cannot reproduce early | `MIN_AGE_FOR_CLONING` |
| Cannot fill the database | `MAX_LIVE_AGENTS`, `MAX_GENERATIONS` |
| Cannot alter its own config | Config lives on the `Simulation` row, never exposed in the snapshot |
| Cannot corrupt the ledger | Every movement is one atomic transaction |

---

## Untrusted configuration

`Simulation.config` is a JSON column, and a JSON column is editable. `resolveConfig()` validates
every value against bounds on read and repairs contradictions:

```ts
if (CLONE_THRESHOLD_SOL <= INITIAL_CAPITAL_SOL) CLONE_THRESHOLD_SOL = INITIAL_CAPITAL_SOL * 2;
if (DEATH_THRESHOLD_SOL >= INITIAL_CAPITAL_SOL) DEATH_THRESHOLD_SOL = 0;
```

A hand-edited row cannot produce an economy where every newborn instantly reproduces, or one where
every newborn is instantly dead.

---

## API surface

The control routes (`start`, `pause`, `stop`, `reset`, `tick`, `speed`) are **unauthenticated** in
V1. This is a single-tenant local laboratory; there are no user accounts and nothing at stake.

**Before any deployment where this is reachable by others**, add authentication to every `POST`
route under `/api/simulation/*` and to `POST /api/agents`. Read routes are harmless; the write
routes let anyone reset a run.

Error handling never leaks internals: `lib/api.ts` maps engine pre-conditions to 4xx with their
message and everything else to a 500 with a generic message, logging the detail server-side.

---

## Threat model

| Threat | Mitigation |
|---|---|
| Prompt injection via agent memory | Memory is engine-generated text, never agent-authored. Even if poisoned, the worst outcome is a bad action choice from the same eight. |
| Model requests an impossible action | Rejected at three layers, replaced with `REST`. |
| Model returns malformed output | `parseDecision` returns `null`; falls back to the demo brain. |
| Model exfiltrates a secret | No secret is ever in the prompt. Asserted by test. |
| Model drains an agent | It cannot spend more than that agent has; debits are clamped. |
| Model attacks the database | It has no database access. It returns a string. |
| API key leaks to the browser | Read only in a server module; never imported by a client component. |
| Runaway API cost | The demo brain is the default and requires no network at all. |
| A crash mid-cycle | Money movements are one atomic transaction; a failed cycle pauses the run. |
| Config tampering | Validated and repaired on read. |
| Someone points V1 at mainnet | `getSolanaProvider()` throws for any non-simulation mode. No mainnet RPC default exists. |

---

## V2 checklist

Before `realValueEnabled` can become `true`:

- [ ] **Signing out of process.** A separate service holds keys. The web app gets a client, never keys.
- [ ] **Per-agent limits.** Per-transaction, per-cycle and lifetime caps enforced by the signer.
- [ ] **Program allowlist.** Only named programs and instructions; everything else rejected pre-signing.
- [ ] **Simulate before send.** Already the pattern in `transactions.ts`; must stay mandatory.
- [ ] **Reconciliation.** Ledger vs chain each cycle; divergence halts the simulation.
- [ ] **Audit logging.** Every signing request — allowed or denied — with the originating decision.
- [ ] **Kill switch.** One action freezes all signing.
- [ ] **Devnet soak.** A long unattended devnet run before mainnet is discussed.
- [ ] **Re-review.** This threat model, against the new surface.

The principle does not change: **an agent proposes, a trusted system decides.** In V2 the trusted
system simply has more to say no to.
