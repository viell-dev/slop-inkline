// A symbol's readings and translations in real Obsidian: finding a symbol by
// them in every list, and the index that remembers them. All the text is
// synthetic.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { editFile } from "../support/editing.ts";
import {
  createSymbol,
  delayVault,
  noteText,
  openAtMarker,
  restoreVault,
  startOver,
  waitForStatus,
} from "../support/editor.ts";
import { type } from "../support/insertion.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import {
  row,
  rows,
  showLibrary,
  waitForRow,
  waitForRows,
  waitForValues,
} from "../support/symbol-text-library.ts";
import {
  changeOnDisk,
  fill,
  makeNote,
  newSymbol,
  noteFile,
  restartInkline,
  saveAndClose,
  showFields,
  symbolWith,
} from "../support/symbol-text.ts";

/** Bulk files, each with a reading of its own, for an index to take time over. */
async function bulkSymbols(count: number): Promise<void> {
  await browser.executeObsidian(async ({ app }, total) => {
    const { canvas, text } = window.inklineTest;
    const { bytes } = await canvas.saveInk({ strokes: [] }, undefined, []);
    for (let at = 0; at < total; at++) {
      const said = await text.writeText(bytes, "reading", [
        `value${String(at)}`,
      ]);
      await app.vault.createBinary(
        `Bulk ${String(at).padStart(2, "0")}.ink.png`,
        said.slice().buffer,
      );
    }
  }, count);
}

describe("A symbol's readings and translations", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("inkline-library");
    });
    await makeNote();
  });

  describe("in search", function () {
    beforeEach(async function () {
      await symbolWith("Anything at all.ink.png", {
        reading: ["TA", "šá"],
        translation: ["rice field"],
      });
      await createSymbol("tower.ink.png");
      await createSymbol("TA.ink.png");
      await createSymbol("tall hat.ink.png");
    });

    /** Waits for the library's filter to have read the text. */
    async function indexed(): Promise<void> {
      await showLibrary();
      await waitForValues("Anything at all.ink.png", "TA");
    }

    it("finds a symbol named anything by `;;`, and says why", async function () {
      await indexed();
      await openAtMarker(noteFile, "HERE");
      await type(";;TA");
      // One key before, the name holds `t`, which needs no explaining.
      await browser.waitUntil(async () =>
        (await rows()).some(({ why }) => why === "Reading: TA"),
      );
      // A name that is what was typed comes first, and needs no explaining,
      // then a value that is, above a name it only starts.
      expect((await rows()).slice(0, 2)).toEqual([
        { name: "TA", why: "" },
        { name: "Anything at all", why: "Reading: TA" },
      ]);
      await saveScreenshot("text-suggest");
      await browser.keys(["ArrowDown", "Enter"]);
      await browser.waitUntil(async () =>
        browser.executeObsidian(({ app, obsidian }) => {
          const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
          return (
            view?.editor.getValue().includes("Anything at all.ink.png") === true
          );
        }),
      );
    });

    it("finds by a translation's words, and a sentence stops matching", async function () {
      await indexed();
      await openAtMarker(noteFile, "HERE");
      await type(";;rice f");
      await waitForRows([
        { name: "Anything at all", why: "Translation: rice field" },
      ]);
      await type("ood");
      await browser.waitUntil(async () => (await rows()).length === 0);
      // With nothing listed, Enter is the note's own: a new line, no symbol.
      await browser.keys(["Enter"]);
      // The editor's new line drops the space after the cursor.
      let text = "";
      try {
        await browser.waitUntil(async () => {
          text = await noteText();
          return text === "Write ;;rice food\non.\n";
        });
      } catch (error) {
        throw new Error(`Enter left ${JSON.stringify(text)}`, {
          cause: error,
        });
      }
    });

    it("finds by Insert existing symbol", async function () {
      await indexed();
      await openAtMarker(noteFile, "HERE");
      await browser.executeObsidianCommand("inkline:insert-existing-symbol");
      await browser.$(".prompt-input").waitForExist();
      await browser.$(".prompt-input").setValue("rice");
      await waitForRows([
        { name: "Anything at all", why: "Translation: rice field" },
      ]);
      await saveScreenshot("text-insert-existing");
      // A space after what was typed is nothing to look for, as in the library.
      await browser.$(".prompt-input").setValue("TA ");
      await waitForRow("Anything at all");
      await browser.keys(["Escape"]);
    });

    it("finds by Copy from", async function () {
      await indexed();
      await newSymbol();
      await browser.$('[data-inkline-button="copy"]').click();
      await browser.$(".prompt-input").waitForExist();
      await browser.$(".prompt-input").setValue("rice");
      await waitForRows([
        { name: "Anything at all", why: "Translation: rice field" },
      ]);
      await saveScreenshot("text-copy-from");
      await browser.keys(["Enter"]);
      await waitForStatus("Started from a copy of Anything at all");
    });

    it("finds by the library's filter, and says why", async function () {
      await indexed();
      const search = browser.$(".inkline-library-search");
      await search.setValue("rice");
      await browser.waitUntil(
        async () => (await browser.$$(".inkline-library-symbol").length) === 1,
      );
      const found = row("Anything at all.ink.png").$(".inkline-value-found");
      expect(await found.getText()).toBe("rice field");
      await saveScreenshot("text-library-found");
      await search.setValue("šá");
      await browser.waitUntil(
        async () =>
          (await row("Anything at all.ink.png")
            .$(".inkline-value-found")
            .getText()) === "šá",
      );
      // By its name there is nothing to explain.
      await search.setValue("Anything");
      await browser.waitUntil(
        async () =>
          !(await row("Anything at all.ink.png")
            .$(".inkline-value-found")
            .isExisting()),
      );
    });
  });

  describe("in the index", function () {
    /** The rows the library's filter leaves for `query`, by path. */
    async function filtered(query: string): Promise<string[]> {
      await browser.$(".inkline-library-search").setValue(query);
      return browser.execute(() =>
        Array.from(document.querySelectorAll(".inkline-library-symbol")).map(
          (found) => found.getAttribute("data-inkline-path") ?? "",
        ),
      );
    }

    /** Waits for the filter to leave only `paths` for `query`. */
    async function waitForFiltered(
      query: string,
      paths: readonly string[],
    ): Promise<void> {
      let shown: string[] = [];
      try {
        await browser.waitUntil(async () => {
          shown = await filtered(query);
          return JSON.stringify(shown) === JSON.stringify(paths);
        });
      } catch (error) {
        throw new Error(
          `${query} left ${JSON.stringify(shown)}, not ${JSON.stringify(paths)}`,
          { cause: error },
        );
      }
    }

    it("follows the vault's changes to a file", async function () {
      await symbolWith("One.ink.png", { reading: ["TA"] });
      await showLibrary();
      await waitForFiltered("TA", ["One.ink.png"]);
      await changeOnDisk("One.ink.png", { reading: ["KA"] });
      await waitForFiltered("KA", ["One.ink.png"]);
      await waitForFiltered("TA", []);
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("One.ink.png");
        if (file === null) throw new Error("no file");
        await app.vault.rename(file, "Two.ink.png");
      });
      await waitForFiltered("KA", ["Two.ink.png"]);
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.createFolder("Old");
        const file = app.vault.getFileByPath("Two.ink.png");
        if (file === null) throw new Error("no file");
        await app.vault.rename(file, "Old/Two.ink.png");
        const folder = app.vault.getFolderByPath("Old");
        if (folder === null) throw new Error("no folder");
        await app.vault.rename(folder, "New");
      });
      await waitForFiltered("KA", ["New/Two.ink.png"]);
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("New/Two.ink.png");
        if (file === null) throw new Error("no file");
        await app.fileManager.trashFile(file);
      });
      await waitForFiltered("KA", []);
      await symbolWith("Three.ink.png", { reading: ["KA"] });
      await waitForFiltered("KA", ["Three.ink.png"]);
    });

    // One reading of the vault, slowed so that each step comes while it reads.
    it("searches while it reads, says it may be missing some, and reads what just changed first", async function () {
      this.timeout(120_000);
      await bulkSymbols(60);
      await showLibrary();
      await delayVault("readBinary", 300);
      await restartInkline();
      await showLibrary();
      const search = browser.$(".inkline-library-search");
      const status = browser.$(".inkline-library-status");
      const count = () => browser.$$(".inkline-library-symbol").length;
      // Something the vault reports goes before the rest of the files.
      await changeOnDisk("Bulk 58.ink.png", { reading: ["synced"] });
      await search.setValue("synced");
      await browser.waitUntil(async () => (await count()) === 1, {
        timeout: 5000,
      });
      expect(await status.isDisplayed()).toBe(true);
      // A name is found while the values are read, which the status says.
      await search.setValue("Bulk 59");
      await browser.waitUntil(async () => (await count()) === 1);
      expect(await status.isDisplayed()).toBe(true);
      await saveScreenshot("text-library-reading");
      await search.click();
      await browser.keys(["Control", "a"]);
      await browser.keys(["Delete"]);
      await browser.waitUntil(async () => !(await status.isDisplayed()));
      await openAtMarker(noteFile, "HERE");
      await browser.executeObsidianCommand("inkline:insert-existing-symbol");
      await browser.$(".prompt-input").waitForExist();
      await browser.$(".prompt-input").setValue("Bulk 59");
      await waitForRow("Bulk 59");
      expect(await browser.$(".prompt-instructions").getText()).toContain(
        "still reading",
      );
      await browser.keys(["Escape"]);
      await browser.$(".prompt").waitForExist({ reverse: true });
      await showLibrary();
      // A burst of reports, as from a sync tool, and a save goes before those
      // too: what was just typed is what a person looks for next.
      await browser.executeObsidian(async ({ app }) => {
        const { text } = window.inklineTest;
        for (const file of app.vault.getFiles()) {
          if (!file.path.startsWith("Bulk ")) continue;
          // Past the vault, whose reads are slowed for the index.
          const bytes = new Uint8Array(
            await app.vault.adapter.readBinary(file.path),
          );
          const written = await text.writeText(bytes, "translation", ["again"]);
          await app.vault.modifyBinary(file, written.slice().buffer);
        }
      });
      await editFile("Bulk 59.ink.png");
      await showFields();
      await fill("reading", "justtyped");
      await saveAndClose();
      await search.setValue("justtyped");
      await browser.waitUntil(async () => (await count()) === 1, {
        timeout: 5000,
      });
      expect(await status.isDisplayed()).toBe(true);
      // Once it has read the rest, at full speed now, the status goes.
      await restoreVault();
      await search.setValue("value57");
      await browser.waitUntil(async () => (await count()) === 1, {
        timeout: 60_000,
      });
      await browser.waitUntil(async () => !(await status.isDisplayed()));
    });
  });
});
