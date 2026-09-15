/**
 * Global test setup: makes sure the dedicated test database exists and matches
 * the current schema before any suite runs.
 */

import { execSync } from 'node:child_process';
import { beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';

beforeAll(() => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
