/**
 * Agent identity. Codes are sequential per simulation ("SX-001"), names are
 * drawn from a fixed, seeded vocabulary so a run's cast is reproducible.
 */

import type { SeededRandom } from '@/lib/rng';

const PREFIXES = [
  'Axiom', 'Vector', 'Helix', 'Quanta', 'Lumen', 'Cipher', 'Delta', 'Orbit',
  'Nexus', 'Prism', 'Vertex', 'Kernel', 'Strata', 'Photon', 'Cradle', 'Meridian',
  'Ember', 'Atlas', 'Cinder', 'Halo', 'Ridge', 'Torus', 'Onyx', 'Spire',
];

const SUFFIXES = [
  'Works', 'Labs', 'Systems', 'Foundry', 'Collective', 'Industries', 'Group',
  'Dynamics', 'Holdings', 'Syndicate', 'Studio', 'Engine',
];

export function formatAgentCode(index: number): string {
  return `SX-${String(index).padStart(3, '0')}`;
}

export function generateAgentName(rng: SeededRandom): string {
  return `${rng.pick(PREFIXES)} ${rng.pick(SUFFIXES)}`;
}

/** Virtual, non-custodial placeholder address used in simulation mode. */
export function simulatedAddress(rng: SeededRandom): string {
  return `SIMx${rng.token(38)}`;
}
