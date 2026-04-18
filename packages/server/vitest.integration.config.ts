import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/*.integration.test.ts',
      'src/**/__tests__/**/*.integration.test.ts',
      'src/**/__tests__/**/*.isolation.test.ts',
    ],
    globalSetup: ['src/test-utils/global-setup.ts'],
    globalTeardown: ['src/test-utils/global-teardown.ts'],
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'threads',
    isolate: false,
    sequence: { concurrent: false },
    reporters: ['default'],
  },
});
