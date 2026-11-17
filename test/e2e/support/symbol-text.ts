// A symbol's readings and translations in end-to-end tests: synthetic symbols
// and their text, read back with the format's own code, and the editor's
// fields for them.

import path from "node:path";
import { browser } from "@wdio/globals";
import { createSymbol, openAtMarker, waitForEditor } from "./editor.ts";

export const fixtures = path.resolve(
  import.meta.dirname,
  "../../fixtures/format",
);

export const noteFile = "Note.md";

/** Fields to give a symbol. */
export interface Fields {
  readonly reading?: readonly string[];
  readonly translation?: readonly string[];
}

/** What a file's fields say, from the file itself. */
export async function fieldsOf(file: string): Promise<{
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
export async function changeOnDisk(
  file: string,
  fields: Fields,
): Promise<void> {
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
 * Changes a file's drawing to three dots, and its fields, as sync would bring
 * them from another computer.
 */
export async function redrawOnDisk(
  file: string,
  fields: Fields,
): Promise<void> {
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
export async function symbolWith(
  file: string,
  fields: Fields,
  xs?: readonly number[],
): Promise<void> {
  await createSymbol(file, xs);
  await changeOnDisk(file, fields);
}

/** A text area of the form or editor open now. */
export function area(
  field: "reading" | "translation",
): ReturnType<typeof browser.$> {
  return browser.$(`textarea[data-inkline-field="${field}"]`);
}

/** Sets a text area's value as typing would. */
export async function fill(
  field: "reading" | "translation",
  text: string,
): Promise<void> {
  await area(field).setValue(text);
}

/**
 * Sets a text area's value as pasting does, in one change. A list at the format's
 * limit is thousands of keys, which take most of a test's time to send.
 */
export async function paste(
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

/** Starts a new symbol in the note. */
export async function newSymbol(): Promise<void> {
  await openAtMarker(noteFile, "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
}

export const toggle = () => browser.$(".inkline-text-toggle");

/** Shows the editor's text fields. */
export async function showFields(): Promise<void> {
  if ((await toggle().getAttribute("aria-expanded")) !== "true") {
    await toggle().click();
  }
  await area("reading").waitForDisplayed();
}

/** Saves and closes the editor. */
export async function saveAndClose(): Promise<void> {
  await browser.$('[data-inkline-button="save"]').click();
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

/** Turns Inkline off and on, which reads every symbol again from nothing. */
export async function restartInkline(): Promise<void> {
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

/** Saves the editor. */
export function saveEditor(): void {
  document.querySelector<HTMLElement>('[data-inkline-button="save"]')?.click();
}

/**
 * Has the next read of `file` through the vault wait for {@link letReadGo}.
 * Its gate registers with `undoStubs()` in support/editor.ts, which lets the
 * read go if a test ends with it held.
 */
export async function holdNextRead(file: string): Promise<void> {
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
    Reflect.set(window, "inklineAtEnd-next-read", () => {
      Reflect.deleteProperty(window, "inklineLetReadGo");
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
export async function letReadGo(): Promise<void> {
  await browser.execute(() => {
    const go: unknown = Reflect.get(window, "inklineLetReadGo");
    Reflect.deleteProperty(window, "inklineLetReadGo");
    Reflect.deleteProperty(window, "inklineAtEnd-next-read");
    if (typeof go !== "function") throw new Error("no held read");
    Reflect.apply(go, undefined, []);
  });
}

/**
 * Has the next write to the vault wait for {@link letWriteGo}, as one on a drive
 * that has stopped answering does, and returns once it is waiting. Its gate
 * registers with `undoStubs()` in support/editor.ts, which lets the write go
 * if a test ends with it held.
 */
export async function holdNextWrite(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const write = app.vault.modifyBinary.bind(app.vault);
    let go = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      go = resolve;
    });
    Reflect.set(window, "inklineLetWriteGo", () => {
      go();
    });
    Reflect.set(window, "inklineAtEnd-next-write", () => {
      Reflect.deleteProperty(window, "inklineLetWriteGo");
      Reflect.deleteProperty(window, "inklineWriteHeld");
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
export async function waitForHeldWrite(): Promise<void> {
  await browser.waitUntil(async () =>
    browser.execute(() => Reflect.get(window, "inklineWriteHeld") === true),
  );
}

/** Lets go a write that {@link holdNextWrite} held, if there is one. */
export async function letWriteGo(): Promise<void> {
  await browser.execute(() => {
    const go: unknown = Reflect.get(window, "inklineLetWriteGo");
    Reflect.deleteProperty(window, "inklineLetWriteGo");
    Reflect.deleteProperty(window, "inklineWriteHeld");
    Reflect.deleteProperty(window, "inklineAtEnd-next-write");
    if (typeof go === "function") Reflect.apply(go, undefined, []);
  });
}

/** Puts a note in place, and waits until Obsidian can open it. */
export async function makeNote(text = "Write HERE on.\n"): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, file, body) => {
      await app.vault.create(file, body);
    },
    noteFile,
    text,
  );
}
