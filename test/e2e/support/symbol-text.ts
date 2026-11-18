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

/** What a text area of the form or editor open now says is wrong. */
export function fieldError(
  field: "reading" | "translation",
): ReturnType<typeof browser.$> {
  return browser.$(
    `.inkline-text-field:has(textarea[data-inkline-field="${field}"]) .inkline-text-error`,
  );
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
  // The editor's, as a library's form can be open beside it.
  await browser
    .$('.inkline-text-strip textarea[data-inkline-field="reading"]')
    .waitForDisplayed();
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
 * Has the next read of `file` through the vault wait for {@link letReadGo}, as
 * a save reads its file in its turn before it writes. It returns once the gate
 * is in place: {@link waitForHeldRead} waits until the read has reached it.
 *
 * Its gate registers with `undoStubs()` in support/editor.ts, which lets the
 * read go if a test ends with it held. Let go either way, a read that has
 * reached the gate is kept in the renderer's `inklineLetGo` until it ends, so
 * that `undoStubs()` waits for it before the vault is reset. A read that has
 * not reached it is no longer held, and the gate takes itself off the vault
 * if nothing has been put over it. The gate's keys have fixed names, so it
 * refuses to be set up while an earlier one has not been let go.
 */
export async function holdNextRead(file: string): Promise<void> {
  await browser.executeObsidian(({ app }, wanted) => {
    if (Reflect.has(window, "inklineAtEnd-next-read")) {
      throw new Error("a read is already held: let it go first");
    }
    const held = app.vault.getFileByPath(wanted);
    if (held === null) throw new Error(`no ${wanted}`);
    // What the vault had as its own, if anything, to put back.
    const ownBefore = Object.hasOwn(app.vault, "readBinary");
    const previous: unknown = Reflect.get(app.vault, "readBinary");
    const read = app.vault.readBinary.bind(app.vault);
    let go = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      go = resolve;
    });
    let released = false;
    /** The held read, once it has come. */
    let call: Promise<ArrayBuffer> | undefined;
    const wrapper: typeof app.vault.readBinary = (asked) => {
      if (released || asked !== held) return read(asked);
      putBack();
      Reflect.set(window, "inklineReadHeld", true);
      call = (async () => {
        await gate;
        return read(asked);
      })();
      return call;
    };
    /** Takes the wrapper off the vault, if it is still there. */
    const putBack = (): void => {
      if (Reflect.get(app.vault, "readBinary") !== wrapper) return;
      if (ownBefore) Reflect.set(app.vault, "readBinary", previous);
      else Reflect.deleteProperty(app.vault, "readBinary");
    };
    const release = (): void => {
      released = true;
      putBack();
      Reflect.deleteProperty(window, "inklineLetReadGo");
      Reflect.deleteProperty(window, "inklineReadHeld");
      Reflect.deleteProperty(window, "inklineAtEnd-next-read");
      go();
      if (call === undefined) return;
      // Kept until it ends, for undoStubs() to wait for.
      const known: unknown = Reflect.get(window, "inklineLetGo");
      const letGo = known instanceof Set ? known : new Set<unknown>();
      Reflect.set(window, "inklineLetGo", letGo);
      const entry = { gate: "next-read", call };
      letGo.add(entry);
      const forget = (): void => {
        letGo.delete(entry);
      };
      call.then(forget, forget);
    };
    Reflect.set(window, "inklineLetReadGo", release);
    Reflect.set(window, "inklineAtEnd-next-read", release);
    app.vault.readBinary = wrapper;
  }, file);
}

/** Waits for the read that {@link holdNextRead} set up to reach its gate. */
export async function waitForHeldRead(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => Reflect.get(window, "inklineReadHeld") === true),
    { timeoutMsg: "no read reached the gate" },
  );
}

/** Lets go a read that {@link holdNextRead} held, if there is one. */
export async function letReadGo(): Promise<void> {
  await browser.execute(() => {
    const release: unknown = Reflect.get(window, "inklineLetReadGo");
    if (typeof release === "function") Reflect.apply(release, undefined, []);
  });
}

/**
 * Has the next write to the vault wait for {@link letWriteGo}, as one on a drive
 * that has stopped answering does. It returns once the gate is in place, which
 * is before any write has come: {@link waitForHeldWrite} waits until one has
 * reached it.
 *
 * Its gate registers with `undoStubs()` in support/editor.ts, which lets the
 * write go if a test ends with it held. Let go either way, a write that has
 * reached the gate is kept in the renderer's `inklineLetGo` until it ends, so
 * that `undoStubs()` waits for it before the vault is reset. A write that has
 * not reached it is no longer held, and the gate takes itself off the vault
 * if nothing has been put over it. The gate's keys have fixed names, so it
 * refuses to be set up while an earlier one has not been let go.
 */
export async function holdNextWrite(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    if (Reflect.has(window, "inklineAtEnd-next-write")) {
      throw new Error("a write is already held: let it go first");
    }
    // What the vault had as its own, if anything, to put back.
    const ownBefore = Object.hasOwn(app.vault, "modifyBinary");
    const previous: unknown = Reflect.get(app.vault, "modifyBinary");
    const write = app.vault.modifyBinary.bind(app.vault);
    let go = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      go = resolve;
    });
    let released = false;
    /** The held write, once it has come. */
    let call: Promise<void> | undefined;
    const wrapper: typeof app.vault.modifyBinary = (...args) => {
      if (released) return write(...args);
      putBack();
      Reflect.set(window, "inklineWriteHeld", true);
      call = (async () => {
        await gate;
        await write(...args);
      })();
      return call;
    };
    /** Takes the wrapper off the vault, if it is still there. */
    const putBack = (): void => {
      if (Reflect.get(app.vault, "modifyBinary") !== wrapper) return;
      if (ownBefore) Reflect.set(app.vault, "modifyBinary", previous);
      else Reflect.deleteProperty(app.vault, "modifyBinary");
    };
    const release = (): void => {
      released = true;
      putBack();
      Reflect.deleteProperty(window, "inklineLetWriteGo");
      Reflect.deleteProperty(window, "inklineWriteHeld");
      Reflect.deleteProperty(window, "inklineAtEnd-next-write");
      go();
      if (call === undefined) return;
      // Kept until it ends, for undoStubs() to wait for.
      const known: unknown = Reflect.get(window, "inklineLetGo");
      const letGo = known instanceof Set ? known : new Set<unknown>();
      Reflect.set(window, "inklineLetGo", letGo);
      const entry = { gate: "next-write", call };
      letGo.add(entry);
      const forget = (): void => {
        letGo.delete(entry);
      };
      call.then(forget, forget);
    };
    Reflect.set(window, "inklineLetWriteGo", release);
    Reflect.set(window, "inklineAtEnd-next-write", release);
    app.vault.modifyBinary = wrapper;
  });
}

/** Waits for a write that {@link holdNextWrite} set up to reach the vault. */
export async function waitForHeldWrite(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => Reflect.get(window, "inklineWriteHeld") === true),
    { timeoutMsg: "no write reached the gate" },
  );
}

/** Lets go a write that {@link holdNextWrite} held, if there is one. */
export async function letWriteGo(): Promise<void> {
  await browser.execute(() => {
    const release: unknown = Reflect.get(window, "inklineLetWriteGo");
    if (typeof release === "function") Reflect.apply(release, undefined, []);
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
