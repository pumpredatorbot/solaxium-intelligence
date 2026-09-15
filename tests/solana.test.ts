import { beforeEach, describe, expect, it } from 'vitest';
import { assertNoRealMoney, getSolanaConfig } from '@/config/solana';
import { createRng } from '@/lib/rng';
import { getSolanaProvider } from '@/lib/solana';
import { describeNetwork, NETWORKS } from '@/lib/solana/network';
import {
  SIMULATED_FEE_LAMPORTS,
  SimulationSolanaProvider,
  guardRealTransfer,
} from '@/lib/solana/simulation-provider';
import { transfer, TREASURY_ADDRESS } from '@/lib/solana/transactions';
import { createSimulatedWallet, isSimulatedAddress } from '@/lib/solana/wallet';
import { prisma } from '@/lib/db';
import { createSimulation } from '@/lib/engine/engine';
import { solToLamports } from '@/lib/sol';
import { resetDatabase } from './helpers';

const balances = new Map<string, number>();
const source = { lamportsFor: async (a: string) => balances.get(a) ?? null };

describe('Solana configuration', () => {
  it('runs in simulation mode with real value disabled', () => {
    const config = getSolanaConfig();
    expect(config.mode).toBe('simulation');
    expect(config.network).toBe('simulation');
    expect(config.rpcUrl).toBeNull();
    expect(config.realValueEnabled).toBe(false);
  });

  it('falls back to simulation for an unrecognised mode', () => {
    const previous = process.env.SOLANA_MODE;
    process.env.SOLANA_MODE = 'ethereum';
    expect(getSolanaConfig().mode).toBe('simulation');
    process.env.SOLANA_MODE = previous;
  });

  it('blocks every real-value operation', () => {
    expect(() => assertNoRealMoney('sendTransaction')).toThrow(/simulated economy/i);
    expect(() => guardRealTransfer('withdraw')).toThrow();
  });

  it('refuses to resolve a provider for a non-simulation mode', () => {
    const previous = process.env.SOLANA_MODE;
    process.env.SOLANA_MODE = 'mainnet-beta';
    // getSolanaConfig() clamps unknown modes, but mainnet-beta is a valid mode
    // that V1 must still refuse to build a provider for.
    expect(() => getSolanaProvider()).toThrow(/not implemented in V1/);
    process.env.SOLANA_MODE = previous;
  });

  it('never carries a mainnet RPC default', () => {
    expect(NETWORKS['mainnet-beta'].defaultRpcUrl).toBeNull();
    expect(NETWORKS.simulation.realValue).toBe(false);
    expect(describeNetwork('simulation').label).toBe('Simulation');
  });
});

describe('SimulationSolanaProvider', () => {
  let provider: SimulationSolanaProvider;

  beforeEach(() => {
    balances.clear();
    provider = new SimulationSolanaProvider(source);
  });

  it('reports itself as simulated, never real', () => {
    expect(provider.network).toBe('simulation');
    expect(provider.realValue).toBe(false);
  });

  it('returns a zero balance for an unknown address', async () => {
    const balance = await provider.getBalance('SIMxUnknown');
    expect(balance.lamports).toBe(0);
    expect(balance.network).toBe('simulation');
  });

  it('resolves a known balance from its source', async () => {
    balances.set('SIMxAlice', solToLamports(2.5));
    expect((await provider.getBalance('SIMxAlice')).lamports).toBe(solToLamports(2.5));
  });

  it('simulates a valid transfer without sending it', async () => {
    balances.set('SIMxAlice', solToLamports(1));
    const result = await provider.simulateTransaction({
      from: 'SIMxAlice',
      to: 'SIMxBob',
      lamports: solToLamports(0.5),
      memo: 'test',
    });

    expect(result.ok).toBe(true);
    expect(result.feeLamports).toBe(SIMULATED_FEE_LAMPORTS);
    expect(result.logs.some((l) => l.includes('Memo: test'))).toBe(true);
    // Simulating must not move anything.
    expect(balances.get('SIMxAlice')).toBe(solToLamports(1));
  });

  it('rejects an underfunded or non-positive transfer', async () => {
    balances.set('SIMxAlice', solToLamports(0.1));

    const underfunded = await provider.simulateTransaction({
      from: 'SIMxAlice',
      to: 'SIMxBob',
      lamports: solToLamports(5),
    });
    expect(underfunded.ok).toBe(false);
    expect(underfunded.error).toMatch(/insufficient/i);

    const zero = await provider.simulateTransaction({
      from: 'SIMxAlice',
      to: 'SIMxBob',
      lamports: 0,
    });
    expect(zero.ok).toBe(false);
  });

  it('records a virtual receipt marked simulatedOnly', async () => {
    balances.set('SIMxAlice', solToLamports(1));
    const receipt = await provider.sendTransaction({
      from: 'SIMxAlice',
      to: 'SIMxBob',
      lamports: solToLamports(0.2),
    });

    expect(receipt.simulatedOnly).toBe(true);
    expect(receipt.confirmed).toBe(true);
    expect(receipt.network).toBe('simulation');
    expect(receipt.signature.startsWith('SIMsig')).toBe(true);
    expect(await provider.getTransaction(receipt.signature)).toEqual(receipt);
  });

  it('throws rather than sending a transfer that would fail', async () => {
    balances.set('SIMxAlice', 0);
    await expect(
      provider.sendTransaction({ from: 'SIMxAlice', to: 'SIMxBob', lamports: 1 }),
    ).rejects.toThrow(/rejected/);
  });

  it('returns null for an unknown signature', async () => {
    expect(await provider.getTransaction('SIMsigNope')).toBeNull();
  });

  it('reports zero SPL token balances in V1', async () => {
    const token = await provider.getTokenBalance('SIMxAlice', 'SomeMint');
    expect(token.amount).toBe(0);
    expect(token.decimals).toBe(9);
  });

  it('simulates before sending in the transfer helper', async () => {
    balances.set('SIMxAlice', solToLamports(1));
    const good = await transfer(provider, {
      from: 'SIMxAlice',
      to: TREASURY_ADDRESS,
      lamports: solToLamports(0.1),
    });
    expect(good.ok).toBe(true);
    expect(good.receipt?.simulatedOnly).toBe(true);

    const bad = await transfer(provider, {
      from: 'SIMxAlice',
      to: TREASURY_ADDRESS,
      lamports: solToLamports(99),
    });
    expect(bad.ok).toBe(false);
    expect(bad.receipt).toBeNull();
  });
});

describe('agent wallets', () => {
  it('issues a virtual address with no keypair', () => {
    const wallet = createSimulatedWallet('agent-1', createRng('wallet'));
    expect(wallet.network).toBe('simulation');
    expect(wallet.provider).toBe('simulation');
    expect(isSimulatedAddress(wallet.publicAddress)).toBe(true);
    // No secret material of any kind is part of the descriptor.
    expect(Object.keys(wallet).sort()).toEqual([
      'agentId',
      'network',
      'provider',
      'publicAddress',
    ]);
  });

  it('issues distinct addresses from the same stream', () => {
    const rng = createRng('wallets');
    const addresses = new Set(
      Array.from({ length: 100 }, () => createSimulatedWallet('a', rng).publicAddress),
    );
    expect(addresses.size).toBe(100);
  });

  it('resolves a real agent balance through the provider', async () => {
    await resetDatabase();
    const { simulationId, founderIds } = await createSimulation({
      name: 'solana',
      seed: 'solana-1',
      founderCount: 1,
    });
    void simulationId;

    const wallet = await prisma.agentWallet.findUniqueOrThrow({
      where: { agentId: founderIds[0] },
    });
    const balance = await getSolanaProvider().getBalance(wallet.publicAddress);

    // getBalance is not a stub: it reflects the agent's ledger capital.
    expect(balance.lamports).toBe(solToLamports(1));
  });
});
