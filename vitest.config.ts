import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.{test,spec}.{ts,tsx}'],
    // Run files and tests in a random order. Not a preference — it is the only
    // thing that keeps each `it` an independent claim. Three files had quietly
    // stopped being that: one test created the workflow the next one edited,
    // another appended to a transcript a later test measured, and a third left
    // an entry in cost-tracker's (append-only) parse cache under a path it then
    // rewrote with different content. All three passed in file order and failed
    // the moment two tests swapped places, which is a suite that verifies a
    // sequence rather than a set of facts.
    //
    // The order is not lost when it matters: vitest prints `Running tests with
    // seed "<n>"`, so a red CI run is reproduced with
    // `npx vitest run --sequence.seed=<n>`.
    sequence: { shuffle: true },
  },
});
