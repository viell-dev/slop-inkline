import { defineConfig } from "vitest/config";

// Only the unit tests: the end-to-end specs run in Obsidian, through
// WebdriverIO.
export default defineConfig({
  test: { include: ["test/unit/**/*.test.ts"] },
});
