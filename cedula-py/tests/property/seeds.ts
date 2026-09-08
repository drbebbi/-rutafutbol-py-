/**
 * Versioned, reproducible seed set for the merge gate.
 *
 * Property tests that pick a fresh random seed every run make CI flaky and
 * make a failure impossible to reproduce. These seeds are fixed; when a
 * property finds a bug, the shrunk counterexample is promoted to a permanent
 * regression test rather than being left to chance.
 */
export const PROPERTY_SEED_SET_VERSION = 1;

export const PROPERTY_SEEDS: readonly number[] = [
  20260101, 20260202, 20260303, 20260404, 20260505,
];

export const RUNS_PER_SEED = 40;
