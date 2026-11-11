// Checks that the documentation site, and the repository's own documents that
// GitHub shows, say what the code does: the commands, the editor's keys, the
// defaults, the Obsidian and Node.js versions, the BRAT check's versions, and
// every link and example they give. The site's build checks that its own pages
// exist; this checks the rest.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../manifest.json" with { type: "json" };
import packageJson from "../../package.json" with { type: "json" };
import { compareSemver } from "../../scripts/lib/version.ts";
import { emptyDocument } from "../../src/ink/document.ts";
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

  it("gives each of the editor's buttons the key its tooltip shows", () => {
    const modal = source("src/editor/modal.ts");
    const buttons = [
      ...modal.matchAll(
        /#addButton\(\s*\w+,\s*"([\w-]+)",\s*"([^"]+)",\s*"([^"]+)",/g,
      ),
    ].map((match) => ({ text: match[2] ?? "", key: match[3] ?? "" }));
    expect(buttons.length).toBeGreaterThan(10);
    const rows = tableRows(page("keyboard.md"));
    for (const { text, key } of buttons) {
      const row = rows.find((cells) => cells[1] === text);
      expect(row, text).toBeDefined();
      expect(row?.[0]?.split(", or ")[0], text).toBe(key);
    }
    // The brush sizes' buttons, made in a loop, take the keys 1 to 4.
    const sizes = rows.find((cells) => cells[1]?.startsWith("S, "));
    expect(sizes?.[1]).toBe(brushSizes.map((size) => size.label).join(", "));
    expect(sizes?.[0]).toBe(brushSizes.map((_, index) => index + 1).join(", "));
    // The guide to the editor names the same keys in its text, as
    // **Pen** (P).
    const named = [
      ...page("drawing.md").matchAll(/\*\*([^*]+)\*\* \(([^)]+)\)/g),
    ].flatMap((match) => {
      const button = buttons.find(({ text }) => text === match[1]);
      return button === undefined
        ? []
        : [{ text: button.text, key: button.key, named: match[2] ?? "" }];
    });
    for (const { text, key, named: keys } of named) {
      expect(keys.split(", or ")[0], text).toBe(key);
    }
    // Every button with a key is named there, apart from the brush sizes,
    // which it names together.
    const sizeLabels = brushSizes.map((size) => size.label);
    expect([...new Set(named.map(({ text }) => text))].sort()).toEqual(
      buttons
        .map(({ text }) => text)
        .filter((text) => !sizeLabels.includes(text))
        .sort(),
    );
    // Keys with no button of their own.
    for (const key of ["Mod+S", "Esc"]) {
      expect(rows.some((cells) => cells[0] === key)).toBe(true);
    }
    expect(modal).toContain(`key(["Mod"], "s",`);
    expect(modal).toContain(`key(["Mod"], "y",`);
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

  it("names the Obsidian version the manifest needs, on desktop only", () => {
    expect(manifest.isDesktopOnly).toBe(true);
    expect(page("install.md")).toContain(
      `Obsidian **${manifest.minAppVersion} or later**`,
    );
    const named = new RegExp(
      `Obsidian\\s+${manifest.minAppVersion.replaceAll(".", "\\.")}`,
    );
    expect(page("index.md")).toMatch(named);
    expect(source("README.md")).toMatch(named);
  });

  it("names the Node.js version the package needs", () => {
    const major = /^>=(\d+)\.0\.0$/.exec(packageJson.engines.node)?.[1];
    expect(major).toBeDefined();
    const flat = (text: string) => text.replace(/\s+/g, " ");
    expect(flat(source("CONTRIBUTING.md"))).toContain(
      `Node.js ${major ?? ""} or newer`,
    );
    expect(flat(page("install.md"))).toContain(
      `[Node.js](https://nodejs.org/) ${major ?? ""} or later`,
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

  it("says that there is no release while there is none, and only then", () => {
    const unreleased = packageJson.version === "0.0.0";
    for (const name of ["index.md", "install.md"]) {
      expect(page(name).includes("::: warning No release yet"), name).toBe(
        unreleased,
      );
    }
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
