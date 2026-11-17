// A symbol's readings and translations in real Obsidian, filled in from the
// editor: saved with a new symbol, kept through later saves and in a draft, and
// refused over the format's limit. What the file holds is read back with the
// format's own code, in Obsidian's Chromium. All the text is synthetic.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { loadModules, toBase64 } from "../support/browser.ts";
import { editFile } from "../support/editing.ts";
import {
  clickTop,
  draw,
  markEditor,
  recordOf,
  restoreVault,
  startOver,
  surface,
  symbolFiles,
  topButton,
  waitForNext,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import {
  area,
  changeOnDisk,
  fieldsOf,
  fill,
  fixtures,
  letWriteGo,
  makeNote,
  newSymbol,
  paste,
  redrawOnDisk,
  restartInkline,
  saveAndClose,
  showFields,
  symbolWith,
  toggle,
} from "../support/symbol-text.ts";
import { bytesOf } from "../support/vault-files.ts";

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

  // No test of this file sets the stubs that this takes away: a held read or
  // write, and a replaced read or write of the vault. It is kept from the
  // suite these tests were split from, so that they run under the hooks they
  // always ran under. Whether this file needs it is for the change that makes
  // one clean-up of this and `undoStubs()` (#228).
  afterEach(async function () {
    await browser.execute(() => {
      const go: unknown = Reflect.get(window, "inklineLetReadGo");
      Reflect.deleteProperty(window, "inklineLetReadGo");
      if (typeof go === "function") Reflect.apply(go, undefined, []);
    });
    await letWriteGo();
    await restoreVault();
    await browser.executeObsidian(({ app }) => {
      Reflect.deleteProperty(app.vault, "readBinary");
      Reflect.deleteProperty(app.vault, "modifyBinary");
    });
  });

  describe("in the editor", function () {
    it("adds no row until asked, and says how to enter several", async function () {
      await newSymbol();
      const layout = await browser.execute(() => {
        const box = (selector: string) => {
          const found = document.querySelector(selector);
          if (found === null) throw new Error(`no ${selector}`);
          return found.getBoundingClientRect();
        };
        const name = box(".inkline-editor .inkline-name");
        const button = box(".inkline-text-toggle");
        return {
          sameRow:
            button.top >= name.top - 1 && button.bottom <= name.bottom + 1,
          nameWidth: name.width,
        };
      });
      expect(layout.sameRow).toBe(true);
      expect(layout.nameWidth).toBeGreaterThan(200);
      expect(await browser.$(".inkline-text-strip").isDisplayed()).toBe(false);
      expect(await toggle().getText()).toBe("Readings and translations");
      await saveScreenshot("text-editor-closed");
      await toggle().click();
      await area("reading").waitForDisplayed();
      expect(await browser.$(".inkline-text-hint").getText()).toContain(
        "One per line",
      );
      // The focus goes to the first field, so that typing does not draw.
      await browser.keys(["p"]);
      expect(await area("reading").getValue()).toBe("p");
      await saveScreenshot("text-editor-open");
    });

    it("saves what is typed with a new symbol, and shows it on opening again", async function () {
      await newSymbol();
      await draw([
        [0.3, 0.3],
        [0.5, 0.6],
      ]);
      await showFields();
      await fill("reading", "  TA\n\nDA  \n");
      await fill("translation", "field");
      await saveAndClose();
      const [file] = await symbolFiles();
      if (file === undefined) throw new Error("no symbol saved");
      expect(await fieldsOf(file)).toEqual({
        reading: ["TA", "DA"],
        translation: ["field"],
      });
      await editFile(file);
      // Shown at once, without opening anything.
      expect(await toggle().getText()).toContain("TA, DA");
      expect(await toggle().getText()).toContain("field");
      expect(await browser.$(".inkline-text-strip").isDisplayed()).toBe(false);
      await saveScreenshot("text-editor-values");
      await showFields();
      expect(await area("reading").getValue()).toBe("TA\nDA");
      expect(await area("translation").getValue()).toBe("field");
    });

    it("keeps them through saves that change only the drawing", async function () {
      await symbolWith("Kept.ink.png", {
        reading: ["TA"],
        translation: ["field"],
      });
      await editFile("Kept.ink.png");
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      expect(await fieldsOf("Kept.ink.png")).toEqual({
        reading: ["TA"],
        translation: ["field"],
      });
      // And after a save that changed one of them: the next save carries the
      // new value, not what the file held when the editor opened.
      await showFields();
      await fill("reading", "KA");
      await browser.keys(["Control", "s"]);
      await browser.waitUntil(async () =>
        (await fieldsOf("Kept.ink.png")).reading.includes("KA"),
      );
      await surface().click();
      await draw([
        [0.2, 0.3],
        [0.3, 0.6],
      ]);
      await saveAndClose();
      expect(await fieldsOf("Kept.ink.png")).toEqual({
        reading: ["KA"],
        translation: ["field"],
      });
    });

    it("asks before losing what was typed, and a draft keeps it", async function () {
      await symbolWith("Typed.ink.png", { reading: ["TA"] });
      await editFile("Typed.ink.png");
      await showFields();
      await fill("reading", "KA");
      await browser.keys(["Escape"]);
      expect(await topButton("Discard")).toBeDefined();
      await clickTop("Keep drawing");
      await restartInkline();
      await editFile("Typed.ink.png");
      await clickTop("Restore");
      await area("reading").waitForDisplayed();
      expect(await area("reading").getValue()).toBe("KA");
      await saveAndClose();
      expect((await fieldsOf("Typed.ink.png")).reading).toEqual(["KA"]);
    });

    it("starts the next symbol empty, with the fields still showing", async function () {
      await newSymbol();
      await draw([
        [0.3, 0.3],
        [0.5, 0.6],
      ]);
      await showFields();
      await fill("reading", "TA");
      await markEditor();
      await browser.$('[data-inkline-button="next"]').click();
      await waitForNext(1);
      expect(await area("reading").isDisplayed()).toBe(true);
      expect(await area("reading").getValue()).toBe("");
      expect(await area("translation").getValue()).toBe("");
    });

    it("refuses a list over the format's limit, and saves one at it", async function () {
      await symbolWith("Limit.ink.png", {});
      await editFile("Limit.ink.png");
      await draw([
        [0.3, 0.3],
        [0.5, 0.6],
      ]);
      await showFields();
      const before = await bytesOf("Limit.ink.png");
      await paste("reading", "é".repeat(2048) + "x");
      await browser.$('[data-inkline-button="save"]').click();
      await waitForStatus("Not saved");
      expect(await browser.$(".inkline-text-error").getText()).toContain(
        "4096",
      );
      expect(await bytesOf("Limit.ink.png")).toBe(before);
      await paste("reading", "é".repeat(2048));
      await saveAndClose();
      expect((await fieldsOf("Limit.ink.png")).reading).toEqual([
        "é".repeat(2048),
      ]);
    });

    it("keeps each line's direction in a field, and isolates values on the button", async function () {
      const hebrew = "שלום";
      await symbolWith("Right.ink.png", { reading: [hebrew, "TA"] });
      await editFile("Right.ink.png");
      expect(await toggle().$("bdi").getText()).toBe(hebrew);
      await showFields();
      const style = await browser.execute(() => {
        const field = document.querySelector("textarea");
        return field === null ? "" : getComputedStyle(field).unicodeBidi;
      });
      expect(style).toBe("plaintext");
      expect(await area("reading").getValue()).toBe(`${hebrew}\nTA`);
    });

    it("follows a change on disk to a field nobody typed in", async function () {
      await symbolWith("Sync.ink.png", {
        reading: ["TA"],
        translation: ["field"],
      });
      await editFile("Sync.ink.png");
      await showFields();
      await fill("translation", "plot");
      await changeOnDisk("Sync.ink.png", { reading: ["KA"] });
      await browser.waitUntil(
        async () => (await area("reading").getValue()) === "KA",
      );
      // What was typed in the other stays, and no question came up.
      expect(await area("translation").getValue()).toBe("plot");
      expect(await topButton("Keep mine")).toBeUndefined();
      await saveAndClose();
      expect(await fieldsOf("Sync.ink.png")).toEqual({
        reading: ["KA"],
        translation: ["plot"],
      });
    });

    it("asks when the drawing changed and a field typed in did, and Keep mine keeps both", async function () {
      await symbolWith("Clash.ink.png", {
        reading: ["TA"],
        translation: ["field"],
      });
      await editFile("Clash.ink.png");
      await showFields();
      await fill("reading", "typed");
      await redrawOnDisk("Clash.ink.png", {
        reading: ["theirs"],
        translation: ["plot"],
      });
      await clickTop("Keep mine");
      await browser.waitUntil(
        async () => (await area("translation").getValue()) === "plot",
      );
      expect(await area("reading").getValue()).toBe("typed");
      await saveAndClose();
      expect(await fieldsOf("Clash.ink.png")).toEqual({
        reading: ["typed"],
        translation: ["plot"],
      });
    });

    it("takes the file's values in a field it changed when told to Reload", async function () {
      await symbolWith("Reload.ink.png", {
        reading: ["TA"],
        translation: ["field"],
      });
      await editFile("Reload.ink.png");
      await showFields();
      await fill("reading", "typed");
      await fill("translation", "kept");
      await redrawOnDisk("Reload.ink.png", { reading: ["theirs"] });
      await clickTop("Reload");
      await browser.waitUntil(
        async () => (await area("reading").getValue()) === "theirs",
      );
      expect(await area("translation").getValue()).toBe("kept");
    });

    it("gives a file with no record its text, and keeps it", async function () {
      const bytes = await readFile(path.join(fixtures, "v1-strokes.ink.png"));
      await browser.executeObsidian(async ({ app }, data) => {
        const { inkFile, png, text } = window.inklineTest;
        const file = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const plain = png.writeChunks(
          png
            .readChunks(file)
            .filter(({ type }) => type !== inkFile.recordChunkType),
        );
        const said = await text.writeText(plain, "reading", ["TA"]);
        await app.vault.createBinary("Plain.ink.png", said.slice().buffer);
      }, toBase64(bytes));
      await editFile("Plain.ink.png");
      expect(await toggle().getText()).toContain("TA");
      await saveAndClose();
      expect((await fieldsOf("Plain.ink.png")).reading).toEqual(["TA"]);
      expect(await recordOf("Plain.ink.png")).toContain("strokes");
    });

    it("leaves a copy's text with the symbol it came from, and says so", async function () {
      await symbolWith("Source.ink.png", { reading: ["TA"] });
      await newSymbol();
      await browser.$('[data-inkline-button="copy"]').click();
      await browser.$(".prompt-input").waitForExist();
      await browser.$(".prompt-input").setValue("Source");
      await browser.keys(["Enter"]);
      await waitForStatus("without its readings and translations");
      expect(await toggle().getText()).toBe("Readings and translations");
      await saveAndClose();
      const made = (await symbolFiles()).find(
        (file) => file !== "Source.ink.png",
      );
      if (made === undefined) throw new Error("no copy saved");
      expect(await fieldsOf(made)).toEqual({ reading: [], translation: [] });
      expect((await fieldsOf("Source.ink.png")).reading).toEqual(["TA"]);
    });
  });
});
