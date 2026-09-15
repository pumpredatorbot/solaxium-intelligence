import { PrismaClient } from '@prisma/client';

/**
 * Single Prisma client for the process. Next.js dev-mode HMR re-evaluates
 * modules, so the instance is parked on globalThis to avoid exhausting the
 * connection pool.
 */
const globalForPrisma = globalThis as unknown as { __solaxiumPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.__solaxiumPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__solaxiumPrisma = prisma;
}

export type { Prisma } from '@prisma/client';
