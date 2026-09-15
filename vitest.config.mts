import { defineConfig } from 'vitest/config';


export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    // The DB-backed suites share one PostgreSQL schema; run files serially so
    // they cannot observe each other's rows.
    fileParallelism: false,
    // Tests run against a dedicated database so a `npm test` can never touch
    // the development data.
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://solaxium:solaxium@127.0.0.1:5432/solaxium_test?schema=public',
      AI_PROVIDER: 'demo',
      SOLANA_MODE: 'simulation',
      NODE_ENV: 'test',
    },
  },
  resolve: {
    alias: { '@': new URL('.', import.meta.url).pathname },
  },
});
