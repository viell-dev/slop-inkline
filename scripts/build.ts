// Bundles the plugin into dist/ with the files Obsidian loads next to it.
// `--watch` rebuilds on every change, with inline source maps.

import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import esbuild, { type Plugin } from "esbuild";

const watch = process.argv.includes("--watch");
const outdir = "dist";
const entryPoint = "src/main.ts";
const staticFiles = ["manifest.json", "styles.css"];

const staticFilesPlugin: Plugin = {
  name: "static-files",
  setup(build) {
    // esbuild watches only the bundle's own inputs, so the entry point lists
    // the static files too: a change to either rebuilds and copies it.
    build.onLoad(
      { filter: /[\\/]src[\\/]main\.ts$/ },
      async ({ path: file }) => ({
        contents: await readFile(file, "utf8"),
        loader: "ts",
        watchFiles: staticFiles.map((name) => path.resolve(name)),
      }),
    );
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      await mkdir(outdir, { recursive: true });
      await Promise.all(
        staticFiles.map((file) => copyFile(file, path.join(outdir, file))),
      );
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
  banner: {
    js: "/* Inkline, built from https://github.com/viell-dev/slop-inkline. */",
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
