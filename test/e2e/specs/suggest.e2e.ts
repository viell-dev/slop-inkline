import { browser, expect } from "@wdio/globals";
import { encodePng } from "../../support/png.ts";
import { toBase64 } from "../support/browser.ts";
import { noteText, openAtMarker } from "../support/editor.ts";
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
        for (const name of ["Typing", "Space", "Command", "Number"]) {
          await app.vault.create(`${name}.md`, "The door reads HERE.\n");
        }
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
    await browser.waitUntil(async () => (await suggested()).length === 4);
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
});
