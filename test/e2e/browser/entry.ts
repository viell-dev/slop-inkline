// The plugin's own modules, bundled by test/e2e/support/browser.ts and loaded
// into Obsidian's renderer as `window.inklineTest`, so that end-to-end tests
// can run them in the Chromium that users have.

export * as png from "../../../src/format/png.ts";
export * as record from "../../../src/format/record.ts";
export * as inkFile from "../../../src/format/ink-file.ts";
export * as canvas from "../../../src/ink/canvas.ts";
export * as document from "../../../src/ink/document.ts";
export * as geometry from "../../../src/ink/geometry.ts";
export * as pixels from "../../../src/ink/pixels.ts";
export * as render from "../../../src/ink/render.ts";
export * as drafts from "../../../src/editor/drafts.ts";
export * as guides from "../../../src/editor/guides.ts";
export * as view from "../../../src/editor/view.ts";
export * as settings from "../../../src/settings.ts";
export * as cursor from "../../../src/editor/cursor.ts";
export * as reference from "../../../src/editor/reference.ts";
export * as pictures from "./pictures.ts";
export * as renderSymbols from "../../../src/render/symbols.ts";
