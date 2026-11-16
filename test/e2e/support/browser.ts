import path from "node:path";
import { browser } from "@wdio/globals";
import esbuild from "esbuild";

/**
 * The bundle of `test/e2e/browser/entry.ts`, built once for each worker
 * process: each spec file runs in a process of its own, and the files the
 * bundle comes from do not change while it runs.
 */
let bundle: Promise<string> | undefined;

async function build(): Promise<string> {
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
  return output.text;
}

/**
 * Bundles `test/e2e/browser/entry.ts` and runs it in Obsidian's renderer,
 * where it sets `globalThis.inklineTest`. Run it again after Obsidian
 * reloads, and in each window that needs it: it runs the bundle in the
 * current window unless that window already has `inklineTest`, and bundles
 * only on its first call in a spec file.
 */
export async function loadModules(): Promise<void> {
  if (await browser.execute(() => "inklineTest" in globalThis)) return;
  // A build that failed is tried again on the next call.
  bundle ??= build().catch((error: unknown) => {
    bundle = undefined;
    throw error;
  });
  await browser.execute(await bundle);
}

/** Encodes bytes for passing into the renderer, which takes only JSON. */
export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
