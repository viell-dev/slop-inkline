// Inkline's choice between the link Obsidian makes for a symbol and one that
// names it by its vault path. Obsidian's side is a fake of the two methods
// embedFor calls: what Obsidian makes and resolves is tested end to end.

import type { App, TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { embedFor } from "../../../src/notes/embeds.ts";

const notePath = "Notes/Day.md";

/** A file, as far as embedFor reads one. */
const fileAt = (path: string): TFile =>
  // embedFor reads only a file's path, and compares files by identity.
  ({ path }) as TFile;

/**
 * An app whose `generateMarkdownLink` gives `link`, and whose link resolver
 * gives `resolve`'s answer, with each path it was asked to resolve recorded.
 */
function appWith(
  link: string,
  resolve: (path: string) => TFile | null,
): { app: App; resolved: (readonly [string, string])[] } {
  const resolved: (readonly [string, string])[] = [];
  const fake = {
    fileManager: {
      generateMarkdownLink: (_file: TFile, sourcePath: string): string => {
        expect(sourcePath).toBe(notePath);
        return link;
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (path: string, sourcePath: string) => {
        resolved.push([path, sourcePath]);
        return resolve(path);
      },
    },
  };
  // embedFor calls only these two of App's methods.
  return { app: fake as App, resolved };
}

describe("embedFor", () => {
  it("keeps a wiki link as Obsidian makes it, without resolving it", () => {
    const file = fileAt("Signs/Water (old).ink.png");
    const { app, resolved } = appWith("[[Water (old).ink.png]]", () => null);
    expect(embedFor(app, file, notePath)).toBe("![[Water (old).ink.png]]");
    expect(resolved).toEqual([]);
  });

  it("keeps a Markdown link that leads back to the file", () => {
    const file = fileAt("Signs/Water.ink.png");
    const { app, resolved } = appWith("[](../Signs/Water.ink.png)", (path) =>
      path === "../Signs/Water.ink.png" ? file : null,
    );
    expect(embedFor(app, file, notePath)).toBe("![](../Signs/Water.ink.png)");
    expect(resolved).toEqual([["../Signs/Water.ink.png", notePath]]);
  });

  it("names the file by its vault path when the link leads to another", () => {
    const file = fileAt("Signs/100% water.ink.png");
    const other = fileAt("Signs/100 water.ink.png");
    const { app, resolved } = appWith(
      "[](Signs/100%20water.ink.png)",
      () => other,
    );
    expect(embedFor(app, file, notePath)).toBe(
      "![](Signs/100%25%20water.ink.png)",
    );
    expect(resolved).toHaveLength(1);
  });

  it("names the file by its vault path when the link leads nowhere", () => {
    const file = fileAt("Signs/Water.ink.png");
    const { app } = appWith("[](Signs/Waters.ink.png)", () => null);
    expect(embedFor(app, file, notePath)).toBe("![](Signs/Water.ink.png)");
  });

  it("names the file by its vault path when Markdown would end the link early", () => {
    const file = fileAt("Signs/Water).ink.png");
    const { app, resolved } = appWith("[](Signs/Water).ink.png)", () => file);
    expect(embedFor(app, file, notePath)).toBe("![](Signs/Water%29.ink.png)");
    // Not a whole link, so there is nothing to resolve.
    expect(resolved).toEqual([]);
  });
});
