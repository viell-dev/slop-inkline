// Bundles the plugin into dist/ with the files Obsidian loads next to it. The
// manifest there names the version in package.json, which a pre-release's
// manifest.json does not, as RELEASING.md explains.
// `--watch` rebuilds on every change, with inline source maps.

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import esbuild, { type Plugin } from "esbuild";
import { bundleBanner, copiedCode } from "./lib/notices.ts";
import { builtManifest } from "./lib/release.ts";

const watch = process.argv.includes("--watch");
const outdir = "dist";
const entryPoint = "src/main.ts";
const watchedFiles = ["manifest.json", "package.json", "styles.css"];

async function readPackage(): Promise<{
  version: string;
  dependencies?: Record<string, string>;
}> {
  return JSON.parse(await readFile("package.json", "utf8")) as {
    version: string;
    dependencies?: Record<string, string>;
  };
}

const staticFilesPlugin: Plugin = {
  name: "static-files",
  setup(build) {
    // esbuild watches only the bundle's own inputs, so the entry point lists
    // the files beside it too: a change to any rebuilds and writes them.
    build.onLoad(
      { filter: /[\\/]src[\\/]main\.ts$/ },
      async ({ path: file }) => ({
        contents: await readFile(file, "utf8"),
        loader: "ts",
        watchFiles: watchedFiles.map((name) => path.resolve(name)),
      }),
    );
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      await mkdir(outdir, { recursive: true });
      const { version } = await readPackage();
      await Promise.all([
        copyFile("styles.css", path.join(outdir, "styles.css")),
        writeFile(
          path.join(outdir, "manifest.json"),
          builtManifest(await readFile("manifest.json", "utf8"), version),
        ),
      ]);
    });
  },
};

const context = await esbuild.context({
  entryPoints: [entryPoint],
  outfile: path.join(outdir, "main.js"),
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  // Obsidian provides these at run time. Node and Electron modules are left
  // out on purpose, so that importing one fails the build: the plugin keeps
  // to web APIs, which mobile Obsidian also has.
  external: ["obsidian", "@codemirror/*", "@lezer/*"],
  // Everything in `dependencies` is bundled, so its licence goes with it, as
  // does that of code copied into the source.
  banner: {
    js: await bundleBanner(
      process.cwd(),
      Object.keys((await readPackage()).dependencies ?? {}),
      copiedCode,
    ),
  },
  sourcemap: watch ? "inline" : false,
  // Unminified, so that a release can be read and reviewed as shipped.
  minify: false,
  logLevel: "info",
  plugins: [staticFilesPlugin],
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
