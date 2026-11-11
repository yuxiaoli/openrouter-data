import { defineConfig } from 'vitest/config';

// The independent charts/ package uses node:test, not Vitest. Its own workflow
// runs those tests; keep the collector/API suite scoped to this package.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
