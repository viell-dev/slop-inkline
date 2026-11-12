import { browser, expect } from "@wdio/globals";
import { encodePng } from "../../support/png.ts";
import { codeCases, type CodeCase } from "../../support/code-cases.ts";
import { loadModules, toBase64 } from "../support/browser.ts";
import { noteText, openAtMarker, waitForNotice } from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** A synthetic symbol: the line box, with a grey block in it. */
function symbol(): string {
  const width = 64;
  const height = 192;
  const data = new Uint8Array(width * height * 4);
  for (let y = 48; y < 144; y++) {
    for (let x = 8; x < 56; x++) {
      data.set([126, 126, 126, 255], (y * width + x) * 4);
    }
  }
  return toBase64(encodePng({ width, height, data }));
}

const symbols = [
  "arch.ink.png",
  "001.ink.png",
  // The one the note uses, first, so that it is the older: only its uses can
  // rank it above the other.
  "Glyphs/tower two.ink.png",
  "Glyphs/tower one.ink.png",
];

/** The names the open suggestion or list shows, top first. */
async function suggested(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(
      activeDocument.querySelectorAll(
        ".suggestion-item .inkline-suggestion-name",
      ),
    ).map((name) => name.textContent),
  );
}

/** Waits for a suggestion or list to show `names`, top first. */
async function waitForSuggested(names: string[]): Promise<void> {
  let shown: string[] = [];
  try {
    await browser.waitUntil(async () => {
      shown = await suggested();
      return JSON.stringify(shown) === JSON.stringify(names);
    });
  } catch (error) {
    throw new Error(
      `waited for ${JSON.stringify(names)}, but the list showed ${JSON.stringify(shown)}`,
      { cause: error },
    );
  }
}

/** Types `text` into the focused editor, a key at a time. */
async function type(text: string): Promise<void> {
  for (const key of text) await browser.keys([key]);
}

/** Waits for the note to read `text`, failing with what it last read. */
async function waitForNote(text: string): Promise<void> {
  let read = "";
  let path: string | undefined;
  try {
    await browser.waitUntil(async () => {
      read = await noteText();
      return read === text;
    });
  } catch (error) {
    path = await browser.executeObsidian(
      ({ app }) => app.workspace.getActiveFile()?.path,
    );
    throw new Error(
      `waited for ${JSON.stringify(text)}, but ${String(path)} read ${JSON.stringify(read)}`,
      { cause: error },
    );
  }
}

/** Sets one of Obsidian's own settings for links, which its API does not expose. */
async function setLinkSetting(
  key: "useMarkdownLinks" | "newLinkFormat",
  value: unknown,
): Promise<void> {
  await browser.executeObsidian(
    ({ app }, name, setting) => {
      const vault: object = app.vault;
      const settable = (
        candidate: object,
      ): candidate is { setConfig(key: string, value: unknown): void } =>
        "setConfig" in candidate && typeof candidate.setConfig === "function";
      if (!settable(vault)) throw new Error("Obsidian has no setConfig");
      vault.setConfig(name, setting);
    },
    key,
    value,
  );
}

/** Turns Obsidian's Markdown links on or off, in place of wiki links. */
async function useMarkdownLinks(on: boolean): Promise<void> {
  await setLinkSetting("useMarkdownLinks", on);
}

/** Adds symbols at `paths`, each the synthetic symbol. */
async function addSymbols(paths: string[]): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, files, png) => {
      const data = Uint8Array.from(atob(png), (c) => c.charCodeAt(0)).buffer;
      for (const path of files) await app.vault.createBinary(path, data);
    },
    paths,
    symbol(),
  );
}

/**
 * Makes the vault say it has no file at `paths`, by path and in its list of
 * files, as once they are deleted, without the events a deletion sends: on
 * Obsidian 1.14.4 they sometimes close an open list before a test can
 * choose from it.
 */
async function forgetFiles(paths: string[]): Promise<void> {
  await browser.executeObsidian(({ app }, files) => {
    const vault = app.vault;
    const byPath = vault.getFileByPath.bind(vault);
    const all = vault.getFiles.bind(vault);
    Reflect.set(vault, "inklineRemembered", { byPath, all });
    vault.getFileByPath = (path: string) =>
      files.includes(path) ? null : byPath(path);
    vault.getFiles = () => all().filter((file) => !files.includes(file.path));
  }, paths);
}

/** Undoes {@link forgetFiles}. */
async function rememberFiles(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const vault = app.vault;
    const kept: unknown = Reflect.get(vault, "inklineRemembered");
    if (typeof kept !== "object" || kept === null) return;
    Reflect.deleteProperty(vault, "inklineRemembered");
    Reflect.set(vault, "getFileByPath", Reflect.get(kept, "byPath"));
    Reflect.set(vault, "getFiles", Reflect.get(kept, "all"));
  });
}

/**
 * Moves the files at `paths` to the vault's own trash, and waits for the
 * vault to forget them, which it does once it sees them go.
 */
async function deleteFiles(paths: string[]): Promise<void> {
  await browser.executeObsidian(async ({ app }, files) => {
    for (const path of files) {
      if (app.vault.getFileByPath(path) !== null) {
        await app.vault.adapter.trashLocal(path);
      }
    }
  }, paths);
  await browser.waitUntil(async () =>
    browser.executeObsidian(
      ({ app }, files) =>
        files.every((path) => app.vault.getFileByPath(path) === null),
      paths,
    ),
  );
}

/** Whether a suggestion or list is open. */
async function listOpen(): Promise<boolean> {
  return browser.$(".suggestion-container").isExisting();
}

/**
 * Notes by name, with HERE where a trigger is typed, and whether a list
 * opens there: in code that started on an earlier line, none does, and in
 * the text beside it, one does.
 */
const contexts: [string, string, boolean][] = [
  // A code span runs through its paragraph's lines.
  ["Span", "A `code span\nthat runs on HERE` here.\n", false],
  ["Span ended", "A `code span\nthat ends` HERE.\n", true],
  ["Span in a quote", "> A `code span\nthat runs on HERE` here.\n", false],
  ["Span over a blank", "A `not code\n\nHERE` here.\n", true],
  ["Escaped", "A \\`not code\nHERE` here.\n", true],
  ["Unmatched", "A `not code\nHERE here.\n", true],
  ["Unmatched run", "A ``not code\nHERE` here.\n", false],
  // A fenced code block in a quote ends with the quote.
  ["Quote", "> ```\n> sample\n\nHERE\n", true],
  ["Nested quote", "> > ```\n> > sample\n>\n> HERE\n", true],
  ["Quote's fence", "> ```\n> sample\n>\n> HERE\n", false],
  ["Nested fence", "> > ```\n> > sample\n> > HERE\n", false],
  // And one in a list item, with the item.
  ["Item's fence", "- ```\n  sample\n  HERE\n", false],
  ["List", "- A list item\n  ```\n  sample\n\nHERE\n", true],
  // One the note opened runs to its end, through blank lines.
  ["Open fence", "```\nsample\n\n\nHERE\n", false],
  // An indented code block, told from a list item's indented text.
  ["Indented", "Some text.\n\n    HERE\n", false],
  ["Item's text", "- A list item\n\n    HERE\n", true],
];

/**
 * Waits for the line break Enter makes after `typed`, in place of HERE in
 * `note`: the note's own text up to it, a line break, then what the editor
 * starts the next line with, as a quote's `>`, and the rest of the note.
 */
async function waitForLineBreak(note: string, typed: string): Promise<void> {
  const [before = "", after = ""] = note.split("HERE");
  let read = "";
  try {
    await browser.waitUntil(async () => {
      read = await noteText();
      return (
        read.startsWith(`${before}${typed}\n`) &&
        read.endsWith(after) &&
        read.length > before.length + typed.length + after.length
      );
    });
  } catch (error) {
    throw new Error(
      `waited for a line break after ${typed} in ${JSON.stringify(note)}, but it read ${JSON.stringify(read)}`,
      { cause: error },
    );
  }
  expect(read).not.toContain(".ink.png");
}

describe("Inserting a symbol with none in the vault", function () {
  // A list left open would take the keys of every test after it.
  after(async function () {
    if (await browser.$(".prompt-input").isExisting()) {
      await browser.keys(["Escape"]);
    }
  });

  it("says there are none, in place of an empty list", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Empty.md", "The door reads HERE.\n");
    });
    await openAtMarker("Empty.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-existing-symbol");
    await waitForNotice("There are no symbols to insert yet.");
    expect(await browser.$(".prompt-input").isExisting()).toBe(false);
  });
});

describe("Inserting a symbol you have", function () {
  before(async function () {
    const bytes = symbol();
    await browser.executeObsidian(
      async ({ app }, paths, png) => {
        const data = Uint8Array.from(atob(png), (c) => c.charCodeAt(0)).buffer;
        await app.vault.createFolder("Glyphs");
        for (const path of paths) {
          await app.vault.createBinary(path, data);
          // A later change time for each.
          await new Promise((resolve) => window.setTimeout(resolve, 20));
        }
        await app.vault.create(
          "Uses.md",
          "Twice: ![[Glyphs/tower two.ink.png]] and ![[Glyphs/tower two.ink.png]].\n\nHERE\n",
        );
        for (const name of [
          "Typing",
          "Space",
          "Command",
          "Number",
          "Dismiss",
          "Sentence",
          "Deleted",
          "Links",
          "Typo",
        ]) {
          await app.vault.create(`${name}.md`, "The door reads HERE.\n");
        }
        await app.vault.create(
          "Code.md",
          // A marker alone in a code span would leave it empty, and the
          // editor would then select past it.
          "A `code SPAN` here.\n\n```INFO\nFENCE\n```\n\nAfter TEXT.\n",
        );
      },
      symbols,
      bytes,
    );
    // The links the ranking reads.
    await browser.waitUntil(async () =>
      browser.executeObsidian(
        ({ app }) =>
          (app.metadataCache.resolvedLinks["Uses.md"]?.[
            "Glyphs/tower two.ink.png"
          ] ?? 0) === 2,
      ),
    );
  });

  it("inserts a symbol by typing the trigger and its name", async function () {
    await openAtMarker("Typing.md", "HERE");
    await type(";;arc");
    await waitForSuggested(["arch"]);
    // Its picture, beside its name, is painted as text but given no name.
    expect(
      await browser.execute(() => {
        const picture = activeDocument.querySelector(
          ".inkline-suggestion-picture",
        );
        return [
          picture?.classList.contains("inkline-symbol"),
          picture?.getAttribute("aria-hidden"),
          picture?.getAttribute("aria-label"),
        ];
      }),
    ).toEqual([true, "true", null]);
    await saveScreenshot("suggest-typing");
    await browser.keys(["Enter"]);
    await waitForNote("The door reads ![[arch.ink.png]].\n");
    expect(await browser.$(".suggestion-container").isExisting()).toBe(false);
  });

  it("ranks by the match, then by use in the note", async function () {
    await openAtMarker("Uses.md", "HERE");
    // Both names match "tower" as well; the note uses the second twice.
    await type(";;tower");
    await waitForSuggested(["tower two", "tower one"]);
    await browser.keys(["Escape"]);
  });

  it("lists every symbol for the trigger alone, and stops at a space", async function () {
    await openAtMarker("Space.md", "HERE");
    await type(";;");
    // The newest first, as none matches better or is used in the note.
    await waitForSuggested(["tower one", "tower two", "001", "arch"]);
    await type(" ");
    await browser.$(".suggestion-container").waitForExist({ reverse: true });
    expect(await noteText()).toBe("The door reads ;; .\n");
  });

  it("inserts a numbered symbol without a size in its link", async function () {
    await openAtMarker("Number.md", "HERE");
    await type(";;001");
    await waitForSuggested(["001"]);
    await browser.keys(["Enter"]);
    await waitForNote("The door reads ![[001.ink.png]].\n");
  });

  it("inserts the symbol chosen from the command's list", async function () {
    await openAtMarker("Command.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-existing-symbol");
    await browser.$(".prompt-input").waitForDisplayed();
    await type("one");
    await waitForSuggested(["tower one"]);
    await browser.keys(["Enter"]);
    // The shortest link that names it, as Obsidian makes them by default.
    await waitForNote("The door reads ![[tower one.ink.png]].\n");
  });

  it("keeps a dismissed list closed as its name is typed on", async function () {
    await openAtMarker("Dismiss.md", "HERE");
    await type(";;to");
    await browser.waitUntil(async () => (await suggested()).length > 0);
    await browser.keys(["Escape"]);
    await browser.$(".suggestion-container").waitForExist({ reverse: true });
    // Undismissed, ;;tower would list both towers.
    await type("wer");
    await browser.pause(500);
    expect(await listOpen()).toBe(false);
    await browser.keys(["Enter"]);
    await waitForNote("The door reads ;;tower\n.\n");
    // A new trigger lists again.
    await type(";;arc");
    await waitForSuggested(["arch"]);
    await browser.keys(["Enter"]);
    await waitForNote("The door reads ;;tower\n![[arch.ink.png]].\n");
  });

  it("lists again once a key that ended the name is taken back", async function () {
    await openAtMarker("Typo.md", "HERE");
    await type(";;arc");
    await waitForSuggested(["arch"]);
    // A [ is link syntax, which ends the name.
    await type("[");
    await browser.$(".suggestion-container").waitForExist({ reverse: true });
    await browser.keys(["Backspace"]);
    await waitForSuggested(["arch"]);
    await browser.keys(["Enter"]);
    await waitForNote("The door reads ![[arch.ink.png]].\n");
  });

  it("matches a name with a space only if it holds what was typed", async function () {
    await openAtMarker("Sentence.md", "HERE");
    // A fuzzy match would find "tower" in "to wer".
    await type(";;to wer");
    await browser.pause(500);
    expect(await listOpen()).toBe(false);
    await browser.keys(["Enter"]);
    await waitForNote("The door reads ;;to wer\n.\n");
    // And "tower two" in "tower o".
    await type(";;tower o");
    await waitForSuggested(["tower one"]);
    await browser.keys(["Enter"]);
    await waitForNote("The door reads ;;to wer\n![[tower one.ink.png]].\n");
  });

  it("lists nothing in code", async function () {
    // It lists in the text after the code, as a check that it would.
    await openAtMarker("Code.md", "TEXT");
    await type(";;arc");
    await waitForSuggested(["arch"]);
    await browser.keys(["Escape"]);
    // The info string after an opening fence is code too.
    for (const marker of ["SPAN", "INFO", "FENCE"]) {
      await openAtMarker("Code.md", marker);
      await type(";;arc");
      await browser.pause(500);
      expect(await listOpen()).toBe(false);
    }
    expect(await noteText()).toBe(
      "A `code ;;arc` here.\n\n```;;arc\n;;arc\n```\n\nAfter ;;arc.\n",
    );
  });

  describe("in code that started on an earlier line", function () {
    // A list left open by a failure would take the keys of the next test.
    afterEach(async function () {
      if (await listOpen()) await browser.keys(["Escape"]);
    });

    for (const [name, note, lists] of contexts) {
      it(`${lists ? "lists" : "lists nothing"} in ${JSON.stringify(note)}`, async function () {
        await browser.executeObsidian(
          async ({ app }, path, text) => {
            await app.vault.create(path, text);
          },
          `${name}.md`,
          note,
        );
        await openAtMarker(`${name}.md`, "HERE");
        await type(";;arc");
        if (lists) {
          await waitForSuggested(["arch"]);
          await browser.keys(["Enter"]);
          await waitForNote(note.replace("HERE", "![[arch.ink.png]]"));
          return;
        }
        await browser.pause(500);
        await saveScreenshot(
          `suggest-code-${name.toLowerCase().replace(/\W+/g, "-")}`,
        );
        expect(await listOpen()).toBe(false);
        // Enter breaks the line, as it would with no list, and inserts nothing.
        await browser.keys(["Enter"]);
        await waitForLineBreak(note, ";;arc");
      });
    }
  });

  it("inserts nothing for a symbol deleted while it was listed", async function () {
    // ;;gon lists gonk too, so the list shows gone alone only once the last
    // key has been read, before the vault forgets it.
    await addSymbols(["gone.ink.png", "gonk.ink.png"]);
    try {
      await openAtMarker("Deleted.md", "HERE");
      await type(";;gone");
      await waitForSuggested(["gone"]);
      await forgetFiles(["gone.ink.png"]);
      await browser.keys(["Enter"]);
      expect(await noteText()).toBe("The door reads ;;gone.\n");
      await waitForNotice("gone was deleted, so it was not inserted.");
      await browser.$(".suggestion-container").waitForExist({ reverse: true });
      // And stays closed for that trigger, as Obsidian may look at it again:
      // even with the symbol back, ;;gon lists nothing.
      await rememberFiles();
      await browser.keys(["Backspace"]);
      await browser.pause(500);
      expect(await listOpen()).toBe(false);
      await type("e");
      // Nor from the command's list.
      await browser.executeObsidianCommand("inkline:insert-existing-symbol");
      await browser.$(".prompt-input").waitForDisplayed();
      await type("gone");
      await waitForSuggested(["gone"]);
      await forgetFiles(["gone.ink.png"]);
      await browser.keys(["Enter"]);
      await browser.$(".prompt-input").waitForExist({ reverse: true });
      expect(await noteText()).toBe("The door reads ;;gone.\n");
    } finally {
      await rememberFiles();
      await deleteFiles(["gone.ink.png", "gonk.ink.png"]);
    }
  });

  it("inserts Markdown links that lead back to their symbols", async function () {
    // Obsidian leaves a % bare in the links it makes (#35), and a ) too.
    const odd = [
      "Glyphs/sun 50%.ink.png",
      "Glyphs/jix%41&y.ink.png",
      "Glyphs/half)moon.ink.png",
    ];
    await useMarkdownLinks(true);
    try {
      await addSymbols(odd);
      await openAtMarker("Links.md", "HERE");
      for (const [typed, name] of [
        [";;tower o", "tower one"],
        [" ;;sun", "sun 50%"],
        [" ;;jix", "jix%41&y"],
        [" ;;half", "half)moon"],
      ] as const) {
        await type(typed);
        await waitForSuggested([name]);
        await browser.keys(["Enter"]);
      }
      // Obsidian's own link, where it leads back; one with a % that starts
      // no escape mended; and by their vault paths, one whose % starts one,
      // and one whose ) would end the link.
      await waitForNote(
        "The door reads ![](tower%20one.ink.png) ![](sun%2050%25.ink.png) ![](Glyphs/jix%2541&y.ink.png) ![](Glyphs/half%29moon.ink.png).\n",
      );
      await browser.executeObsidian(async ({ app, obsidian }) => {
        await app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.save();
      });
      const wanted = ["Glyphs/tower one.ink.png", ...odd];
      let resolved: Record<string, number> = {};
      try {
        await browser.waitUntil(async () => {
          resolved = await browser.executeObsidian(
            ({ app }) => app.metadataCache.resolvedLinks["Links.md"] ?? {},
          );
          return wanted.every((path) => resolved[path] === 1);
        });
      } catch (error) {
        throw new Error(`Obsidian resolved ${JSON.stringify(resolved)}`, {
          cause: error,
        });
      }
    } finally {
      await useMarkdownLinks(false);
      await deleteFiles(odd);
    }
  });

  it("inserts a path from a note's folder when Obsidian writes relative links", async function () {
    // As Without Inkline gives it, for apps that read a path from the note.
    await useMarkdownLinks(true);
    await setLinkSetting("newLinkFormat", "relative");
    try {
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.createFolder("Notes");
        await app.vault.create("Notes/Relative.md", "The door reads HERE.\n");
      });
      await openAtMarker("Notes/Relative.md", "HERE");
      await type(";;tower o");
      await waitForSuggested(["tower one"]);
      await browser.keys(["Enter"]);
      await waitForNote("The door reads ![](../Glyphs/tower%20one.ink.png).\n");
      await browser.executeObsidian(async ({ app, obsidian }) => {
        await app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.save();
      });
      // Obsidian leads it to the symbol, and Inkline shows it as one.
      await browser.waitUntil(
        async () =>
          browser.executeObsidian(
            ({ app }) =>
              app.metadataCache.resolvedLinks["Notes/Relative.md"]?.[
                "Glyphs/tower one.ink.png"
              ] === 1,
          ),
        { timeoutMsg: "Obsidian did not resolve the relative link" },
      );
      await browser.waitUntil(
        async () =>
          browser.execute(() =>
            Array.from(
              activeDocument.querySelectorAll<HTMLImageElement>(
                ".workspace-leaf.mod-active .markdown-source-view img.inkline-symbol",
              ),
            ).some(
              (image) =>
                image.src.includes("tower%20one") &&
                image.complete &&
                image.naturalWidth > 0,
            ),
          ),
        { timeoutMsg: "the note does not show the symbol" },
      );
    } finally {
      await setLinkSetting("newLinkFormat", "shortest");
      await useMarkdownLinks(false);
    }
  });
});

describe("Where a trigger is code", function () {
  before(async function () {
    await loadModules();
  });

  // The cases of test/support/code-cases.ts, rendered as Reading view
  // renders them.
  it("finds code where Obsidian renders it, and only there", async function () {
    const differ = await browser.executeObsidian(
      async ({ app, obsidian }, cases) => {
        const { insideCode } = window.inklineTest.code;
        const found: string[] = [];
        for (const [name, { note, code, limit }] of cases) {
          const shown = activeDocument.body.createDiv();
          const component = new obsidian.Component();
          component.load();
          try {
            await obsidian.MarkdownRenderer.render(
              app,
              note,
              shown,
              "",
              component,
            );
            const walker = activeDocument.createTreeWalker(
              shown,
              NodeFilter.SHOW_TEXT,
            );
            let rendered: boolean | undefined;
            for (
              let at = walker.nextNode();
              at !== null;
              at = walker.nextNode()
            ) {
              if (at.textContent?.includes("HERE") === true) {
                rendered = at.parentElement?.closest("code") != null;
                break;
              }
            }
            const lines = note.split("\n");
            const before = note.slice(0, note.indexOf("HERE")).split("\n");
            const checked = insideCode(
              (index) => lines[index],
              before.length - 1,
              (before.at(-1) ?? "").length,
            );
            if (rendered !== code) {
              found.push(`${name}: Obsidian renders ${String(rendered)}`);
            }
            // Where the check knowingly differs, it finds the other answer.
            if (checked !== (limit === undefined ? code : !code)) {
              found.push(`${name}: the check finds ${String(checked)}`);
            }
          } finally {
            component.unload();
            shown.remove();
          }
        }
        return found;
      },
      // The notes typed in above too, where a list opens only in text.
      [
        ...Object.entries(codeCases),
        ...contexts.map(([name, note, lists]): [string, CodeCase] => [
          name,
          { note, code: !lists },
        ]),
      ],
    );
    expect(differ).toEqual([]);
  });
});
