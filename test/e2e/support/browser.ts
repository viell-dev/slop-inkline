import path from "node:path";
import { browser } from "@wdio/globals";
import esbuild from "esbuild";

/**
 * Bundles `test/e2e/browser/entry.ts` and runs it in Obsidian's renderer,
 * where it sets `globalThis.inklineTest`. Run it again after Obsidian
 * reloads.
 */
export async function loadModules(): Promise<void> {
  const result = await esbuild.build({
    entryPoints: [path.join(import.meta.dirname, "../browser/entry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "inklineTestModules",
    platform: "browser",
    target: "es2022",
    footer: { js: "globalThis.inklineTest = inklineTestModules;" },
    logLevel: "warning",
  });
  const [output] = result.outputFiles;
  if (output === undefined) throw new Error("esbuild wrote nothing");
  await browser.execute(output.text);
}

/** Encodes bytes for passing into the renderer, which takes only JSON. */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
