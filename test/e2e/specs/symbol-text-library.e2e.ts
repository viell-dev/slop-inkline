// A symbol's readings and translations in real Obsidian, shown and changed in
// the library, with every other byte of the file kept. What the file holds is
// read back with the format's own code, in Obsidian's Chromium. All the text is
// synthetic.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { loadModules, toBase64 } from "../support/browser.ts";
import { editFile } from "../support/editing.ts";
import {
  createSymbol,
  openAtMarker,
  startOver,
  symbolFiles,
} from "../support/editor.ts";
import { type } from "../support/insertion.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import {
  formError,
  formSave,
  openFields,
  row,
  showLibrary,
  shownValues,
  waitForClosedForm,
  waitForRow,
  waitForValues,
} from "../support/symbol-text-library.ts";
import {
  area,
  changeOnDisk,
  fieldsOf,
  fill,
  fixtures,
  makeNote,
  noteFile,
  paste,
  showFields,
  symbolWith,
} from "../support/symbol-text.ts";
import { bytesOf } from "../support/vault-files.ts";
import { waitOrSay } from "../support/waits.ts";

/**
 * Each of a file's chunks that are not its fields, as text to compare, with its
 * CRC, read straight from the bytes, so that a sealed-again chunk shows.
 */
async function otherChunks(file: string): Promise<string[]> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const bytes = new Uint8Array(await app.vault.readBinary(found));
    const view = new DataView(bytes.buffer);
    const chunks: string[] = [];
    let at = 8;
    while (at < bytes.length) {
      const length = view.getUint32(at);
      const end = at + 12 + length;
      const chunk = bytes.subarray(at, end);
      const keyword = new TextDecoder().decode(chunk.subarray(8, 8 + 20));
      if (!keyword.startsWith("Inkline ")) chunks.push(chunk.join(","));
      at = end;
    }
    return chunks;
  }, file);
}
const formNote = () => browser.$(".inkline-text-note");

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

  describe("in the library", function () {
    /** The height of the row for `file`, in pixels. */
    async function rowHeight(file: string): Promise<number> {
      const { height } = await row(file).getSize();
      return height;
    }

    it("shows what a symbol holds under its row, and leaves one with none as it was", async function () {
      await symbolWith("past tense.ink.png", {});
      await symbolWith("Said.ink.png", {
        reading: ["TA", "DA"],
        translation: ["field"],
      });
      await showLibrary();
      await waitForValues("Said.ink.png", "Readings: TA, DA");
      await waitForValues("Said.ink.png", "Translation: field");
      expect(await shownValues("past tense.ink.png")).toBe("");
      // A row with none is as tall as one was before this feature.
      expect(await rowHeight("past tense.ink.png")).toBeLessThan(40);
      expect(await row("Said.ink.png").$("bdi").getText()).toBe("TA");
    });

    for (const theme of ["moonstone", "obsidian"]) {
      it(`stays inside the default sidebar in the ${theme} theme`, async function () {
        await browser.executeObsidian(({ app }, wanted) => {
          const change: unknown = Reflect.get(app, "changeTheme");
          if (typeof change !== "function") throw new Error("no themes");
          change.call(app, wanted);
        }, theme);
        try {
          await symbolWith("past tense.ink.png", {});
          await symbolWith("a name long enough to wrap in its row.ink.png", {
            reading: [
              "TA",
              "DA",
              "ta-a",
              "THA",
              "dha",
              "ṭa",
              "ḍa",
              "tʰa",
              "d̪a",
            ],
            translation: ["a very long translation that the row must shorten"],
          });
          await symbolWith("Said.ink.png", {
            reading: ["KA"],
            translation: ["rice field", "שלום"],
          });
          await showLibrary();
          await waitForValues("Said.ink.png", "Reading: KA");
          await waitForValues(
            "a name long enough to wrap in its row.ink.png",
            "and 1 more",
          );
          const sizes = await browser.execute(() => {
            const list = document.querySelector(".inkline-library-list");
            const view = document.querySelector(".inkline-library");
            return {
              list: [list?.scrollWidth ?? 0, list?.clientWidth ?? 0],
              view: [view?.scrollWidth ?? 0, view?.clientWidth ?? 0],
            };
          });
          expect(sizes.list[0]).toBeLessThanOrEqual(sizes.list[1] ?? 0);
          expect(sizes.view[0]).toBeLessThanOrEqual(sizes.view[1] ?? 0);
          await saveScreenshot(`text-library-${theme}`);
          await browser.$(".inkline-library-search").setValue("rice");
          await browser.waitUntil(
            async () =>
              (await browser.$$(".inkline-library-symbol").length) === 1,
          );
          await saveScreenshot(`text-library-found-${theme}`);
          await browser.$(".inkline-library-search").click();
          await browser.keys(["Control", "a"]);
          await browser.keys(["Delete"]);
          await openFields("Said.ink.png");
          await saveScreenshot(`text-library-form-${theme}`);
          await browser.keys(["Escape"]);
          await waitForClosedForm();
          await editFile("Said.ink.png");
          await saveScreenshot(`text-editor-values-${theme}`);
          await showFields();
          await saveScreenshot(`text-editor-open-${theme}`);
          await browser.keys(["Escape"]);
          await browser.$(".inkline-editor").waitForExist({ reverse: true });
          await openAtMarker(noteFile, "HERE");
          await type(";;rice");
          await waitForRow("Said");
          await saveScreenshot(`text-suggest-${theme}`);
          await browser.keys(["Escape"]);
        } finally {
          await browser.executeObsidian(({ app }) => {
            const change: unknown = Reflect.get(app, "changeTheme");
            if (typeof change !== "function") throw new Error("no themes");
            change.call(app, "moonstone");
          });
        }
      });
    }

    it("changes only the text chunks, and no note", async function () {
      await symbolWith("Guess.ink.png", { reading: ["TA"] });
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.create("Uses.md", "Read ![[Guess.ink.png]] here.\n");
      });
      await browser.waitUntil(async () =>
        browser.executeObsidian(
          ({ app }) =>
            (app.metadataCache.resolvedLinks["Uses.md"]?.["Guess.ink.png"] ??
              0) > 0,
        ),
      );
      const before = await otherChunks("Guess.ink.png");
      const note = await browser.executeObsidian(({ app }) => {
        const file = app.vault.getFileByPath("Uses.md");
        return file === null ? 0 : file.stat.mtime;
      });
      await showLibrary();
      await openFields("Guess.ink.png");
      await saveScreenshot("text-library-form");
      expect(await area("reading").getValue()).toBe("TA");
      await fill("reading", "KA\nGA");
      await fill("translation", "plot");
      await formSave().click();
      await waitForClosedForm();
      await waitForValues("Guess.ink.png", "Readings: KA, GA");
      expect(await fieldsOf("Guess.ink.png")).toEqual({
        reading: ["KA", "GA"],
        translation: ["plot"],
      });
      expect(await otherChunks("Guess.ink.png")).toEqual(before);
      // The focus comes back to what opened the fields.
      expect(
        await browser.execute(() =>
          document.activeElement?.getAttribute("data-inkline-role"),
        ),
      ).toBe("edit");
      const after = await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("Uses.md");
        return file === null
          ? undefined
          : { mtime: file.stat.mtime, text: await app.vault.read(file) };
      });
      expect(after).toEqual({
        mtime: note,
        text: "Read ![[Guess.ink.png]] here.\n",
      });
      expect(await symbolFiles()).toEqual(["Guess.ink.png"]);
    });

    it("clears a field, and writes nothing when nothing changed", async function () {
      await symbolWith("Clear.ink.png", {
        reading: ["TA"],
        translation: ["field"],
      });
      await showLibrary();
      await openFields("Clear.ink.png");
      const before = await bytesOf("Clear.ink.png");
      await formSave().click();
      await waitForClosedForm();
      expect(await bytesOf("Clear.ink.png")).toBe(before);
      await openFields("Clear.ink.png");
      await area("reading").click();
      await browser.keys(["Control", "a"]);
      await browser.keys(["Delete"]);
      // The focus is what Mod+Enter answers to.
      await browser.keys(["Control", "Enter"]);
      await waitForClosedForm();
      expect(await fieldsOf("Clear.ink.png")).toEqual({
        reading: [],
        translation: ["field"],
      });
    });

    it("cancels with Esc, and Enter starts another value", async function () {
      await symbolWith("Keys.ink.png", { reading: ["TA"] });
      await showLibrary();
      await openFields("Keys.ink.png");
      await area("reading").click();
      await browser.keys(["End", "Enter", "K", "A"]);
      expect(await area("reading").getValue()).toBe("TA\nKA");
      await browser.keys(["Escape"]);
      await waitForClosedForm();
      expect((await fieldsOf("Keys.ink.png")).reading).toEqual(["TA"]);
    });

    for (const kind of ["no record", "a damaged record"] as const) {
      it(`works on a file with ${kind}, keeping every other byte`, async function () {
        const bytes = await readFile(path.join(fixtures, "v1-strokes.ink.png"));
        await browser.executeObsidian(
          async ({ app }, data, wanted) => {
            const { inkFile, png } = window.inklineTest;
            const file = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
            const chunks = png.readChunks(file);
            const isRecord = ({ type }: { type: string }): boolean =>
              type === inkFile.recordChunkType;
            const record = chunks.find(isRecord);
            if (record === undefined) throw new Error("no record");
            const odd = file.slice();
            // A flipped bit, with the CRC left wrong.
            const at = record.data.byteOffset - file.byteOffset + 8;
            odd[at] = (odd[at] ?? 0) ^ 0x10;
            await app.vault.createBinary(
              "Odd.ink.png",
              wanted === "no record"
                ? png.writeChunks(chunks.filter((each) => !isRecord(each)))
                    .buffer
                : odd.buffer,
            );
          },
          toBase64(bytes),
          kind,
        );
        const before = await otherChunks("Odd.ink.png");
        await showLibrary();
        await openFields("Odd.ink.png");
        await fill("reading", "TA");
        await formSave().click();
        await waitForClosedForm();
        expect((await fieldsOf("Odd.ink.png")).reading).toEqual(["TA"]);
        expect(await otherChunks("Odd.ink.png")).toEqual(before);
      });
    }

    it("refuses the text of a file that is not a whole PNG, and leaves it, though it can rename it", async function () {
      const bytes = await readFile(path.join(fixtures, "v1-strokes.ink.png"));
      await browser.executeObsidian(async ({ app }, data) => {
        const file = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        await app.vault.createBinary(
          "Cut.ink.png",
          file.subarray(0, file.length - 20).slice().buffer,
        );
      }, toBase64(bytes));
      const before = await bytesOf("Cut.ink.png");
      await showLibrary();
      await row("Cut.ink.png").$('[data-inkline-role="edit"]').click();
      await browser.waitUntil(async () =>
        (await formError().getText()).includes("not a whole PNG"),
      );
      // Its fields cannot be typed in, and its name can change.
      expect(await area("reading").getProperty("readOnly")).toBe(true);
      expect(await formSave().isEnabled()).toBe(true);
      await browser.keys(["Escape"]);
      await waitForClosedForm();
      expect(await bytesOf("Cut.ink.png")).toBe(before);
      await row("Cut.ink.png").$('[data-inkline-role="edit"]').click();
      await browser.waitUntil(async () => formSave().isEnabled());
      await browser.$(".inkline-library-edit-form input").setValue("Whole");
      await browser.keys(["Enter"]);
      await waitForClosedForm();
      expect(await symbolFiles()).toEqual(["Whole.ink.png"]);
      expect(await bytesOf("Whole.ink.png")).toBe(before);
    });

    it("keeps a list it cannot read, behind the value typed", async function () {
      await createSymbol("Later.ink.png");
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("Later.ink.png");
        if (file === null) throw new Error("no file");
        const { png } = window.inklineTest;
        const bytes = new Uint8Array(await app.vault.readBinary(file));
        const chunks = png.readChunks(bytes);
        // A control character is one no value of this revision may hold.
        const data = new TextEncoder().encode("Inkline reading\0\0\0\0\0a\tb");
        await app.vault.modifyBinary(
          file,
          png.writeChunks([
            ...chunks.slice(0, 1),
            { type: "iTXt", data },
            ...chunks.slice(1),
          ]).buffer,
        );
      });
      await showLibrary();
      await openFields("Later.ink.png");
      expect(await area("reading").getValue()).toBe("");
      await fill("reading", "TA");
      await formSave().click();
      await waitForClosedForm();
      const held = await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("Later.ink.png");
        if (file === null) throw new Error("no file");
        const { png } = window.inklineTest;
        const bytes = new Uint8Array(await app.vault.readBinary(file));
        return png
          .readChunks(bytes)
          .filter(({ type }) => type === "iTXt")
          .map(({ data }) => new TextDecoder().decode(data));
      });
      expect(held).toEqual([
        "Inkline reading\0\0\0\0\0TA",
        "Inkline reading\0\0\0\0\0a\tb",
      ]);
    });

    it("follows a sync tool's change to a field nobody typed in, and warns of a clash", async function () {
      await symbolWith("Synced.ink.png", {
        reading: ["TA"],
        translation: ["field"],
      });
      await showLibrary();
      await openFields("Synced.ink.png");
      await fill("translation", "typed");
      await changeOnDisk("Synced.ink.png", { reading: ["KA"] });
      await browser.waitUntil(
        async () => (await area("reading").getValue()) === "KA",
      );
      expect(await area("translation").getValue()).toBe("typed");
      expect(await formNote().getText()).toBe("");
      await changeOnDisk("Synced.ink.png", { translation: ["theirs"] });
      await browser.waitUntil(async () =>
        (await formNote().getText()).includes("theirs"),
      );
      expect(await area("translation").getValue()).toBe("typed");
      await saveScreenshot("text-library-clash");
      // A later change leaves the warning, with what the file now says.
      await changeOnDisk("Synced.ink.png", {
        reading: ["GA"],
        translation: ["newer"],
      });
      await browser.waitUntil(
        async () => (await area("reading").getValue()) === "GA",
      );
      await changeOnDisk("Synced.ink.png", { reading: ["KA"] });
      await browser.waitUntil(
        async () => (await area("reading").getValue()) === "KA",
      );
      expect(await formNote().getText()).toContain("newer");
      await formSave().click();
      await waitForClosedForm();
      expect(await fieldsOf("Synced.ink.png")).toEqual({
        reading: ["KA"],
        translation: ["typed"],
      });
    });

    it("never writes over a change it has not shown", async function () {
      await symbolWith("Raced.ink.png", { reading: ["TA"] });
      await showLibrary();
      await openFields("Raced.ink.png");
      await fill("reading", "typed");
      // The change lands with the vault telling nobody until the save reads.
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("Raced.ink.png");
        if (file === null) throw new Error("no file");
        const { text } = window.inklineTest;
        const read = app.vault.readBinary.bind(app.vault);
        const bytes = await text.writeText(
          new Uint8Array(await read(file)),
          "reading",
          ["theirs"],
        );
        const buffer = bytes.slice().buffer;
        app.vault.readBinary = () => {
          app.vault.readBinary = read;
          return Promise.resolve(buffer);
        };
      });
      await formSave().click();
      await browser.waitUntil(async () =>
        (await formNote().getText()).includes("theirs"),
      );
      expect((await fieldsOf("Raced.ink.png")).reading).toEqual(["TA"]);
      expect(await area("reading").getValue()).toBe("typed");
    });

    it("says so when the file goes while its fields are open", async function () {
      await symbolWith("Gone.ink.png", { reading: ["TA"] });
      await showLibrary();
      await openFields("Gone.ink.png");
      await fill("reading", "typed");
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("Gone.ink.png");
        if (file !== null) await app.fileManager.trashFile(file);
      });
      await browser.waitUntil(async () =>
        (await formError().getText()).includes("no longer in the vault"),
      );
      expect(await area("reading").getValue()).toBe("typed");
      expect(await formSave().isEnabled()).toBe(false);
    });

    it("takes a value at the format's limit, and refuses one over it", async function () {
      await symbolWith("Long.ink.png", {});
      await showLibrary();
      await openFields("Long.ink.png");
      const before = await bytesOf("Long.ink.png");
      await paste("reading", "x".repeat(4097));
      await formSave().click();
      await browser.waitUntil(async () =>
        (await browser.$(".inkline-text-error").getText()).includes("4096"),
      );
      expect(await bytesOf("Long.ink.png")).toBe(before);
      await paste("reading", "x".repeat(4096));
      await formSave().click();
      await waitForClosedForm();
      expect((await fieldsOf("Long.ink.png")).reading).toEqual([
        "x".repeat(4096),
      ]);
      await waitForValues("Long.ink.png", "Reading: xxx");
      // The row stays one line, and the list does not scroll sideways.
      const sizes = await browser.execute(() => {
        const list = document.querySelector(".inkline-library-list");
        const line = document.querySelector(".inkline-library-values");
        return {
          scroll: list?.scrollWidth ?? 0,
          client: list?.clientWidth ?? 0,
          line: line?.getBoundingClientRect().height ?? 0,
        };
      });
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
      expect(sizes.line).toBeLessThan(24);
      await saveScreenshot("text-library-long");
    });

    it("keeps a value's direction to itself", async function () {
      // An override that, outside an isolate, would take what follows with it.
      const hostile = `${String.fromCharCode(0x202e)}abc`;
      await symbolWith("Bidi.ink.png", {
        reading: [hostile, "second"],
        translation: ["שלום", '<img src="x">'],
      });
      await showLibrary();
      await waitForValues("Bidi.ink.png", "second");
      // A value is text, never markup.
      await waitForValues("Bidi.ink.png", '<img src="x">');
      expect(
        await row("Bidi.ink.png").$(".inkline-values img").isExisting(),
      ).toBe(false);
      const order = await browser.execute(() => {
        const values = document.querySelectorAll(".inkline-library-values bdi");
        const box = (index: number) =>
          values[index]?.getBoundingClientRect().left ?? 0;
        return { first: box(0), second: box(1), kind: values[0]?.tagName };
      });
      expect(order.kind).toBe("BDI");
      expect(order.first).toBeLessThan(order.second);
      await saveScreenshot("text-library-bidi");
    });

    it("draws a large list in steps, and finds what is past the first", async function () {
      this.timeout(120_000);
      await browser.executeObsidian(async ({ app }) => {
        const { canvas, text } = window.inklineTest;
        const { bytes } = await canvas.saveInk({ strokes: [] }, undefined, []);
        for (let at = 0; at < 250; at++) {
          const said =
            at === 249
              ? await text.writeText(bytes, "reading", ["last"])
              : bytes;
          await app.vault.createBinary(
            `Row ${String(at).padStart(3, "0")}.ink.png`,
            said.slice().buffer,
          );
        }
      });
      await showLibrary();
      const rowCount = () => browser.$$(".inkline-library-symbol").length;
      const waitForCount = async (count: number): Promise<void> => {
        let rows = -1;
        await waitOrSay(
          async () => {
            rows = await rowCount();
            return rows === count;
          },
          () => `not ${String(count)} rows, but ${String(rows)}`,
        );
      };
      const more = () => browser.$(".inkline-library-more");
      const focusMore = async (): Promise<void> => {
        await browser.execute(() => {
          document.querySelector<HTMLElement>(".inkline-library-more")?.focus();
        });
      };
      /** What has the focus, and whether it shows in the list. */
      const focused = () =>
        browser.execute(() => {
          const active = document.activeElement;
          const box = active?.getBoundingClientRect();
          const pane = document
            .querySelector(".inkline-library")
            ?.getBoundingClientRect();
          return {
            role: active?.getAttribute("data-inkline-role") ?? null,
            path:
              active
                ?.closest("[data-inkline-path]")
                ?.getAttribute("data-inkline-path") ?? null,
            shows:
              box !== undefined &&
              pane !== undefined &&
              box.top >= pane.top &&
              box.top < pane.bottom,
          };
        });
      await waitForCount(100);
      expect(await more().getText()).toBe("Show more: 150 left");
      // By the keyboard, the focus goes on from the first new row.
      await focusMore();
      await browser.keys(["Enter"]);
      await waitForCount(200);
      expect(await focused()).toEqual({
        role: "insert",
        path: "Row 100.ink.png",
        shows: true,
      });
      expect(await more().getText()).toBe("Show more: 50 left");
      // A redraw that nobody asked for leaves it on the button.
      await focusMore();
      await changeOnDisk("Row 000.ink.png", { reading: ["again"] });
      await waitForValues("Row 000.ink.png", "again");
      expect((await focused()).role).toBe("more");
      // With nothing left to show, the same, by the mouse this time.
      await more().click();
      await waitForCount(250);
      expect(await more().isExisting()).toBe(false);
      expect(await focused()).toEqual({
        role: "insert",
        path: "Row 200.ink.png",
        shows: true,
      });
      await browser.$(".inkline-library-search").setValue("last");
      await waitForCount(1);
    });

    it("lets a name and a reading disagree, through a rename too", async function () {
      await symbolWith("ka.ink.png", { reading: ["TA"] });
      await showLibrary();
      await waitForValues("ka.ink.png", "Reading: TA");
      await openFields("ka.ink.png");
      await browser.$(".inkline-library-edit-form input").setValue("ga");
      await browser.keys(["Enter"]);
      await waitForValues("ga.ink.png", "Reading: TA");
      expect((await fieldsOf("ga.ink.png")).reading).toEqual(["TA"]);
    });
  });
});
