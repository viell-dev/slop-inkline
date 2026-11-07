// A symbol's readings and translations in real Obsidian: filling them in from
// the editor and the library, finding a symbol by them in every list, and the
// index that remembers them. What the file holds is read back with the format's
// own code, in Obsidian's Chromium. All the text is synthetic.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { loadModules, toBase64 } from "../support/browser.ts";
import {
  clickTop,
  createSymbol,
  delayVault,
  draw,
  markEditor,
  openAtMarker,
  recordOf,
  restoreVault,
  startOver,
  surface,
  symbolFiles,
  topButton,
  waitForEditor,
  waitForNext,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/format");

const noteFile = "Note.md";

/** Fields to give a symbol. */
interface Fields {
  readonly reading?: readonly string[];
  readonly translation?: readonly string[];
}

/** What a file's fields say, from the file itself. */
async function fieldsOf(file: string): Promise<{
  reading: readonly string[];
  translation: readonly string[];
}> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const { png, text } = window.inklineTest;
    const bytes = new Uint8Array(await app.vault.readBinary(found));
    return text.readText(png.readChunks(bytes));
  }, file);
}

/** Changes a file's fields as a sync tool would, behind Inkline's back. */
async function changeOnDisk(file: string, fields: Fields): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, wanted, { reading, translation }) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const { text } = window.inklineTest;
      let bytes: Uint8Array = new Uint8Array(await app.vault.readBinary(found));
      if (reading !== undefined) {
        bytes = await text.writeText(bytes, "reading", reading);
      }
      if (translation !== undefined) {
        bytes = await text.writeText(bytes, "translation", translation);
      }
      await app.vault.modifyBinary(found, bytes.slice().buffer);
    },
    file,
    fields,
  );
}

/** A symbol at `file` that says `fields` about itself. */
async function symbolWith(
  file: string,
  fields: Fields,
  xs?: readonly number[],
): Promise<void> {
  await createSymbol(file, xs);
  await changeOnDisk(file, fields);
}

/** The bytes of a file, as text to compare. */
async function bytesOf(file: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    return Array.from(new Uint8Array(await app.vault.readBinary(found))).join(
      ",",
    );
  }, file);
}

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

/** Opens the library in the right sidebar. */
async function showLibrary(): Promise<void> {
  await browser.executeObsidianCommand("inkline:show-library");
  await browser.$(".inkline-library-list").waitForExist();
}

/** The library's row for the symbol at `file`. */
function row(file: string): ReturnType<typeof browser.$> {
  return browser.$(`.inkline-library-symbol[data-inkline-path="${file}"]`);
}

/** What the row for `file` shows of its values. */
async function shownValues(file: string): Promise<string> {
  const line = row(file).$(".inkline-library-values");
  return (await line.isExisting()) ? await line.getText() : "";
}

/** Waits for the row of `file` to show `text` among its values. */
async function waitForValues(file: string, text: string): Promise<void> {
  let shown = "";
  try {
    await browser.waitUntil(async () => {
      shown = await shownValues(file);
      return shown.includes(text);
    });
  } catch (error) {
    throw new Error(`waited for "${text}" in ${file}, and saw "${shown}"`, {
      cause: error,
    });
  }
}

/** A text area of the form or editor open now. */
function area(field: "reading" | "translation"): ReturnType<typeof browser.$> {
  return browser.$(`textarea[data-inkline-field="${field}"]`);
}

/** Opens the library's fields for `file`, once they have read the file. */
async function openFields(file: string): Promise<void> {
  await row(file).$('[data-inkline-role="text"]').click();
  await browser.waitUntil(async () => {
    const save = formSave();
    return (await save.isExisting()) && (await save.isEnabled());
  });
}

const formSave = () => browser.$(".inkline-library-text-buttons button");
const formError = () => browser.$(".inkline-library-rename-error");
const formNote = () => browser.$(".inkline-library-text-note");

/** The form's fields are gone, as after a save or a cancel. */
async function waitForClosedForm(): Promise<void> {
  await browser.$(".inkline-library-text-form").waitForExist({ reverse: true });
}

/** Sets a text area's value as typing would. */
async function fill(
  field: "reading" | "translation",
  text: string,
): Promise<void> {
  await area(field).setValue(text);
}

/**
 * Sets a text area's value as pasting does, in one change. A list at the format's
 * limit is thousands of keys, which take most of a test's time to send.
 */
async function paste(
  field: "reading" | "translation",
  text: string,
): Promise<void> {
  await browser.execute(
    (name, value) => {
      const found = document.querySelector<HTMLTextAreaElement>(
        `textarea[data-inkline-field="${name}"]`,
      );
      if (found === null) throw new Error(`no ${name}`);
      found.value = value;
      found.dispatchEvent(new Event("input", { bubbles: true }));
    },
    field,
    text,
  );
}

/** Opens the editor on a symbol file. */
async function editFile(file: string): Promise<void> {
  await browser.executeObsidian(({ app, plugins }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    void plugins.inkline.editSymbol(found);
  }, file);
  await waitForEditor();
}

/** Starts a new symbol in the note. */
async function newSymbol(): Promise<void> {
  await openAtMarker(noteFile, "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
}

const toggle = () => browser.$(".inkline-text-toggle");

/** Shows the editor's text fields. */
async function showFields(): Promise<void> {
  if ((await toggle().getAttribute("aria-expanded")) !== "true") {
    await toggle().click();
  }
  await area("reading").waitForDisplayed();
}

/** Saves and closes the editor. */
async function saveAndClose(): Promise<void> {
  await browser.$('[data-inkline-button="save"]').click();
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

/** What the open list shows: each row's name, and why it is there. */
async function rows(): Promise<{ name: string; why: string }[]> {
  return browser.execute(() =>
    Array.from(activeDocument.querySelectorAll(".suggestion-item")).map(
      (item) => ({
        name: item.querySelector(".inkline-suggestion-name")?.textContent ?? "",
        why: item.querySelector(".inkline-values")?.textContent ?? "",
      }),
    ),
  );
}

/** Waits for the open list to show a row named `name`, and returns the rows. */
async function waitForRow(
  name: string,
): Promise<{ name: string; why: string }[]> {
  let shown: { name: string; why: string }[] = [];
  try {
    await browser.waitUntil(async () => {
      shown = await rows();
      return shown.some((each) => each.name === name);
    });
  } catch (error) {
    throw new Error(`no row "${name}" among ${JSON.stringify(shown)}`, {
      cause: error,
    });
  }
  return shown;
}

/** Turns Inkline off and on, which reads every symbol again from nothing. */
async function restartInkline(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const plugins: unknown = Reflect.get(app, "plugins");
    if (typeof plugins !== "object" || plugins === null) {
      throw new Error("no plugins");
    }
    const disable: unknown = Reflect.get(plugins, "disablePlugin");
    const enable: unknown = Reflect.get(plugins, "enablePlugin");
    if (typeof disable !== "function" || typeof enable !== "function") {
      throw new Error("no plugin controls");
    }
    await (disable.call(plugins, "inkline") as Promise<void>);
    await (enable.call(plugins, "inkline") as Promise<void>);
  });
}

/** Types `text` a key at a time, as a person does. */
async function type(text: string): Promise<void> {
  for (const key of text) await browser.keys([key]);
}

/** Saves the library's fields, under an editor or not. */
function saveFields(): void {
  document
    .querySelector<HTMLFormElement>(".inkline-library-text-form")
    ?.requestSubmit();
}

/** Saves the editor. */
function saveEditor(): void {
  document.querySelector<HTMLElement>('[data-inkline-button="save"]')?.click();
}

/**
 * Has the next write to the vault start the other of the two saves, and go on
 * only `ms` later, so that the other has every chance to come between its read
 * and its write. `other` says which: `fields` or `editor`.
 */
async function atNextWrite(
  other: "fields" | "editor",
  ms: number,
): Promise<void> {
  await browser.executeObsidian(
    ({ app }, which, wait) => {
      const write = app.vault.modifyBinary.bind(app.vault);
      app.vault.modifyBinary = async (...args) => {
        app.vault.modifyBinary = write;
        if (which === "fields") {
          document
            .querySelector<HTMLFormElement>(".inkline-library-text-form")
            ?.requestSubmit();
        } else {
          document
            .querySelector<HTMLElement>('[data-inkline-button="save"]')
            ?.click();
        }
        await new Promise((resolve) => window.setTimeout(resolve, wait));
        return write(...args);
      };
    },
    other,
    ms,
  );
}

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

/** Puts a note in place, and waits until Obsidian can open it. */
async function makeNote(text = "Write HERE on.\n"): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, file, body) => {
      await app.vault.create(file, body);
    },
    noteFile,
    text,
  );
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

  after(async function () {
    await startOver();
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

    it("asks when the file changed a field that was typed in, and Keep mine keeps both", async function () {
      await symbolWith("Clash.ink.png", {
        reading: ["TA"],
        translation: ["field"],
      });
      await editFile("Clash.ink.png");
      await showFields();
      await fill("reading", "typed");
      await changeOnDisk("Clash.ink.png", {
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
      await changeOnDisk("Reload.ink.png", { reading: ["theirs"] });
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
        await symbolWith("past tense.ink.png", {});
        await symbolWith("a name long enough to wrap in its row.ink.png", {
          reading: ["TA", "DA", "ta-a", "THA", "dha", "ṭa", "ḍa", "tʰa", "d̪a"],
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
        await browser.executeObsidian(({ app }) => {
          const change: unknown = Reflect.get(app, "changeTheme");
          if (typeof change !== "function") throw new Error("no themes");
          change.call(app, "moonstone");
        });
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
      ).toBe("text");
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

    it("refuses a file that is not a whole PNG, and leaves it", async function () {
      const bytes = await readFile(path.join(fixtures, "v1-strokes.ink.png"));
      await browser.executeObsidian(async ({ app }, data) => {
        const file = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        await app.vault.createBinary(
          "Cut.ink.png",
          file.subarray(0, file.length - 20).slice().buffer,
        );
      }, toBase64(bytes));
      await showLibrary();
      await row("Cut.ink.png").$('[data-inkline-role="text"]').click();
      await browser.waitUntil(async () =>
        (await formError().getText()).includes("not a whole PNG"),
      );
      expect(await formSave().isEnabled()).toBe(false);
      await browser.keys(["Escape"]);
      await waitForClosedForm();
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

    /**
     * Opens `file`'s fields in two libraries, types each value in its own, and
     * saves both at once, with each write taking long enough for the other to
     * read the file first, if nothing stops it.
     */
    async function saveTwice(
      file: string,
      first: readonly [field: string, text: string],
      second: readonly [field: string, text: string],
    ): Promise<void> {
      await browser.executeObsidian(async ({ app }) => {
        await app.workspace
          .getLeaf("split")
          .setViewState({ type: "inkline-library", active: false });
      });
      const buttons = `.inkline-library-symbol[data-inkline-path="${file}"] [data-inkline-role="text"]`;
      await browser.waitUntil(
        async () => (await browser.$$(buttons).length) === 2,
      );
      const saves = ".inkline-library-text-buttons button[type=submit]";
      await browser.execute((selector) => {
        for (const button of document.querySelectorAll<HTMLElement>(selector)) {
          button.click();
        }
      }, buttons);
      await browser.waitUntil(async () =>
        browser.execute((selector) => {
          const found = document.querySelectorAll<HTMLButtonElement>(selector);
          return found.length === 2 && [...found].every((b) => !b.disabled);
        }, saves),
      );
      await delayVault("modifyBinary", 300, "before");
      await browser.execute(
        (values) => {
          const forms = document.querySelectorAll<HTMLFormElement>(
            ".inkline-library-text-form",
          );
          forms.forEach((form, index) => {
            const [field, text] = values[index] ?? [];
            const found = form.querySelector<HTMLTextAreaElement>(
              `textarea[data-inkline-field="${field ?? ""}"]`,
            );
            if (found === null) throw new Error("no field");
            found.value = text ?? "";
            found.dispatchEvent(new Event("input", { bubbles: true }));
          });
          for (const form of forms) form.requestSubmit();
        },
        [first, second],
      );
    }

    it("keeps both of two saves of one symbol, whichever writes last", async function () {
      await symbolWith("Both.ink.png", {
        reading: ["TA"],
        translation: ["field"],
      });
      await showLibrary();
      await saveTwice(
        "Both.ink.png",
        ["reading", "FIRST"],
        ["translation", "SECOND"],
      );
      await waitForClosedForm();
      await restoreVault();
      expect(await fieldsOf("Both.ink.png")).toEqual({
        reading: ["FIRST"],
        translation: ["SECOND"],
      });
    });

    it("refuses the later of two saves of one field, and shows what is there", async function () {
      await symbolWith("Same.ink.png", { reading: ["TA"] });
      await showLibrary();
      await saveTwice(
        "Same.ink.png",
        ["reading", "FIRST"],
        ["reading", "SECOND"],
      );
      await browser.waitUntil(async () =>
        (await formNote().getText()).includes("FIRST"),
      );
      await restoreVault();
      expect((await fieldsOf("Same.ink.png")).reading).toEqual(["FIRST"]);
      expect(await area("reading").getValue()).toBe("SECOND");
    });

    it("stops an editor's save that the library's went ahead of, until it is asked", async function () {
      await symbolWith("Library first.ink.png", {
        reading: ["TA"],
        translation: ["field"],
      });
      await showLibrary();
      await openFields("Library first.ink.png");
      await fill("reading", "typed");
      await editFile("Library first.ink.png");
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      const before = await recordOf("Library first.ink.png");
      // As the library starts to write, the editor saves too.
      await atNextWrite("editor", 300);
      await browser.execute(saveFields);
      await clickTop("Keep mine");
      await browser.$(".inkline-editor").waitForExist({ reverse: true });
      expect(await fieldsOf("Library first.ink.png")).toEqual({
        reading: ["typed"],
        translation: ["field"],
      });
      expect(await recordOf("Library first.ink.png")).not.toBe(before);
    });

    it("has the library's save build on an editor's that went ahead of it", async function () {
      await symbolWith("Editor first.ink.png", {
        reading: ["TA"],
        translation: ["field"],
      });
      await showLibrary();
      await openFields("Editor first.ink.png");
      await fill("reading", "typed");
      await editFile("Editor first.ink.png");
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      const before = await recordOf("Editor first.ink.png");
      // As the editor starts to write, the library saves too.
      await atNextWrite("fields", 300);
      await browser.execute(saveEditor);
      await waitForClosedForm();
      await browser.$(".inkline-editor").waitForExist({ reverse: true });
      expect(await fieldsOf("Editor first.ink.png")).toEqual({
        reading: ["typed"],
        translation: ["field"],
      });
      expect(await recordOf("Editor first.ink.png")).not.toBe(before);
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
        await browser.waitUntil(async () => (await rowCount()) === count, {
          timeoutMsg: `not ${String(count)} rows, but ${String(await rowCount())}`,
        });
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
      await row("ka.ink.png").$('[data-inkline-role="rename"]').click();
      await browser.$(".inkline-library-rename-form input").setValue("ga");
      await browser.keys(["Enter"]);
      await waitForValues("ga.ink.png", "Reading: TA");
      expect((await fieldsOf("ga.ink.png")).reading).toEqual(["TA"]);
    });
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
      const shown = await waitForRow("Anything at all");
      expect(shown).toEqual([
        { name: "Anything at all", why: "Translation: rice field" },
      ]);
      await type("ood");
      await browser.waitUntil(async () => (await rows()).length === 0);
    });

    it("needs no accents to find a value that has them, and a value holds what was typed", async function () {
      await indexed();
      await openAtMarker(noteFile, "HERE");
      await type(";;sa");
      await browser.waitUntil(async () =>
        (await rows()).some(({ why }) => why === "Reading: šá"),
      );
      await browser.keys(["Escape"]);
      await type(" ;;ida");
      // Letters of `rice field` in order, but not together.
      await browser.waitUntil(async () => (await rows()).length === 0);
    });

    it("tells a voiced kana from the plain one, in the lists and the library", async function () {
      await symbolWith("One.ink.png", { reading: ["は"] });
      await symbolWith("Two.ink.png", { reading: ["ば"] });
      await symbolWith("Three.ink.png", { reading: ["ぱ"] });
      await indexed();
      await waitForValues("Three.ink.png", "ぱ");
      const search = browser.$(".inkline-library-search");
      /** The rows the filter leaves, by path. */
      const left = () =>
        browser.execute(() =>
          Array.from(document.querySelectorAll(".inkline-library-symbol")).map(
            (found) => found.getAttribute("data-inkline-path"),
          ),
        );
      for (const [typed, file] of [
        ["は", "One.ink.png"],
        ["ば", "Two.ink.png"],
        ["ぱ", "Three.ink.png"],
      ] as const) {
        await search.setValue(typed);
        await browser.waitUntil(
          async () => JSON.stringify(await left()) === JSON.stringify([file]),
          { timeoutMsg: `${typed} did not leave only ${file}` },
        );
      }
      await search.setValue("sa");
      await browser.waitUntil(
        async () =>
          JSON.stringify(await left()) ===
          JSON.stringify(["Anything at all.ink.png"]),
      );
      await search.setValue("");
      await openAtMarker(noteFile, "HERE");
      await browser.executeObsidianCommand("inkline:insert-existing-symbol");
      await browser.$(".prompt-input").waitForExist();
      await browser.$(".prompt-input").setValue("は");
      await waitForRow("One");
      expect(await rows()).toEqual([{ name: "One", why: "Reading: は" }]);
      await browser.keys(["Escape"]);
    });

    it("finds by Insert existing symbol", async function () {
      await indexed();
      await openAtMarker(noteFile, "HERE");
      await browser.executeObsidianCommand("inkline:insert-existing-symbol");
      await browser.$(".prompt-input").waitForExist();
      await browser.$(".prompt-input").setValue("rice");
      expect(await waitForRow("Anything at all")).toEqual([
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
      expect(await waitForRow("Anything at all")).toEqual([
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

    it("goes on past a damaged file and a costly one", async function () {
      await browser.executeObsidian(async ({ app }) => {
        const { png, text } = window.inklineTest;
        await app.vault.createBinary(
          "A cut.ink.png",
          new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]).buffer,
        );
        await app.vault.createBinary("B empty.ink.png", new ArrayBuffer(0));
        const { bytes } = await window.inklineTest.canvas.saveInk(
          { strokes: [] },
          undefined,
          [],
        );
        // More void chunks of a keyword than the index tries, before a good
        // one, as a file made to be slow to read has.
        const chunks = png.readChunks(bytes);
        const keyword = new TextEncoder().encode("Inkline reading");
        const void_ = new Uint8Array(keyword.length + 2);
        void_.set(keyword);
        const crafted = png.writeChunks([
          ...chunks.slice(0, 1),
          ...Array.from({ length: 2000 }, () => ({
            type: "zTXt",
            data: void_,
          })),
          ...chunks.slice(1),
        ]);
        const costly = await text.writeText(crafted, "translation", ["costly"]);
        await app.vault.createBinary("C costly.ink.png", costly.slice().buffer);
      });
      await symbolWith("Z after.ink.png", { reading: ["TA"] });
      await showLibrary();
      await waitForFiltered("TA", ["Z after.ink.png"]);
      // Declined for one keyword, not for the other, which it found at once.
      await waitForFiltered("costly", ["C costly.ink.png"]);
    });

    it("searches while it reads, and says it may be missing some", async function () {
      this.timeout(120_000);
      await bulkSymbols(60);
      await showLibrary();
      // Reads slowly enough to see, from nothing.
      await delayVault("readBinary", 100);
      await restartInkline();
      await showLibrary();
      const search = browser.$(".inkline-library-search");
      const status = browser.$(".inkline-library-status");
      await search.setValue("Bulk 59");
      await browser.waitUntil(
        async () => (await browser.$$(".inkline-library-symbol").length) === 1,
      );
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
      await search.setValue("value59");
      await browser.waitUntil(
        async () => (await browser.$$(".inkline-library-symbol").length) === 1,
        { timeout: 60_000 },
      );
      await browser.waitUntil(async () => !(await status.isDisplayed()));
      await restoreVault();
    });

    it("finds what just changed ahead of the first reading of the vault", async function () {
      this.timeout(120_000);
      await bulkSymbols(60);
      await showLibrary();
      await delayVault("readBinary", 300);
      await restartInkline();
      await showLibrary();
      const status = browser.$(".inkline-library-status");
      const count = () => browser.$$(".inkline-library-symbol").length;
      // Something the vault reports goes before the rest of the files.
      await changeOnDisk("Bulk 58.ink.png", { reading: ["synced"] });
      await browser.$(".inkline-library-search").setValue("synced");
      await browser.waitUntil(async () => (await count()) === 1, {
        timeout: 5000,
      });
      expect(await status.isDisplayed()).toBe(true);
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
      await browser.$(".inkline-library-search").setValue("justtyped");
      await browser.waitUntil(async () => (await count()) === 1, {
        timeout: 5000,
      });
      expect(await status.isDisplayed()).toBe(true);
      await restoreVault();
    });
  });
});
