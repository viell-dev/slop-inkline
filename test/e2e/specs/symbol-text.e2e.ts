// A symbol's readings and translations in real Obsidian: filling them in from
// the editor and the library, finding a symbol by them in every list, and the
// index that remembers them. What the file holds is read back with the format's
// own code, in Obsidian's Chromium. All the text is synthetic.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { stalledAfter } from "../../../src/notes/file-writes.ts";
import { loadModules, toBase64 } from "../support/browser.ts";
import {
  clickTop,
  createSymbol,
  delayVault,
  draw,
  fillStorage,
  freeStorage,
  markEditor,
  openAtMarker,
  recordOf,
  restoreVault,
  startOver,
  storedDrafts,
  surface,
  symbolFiles,
  topButton,
  waitForEditor,
  waitForNext,
  waitForNotice,
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

/**
 * Has a sync tool change `file`'s reading just as the next read of the file
 * starts, which is a save's look at it just before it writes: writing to the
 * disk tells the vault at once, so that a change made before a save would be
 * taken in before it starts.
 */
async function changeAtNextRead(file: string, reading: string): Promise<void> {
  await browser.executeObsidian(
    ({ app }, wanted, value) => {
      const read = app.vault.readBinary.bind(app.vault);
      app.vault.readBinary = async (target) => {
        if (target.path !== wanted) return read(target);
        app.vault.readBinary = read;
        const { text } = window.inklineTest;
        const bytes = await text.writeText(
          new Uint8Array(await read(target)),
          "reading",
          [value],
        );
        await app.vault.adapter.writeBinary(wanted, bytes.slice().buffer);
        return read(target);
      };
    },
    file,
    reading,
  );
}

/**
 * Changes a file's drawing to three dots, and its fields, as sync would bring
 * them from another computer.
 */
async function redrawOnDisk(file: string, fields: Fields): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, wanted, { reading, translation }) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const { canvas, inkFile, png, text } = window.inklineTest;
      const was = new Uint8Array(await app.vault.readBinary(found));
      const dot = (x: number) => ({
        tool: "pen" as const,
        size: 256,
        points: [x, 1600],
      });
      const saved = await canvas.saveInk(
        { strokes: [dot(800), dot(1600), dot(2400)] },
        undefined,
        inkFile.preservableChunks(png.readChunks(was)),
      );
      let bytes: Uint8Array = saved.bytes;
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

/** What a file holds now, to put back with {@link writeBase64}. */
async function bytesAsBase64(file: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const bytes = new Uint8Array(await app.vault.readBinary(found));
    return btoa(String.fromCharCode(...bytes));
  }, file);
}

/** Puts back what {@link bytesAsBase64} gave. */
async function writeBase64(file: string, held: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, wanted, base64) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      await app.vault.modifyBinary(found, bytes.buffer);
    },
    file,
    held,
  );
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
const formNote = () => browser.$(".inkline-text-note");

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
          // The fields still to save, if another library's are busy.
          [
            ...document.querySelectorAll<HTMLFormElement>(
              ".inkline-library-text-form",
            ),
          ]
            .find(
              (form) =>
                form.querySelector<HTMLButtonElement>("button[type=submit]")
                  ?.disabled === false,
            )
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

/** Has the next read of `file` wait for {@link letReadGo}. */
async function holdNextRead(file: string): Promise<void> {
  await browser.executeObsidian(({ app }, wanted) => {
    const held = app.vault.getFileByPath(wanted);
    if (held === null) throw new Error(`no ${wanted}`);
    const read = app.vault.readBinary.bind(app.vault);
    let go = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      go = resolve;
    });
    Reflect.set(window, "inklineLetReadGo", () => {
      go();
    });
    app.vault.readBinary = async (asked) => {
      if (asked !== held) return read(asked);
      app.vault.readBinary = read;
      await gate;
      return read(asked);
    };
  }, file);
}

/** Lets go a read that {@link holdNextRead} held. */
async function letReadGo(): Promise<void> {
  await browser.execute(() => {
    const go: unknown = Reflect.get(window, "inklineLetReadGo");
    if (typeof go !== "function") throw new Error("no held read");
    Reflect.apply(go, undefined, []);
  });
}

/**
 * Has the next write to the vault wait for {@link letWriteGo}, as one on a drive
 * that has stopped answering does, and returns once it is waiting.
 */
async function holdNextWrite(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const write = app.vault.modifyBinary.bind(app.vault);
    let go = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      go = resolve;
    });
    Reflect.set(window, "inklineLetWriteGo", () => {
      go();
    });
    app.vault.modifyBinary = async (...args) => {
      app.vault.modifyBinary = write;
      Reflect.set(window, "inklineWriteHeld", true);
      await gate;
      return write(...args);
    };
  });
}

/** Waits for a write that {@link holdNextWrite} set up to reach the vault. */
async function waitForHeldWrite(): Promise<void> {
  await browser.waitUntil(async () =>
    browser.execute(() => Reflect.get(window, "inklineWriteHeld") === true),
  );
}

/** Lets go a write that {@link holdNextWrite} held, if there is one. */
async function letWriteGo(): Promise<void> {
  await browser.execute(() => {
    const go: unknown = Reflect.get(window, "inklineLetWriteGo");
    Reflect.deleteProperty(window, "inklineLetWriteGo");
    Reflect.deleteProperty(window, "inklineWriteHeld");
    if (typeof go === "function") Reflect.apply(go, undefined, []);
  });
}

/**
 * Opens a second library, and in it the fields of `file` as it is now, under an
 * editor or not, and sets `field`'s value. The library is new so that its row is
 * for what is at the path now, and the first library's fields, which are saving,
 * stay as they are.
 */
async function fieldsInSecondLibrary(
  file: string,
  field: "reading" | "translation",
  text: string,
): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    await app.workspace
      .getLeaf("split")
      .setViewState({ type: "inkline-library", active: false });
  });
  const button = `.inkline-library-symbol[data-inkline-path="${file}"] [data-inkline-role="text"]`;
  await browser.waitUntil(async () =>
    browser.execute((selector) => {
      const found = document.querySelector<HTMLElement>(selector);
      found?.click();
      return found !== null;
    }, button),
  );
  const unsaved = async (): Promise<boolean> =>
    browser.execute(
      (name, value) => {
        const form = [
          ...document.querySelectorAll<HTMLFormElement>(
            ".inkline-library-text-form",
          ),
        ].find(
          (each) =>
            each.querySelector<HTMLButtonElement>("button[type=submit]")
              ?.disabled === false,
        );
        const area = form?.querySelector<HTMLTextAreaElement>(
          `textarea[data-inkline-field="${name}"]`,
        );
        if (area === null || area === undefined) return false;
        area.value = value;
        area.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      },
      field,
      text,
    );
  await browser.waitUntil(unsaved);
}

/** How many of the library's fields are open. */
async function openForms(): Promise<number> {
  return browser.$$(".inkline-library-text-form").length;
}

/**
 * Answers Keep mine for as long as the editor asks, until it closes. In one step
 * in the page, as a modal that closes under a driver's element holds it up.
 */
async function keepMineUntilClosed(): Promise<void> {
  await browser.waitUntil(async () =>
    browser.execute(() => {
      const top = [...document.querySelectorAll(".modal-container")].at(-1);
      [...(top?.querySelectorAll("button") ?? [])]
        .find((button) => button.textContent === "Keep mine")
        ?.click();
      return document.querySelector(".inkline-editor") === null;
    }),
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

    describe("when only its text changes on disk", function () {
      const file = "Sync.ink.png";
      const note = () => browser.$(".inkline-editor .inkline-text-note");

      /** How many strokes the record in `file` holds. */
      async function strokes(): Promise<number> {
        const { strokes: held } = JSON.parse(await recordOf(file)) as {
          strokes: unknown[];
        };
        return held.length;
      }

      /** Whether a modal stands above the editor, as a question does. */
      async function asked(): Promise<boolean> {
        return browser.execute(
          () => document.querySelectorAll(".modal-container").length > 1,
        );
      }

      /** Opens the editor on a symbol, and draws a stroke it does not save. */
      async function withStroke(): Promise<void> {
        await symbolWith(file, { reading: ["TA"], translation: ["field"] });
        await editFile(file);
        await showFields();
        await draw([
          [0.5, 0.3],
          [0.7, 0.6],
        ]);
      }

      /** Has the editor keep the stroke as a draft, and restarts Obsidian. */
      async function leaveDraft(): Promise<void> {
        await browser.waitUntil(
          async () => (await storedDrafts()).length === 1,
        );
        await browser.reloadObsidian();
        await loadModules();
      }

      /** What the question about a draft says, once it opens. */
      async function draftQuestion(): Promise<string> {
        await browser.waitUntil(
          async () => (await topButton("Restore")) !== undefined,
        );
        return browser.execute(
          () =>
            [...document.querySelectorAll(".modal-container")].at(-1)
              ?.textContent ?? "",
        );
      }

      it("takes it in without asking, and leaves unsaved strokes alone", async function () {
        await withStroke();
        await changeOnDisk(file, { reading: ["KA"] });
        await browser.waitUntil(
          async () => (await area("reading").getValue()) === "KA",
        );
        await waitForStatus("Readings and translations updated");
        expect(await asked()).toBe(false);
        expect(await area("translation").getValue()).toBe("field");
        await saveAndClose();
        expect(await fieldsOf(file)).toEqual({
          reading: ["KA"],
          translation: ["field"],
        });
        expect(await strokes()).toBe(2);
      });

      it("takes in a save from the library the same way", async function () {
        await symbolWith(file, { reading: ["TA"] });
        await showLibrary();
        await openFields(file);
        await fill("translation", "from the library");
        await editFile(file);
        await showFields();
        await draw([
          [0.5, 0.3],
          [0.7, 0.6],
        ]);
        await browser.execute(saveFields);
        await waitForClosedForm();
        await browser.waitUntil(
          async () =>
            (await area("translation").getValue()) === "from the library",
        );
        expect(await asked()).toBe(false);
        await saveAndClose();
        expect((await fieldsOf(file)).translation).toEqual([
          "from the library",
        ]);
        expect(await strokes()).toBe(2);
      });

      it("reloads nothing with nothing unsaved, so Undo has nothing to take back", async function () {
        await symbolWith(file, { reading: ["TA"] });
        await editFile(file);
        await showFields();
        await changeOnDisk(file, { reading: ["KA"] });
        await waitForStatus("Readings and translations updated");
        expect(await area("reading").getValue()).toBe("KA");
        expect(
          await browser
            .$('[data-inkline-button="undo"]')
            .getProperty("disabled"),
        ).toBe(true);
        // Nothing to save, so nothing is kept as if it were.
        expect(await storedDrafts()).toEqual([]);
      });

      it("keeps what was typed in a field it changed, and says what saving replaces", async function () {
        await symbolWith(file, { reading: ["TA"], translation: ["field"] });
        await editFile(file);
        await showFields();
        await fill("reading", "typed");
        // Closed, to show that the fields open to say so.
        await toggle().click();
        expect(await area("reading").isDisplayed()).toBe(false);
        await changeOnDisk(file, {
          reading: ["theirs"],
          translation: ["plot"],
        });
        await waitForStatus("saving replaces what it now says");
        expect(await asked()).toBe(false);
        expect(await area("reading").isDisplayed()).toBe(true);
        expect(await area("reading").getValue()).toBe("typed");
        expect(await area("translation").getValue()).toBe("plot");
        const said = await note().getText();
        expect(said).toContain("Saving replaces what it now says");
        expect(said).toContain("Reading: theirs");
        expect(said).not.toContain("plot");
        await saveScreenshot("text-editor-replaced");
        // The file keeps its value until a person saves over it.
        expect((await fieldsOf(file)).reading).toEqual(["theirs"]);
        await browser.keys(["Control", "s"]);
        await waitForStatus("Saved");
        expect(await note().getText()).toBe("");
        expect(await fieldsOf(file)).toEqual({
          reading: ["typed"],
          translation: ["plot"],
        });
      });

      it("drops the note once the typing no longer replaces anything", async function () {
        await symbolWith(file, { reading: ["TA"] });
        await editFile(file);
        await showFields();
        await fill("reading", "typed");
        await changeOnDisk(file, { reading: ["theirs"] });
        await waitForStatus("saving replaces what it now says");
        await fill("reading", "theirs");
        await browser.waitUntil(async () => (await note().getText()) === "");
      });

      it("stops a save that finds a change to a field typed in, with nothing written", async function () {
        await symbolWith(file, { reading: ["TA"] });
        await editFile(file);
        await showFields();
        await fill("reading", "typed");
        await changeAtNextRead(file, "theirs");
        await browser.execute(saveEditor);
        await waitForStatus("Not saved: the file changed text you typed");
        expect(await asked()).toBe(false);
        expect((await fieldsOf(file)).reading).toEqual(["theirs"]);
        expect(await note().getText()).toContain("Reading: theirs");
        expect(await area("reading").getValue()).toBe("typed");
        await browser.$('[data-inkline-button="save"]').click();
        await browser.$(".inkline-editor").waitForExist({ reverse: true });
        expect((await fieldsOf(file)).reading).toEqual(["typed"]);
      });

      it("goes on with a save that finds a change it can keep, and closes", async function () {
        await withStroke();
        await changeAtNextRead(file, "KA");
        await browser.execute(saveEditor);
        await browser.$(".inkline-editor").waitForExist({ reverse: true });
        expect(await fieldsOf(file)).toEqual({
          reading: ["KA"],
          translation: ["field"],
        });
        expect(await strokes()).toBe(2);
      });

      it("goes on with Next through a change found as it saves", async function () {
        await newSymbol();
        await draw([
          [0.5, 0.3],
          [0.7, 0.6],
        ]);
        await browser.keys(["Control", "s"]);
        await waitForStatus("Saved");
        await draw([
          [0.2, 0.3],
          [0.3, 0.6],
        ]);
        const [made] = await symbolFiles();
        if (made === undefined) throw new Error("no symbol");
        await changeAtNextRead(made, "KA");
        await markEditor();
        await browser.$('[data-inkline-button="next"]').click();
        await waitForNext(1);
        expect((await fieldsOf(made)).reading).toEqual(["KA"]);
      });

      it("takes in text on top of a change that Keep mine replaces", async function () {
        await withStroke();
        await redrawOnDisk(file, { reading: ["theirs"] });
        await clickTop("Keep mine");
        await browser.waitUntil(
          async () => (await area("reading").getValue()) === "theirs",
        );
        await changeOnDisk(file, { translation: ["plot"] });
        await browser.waitUntil(
          async () => (await area("translation").getValue()) === "plot",
        );
        expect(await asked()).toBe(false);
        await saveAndClose();
        expect(await fieldsOf(file)).toEqual({
          reading: ["theirs"],
          translation: ["plot"],
        });
        // The drawing kept: the first stroke and the new one, not three dots.
        expect(await strokes()).toBe(2);
      });

      it("looks at the file again once a question is answered", async function () {
        await withStroke();
        const original = await bytesAsBase64(file);
        await redrawOnDisk(file, {});
        await browser.waitUntil(
          async () => (await topButton("Keep mine")) !== undefined,
        );
        // Back to the drawing the editor knows, with other text, under the
        // question: what that question read is out of date.
        await writeBase64(file, original);
        await changeOnDisk(file, { reading: ["KA"] });
        await clickTop("Keep mine");
        await browser.waitUntil(
          async () => (await area("reading").getValue()) === "KA",
        );
        await saveAndClose();
        expect((await fieldsOf(file)).reading).toEqual(["KA"]);
        expect(await strokes()).toBe(2);
      });

      it("offers a draft without saying its strokes may not line up", async function () {
        await withStroke();
        await leaveDraft();
        await changeOnDisk(file, { reading: ["KA"] });
        await editFile(file);
        const said = await draftQuestion();
        expect(said).toContain("has unsaved changes");
        expect(said).not.toContain("may not line up");
        expect(said).not.toContain("look over what you typed");
        await clickTop("Restore");
        await saveAndClose();
        expect((await fieldsOf(file)).reading).toEqual(["KA"]);
        expect(await strokes()).toBe(2);
      });

      it("says to look over text a draft would put back", async function () {
        await symbolWith(file, { reading: ["TA"], translation: ["field"] });
        await editFile(file);
        await showFields();
        await fill("reading", "typed");
        await leaveDraft();
        await changeOnDisk(file, { translation: ["plot"] });
        await editFile(file);
        const said = await draftQuestion();
        expect(said).toContain("look over what you typed");
        expect(said).not.toContain("may not line up");
      });

      it("still says so of a draft whose drawing changed", async function () {
        await withStroke();
        await leaveDraft();
        await redrawOnDisk(file, { reading: ["KA"] });
        await editFile(file);
        expect(await draftQuestion()).toContain("may not line up");
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

    it("has an editor's save take in what a library's wrote ahead of it, without asking", async function () {
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

    /**
     * Has a library's save of `file` hold the line for writes, on its read, with
     * an editor's save of a new stroke waiting behind it. Returns the record the
     * file had. Runs `meanwhile` as they wait, then the read goes on.
     */
    async function saveBehindLibrary(
      file: string,
      field: "reading" | "translation",
      text: string,
      meanwhile: () => Promise<void>,
    ): Promise<string> {
      await showLibrary();
      await openFields(file);
      await fill(field, text);
      await editFile(file);
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      const before = await recordOf(file);
      await holdNextRead(file);
      await browser.execute(saveFields);
      await browser.execute(saveEditor);
      await waitForStatus("Saving");
      // Long enough for the drawing to be encoded and the save to join the line.
      await browser.pause(500);
      await meanwhile();
      await letReadGo();
      return before;
    }

    it("keeps a library's save of a file put back while the editor's waited", async function () {
      const file = "Replaced.ink.png";
      await symbolWith(file, { reading: ["TA"], translation: ["field"] });
      const before = await saveBehindLibrary(
        file,
        "translation",
        "goes with the old file",
        async () => {
          // As sync can: the file goes, and the same bytes come back as a new one.
          await browser.executeObsidian(async ({ app }, wanted) => {
            const old = app.vault.getFileByPath(wanted);
            if (old === null) throw new Error(`no ${wanted}`);
            const bytes = await app.vault.adapter.readBinary(wanted);
            await app.fileManager.trashFile(old);
            while (app.vault.getFileByPath(wanted) !== null) {
              await new Promise((resolve) => window.setTimeout(resolve, 10));
            }
            await app.vault.createBinary(wanted, bytes);
          }, file);
          await fieldsInSecondLibrary(file, "reading", "typed");
          // As the editor starts to write, the second library saves too.
          await atNextWrite("fields", 300);
        },
      );
      await browser.$(".inkline-editor").waitForExist({ reverse: true });
      await browser.waitUntil(async () => (await openForms()) === 1);
      // The first library's save was of the file that went, so it is refused.
      expect(await formError().getText()).toContain("no longer in the vault");
      expect(await fieldsOf(file)).toEqual({
        reading: ["typed"],
        translation: ["field"],
      });
      expect(await recordOf(file)).not.toBe(before);
    });

    it("loses no save to a rename while saves wait, under either name", async function () {
      const file = "Before.ink.png";
      const moved = "After.ink.png";
      await symbolWith(file, { reading: ["TA"], translation: ["field"] });
      const before = await saveBehindLibrary(
        file,
        "translation",
        "FIRST",
        async () => {
          await browser.executeObsidian(
            async ({ app }, from, to) => {
              const found = app.vault.getFileByPath(from);
              if (found === null) throw new Error(`no ${from}`);
              await app.vault.rename(found, to);
            },
            file,
            moved,
          );
          await fieldsInSecondLibrary(moved, "reading", "SECOND");
          // Long enough for either to read before the other writes, if it can.
          await delayVault("modifyBinary", 300, "before");
          await browser.execute(() => {
            [
              ...document.querySelectorAll<HTMLFormElement>(
                ".inkline-library-text-form",
              ),
            ]
              .find(
                (form) =>
                  form.querySelector<HTMLButtonElement>("button[type=submit]")
                    ?.disabled === false,
              )
              ?.requestSubmit();
          });
        },
      );
      // The first library's save goes ahead of the editor's, which asks.
      await keepMineUntilClosed();
      await waitForClosedForm();
      await restoreVault();
      expect(await symbolFiles()).toEqual([moved]);
      expect(await fieldsOf(moved)).toEqual({
        reading: ["SECOND"],
        translation: ["FIRST"],
      });
      expect(await recordOf(moved)).not.toBe(before);
    });

    it("makes a deleted file once for two editors, and the other asks", async function () {
      const file = "Symbols/Twice.ink.png";
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.createFolder("Symbols");
      });
      await symbolWith(file, { reading: ["TA"] });
      await editFile(file);
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      await browser.executeObsidian(({ app, plugins }, wanted) => {
        const found = app.vault.getFileByPath(wanted);
        if (found === null) throw new Error(`no ${wanted}`);
        void plugins.inkline.editSymbol(found);
      }, file);
      await browser.waitUntil(
        async () => (await browser.$$(".inkline-editor").length) === 2,
      );
      // The later editor changes a value, as its surface is under no pointer.
      await browser.execute(() => {
        [...document.querySelectorAll<HTMLElement>(".inkline-text-toggle")]
          .at(-1)
          ?.click();
      });
      await browser.waitUntil(async () =>
        browser.execute(() => {
          const area = [
            ...document.querySelectorAll<HTMLTextAreaElement>(
              'textarea[data-inkline-field="reading"]',
            ),
          ].at(-1);
          if (area === undefined) return false;
          area.value = "LATER";
          area.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }),
      );
      const before = await recordOf(file);
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.adapter.rmdir("Symbols", true);
      });
      await browser.waitUntil(
        async () => !(await symbolFiles()).includes(file),
      );
      await browser.execute(() => {
        for (const button of document.querySelectorAll<HTMLElement>(
          '[data-inkline-button="save"]',
        )) {
          button.click();
        }
      });
      // The drawn one first gives the other a changed drawing, which it asks
      // about. The other first changes only text, which the drawn one builds on.
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            document.querySelector(".inkline-editor") === null ||
            [...document.querySelectorAll("button")].some(
              (button) => button.textContent === "Keep mine",
            ),
        ),
      );
      const asked = await browser.execute(
        () => document.querySelector(".inkline-editor") !== null,
      );
      expect(await symbolFiles()).toEqual([file]);
      if (asked) {
        // Whichever got there first made the file, and the other wrote nothing.
        expect(await recordOf(file)).not.toBe(before);
        expect((await fieldsOf(file)).reading).toEqual(["TA"]);
      } else {
        expect(await recordOf(file)).not.toBe(before);
      }
      await keepMineUntilClosed();
      expect(await symbolFiles()).toEqual([file]);
      expect((await fieldsOf(file)).reading).toEqual(["LATER"]);
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

  describe("when Obsidian does not finish a write", function () {
    /** Long enough for a save to have waited, with a margin for a busy machine. */
    const waited = stalledAfter + 15_000;

    const editorWait = () => browser.$(".inkline-editor .inkline-save-wait");

    /** The form with `typed` as its reading, marked for the driver to find. */
    function form(typed: string): ReturnType<typeof browser.$> {
      return browser.$(`[data-test-form="${typed}"]`);
    }

    const formButton = (typed: string, text: "Save" | "Cancel") =>
      form(typed).$(`button=${text}`);

    /** Marks the form with `typed` as its reading for {@link form}. */
    async function markForm(typed: string): Promise<void> {
      await browser.execute((wanted) => {
        for (const area of document.querySelectorAll<HTMLTextAreaElement>(
          'textarea[data-inkline-field="reading"]',
        )) {
          if (area.value === wanted) {
            area.closest("form")?.setAttribute("data-test-form", wanted);
          }
        }
      }, typed);
    }

    /** Waits for that form to say its save waits, and returns what it says. */
    async function waitForFormWait(typed: string): Promise<string> {
      const wait = form(typed).$(".inkline-save-wait");
      await browser.waitUntil(async () => (await wait.getText()) !== "", {
        timeout: waited,
        timeoutMsg: `the form with ${typed} never said its save waits`,
      });
      return wait.getText();
    }

    /**
     * Has a library's save of `Held.ink.png` hold the line for writes, at its
     * write, and opens the fields of `Other.ink.png` in a second library, with
     * `typed` in them.
     */
    async function behindHeldWrite(typed: string): Promise<void> {
      await symbolWith("Held.ink.png", { reading: ["TA"] });
      await symbolWith("Other.ink.png", { reading: ["DA"] });
      await showLibrary();
      await openFields("Held.ink.png");
      await fill("reading", "FIRST");
      await holdNextWrite();
      await browser.execute(saveFields);
      await waitForHeldWrite();
      await fieldsInSecondLibrary("Other.ink.png", "reading", typed);
      await markForm(typed);
    }

    /** Has the editor save `file`'s new stroke, and hold that at its write. */
    async function editorHeldAtWrite(file: string): Promise<void> {
      await editFile(file);
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      await holdNextWrite();
      await browser.keys(["Control", "s"]);
      await waitForHeldWrite();
    }

    /** Waits for the editor to say its save waits, and returns what it says. */
    async function waitForEditorWait(): Promise<string> {
      await browser.waitUntil(
        async () => (await editorWait().getText()) !== "",
        {
          timeout: waited,
          timeoutMsg: "the editor never said its save waits",
        },
      );
      return editorWait().getText();
    }

    /** How many strokes the record in `file` holds. */
    async function strokesIn(file: string): Promise<number> {
      const { strokes } = JSON.parse(await recordOf(file)) as {
        strokes: unknown[];
      };
      return strokes.length;
    }

    afterEach(async function () {
      // A save left waiting would hold up every later test's.
      await letWriteGo();
    });

    it("shows nothing for a save that takes less than the wait", async function () {
      const file = "Slow.ink.png";
      await symbolWith(file, { reading: ["TA"] });
      await showLibrary();
      await browser.execute(() => {
        new MutationObserver(() => {
          const shown = document.querySelector(".inkline-save-wait");
          if (shown !== null && shown.textContent !== "") {
            Reflect.set(window, "inklineSawWait", true);
          }
        }).observe(document.body, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
      await openFields(file);
      await fill("reading", "typed");
      await delayVault("modifyBinary", stalledAfter / 2, "before");
      await formSave().click();
      await waitForClosedForm();
      await editFile(file);
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await restoreVault();
      expect((await fieldsOf(file)).reading).toEqual(["typed"]);
      expect(
        await browser.execute(
          () => Reflect.get(window, "inklineSawWait") === true,
        ),
      ).toBe(false);
      expect(await browser.$(".notice*=Saved Slow").isExisting()).toBe(false);
    });

    it("tells a form behind a held write, keeps what was typed, and saves when the write ends", async function () {
      await behindHeldWrite("typed");
      await formButton("typed", "Save").click();
      const said = await waitForFormWait("typed");
      expect(said).toContain("Waiting for Obsidian to finish writing a file.");
      expect(said).toContain("goes on by itself when it does");
      expect(said).toContain("copy what you typed and restart Obsidian");
      expect(said).toContain("Cancel closes this, and stops the save");
      await saveScreenshot("save-wait-library", form("typed"));
      // What was typed is there to copy, from the field that has the focus.
      const shown = await browser.execute(() => {
        const active = document.activeElement;
        if (active?.tagName !== "TEXTAREA") return undefined;
        const area = active as HTMLTextAreaElement;
        area.select();
        return {
          selected: area.value.slice(area.selectionStart, area.selectionEnd),
          readOnly: area.readOnly,
        };
      });
      expect(shown).toEqual({ selected: "typed", readOnly: true });
      expect(await formButton("typed", "Save").isEnabled()).toBe(false);
      expect(await formButton("typed", "Cancel").isEnabled()).toBe(true);
      expect((await fieldsOf("Other.ink.png")).reading).toEqual(["DA"]);
      await letWriteGo();
      await waitForClosedForm();
      expect((await fieldsOf("Held.ink.png")).reading).toEqual(["FIRST"]);
      expect((await fieldsOf("Other.ink.png")).reading).toEqual(["typed"]);
      await waitForNotice("Saved Other");
      await waitForValues("Other.ink.png", "typed");
    });

    for (const [how, leave] of [
      ["Cancel", async (typed: string) => formButton(typed, "Cancel").click()],
      ["Esc", async () => browser.keys(["Escape"])],
    ] as const) {
      it(`leaves a save behind a held write with ${how}, which then writes nothing`, async function () {
        await behindHeldWrite("dropped");
        const before = await bytesOf("Other.ink.png");
        await formButton("dropped", "Save").click();
        await waitForFormWait("dropped");
        await leave("dropped");
        await browser.waitUntil(async () => (await openForms()) === 1);
        await letWriteGo();
        await waitForClosedForm();
        expect((await fieldsOf("Held.ink.png")).reading).toEqual(["FIRST"]);
        expect(await bytesOf("Other.ink.png")).toBe(before);
      });
    }

    it("lets a form with its own write held close, and says it may still finish", async function () {
      const file = "Own.ink.png";
      await symbolWith(file, { reading: ["TA"] });
      await showLibrary();
      await openFields(file);
      await fill("reading", "typed");
      await markForm("typed");
      await holdNextWrite();
      await formButton("typed", "Save").click();
      await waitForHeldWrite();
      await waitForFormWait("typed");
      await formButton("typed", "Cancel").click();
      await waitForClosedForm();
      await waitForNotice("may still finish");
      expect((await fieldsOf(file)).reading).toEqual(["TA"]);
      await letWriteGo();
      await waitForNotice("Saved Own");
      expect((await fieldsOf(file)).reading).toEqual(["typed"]);
      await waitForValues(file, "typed");
    });

    it("says so in the editor, goes on drawing, and ends with the write", async function () {
      const file = "Drawn.ink.png";
      await createSymbol(file);
      await editorHeldAtWrite(file);
      await waitForStatus("Saving");
      const said = await waitForEditorWait();
      expect(said).toContain("Waiting for Obsidian to finish writing a file.");
      expect(said).toContain("goes on by itself when it does");
      expect(said).toContain("Your strokes are safe in a draft");
      expect(said).toContain("restart Obsidian and open this symbol again");
      await saveScreenshot("save-wait-editor");
      await draw([
        [0.2, 0.3],
        [0.3, 0.6],
      ]);
      // Other news in the status line leaves what it says in place, as does
      // trying to close, which a save still under way refuses.
      await browser.keys(["Escape"]);
      await waitForStatus("Saving");
      expect(await editorWait().getText()).toBe(said);
      expect(await browser.$(".inkline-editor").isExisting()).toBe(true);
      expect(await strokesIn(file)).toBe(1);
      await letWriteGo();
      await waitForStatus("Saved");
      expect(await editorWait().getText()).toBe("");
      expect(await strokesIn(file)).toBe(2);
      await browser.keys(["Control", "s"]);
      await browser.waitUntil(async () => (await strokesIn(file)) === 3);
    });

    it("says how a new symbol's strokes come back", async function () {
      await newSymbol();
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      await delayVault("createBinary", stalledAfter + 1500, "before");
      await browser.keys(["Control", "s"]);
      expect(await waitForEditorWait()).toContain(
        "restart Obsidian and start a new symbol in this note",
      );
      await waitForStatus("Saved");
      expect(await editorWait().getText()).toBe("");
    });

    it("gives the strokes back after a restart, where the message says", async function () {
      const file = "Restarted.ink.png";
      await createSymbol(file);
      const before = await recordOf(file);
      await editorHeldAtWrite(file);
      await waitForEditorWait();
      await draw([
        [0.2, 0.3],
        [0.3, 0.6],
      ]);
      await browser.reloadObsidian();
      await loadModules();
      expect(await recordOf(file)).toBe(before);
      await editFile(file);
      await clickTop("Restore");
      await browser.keys(["Control", "Enter"]);
      await browser.$(".inkline-editor").waitForExist({ reverse: true });
      expect(await strokesIn(file)).toBe(3);
    });

    it("does not call the strokes safe when no draft could be kept", async function () {
      const file = "Unkept.ink.png";
      await createSymbol(file);
      await editFile(file);
      await fillStorage();
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      await holdNextWrite();
      await browser.keys(["Control", "s"]);
      await waitForHeldWrite();
      const said = await waitForEditorWait();
      await freeStorage();
      expect(said).toContain("could not be kept in a draft");
      expect(said).not.toContain("safe");
      await letWriteGo();
      await waitForStatus("Saved");
    });

    it("leaves a rename free while a write is held", async function () {
      await behindHeldWrite("unused");
      // Both libraries are busy with fields, so a third does the renaming.
      await browser.executeObsidian(async ({ app }) => {
        await app.workspace
          .getLeaf("split")
          .setViewState({ type: "inkline-library", active: false });
      });
      const button =
        '[data-inkline-path="Other.ink.png"] [data-inkline-role="rename"]';
      await browser.waitUntil(async () =>
        browser.execute((selector) => {
          for (const found of document.querySelectorAll<HTMLElement>(
            selector,
          )) {
            found.click();
          }
          return (
            document.querySelector(".inkline-library-rename-form") !== null
          );
        }, button),
      );
      await browser.execute(() => {
        const renaming = document.querySelector<HTMLFormElement>(
          ".inkline-library-rename-form",
        );
        const name = renaming?.querySelector("input");
        if (renaming === null || name === null || name === undefined) {
          throw new Error("no rename form");
        }
        name.value = "Renamed";
        renaming.requestSubmit();
      });
      await browser.waitUntil(async () =>
        (await symbolFiles()).includes("Renamed.ink.png"),
      );
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
