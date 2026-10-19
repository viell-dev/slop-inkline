// The plugin's own modules, bundled by test/e2e/support/browser.ts and loaded
// into Obsidian's renderer as `globalThis.inklineTest`, so that end-to-end
// tests can run them in the Chromium that users have.

export * as png from "../../../src/format/png.ts";
export * as record from "../../../src/format/record.ts";
export * as inkFile from "../../../src/format/ink-file.ts";
