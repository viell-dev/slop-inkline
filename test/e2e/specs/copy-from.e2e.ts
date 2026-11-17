import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  chooseSymbol,
  editFile,
  inklineOn,
  insert,
  saveOne,
  strokeCount,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  draw,
  editorOpen,
  holdAfter,
  letGo,
  recordOf,
  storedDrafts,
  undoStubs,
  waitForHeld,
  waitForNotice,
  startOver,
  symbolFiles,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import { createSquare, writeSymbol } from "../support/vault-files.ts";

/** How many chunks a symbol file holds that Inkline carries through saves. */
async function carriedIn(path: string): Promise<number> {
  return browser.executeObsidian(async ({ app }, filePath) => {
    const file = app.vault.getFileByPath(filePath);
    if (file === null) throw new Error(`no ${filePath}`);
    const { inkFile, png } = window.inklineTest;
    return inkFile.preservableChunks(
      png.readChunks(new Uint8Array(await app.vault.readBinary(file))),
    ).length;
  }, path);
}

describe("The editor", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
  });

  // A test that fails midway can leave a file operation held or replaced, or
  // Inkline off, which every test after it would then fail on.
  afterEach(async function () {
    await undoStubs();
    if (!(await inklineOn())) {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
  });

  describe("starting from a copy", function () {
    it("starts a new symbol from a copy of another, which Undo takes back", async function () {
      await writeSymbol("Glyphs/tower.ink.png", [800, 1600]);
      await insert();
      await browser.keys(["v"]);
      await chooseSymbol("tower");
      await waitForStatus("Started from a copy of tower");
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.strokes.length === 2,
      );
      await browser.keys(["Control", "z"]);
      await browser.waitUntil(async () => (await storedDrafts()).length === 0);
      await browser.keys(["Control", "Shift", "z"]);
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.strokes.length === 2,
      );
      await draw([[0.5, 0.2]]);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await symbolFiles()).toEqual([
        "001.ink.png",
        "Glyphs/tower.ink.png",
      ]);
      expect(await strokeCount("001.ink.png")).toBe(3);
      expect(await strokeCount("Glyphs/tower.ink.png")).toBe(2);
      // The tower's text stays with its own file.
      expect(await carriedIn("Glyphs/tower.ink.png")).toBe(1);
      expect(await carriedIn("001.ink.png")).toBe(0);
    });

    it("copies a base layer with the strokes", async function () {
      await createSquare();
      await insert();
      await browser.$('[data-inkline-button="copy"]').click();
      // The list shows each symbol's picture beside its name.
      await browser.waitUntil(
        async () =>
          await browser.execute(() => {
            const pictures = [
              ...document.querySelectorAll<HTMLImageElement>(
                ".prompt .inkline-suggestion-picture",
              ),
            ];
            return (
              pictures.length > 0 &&
              pictures.every(
                (picture) => picture.complete && picture.naturalWidth > 0,
              )
            );
          }),
        { timeoutMsg: "no pictures in the list to copy from" },
      );
      expect(
        await browser.execute(() =>
          [
            ...document.querySelectorAll(".prompt .inkline-suggestion-name"),
          ].map((name) => name.textContent),
        ),
      ).toContain("square");
      await saveScreenshot("copy-from-list");
      await chooseSymbol("square");
      await waitForStatus("Started from a copy of square");
      // It holds a picture and no strokes, and says why.
      await waitForStatus("as this file holds no strokes");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      const record = JSON.parse(await recordOf("001.ink.png")) as {
        base?: unknown;
      };
      expect(record.base).toBeDefined();
    });

    it("keeps the drawing when the choice cannot be opened, or is put off", async function () {
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.createBinary(
          "bad.ink.png",
          new TextEncoder().encode("not a PNG").buffer,
        );
      });
      await insert();
      await draw(zigzag);
      await browser.keys(["v"]);
      await chooseSymbol("bad");
      await waitForNotice("Could not open bad.ink.png");
      await browser.keys(["v"]);
      await browser.$(".prompt-input").waitForDisplayed();
      await browser.keys(["Escape"]);
      await browser.$(".prompt").waitForExist({ reverse: true });
      expect(await editorOpen()).toBe(true);
      expect((await storedDrafts())[0]?.strokes).toHaveLength(1);
    });

    it("closes the choice with its editor", async function () {
      await writeSymbol("tower.ink.png", [800]);
      await insert();
      await draw(zigzag);
      // Save and close, then the choice, while the save still runs.
      await holdAfter("create");
      await browser.keys(["Control", "Enter"]);
      await waitForHeld();
      await browser.keys(["v"]);
      await browser.$(".prompt-input").waitForDisplayed();
      await letGo();
      await waitClosed();
      await browser.$(".prompt").waitForExist({ reverse: true });
    });

    it("closes the choice when Inkline is disabled", async function () {
      await writeSymbol("tower.ink.png", [800]);
      await insert();
      await browser.keys(["v"]);
      await browser.$(".prompt-input").waitForDisplayed();
      await obsidianPage.disablePlugin("inkline");
      await browser.$(".prompt").waitForExist({ reverse: true });
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    });

    it("says when there is no symbol to start from", async function () {
      await insert();
      await browser.keys(["v"]);
      await waitForNotice("There are no symbols to start from yet.");
      expect(await browser.$(".prompt").isExisting()).toBe(false);
    });

    it("has no Copy from for a symbol file", async function () {
      await saveOne();
      await editFile("001.ink.png");
      expect(await browser.$('[data-inkline-button="copy"]').isExisting()).toBe(
        false,
      );
      await browser.keys(["v"]);
      await browser.pause(500);
      expect(await browser.$(".prompt").isExisting()).toBe(false);
    });
  });
});
