// Checks that the documentation site, and the repository's own documents that
// GitHub shows, say what the code does: the commands, the editor's keys, the
// defaults, the public release's Obsidian version, the Node.js version, the
// BRAT check's versions, and every link and example. The site's build checks
// that its own pages exist; this checks the rest.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../manifest.json" with { type: "json" };
import packageJson from "../../package.json" with { type: "json" };
import versions from "../../versions.json" with { type: "json" };
import { compareSemver } from "../../scripts/lib/version.ts";
import { emptyDocument } from "../../src/ink/document.ts";
import { controls, keyText } from "../../src/editor/buttons.ts";
import { brushSizes, DrawingSession } from "../../src/editor/session.ts";
import { textLinks } from "../../src/notes/links.ts";
import { defaultSettings } from "../../src/settings.ts";
import { isInkPath } from "../../src/format/ink-file.ts";
import { bratVersionProblems } from "../support/updates.ts";

const pages = readdirSync("docs").filter((name) => name.endsWith(".md"));
const page = (name: string): string => readFileSync(join("docs", name), "utf8");
const source = (path: string): string => readFileSync(path, "utf8");

/** The repository's own Markdown outside the site, by its path. */
const documents = [
  ...readdirSync(".").filter((name) => name.endsWith(".md")),
  "listing/README.md",
  ".github/pull_request_template.md",
];

/** The rows of the Markdown tables in `text`, as lists of trimmed cells. */
function tableRows(text: string): string[][] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .map((line) =>
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    );
}

/** A heading's anchor, as VitePress makes it. */
/** Combining marks, which VitePress drops from an anchor. */
const combining = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  "g",
);

/**
 * A heading's anchor, as VitePress makes it from the heading's text: its
 * slug rule, after the Markdown marks that do not show in the text.
 */
function anchor(heading: string): string {
  return heading
    .replace(/[`*]/g, "")
    .normalize("NFKD")
    .replace(combining, "")
    .replace(/\p{Cc}/gu, "")
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();
}

/**
 * A heading's anchor, as GitHub makes it from the heading's text: lower case,
 * with what is not a letter, a digit, a mark, `_`, `-` or a space dropped, and
 * each space as `-`.
 */
function githubAnchor(heading: string): string {
  return heading
    .replace(/[`*]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replaceAll(" ", "-");
}

/** `text`'s lines outside fenced code, which hold no headings or links. */
function outsideFences(text: string): string[] {
  let fence: string | undefined;
  return text.split("\n").filter((line) => {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark === undefined) return fence === undefined;
    if (fence === undefined) fence = mark;
    else if (mark.startsWith(fence)) fence = undefined;
    return false;
  });
}

/**
 * The anchors of `text`'s headings, outside fenced code, by `slug`, with
 * `-1`, `-2`, and so on after a repeated one, as VitePress and GitHub both
 * number them.
 */
function anchors(text: string, slug = anchor): string[] {
  const seen = new Map<string, number>();
  const found: string[] = [];
  for (const line of outsideFences(text)) {
    const heading = /^#{1,6} (.+)$/.exec(line);
    if (heading === null) continue;
    const id = slug(heading[1] ?? "");
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    found.push(count === 0 ? id : `${id}-${String(count)}`);
  }
  return found;
}

/**
 * The targets of `text`'s Markdown links, outside code, as written. A target in
 * angle brackets, `[text](<a b.md>)`, is not matched: no document uses one, and
 * one added would go unchecked.
 */
function links(text: string): string[] {
  const prose = outsideFences(text)
    .map((line) => line.replace(/`[^`]*`/g, ""))
    .join("\n");
  return [...prose.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? "");
}

/** Links to files on the repository's main branch, as GitHub shows them. */
const repositoryLink =
  /^https:\/\/github\.com\/viell-dev\/slop-inkline\/(?:blob|tree)\/main\//;
/** Where the site's pages are, as it is deployed. */
const site = "https://viell-dev.github.io/slop-inkline/";

/**
 * What is wrong with `href`, a link in the repository's document `name` as
 * GitHub shows it, or undefined: a path from the document's folder, a file on
 * main, or a page of the site, and a heading in it.
 */
function documentLinkProblem(name: string, href: string): string | undefined {
  const [path = "", fragment] = href.split("#");
  if (href.startsWith(site)) {
    const target = `${path.slice(site.length) || "index"}.md`;
    if (!pages.includes(target)) return "no such page";
    if (fragment !== undefined && !anchors(page(target)).includes(fragment)) {
      return "no such heading";
    }
    return undefined;
  }
  let file: string;
  if (repositoryLink.test(href)) {
    file = path.replace(repositoryLink, "").split("?")[0] ?? "";
  } else if (/^[a-z][a-z+.-]*:/i.test(href)) {
    return undefined;
  } else {
    file = path === "" ? name : join(dirname(name), path);
  }
  // Windows and macOS find a file whatever the case of its name, and GitHub
  // does not, so a link differing in case passes there and fails on Linux CI.
  if (!existsSync(file)) return "no such file";
  if (
    fragment !== undefined &&
    file.endsWith(".md") &&
    !anchors(source(file), githubAnchor).includes(fragment)
  ) {
    return "no such heading";
  }
  return undefined;
}

/**
 * The documents that say whether Inkline has had a public release, by their
 * paths from the repository's root.
 */
const releaseStatusDocuments = [
  "docs/index.md",
  "docs/install.md",
  "README.md",
  "docs/limits.md",
];

/**
 * How those documents say what held only before the first public release:
 * that Inkline is a pre-release, that every release so far is one, in a box
 * or a known limit titled "Prerelease", or that there is no release, or no
 * public release, yet. What they say of Obsidian's community directory is not
 * among them: a public release is published before the owner submits it
 * there, so on the day it is still true that the directory does not list it.
 */
const prereleaseOnly = [
  /\bInkline is a pre-?release\b/gi,
  /\bevery release so far is a pre-?release\b/gi,
  /::: \w+ Pre-?release\b/gi,
  /\*\*Pre-?release\.\*\*/gi,
  /\bno releases? (?:yet|so far)\b/gi,
  /\bno (?:public|stable) releases?(?: yet| so far)?\b/gi,
  /\bpublic releases? once there (?:are|is) (?:some|one)\b/gi,
];

/**
 * What `documents`, by their paths, still say in those ways. `1.0.0` is
 * published and versions only go up, so none of it can be true again.
 */
function releaseStatusProblems(
  documents: Readonly<Record<string, string>>,
): string[] {
  return Object.entries(documents).flatMap(([path, text]) => {
    // As one line, since Prettier may break a sentence anywhere.
    const flat = text.replace(/\s+/g, " ");
    return prereleaseOnly.flatMap((pattern) =>
      [...flat.matchAll(pattern)].map((match) => `${path}: "${match[0]}"`),
    );
  });
}

/** The commands' names, as the plugin adds them. */
function commandNames(): string[] {
  return [
    ...source("src/main.ts").matchAll(
      /addCommand\(\{\s*id: "[^"]+",(?:\n[ \t]*\/\/[^\n]*)*\n[ \t]*name: "([^"]+)"/g,
    ),
  ].map((match) => match[1] ?? "");
}

describe("the documentation", () => {
  it("lists every command, and no other", () => {
    const names = commandNames();
    expect(names.length).toBeGreaterThan(0);
    const listed = tableRows(page("keyboard.md"))
      .map((row) => row[0] ?? "")
      .filter((cell) => cell.startsWith("**Inkline: "))
      .map((cell) => cell.slice("**Inkline: ".length, -"**".length));
    expect(listed.sort()).toEqual([...names].sort());
  });

  it("names only commands that exist", () => {
    const names = commandNames();
    // The changelog names each command as it was then.
    const texts = [
      ...pages.map(page),
      ...documents.filter((name) => name !== "CHANGELOG.md").map(source),
    ];
    const named = texts.flatMap((text) =>
      [...text.matchAll(/\*\*Inkline:\s+([^*]+)\*\*/g)].map((match) =>
        (match[1] ?? "").replace(/\s+/g, " "),
      ),
    );
    expect(named.length).toBeGreaterThan(10);
    for (const name of named) expect(names, name).toContain(name);
  });

  it("gives each of the editor's buttons the keys its tooltip shows", () => {
    // The brush sizes, which the guide names together, are checked below.
    const size = ({ id }: { id: string }): boolean => id.startsWith("size-");
    const buttons = controls
      .filter((control) => control.keys.length > 0 && !size(control))
      .map(({ text, keys }) => ({ text, keys: keys.map(keyText) }));
    expect(buttons.length).toBeGreaterThan(10);
    const rows = tableRows(page("keyboard.md"));
    for (const { text, keys } of buttons) {
      const row = rows.find((cells) => cells[1] === text);
      expect(row, text).toBeDefined();
      expect(row?.[0], text).toBe(keys.join(", or "));
    }
    // The brush sizes' buttons take the keys 1 to 4.
    const sizes = controls.filter(size);
    expect(sizes).toHaveLength(brushSizes.length);
    const sizeRow = rows.find((cells) => cells[1]?.startsWith("S, "));
    expect(sizeRow?.[1]).toBe(sizes.map(({ text }) => text).join(", "));
    expect(sizeRow?.[0]).toBe(
      sizes.flatMap(({ keys }) => keys.map(keyText)).join(", "),
    );
    // The guide to the editor names the same keys in its text, as
    // **Pen** (P).
    const named = [
      ...page("drawing.md").matchAll(/\*\*([^*]+)\*\* \(([^)]+)\)/g),
    ].flatMap((match) => {
      const button = buttons.find(({ text }) => text === match[1]);
      return button === undefined
        ? []
        : [{ text: button.text, key: button.keys[0], named: match[2] ?? "" }];
    });
    for (const { text, key, named: keys } of named) {
      expect(keys.split(", or ")[0], text).toBe(key);
    }
    // Every button with a key is named there, apart from the brush sizes,
    // which it names together.
    expect([...new Set(named.map(({ text }) => text))].sort()).toEqual(
      buttons.map(({ text }) => text).sort(),
    );
    // Keys with no button of their own.
    for (const key of ["Mod+S", "Esc"]) {
      expect(rows.some((cells) => cells[0] === key)).toBe(true);
    }
    expect(source("src/editor/controls.ts")).toMatch(
      /key\(\s*\["Mod"\],\s*"s",/,
    );
  });

  it("gives the defaults the code has", () => {
    const settings = page("settings.md");
    const session = new DrawingSession(emptyDocument);
    const brush = brushSizes[session.sizeIndex]?.label ?? "";
    expect(settings).toContain(`| \`${defaultSettings.trigger}\``);
    expect(settings).toMatch(new RegExp(`\\| ${brush}, `));
    expect(page("notes.md")).toContain(`\`${defaultSettings.trigger}\``);
    expect(page("start.md")).toContain(`\`${defaultSettings.trigger}\``);
    expect(source("README.md")).toContain(`\`${defaultSettings.trigger}`);
    expect(settings).toContain(`${String(defaultSettings.symbolScale)}%`);
  });

  it("names the public release's minimum Obsidian version, on desktop only", () => {
    // A pre-release can raise the manifest's minimum ahead of the public
    // release. The public release's entry in versions.json still gives the
    // published minimum.
    const minimum = Object.entries(versions).find(
      ([version]) => version === manifest.version,
    )?.[1];
    if (minimum === undefined) {
      throw new Error(
        `No Obsidian minimum for ${manifest.version} in versions.json`,
      );
    }
    expect(manifest.isDesktopOnly).toBe(true);
    expect(page("install.md")).toContain(`Obsidian **${minimum} or later**`);
    const named = new RegExp(`Obsidian\\s+${minimum.replaceAll(".", "\\.")}`);
    expect(page("index.md")).toMatch(named);
    expect(source("README.md")).toMatch(named);
  });

  it("names the Node.js versions the package needs", () => {
    // A release of one line, and any release from one of a later line on, as
    // WebdriverIO's own range has them.
    const range = /^\^(\d+)\.(\d+\.\d+) \|\| >=(\d+\.\d+\.\d+)$/.exec(
      packageJson.engines.node,
    );
    expect(range).not.toBeNull();
    const [, line = "", rest = "", later = ""] = range ?? [];
    const flat = (text: string) => text.replace(/\s+/g, " ");
    expect(flat(source("CONTRIBUTING.md"))).toContain(
      `Node.js ${line}.${rest} or a later ${line} release, or ${later} or newer`,
    );
    expect(flat(page("install.md"))).toContain(
      `[Node.js](https://nodejs.org/) ${line}.${rest} or a later ${line} release, or ${later} or later`,
    );
  });

  it("gives the BRAT check versions it can run with", () => {
    const recipe = source("CONTRIBUTING.md");
    const latest = /--env E2E_BRAT_LATEST=(\S+)/.exec(recipe)?.[1];
    const start = /--env E2E_BRAT_START=(\S+)/.exec(recipe)?.[1];
    expect(bratVersionProblems(latest, start)).toEqual([]);
    // Nor one after this checkout's version, which no release can have yet.
    for (const version of [latest ?? "", start ?? ""]) {
      expect(
        compareSemver(version, packageJson.version),
        version,
      ).toBeLessThanOrEqual(0);
    }
  });

  it("no longer says that every release is a pre-release, or that there is no public release", () => {
    const documents = Object.fromEntries(
      releaseStatusDocuments.map((path) => [path, source(path)]),
    );
    expect(releaseStatusProblems(documents)).toEqual([]);
  });

  it("finds a document that still calls every release a pre-release", () => {
    // In the documents' own wording, as Prettier breaks it.
    const stale = {
      "docs/index.md":
        "---\nlayout: home\n---\n\n::: info Prerelease\n\nInkline is a prerelease for Obsidian 1.13.4 or later, on\ndesktop.\n\n:::\n",
      "docs/install.md":
        "::: info Prerelease\n\nIt is not\nin Obsidian's community plugin directory yet.\n\n:::\n\nTake the highest version number. Every release so far is a pre-release.\n\nTo stay on public releases once there are some, choose a public version.\n",
      "README.md":
        "Inkline is a prerelease for Obsidian 1.13.4 or later on desktop.\n\nInkline is not in Obsidian's community plugin directory yet.\n",
      "docs/limits.md":
        "- **Prerelease.** Install from GitHub releases, by hand or with BRAT; Inkline is\n  not in Obsidian's community directory yet.\n",
    };
    // What they say of the directory is not among them.
    expect(releaseStatusProblems(stale)).toEqual([
      'docs/index.md: "Inkline is a prerelease"',
      'docs/index.md: "::: info Prerelease"',
      'docs/install.md: "Every release so far is a pre-release"',
      'docs/install.md: "::: info Prerelease"',
      'docs/install.md: "public releases once there are some"',
      'README.md: "Inkline is a prerelease"',
      'docs/limits.md: "**Prerelease.**"',
    ]);
    // Pages that say none of it pass.
    const updated = {
      "docs/index.md": "::: info Public release\n\nInkline 1.0.0 is out.\n",
      "docs/install.md":
        "::: info Unreleased\n\nThis option is available in the 1.1.0 pre-release.\n\n:::\n",
      "README.md":
        "Inkline is in Obsidian's community plugin directory. A release with an\nodd minor version is a pre-release.\n",
    };
    expect(releaseStatusProblems(updated)).toEqual([]);
    // A public release is published before Obsidian's directory lists it, so
    // its documents may truly say that the listing is still to come.
    const listingPending = {
      "README.md":
        "Inkline 1.0.0 is its first public release. It is not in Obsidian's\ncommunity plugin directory yet: the listing waits for Obsidian's review.\n",
      "docs/install.md":
        "## The community directory\n\n**Planned, not available yet.** Obsidian has not listed\nInkline yet.\n",
      "docs/limits.md":
        "- **Not in the directory yet.** Inkline is not in Obsidian's community\n  directory yet. See [Install](./install.md).\n",
    };
    expect(releaseStatusProblems(listingPending)).toEqual([]);
    // A claim that there is no release, or no public one, yet is one, and so
    // is the box the pages had before the first release.
    expect(
      releaseStatusProblems({
        "README.md": "Inkline has had no stable release yet.\n",
        "docs/index.md": "::: warning No release yet\n\nBuild it.\n\n:::\n",
        "docs/install.md": "There are no releases so far.\n",
      }),
    ).toEqual([
      'README.md: "no stable release yet"',
      'docs/index.md: "No release yet"',
      'docs/install.md: "no releases so far"',
    ]);
  });

  it("quotes notices as the plugin words them", () => {
    const code = readdirSync("src", { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".ts"))
      .map((name) => source(join("src", name)))
      .join("\n")
      .replace(/\s+/g, " ");
    const quoted = [
      ...page("troubleshooting.md").matchAll(/\*\*"([^"]+)"\*\*/g),
    ].flatMap((match) =>
      (match[1] ?? "")
        .split("…")
        .map((part) => part.replace(/\s+/g, " ").trim())
        .filter((part) => part.length >= 12),
    );
    expect(quoted.length).toBeGreaterThan(3);
    for (const part of quoted) expect(code, part).toContain(part);
  });

  it("links only to pages, headings, and repository files that exist", () => {
    const problems: string[] = [];
    for (const name of pages) {
      for (const href of links(page(name))) {
        const [path = "", fragment] = href.split("#");
        if (repositoryLink.test(href)) {
          const file = path.replace(repositoryLink, "").split("?")[0] ?? "";
          if (!existsSync(file)) problems.push(`${name}: ${href}`);
        } else if (href.startsWith("../")) {
          if (!existsSync(join("docs", path)))
            problems.push(`${name}: ${href}`);
        } else if (href.startsWith("./") || href.startsWith("#")) {
          const target = path === "" ? name : path.slice(2);
          if (!existsSync(join("docs", target))) {
            problems.push(`${name}: ${href}`);
          } else if (
            fragment !== undefined &&
            !anchors(page(target)).includes(fragment)
          ) {
            problems.push(`${name}: ${href}, no such heading`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps the file format's specification readable as a file of its own", () => {
    // Each release carries a copy, with no site or repository around it, as
    // RELEASING.md says: its links lead to its own headings, by the site's
    // rules and by GitHub's, or to full addresses, and it uses none of the
    // site's own syntax.
    const text = page("file-format.md");
    const lines = outsideFences(text).map((line) =>
      line.replace(/`[^`]*`/g, ""),
    );
    const definitions = lines.flatMap((line) => {
      const target = /^ {0,3}\[[^\]]+\]:\s*(\S+)/.exec(line)?.[1];
      return target === undefined ? [] : [target];
    });
    const problems = [...links(text), ...definitions].flatMap((href) => {
      if (href.startsWith("#")) {
        const fragment = href.slice(1);
        return anchors(text).includes(fragment) &&
          anchors(text, githubAnchor).includes(fragment)
          ? []
          : [`${href}, no such heading`];
      }
      return href.startsWith("https://") ? [] : [`${href}, not a full address`];
    });
    for (const line of lines) {
      if (
        /^\s*:::/.test(line) ||
        /\{#[^}]*\}|\[\[toc\]\]|\{\{|<\/?[A-Za-z][^>]*>/i.test(line)
      ) {
        problems.push(`the site's own syntax: ${line}`);
      }
    }
    expect(text.startsWith("---")).toBe(false);
    expect(links(text).length).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });

  it("links the repository's documents only to files, headings, and pages that exist", () => {
    const problems = documents.flatMap((name) =>
      links(source(name)).flatMap((href) => {
        const problem = documentLinkProblem(name, href);
        return problem === undefined ? [] : [`${name}: ${href}, ${problem}`];
      }),
    );
    expect(problems).toEqual([]);
  });

  it("gives example embeds that read as embeds of symbols", () => {
    const texts = [...pages.map(page), ...documents.map(source)];
    // Obsidian's own embeds, and the images of standard Markdown that name a
    // symbol, as other apps read them.
    const examples = texts.flatMap((text) =>
      [...text.matchAll(/!\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)\s]+\)/g)]
        .map((match) => match[0])
        .filter(
          (example) =>
            example.startsWith("![[") || example.endsWith(".ink.png)"),
        ),
    );
    expect(examples.length).toBeGreaterThan(3);
    for (const example of examples) {
      const [span] = textLinks(`Text ${example} text.`);
      expect(span?.embed, example).toBe(true);
      expect(isInkPath(span?.target ?? ""), example).toBe(true);
    }
  });
});
