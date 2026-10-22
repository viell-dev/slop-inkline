// The documentation site, built with VitePress and served by GitHub Pages.
// The Pages workflow sets DOCS_COMMIT, the commit it builds, and
// DOCS_VERSION, the release the site describes, or "unreleased" for the
// development version on main; versions.md describes which it deploys.

import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { defineConfig } from "vitepress";

const repository = "https://github.com/viell-dev/slop-inkline";

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

const commit = process.env.DOCS_COMMIT ?? gitCommit();
const version = process.env.DOCS_VERSION ?? "unreleased";
const released = version !== "unreleased";
const short = commit.slice(0, 7);
const state = released
  ? `Describes Inkline ${version}`
  : "Describes the unreleased development version";

export default defineConfig({
  title: "Inkline",
  description:
    "An Obsidian plugin for drawing symbols that sit inline in your notes like characters, saved as plain PNG images.",
  lang: "en",
  base: "/slop-inkline/",
  cleanUrls: true,
  lastUpdated: false,
  sitemap: { hostname: "https://viell-dev.github.io/slop-inkline/" },
  head: [["meta", { name: "inkline-docs-commit", content: commit }]],
  markdown: {
    // A link out of docs/, as to the test fixtures, works on GitHub, where
    // the page sits in the repository; on the site it leads to the same
    // path in the repository at the commit the site was built from.
    config(md) {
      md.core.ruler.push("inkline_repository_links", (state) => {
        for (const token of state.tokens) {
          for (const child of token.children ?? []) {
            if (child.type !== "link_open") continue;
            const href = child.attrGet("href");
            if (href?.startsWith("../") !== true) continue;
            const path = posix.normalize(posix.join("docs", href));
            child.attrSet("href", `${repository}/tree/${commit}/${path}`);
          }
        }
      });
    },
  },
  // What the deployment's check reads back: the commit the site was built
  // from, and which version it describes.
  async buildEnd({ outDir }) {
    await writeFile(
      join(outDir, "version.json"),
      `${JSON.stringify({ commit, version, released }, null, 2)}\n`,
    );
  },
  themeConfig: {
    nav: [
      { text: "Guide", link: "/start" },
      { text: "Reference", link: "/file-format" },
      { text: "Changelog", link: `${repository}/blob/main/CHANGELOG.md` },
      { text: "Contribute", link: `${repository}/blob/main/CONTRIBUTING.md` },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "What Inkline is", link: "/" },
          { text: "Install", link: "/install" },
          { text: "Your first symbol", link: "/start" },
          { text: "Drawing in the editor", link: "/drawing" },
          { text: "Symbols in notes", link: "/notes" },
          { text: "Saving and recovery", link: "/recovery" },
          { text: "Keyboard and accessibility", link: "/keyboard" },
          { text: "Settings", link: "/settings" },
          { text: "Without Inkline", link: "/without-inkline" },
          { text: "Known limits", link: "/limits" },
          { text: "Problems and reports", link: "/troubleshooting" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "File format", link: "/file-format" },
          { text: "Rendering in notes", link: "/rendering" },
          { text: "Promises and evidence", link: "/verification" },
          { text: "Versions of this site", link: "/versions" },
        ],
      },
    ],
    search: { provider: "local" },
    outline: { level: [2, 3] },
    socialLinks: [{ icon: "github", link: repository }],
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    footer: {
      message: `${state}, built from <a href="${repository}/commit/${commit}">${short}</a> · <a href="${repository}/blob/main/LICENSE">MIT licensed</a> · Written and maintained by AI agents`,
    },
  },
});
