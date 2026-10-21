// Checks that the documentation site says what the code does: the commands,
// the editor's keys, the defaults, the Obsidian version, and every link and
// example it gives. The site's build checks that its own pages exist; this
// checks the rest.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../manifest.json" with { type: "json" };
import packageJson from "../../package.json" with { type: "json" };
import { emptyDocument } from "../../src/ink/document.ts";
import { brushSizes, DrawingSession } from "../../src/editor/session.ts";
import { textLinks } from "../../src/notes/links.ts";
import { defaultTrigger } from "../../src/notes/search.ts";
import { isInkPath } from "../../src/format/ink-file.ts";

const pages = readdirSync("docs").filter((name) => name.endsWith(".md"));
const page = (name: string): string => readFileSync(join("docs", name), "utf8");
const source = (path: string): string => readFileSync(path, "utf8");

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

function anchors(text: string): string[] {
  return [...text.matchAll(/^#{1,6} (.+)$/gm)].map((match) =>
    anchor(match[1] ?? ""),
  );
}

describe("the documentation", () => {
  it("lists every command, and no other", () => {
    const names = [
      ...source("src/main.ts").matchAll(
        /addCommand\(\{\s*id: "[^"]+",(?:\s*\/\/[^\n]*)*\s*name: "([^"]+)"/g,
      ),
    ].map((match) => match[1] ?? "");
    expect(names.length).toBeGreaterThan(0);
    const listed = tableRows(page("keyboard.md"))
      .map((row) => row[0] ?? "")
      .filter((cell) => cell.startsWith("**Inkline: "))
      .map((cell) => cell.slice("**Inkline: ".length, -"**".length));
    expect(listed.sort()).toEqual([...names].sort());
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
    expect(named.length).toBeGreaterThan(10);
    for (const { text, key, named: keys } of named) {
      expect(keys.split(", or ")[0], text).toBe(key);
    }
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
    expect(settings).toContain(`| \`${defaultTrigger}\``);
    expect(settings).toMatch(new RegExp(`\\| ${brush}, `));
    expect(page("notes.md")).toContain(`\`${defaultTrigger}\``);
    expect(page("start.md")).toContain(`\`${defaultTrigger}\``);
  });

  it("names the Obsidian version the manifest needs, on desktop only", () => {
    expect(manifest.isDesktopOnly).toBe(true);
    expect(page("install.md")).toContain(
      `Obsidian **${manifest.minAppVersion} or later**`,
    );
    expect(page("index.md")).toMatch(
      new RegExp(
        `Obsidian\\s+${manifest.minAppVersion.replaceAll(".", "\\.")}`,
      ),
    );
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
      .join("\n");
    const quoted = [
      ...page("troubleshooting.md").matchAll(/\*\*"([^"]+)"\*\*/g),
    ].flatMap((match) =>
      (match[1] ?? "")
        .split("…")
        .map((part) => part.trim())
        .filter((part) => part.length >= 12),
    );
    expect(quoted.length).toBeGreaterThan(3);
    for (const part of quoted) expect(code, part).toContain(part);
  });

  it("links only to pages, headings, and repository files that exist", () => {
    const repository =
      /^https:\/\/github\.com\/viell-dev\/slop-inkline\/(?:blob|tree)\/main\//;
    const problems: string[] = [];
    for (const name of pages) {
      const text = page(name);
      for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = match[1] ?? "";
        const [path = "", fragment] = href.split("#");
        if (repository.test(href)) {
          const file = path.replace(repository, "").split("?")[0] ?? "";
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

  it("gives example embeds that read as embeds of symbols", () => {
    const examples = pages.flatMap((name) =>
      [...page(name).matchAll(/!\[\[[^\]]+\]\]/g)].map((match) => match[0]),
    );
    expect(examples.length).toBeGreaterThan(3);
    for (const example of examples) {
      const [span] = textLinks(`Text ${example} text.`);
      expect(span?.embed, example).toBe(true);
      expect(isInkPath(span?.target ?? ""), example).toBe(true);
    }
  });
});
