import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: new URL("./test/stubs/obsidian.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
  },
});
