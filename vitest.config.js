import { defineConfig } from 'vitest/config';

// Separate from vite.config.js (which sets root: 'src' for the site build).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
