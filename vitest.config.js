import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.js'],
    globals: true,
    environment: 'node',
    // Ensure mocks in __mocks__ folder are used automatically
    deps: {
      interopDefault: true,
    },
  },
});
