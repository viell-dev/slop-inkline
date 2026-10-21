import { browser, expect } from "@wdio/globals";
import { encodePng } from "../../support/png.ts";
import { toBase64 } from "../support/browser.ts";
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

/** Turns Obsidian's Markdown links on or off, in place of wiki links. */
async function useMarkdownLinks(on: boolean): Promise<void> {
  await browser.executeObsidian(({ app }, value) => {
    // Obsidian's own setting, which its API does not expose.
    const vault: object = app.vault;
    const settable = (
      candidate: object,
    ): candidate is { setConfig(key: string, value: unknown): void } =>
      "setConfig" in candidate && typeof candidate.setConfig === "function";
    if (!settable(vault)) throw new Error("Obsidian has no setConfig");
    vault.setConfig("useMarkdownLinks", value);
  }, on);
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

/** Deletes the files at `paths`, as Obsidian is set to. */
async function deleteFiles(paths: string[]): Promise<void> {
  await browser.executeObsidian(async ({ app }, files) => {
    for (const path of files) {
      const file = app.vault.getFileByPath(path);
      if (file !== null) await app.fileManager.trashFile(file);
    }
  }, paths);
}

/** Whether a suggestion or list is open. */
async function listOpen(): Promise<boolean> {
  return browser.$(".suggestion-container").isExisting();
}

describe("Inserting a symbol with none in the vault", function () {
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
        ]) {
          await app.vault.create(`${name}.md`, "The door reads HERE.\n");
        }
        await app.vault.create(
          "Code.md",
          "A `SPAN` here.\n\n```\nFENCE\n```\n\nAfter TEXT.\n",
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
    for (const marker of ["SPAN", "FENCE"]) {
      await openAtMarker("Code.md", marker);
      await type(";;arc");
      await browser.pause(500);
      expect(await listOpen()).toBe(false);
    }
    expect(await noteText()).toBe(
      "A `;;arc` here.\n\n```\n;;arc\n```\n\nAfter ;;arc.\n",
    );
  });

  it("inserts nothing for a symbol deleted while it was listed", async function () {
    await addSymbols(["gone.ink.png"]);
    await openAtMarker("Deleted.md", "HERE");
    await type(";;gone");
    await waitForSuggested(["gone"]);
    await deleteFiles(["gone.ink.png"]);
    await browser.keys(["Enter"]);
    await waitForNotice("gone was deleted, so it was not inserted.");
    await browser.$(".suggestion-container").waitForExist({ reverse: true });
    expect(await noteText()).toBe("The door reads ;;gone.\n");
    // Nor from the command's list.
    await addSymbols(["gone.ink.png"]);
    await browser.executeObsidianCommand("inkline:insert-existing-symbol");
    await browser.$(".prompt-input").waitForDisplayed();
    await type("gone");
    await waitForSuggested(["gone"]);
    await deleteFiles(["gone.ink.png"]);
    await browser.keys(["Enter"]);
    await browser.$(".prompt-input").waitForExist({ reverse: true });
    expect(await noteText()).toBe("The door reads ;;gone.\n");
  });

  it("inserts Markdown links that lead back to their symbols", async function () {
    // Obsidian leaves a % bare in the links it makes (#35).
    const odd = ["Glyphs/sun 50%.ink.png", "Glyphs/x%41.ink.png"];
    await useMarkdownLinks(true);
    try {
      await addSymbols(odd);
      await openAtMarker("Links.md", "HERE");
      for (const [typed, name] of [
        [";;tower o", "tower one"],
        [" ;;sun", "sun 50%"],
        [" ;;x%41", "x%41"],
      ] as const) {
        await type(typed);
        await waitForSuggested([name]);
        await browser.keys(["Enter"]);
      }
      // Obsidian's own link, where it leads back; one with a % that starts
      // no escape mended; and one whose % starts one, by its vault path.
      await waitForNote(
        "The door reads ![](tower%20one.ink.png) ![](sun%2050%25.ink.png) ![](Glyphs/x%2541.ink.png).\n",
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
});
