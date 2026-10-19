// Bundles the plugin into dist/ with the files Obsidian loads next to it.
// `--watch` rebuilds on every change, with inline source maps.

import { copyFile, mkdir, readFile } from "node:fs/promises";
import esbuild, { type Plugin } from "esbuild";

const watch = process.argv.includes("--watch");
const outdir = "dist";
const staticFiles = ["manifest.json", "styles.css"];

const manifest: unknown = JSON.parse(await readFile("manifest.json", "utf8"));
const version =
  typeof manifest === "object" && manifest !== null && "version" in manifest
    ? String(manifest.version)
    : "unknown";

const copyStaticFiles: Plugin = {
  name: "copy-static-files",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      await mkdir(outdir, { recursive: true });
      await Promise.all(
        staticFiles.map((file) => copyFile(file, `${outdir}/${file}`)),
      );
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  outfile: `${outdir}/main.js`,
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  // Obsidian provides these at run time. Node and Electron modules are left
  // out on purpose, so that importing one fails the build: the plugin keeps
  // to web APIs, which mobile Obsidian also has.
  external: ["obsidian", "@codemirror/*", "@lezer/*"],
  banner: {
    js: `/* Inkline ${version}, built from https://github.com/viell-dev/slop-inkline. */`,
  },
  sourcemap: watch ? "inline" : false,
  // Unminified, so that a release can be read and reviewed as shipped.
  minify: false,
  logLevel: "info",
  plugins: [copyStaticFiles],
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
