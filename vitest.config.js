import { defineConfig } from 'vitest/config';

// Dedicated config so vitest uses the project root (not client/, which vite.config
// sets) and runs the backend unit tests in tests/ under a Node environment.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
