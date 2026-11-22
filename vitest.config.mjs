// @ts-check
// The unit tests' settings, for `npm test` and any other run of Vitest.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The unit tests check what the code does, not how fast it does it: a test
    // about speed asserts on it itself. With the machine's CPU at 100%, tests
    // that take well under a second alone took more than Vitest's 5 seconds,
    // and a limit sized for each test cannot cover the ones nobody measured
    // (#402). So every test and every hook has 30 seconds, and a test seen to
    // need more has a limit of its own, with its measurements beside it. A test
    // that hangs is reported after 30 seconds rather than 5.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
