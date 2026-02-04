import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['**/__tests__/**/*.test.ts'],
    // Content script tests need jsdom for DOM APIs
    environmentMatchGlobs: [
      ['extension/**', 'jsdom'],
    ],
    // Server tests use default node environment
    environment: 'node',
  },
  resolve: {
    alias: {
      '@agentfox/shared': path.resolve(__dirname, 'shared/src'),
    },
  },
});
