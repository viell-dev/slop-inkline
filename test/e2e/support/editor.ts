// Steps for driving the editor in end-to-end tests.

import { browser } from "@wdio/globals";
import type { ChainablePromiseElement } from "webdriverio";
import { obsidianPage } from "wdio-obsidian-service";

/** Opens a note in the editor and puts the cursor where `marker` was, removing it. */
export async function openAtMarker(
  path: string,
  marker: string,
): Promise<void> {
  await obsidianPage.openFile(path);
  await browser.executeObsidian(({ app, obsidian }, text) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (view === null) throw new Error("no Markdown view");
    const editor = view.editor;
    const at = editor.getValue().indexOf(text);
    if (at === -1) throw new Error(`no ${text} in the note`);
    editor.setSelection(
      editor.offsetToPos(at),
      editor.offsetToPos(at + text.length),
    );
    editor.replaceSelection("");
    editor.focus();
  }, marker);
}

/** The active note's text, as the editor has it. */
export async function noteText(): Promise<string> {
  return browser.executeObsidian(({ app, obsidian }) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (view === null) throw new Error("no Markdown view");
    return view.editor.getValue();
  });
}

/** The editor's drawing surface. */
export function surface(): ChainablePromiseElement {
  return browser.$(".inkline-editor .inkline-surface");
}

/** Waits for the editor to be open. */
export async function waitForEditor(): Promise<void> {
  await surface().waitForDisplayed();
}

/**
 * Draws through points on the surface with a mouse, as fractions of its
 * width and height from its top left corner.
 */
export async function draw(
  points: readonly (readonly [number, number])[],
  pointerType: "mouse" | "pen" | "touch" = "mouse",
): Promise<void> {
  const canvas = surface();
  await canvas.waitForDisplayed();
  // The modal grows into place when it opens; wait until it has.
  let size = await canvas.getSize();
  await browser.waitUntil(async () => {
    const previous = size;
    await browser.pause(50);
    size = await canvas.getSize();
    return size.width === previous.width && size.height === previous.height;
  });
  const { width, height } = size;
  const at = ([x, y]: readonly [number, number]) => ({
    origin: canvas,
    // Offsets are from the element's centre.
    x: Math.round((x - 0.5) * width),
    y: Math.round((y - 0.5) * height),
  });
  const [first, ...rest] = points;
  if (first === undefined) return;
  const action = browser.action("pointer", { parameters: { pointerType } });
  action.move(at(first)).down();
  for (const point of rest) action.move({ ...at(point), duration: 20 });
  action.up();
  await action.perform();
}

/**
 * Waits for the editor's status line to say `text`, failing with what it last
 * said.
 */
export async function waitForStatus(
  text: string,
  timeout = 10_000,
): Promise<void> {
  const status = browser.$(".inkline-status");
  let shown = "";
  try {
    await browser.waitUntil(
      async () => {
        shown = (await status.isExisting()) ? await status.getText() : "";
        return shown.includes(text);
      },
      { timeout },
    );
  } catch (error) {
    throw new Error(`waited for "${text}", but the status said "${shown}"`, {
      cause: error,
    });
  }
}

/** Whether the editor is open. */
export async function editorOpen(): Promise<boolean> {
  return browser.$(".inkline-editor").isExisting();
}

/** The symbol files in the vault, by path. */
export async function symbolFiles(): Promise<string[]> {
  return browser.executeObsidian(({ app }) =>
    app.vault
      .getFiles()
      .map((file) => file.path)
      .filter((path) => path.endsWith(".ink.png"))
      .sort(),
  );
}

/** The record a symbol file holds, as JSON, or why it has none. */
export async function recordOf(path: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, filePath) => {
    const file = app.vault.getFileByPath(filePath);
    if (file === null) throw new Error(`no ${filePath}`);
    const { inkFile, record } = window.inklineTest;
    const source = await inkFile.readInkFile(
      new Uint8Array(await app.vault.readBinary(file)),
    );
    return source.kind === "record"
      ? record.serializeRecord(source.record)
      : JSON.stringify(source);
  }, path);
}

/** A button in the topmost modal, such as the close question's. */
export async function topButton(
  text: string,
): Promise<WebdriverIO.Element | undefined> {
  const containers = await browser.$$(".modal-container").getElements();
  const top = containers.at(-1);
  if (top === undefined) return undefined;
  const button = await top.$(`button=${text}`).getElement();
  return (await button.isExisting()) ? button : undefined;
}

/** Clicks a button in the topmost modal, waiting for it to appear. */
export async function clickTop(text: string): Promise<void> {
  await browser.waitUntil(async () => (await topButton(text)) !== undefined, {
    timeoutMsg: `no "${text}" button`,
  });
  await (await topButton(text))?.click();
}

/**
 * Closes every modal, discarding unsaved drawings, and every note, then
 * restores the vault and clears drafts, so that each test starts from the
 * same state.
 */
export async function startOver(): Promise<void> {
  await browser.waitUntil(
    async () => {
      if (!(await browser.$(".modal-container").isExisting())) return true;
      const discard = await topButton("Discard");
      if (discard !== undefined) await discard.click();
      else await browser.keys(["Escape"]);
      return false;
    },
    { timeout: 10_000, interval: 300, timeoutMsg: "modals stayed open" },
  );
  await browser.executeObsidian(({ app }) => {
    // Detaching while iterating would skip leaves, so collect them first.
    const leaves: { detach(): void }[] = [];
    app.workspace.iterateRootLeaves((leaf) => leaves.push(leaf));
    for (const leaf of leaves) leaf.detach();
    for (let index = window.localStorage.length - 1; index >= 0; index--) {
      const key = window.localStorage.key(index);
      if (key?.includes("inkline-draft") === true) {
        window.localStorage.removeItem(key);
      }
    }
  });
  await freeStorage();
  await restoreVault();
  await obsidianPage.resetVault();
}

const delayable = [
  "createBinary",
  "modifyBinary",
  "readBinary",
  "process",
] as const;

/**
 * Makes a vault method wait `ms` before it starts its work, or after it has
 * done it and before it resolves, until {@link restoreVault}, so that a test
 * can act meanwhile.
 */
export async function delayVault(
  name: (typeof delayable)[number],
  ms: number,
  when: "before" | "after" = "after",
): Promise<void> {
  await browser.executeObsidian(
    ({ app }, method, wait, first) => {
      const original: unknown = Reflect.get(app.vault, method);
      if (typeof original !== "function") throw new Error(`no ${method}`);
      const pause = () =>
        new Promise((resolve) => window.setTimeout(resolve, wait));
      Reflect.set(app.vault, `inklineDelayed-${method}`, original);
      Reflect.set(
        app.vault,
        method,
        async (...args: unknown[]): Promise<unknown> => {
          if (first === "before") await pause();
          const result: unknown = await Reflect.apply(
            original,
            app.vault,
            args,
          );
          if (first === "after") await pause();
          return result;
        },
      );
    },
    name,
    ms,
    when,
  );
}

/** Undoes every {@link delayVault}. */
export async function restoreVault(): Promise<void> {
  await browser.executeObsidian(
    ({ app }, methods) => {
      for (const method of methods) {
        const original: unknown = Reflect.get(
          app.vault,
          `inklineDelayed-${method}`,
        );
        if (typeof original !== "function") continue;
        Reflect.set(app.vault, method, original);
        Reflect.deleteProperty(app.vault, `inklineDelayed-${method}`);
      }
    },
    [...delayable],
  );
}

const fillerPrefix = "inkline-test-filler:";

/**
 * Fills the renderer's local storage until it refuses even a few characters
 * more, as a full disk or a quota would, and returns how many characters it
 * took. {@link freeStorage} empties it again.
 */
export async function fillStorage(): Promise<number> {
  return browser.execute((prefix) => {
    let count = 0;
    let filled = 0;
    for (let size = 1024 * 1024; size >= 1; size = Math.floor(size / 4)) {
      const value = "x".repeat(size);
      for (;;) {
        try {
          window.localStorage.setItem(`${prefix}${String(count)}`, value);
        } catch {
          break;
        }
        count++;
        filled += size;
      }
    }
    return filled;
  }, fillerPrefix);
}

/** Removes what {@link fillStorage} wrote. */
export async function freeStorage(): Promise<void> {
  await browser.execute((prefix) => {
    for (let index = window.localStorage.length - 1; index >= 0; index--) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(prefix) === true) window.localStorage.removeItem(key);
    }
  }, fillerPrefix);
}

/** The drafts kept in the vault's local storage, newest first. */
export async function storedDrafts(): Promise<
  {
    id: string;
    target: unknown;
    strokes: { points: readonly number[] }[];
    base: string;
    baseX?: number;
  }[]
> {
  return browser.executeObsidian(({ app }) => {
    const { drafts } = window.inklineTest;
    return new drafts.DraftStore(app).list().map((draft) => ({
      id: draft.id,
      target: draft.target,
      strokes: draft.strokes.map((stroke) => ({ points: stroke.points })),
      base: draft.base.kind,
      ...(draft.base.kind === "kept" ? { baseX: draft.base.layer.x } : {}),
    }));
  });
}
