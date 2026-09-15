# Solana

## Where V1 stands

**No real value moves. None.**

- No keypair is generated, stored, or derivable from anything in the database.
- No seed phrase exists anywhere in the codebase.
- No RPC endpoint is contacted.
- No transaction is signed or broadcast.
- No wallet adapter is installed; `@solana/web3.js` is not a dependency.

`SOLANA_MODE` is `simulation`, and `getSolanaConfig().realValueEnabled` is **hard-coded `false`**
— not read from the environment. Flipping it is a reviewed code change, not a deployment setting.

```ts
// config/solana.ts
realValueEnabled: false,   // V1. Changing this is a deliberate, reviewed change.
```

Every code path that could move value calls `assertNoRealMoney()`, which throws while that flag is
false. Asserted in `tests/solana.test.ts`.

---

## Why build the abstraction now

Retrofitting a boundary around money that is already flowing is how mistakes happen. Building it
while the money is fake means the interface, the guards and the tests are all load-bearing *before*
they need to be.

So the abstraction is shaped for the real thing today, and backed by simulation.

```
SolanaProvider (interface)
  ├─ SimulationSolanaProvider   ← V1: the only implementation
  ├─ DevnetSolanaProvider       ← V2: deliberately absent
  └─ MainnetSolanaProvider      ← V3: deliberately absent
```

`getSolanaProvider()` **throws** for any mode other than `simulation`, rather than silently
degrading. A mis-set environment variable cannot quietly point the platform at a cluster.

```ts
if (mode !== 'simulation') {
  throw new Error(`SOLANA_MODE="${mode}" is not implemented in V1.`);
}
```

---

## The interface

```ts
interface SolanaProvider {
  readonly network: SolanaNetwork;
  readonly realValue: boolean;              // false for every V1 provider

  getBalance(address): Promise<LamportBalance>;
  getTokenBalance(address, mint): Promise<TokenBalance>;
  simulateTransaction(request): Promise<SimulatedTransaction>;
  sendTransaction(request): Promise<TransactionReceipt>;
  getTransaction(signature): Promise<TransactionReceipt | null>;
}
```

### SimulationSolanaProvider

A faithful stand-in for an RPC, backed by the internal ledger rather than a cluster.

- `getBalance()` is **not a stub returning a constant**. It resolves the virtual address to its
  agent and returns that agent's real ledger capital. Asserted in `tests/solana.test.ts`.
- `simulateTransaction()` performs real validation — positive amount, sufficient funds including a
  5000-lamport fee — and returns realistic program logs.
- `sendTransaction()` always simulates first and refuses to "send" a transaction that would fail.
  It records a receipt marked `simulatedOnly: true` with a `SIMsig…` signature that can never be
  mistaken for a real one.
- `getTokenBalance()` returns zero; V1 has no SPL tokens, but the shape is there.

The `transfer()` helper enforces **simulate-then-send**. That ordering is the pattern V2 must
keep: never broadcast a transaction that has not been dry-run.

---

## Wallets

```ts
interface AgentWalletDescriptor {
  agentId: string;
  provider: 'simulation' | 'devnet' | 'mainnet-beta';
  publicAddress: string;      // "SIMx…" — a virtual identifier
  network: SolanaNetwork;
}
```

That is the entire type. There is no `privateKey`, no `secretKey`, no `mnemonic`, no `keypairPath`
— not unset, *absent*. A test asserts the descriptor has exactly four keys, so adding a fifth
becomes a deliberate, visible act.

Addresses are prefixed `SIMx` and are 42 characters, so they are not valid base58 Solana pubkeys
and cannot be pasted into a real wallet by accident.

---

## Amounts are SOL-native

The system's unit is SOL, not USD. Internally everything is integer lamports:

```ts
LAMPORTS_PER_SOL = 1_000_000_000

solToLamports(0.1) + solToLamports(0.2) === solToLamports(0.3)   // true
0.1 + 0.2 === 0.3                                                 // false
```

This is not cosmetic. Floating-point SOL would break the ledger invariant within a few hundred
cycles, and lamport-integer arithmetic is exactly what a real integration would need anyway.

USD equivalents could be shown as informational only; SOL remains the native unit.

---

## The path to V2 (devnet)

Nothing here is implemented. It is the plan the current abstraction was shaped around.

**1. A signing service, out of process.** Agents never gain the ability to sign. A separate
service holds keys, exposes a narrow allowlisted API, and enforces limits. The web application
gets a client for it, never the keys.

**2. `DevnetSolanaProvider`.** Implements `SolanaProvider` against a devnet RPC. Every
`sendTransaction` still simulates first.

**3. Per-agent spending limits.** Per-transaction, per-cycle and lifetime caps enforced by the
signing service, not by calling code.

**4. A program allowlist.** Only named programs and instruction types are permitted. Anything else
is rejected before it reaches a signer.

**5. Dual-write reconciliation.** The internal ledger stays authoritative and is reconciled
against on-chain state each cycle. A divergence halts the simulation.

**6. Full audit logging.** Every signing request, allowed or denied, with the agent, the decision
that produced it and the resulting signature.

### The gate

`realValueEnabled` may only become `true` when all of the above exist and:

- [ ] A signing service runs out of process with no key material in the web application
- [ ] Per-agent spending limits are enforced server-side
- [ ] A program allowlist is enforced
- [ ] Every transaction is simulated before broadcast
- [ ] Ledger ↔ chain reconciliation runs each cycle and halts on divergence
- [ ] Full audit logs exist
- [ ] A kill switch can freeze all signing immediately
- [ ] The threat model in [`SECURITY.md`](SECURITY.md) has been re-reviewed against the new surface

Devnet first. Mainnet only after devnet has run unattended for a long time.

---

## V3 (mainnet) — not a roadmap item yet

Agent-to-agent trade, agent reputation, on-chain lineage, an asset representation if one is
actually useful, DAO governance if one is actually useful, global cross-simulation rankings.

All of it is speculative. None of it activates automatically.

---

## Configuration reference

```bash
SOLANA_MODE="simulation"        # V1 accepts this value only
SOLANA_NETWORK="simulation"     # forced to "simulation" when mode is simulation
SOLANA_RPC_URL=""               # ignored in simulation mode
```

```ts
NETWORKS['mainnet-beta'].defaultRpcUrl === null   // deliberate: no default mainnet endpoint
```

There is no mainnet RPC URL anywhere in the codebase. Someone would have to add one.
