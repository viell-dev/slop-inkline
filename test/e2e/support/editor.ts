// Steps for driving the editor in end-to-end tests.

import { browser } from "@wdio/globals";
import type { ChainablePromiseElement } from "webdriverio";
import { obsidianPage } from "wdio-obsidian-service";

/** Opens a note in the editor and puts the cursor where `marker` was, removing it. */
export async function openAtMarker(
  path: string,
  marker: string,
): Promise<void> {
  await showNote(path);
  // The editor can show the note a moment after the file opens.
  await browser.waitUntil(async () =>
    browser.executeObsidian(
      ({ app, obsidian }, file, text) => {
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        return (
          view?.file?.path === file && view.editor.getValue().includes(text)
        );
      },
      path,
      marker,
    ),
  );
  const at = await browser.executeObsidian(({ app, obsidian }, text) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (view === null) throw new Error("no Markdown view");
    const editor = view.editor;
    const found = editor.getValue().indexOf(text);
    if (found === -1) throw new Error(`no ${text} in the note`);
    editor.setSelection(
      editor.offsetToPos(found),
      editor.offsetToPos(found + text.length),
    );
    editor.replaceSelection("");
    editor.focus();
    return found;
  }, marker);
  // Removed beside a code span's backtick, the marker can leave Live
  // Preview's selection reaching past it once the editor redraws the span,
  // so the cursor is put where the marker was until it stays there for two
  // checks running.
  let held = 0;
  await browser.waitUntil(
    async () => {
      const there = await browser.executeObsidian(
        ({ app, obsidian }, offset) => {
          const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
          if (view === null) throw new Error("no Markdown view");
          const editor = view.editor;
          const from = editor.posToOffset(editor.getCursor("from"));
          const to = editor.posToOffset(editor.getCursor("to"));
          if (from === offset && to === offset) return true;
          editor.setCursor(editor.offsetToPos(offset));
          return false;
        },
        at,
      );
      held = there ? held + 1 : 0;
      return held >= 2;
    },
    { interval: 50 },
  );
}

/** The active note's text, as the editor has it. */
export async function noteText(): Promise<string> {
  return browser.executeObsidian(({ app, obsidian }) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (view === null) throw new Error("no Markdown view");
    return view.editor.getValue();
  });
}

/** Waits for a notice whose text includes `text`. */
export async function waitForNotice(text: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (wanted) =>
          [...document.querySelectorAll(".notice")].some((notice) =>
            notice.textContent.includes(wanted),
          ),
        text,
      ),
    { timeoutMsg: `no notice with "${text}"` },
  );
}

/** The editor's drawing surface. */
export function surface(): ChainablePromiseElement {
  return browser.$(".inkline-editor .inkline-surface");
}

/**
 * Shows the note at `path`, in the tab that already shows it if one does.
 * `obsidianPage.openFile` opens a new tab each time, and in Obsidian 1.13.4
 * and 1.14.4 a note opened in a second tab just after an edit in the first
 * can miss that edit, which an edit in the second then overwrites, on disk
 * and in both tabs: a test's next step would lose what the one before it
 * inserted.
 */
async function showNote(path: string): Promise<void> {
  const shown = await browser.executeObsidian(({ app, obsidian }, file) => {
    const leaf = app.workspace
      .getLeavesOfType("markdown")
      .find(
        (candidate) =>
          candidate.view instanceof obsidian.MarkdownView &&
          candidate.view.file?.path === file,
      );
    if (leaf === undefined) return false;
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return true;
  }, path);
  if (!shown) await obsidianPage.openFile(path);
}

/**
 * Waits for the editor to be open and to have drawn its first frame. In that
 * frame it takes the focus back from where Obsidian puts it, the name field,
 * and sizes its preview line, so that a key pressed before it would go to
 * the name field, and the preview would read the size of an empty canvas.
 */
export async function waitForEditor(): Promise<void> {
  await surface().waitForDisplayed();
  await browser.execute(
    () =>
      new Promise<void>((resolve) => {
        const canvas = document.querySelector(
          ".inkline-editor .inkline-surface",
        );
        const win = canvas?.ownerDocument.defaultView ?? window;
        win.requestAnimationFrame(() => {
          win.requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
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
  const { width, height } = await settledSurface();
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
  timeout = 20_000,
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

/**
 * Waits for the surface to stop growing, as the modal does when it opens,
 * and returns its size.
 */
export async function settledSurface(): Promise<{
  width: number;
  height: number;
}> {
  const canvas = surface();
  await canvas.waitForDisplayed();
  let size = await canvas.getSize();
  await browser.waitUntil(async () => {
    const previous = size;
    await browser.pause(50);
    size = await canvas.getSize();
    return size.width === previous.width && size.height === previous.height;
  });
  return size;
}

/**
 * The guides the surface shows, in the active window, against the font lines
 * that an independent `measureText` of the preview line's font, in that
 * window, predicts: how many it predicts,
 * how many of their pixel rows are drawn across at least 30% of the width,
 * as dashes are, and how many pixels the surface draws at all.
 */
export async function guideRows(): Promise<{
  lines: number;
  shown: number;
  drawn: number;
  rows: number[];
}> {
  return browser.execute(() => {
    const doc = activeDocument;
    const view = doc.defaultView;
    if (view === null) throw new Error("no window");
    const canvas = doc.querySelector(".inkline-editor .inkline-surface");
    const line = doc.querySelector(".inkline-editor .inkline-preview");
    // Obsidian's check, since a popout's elements can come from either
    // window.
    if (
      canvas?.instanceOf(HTMLCanvasElement) !== true ||
      line?.instanceOf(HTMLElement) !== true
    ) {
      throw new Error("no surface");
    }
    const font = view.getComputedStyle(line);
    const context = new view.OffscreenCanvas(1, 1).getContext("2d");
    if (context === null) throw new Error("no context");
    context.font = `${font.fontStyle} ${font.fontWeight} 128px ${font.fontFamily}`;
    const capital = context.measureText("H");
    const lowercase = context.measureText("x");
    const factor = canvas.width / 576;
    const rows = [
      144 - capital.fontBoundingBoxAscent,
      144 - capital.actualBoundingBoxAscent,
      144 - lowercase.actualBoundingBoxAscent,
      144,
      144 + capital.fontBoundingBoxDescent,
    ]
      .filter((y) => y >= 0 && y <= 192)
      .map((y) => Math.round(y * factor));
    const pixels = canvas
      .getContext("2d")
      ?.getImageData(0, 0, canvas.width, canvas.height);
    if (pixels === undefined) throw new Error("no pixels");
    const across = (row: number): number => {
      let count = 0;
      for (let x = 0; x < canvas.width; x++) {
        if ((pixels.data[(row * canvas.width + x) * 4 + 3] ?? 0) > 0) count++;
      }
      return count;
    };
    let drawn = 0;
    for (let index = 3; index < pixels.data.length; index += 4) {
      if ((pixels.data[index] ?? 0) > 0) drawn++;
    }
    return {
      lines: rows.length,
      shown: rows.filter((row) => across(row) >= 0.3 * canvas.width).length,
      drawn,
      rows,
    };
  });
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

/** Creates a synthetic symbol with one stroke for each x coordinate. */
export async function createSymbol(
  path: string,
  xs: readonly number[] = [400],
): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, filePath, starts) => {
      const { bytes } = await window.inklineTest.canvas.saveInk(
        {
          strokes: starts.map((x) => ({
            tool: "pen" as const,
            size: 256,
            pressure: false,
            points: [x, 800, x + 400, 2000],
          })),
        },
        undefined,
        [],
      );
      const folder = filePath.slice(0, Math.max(0, filePath.lastIndexOf("/")));
      if (folder !== "" && app.vault.getFolderByPath(folder) === null) {
        await app.vault.createFolder(folder);
      }
      await app.vault.createBinary(filePath, bytes.slice().buffer);
    },
    path,
    xs,
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
    { interval: 300, timeoutMsg: "modals stayed open" },
  );
  await browser.executeObsidian(async ({ app, obsidian }) => {
    // A note's tab saves what it holds when it closes, without waiting, so
    // that save could land after the vault is reset below. So every note is
    // saved first, and the reset waits for each save under way and the one
    // it queues: save() returns at once while another runs. Obsidian keeps
    // that state in the view's private `saving` and `saveAgain`.
    const views: object[] = [];
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof obsidian.MarkdownView) views.push(leaf.view);
    }
    const settled = async (): Promise<void> => {
      const busy = () =>
        views.some(
          (view) =>
            Reflect.get(view, "saving") === true ||
            Reflect.get(view, "saveAgain") === true,
        );
      const until = Date.now() + 15_000;
      while (busy()) {
        if (Date.now() > until) throw new Error("a note is still saving");
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      }
    };
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof obsidian.MarkdownView) await leaf.view.save();
    }
    await settled();
    // Detaching while iterating would skip leaves, so collect them first:
    // the main window's, and every one in a popout window.
    const leaves: { detach(): void }[] = [];
    app.workspace.iterateRootLeaves((leaf) => leaves.push(leaf));
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view.containerEl.doc !== document) leaves.push(leaf);
    }
    for (const leaf of leaves) leaf.detach();
    // Closing saves too.
    await settled();
    for (let index = window.localStorage.length - 1; index >= 0; index--) {
      const key = window.localStorage.key(index);
      if (key?.includes("inkline-draft") === true) {
        window.localStorage.removeItem(key);
      }
    }
  });
  await freeStorage();
  await restoreVault();
  await restoreDecoding();
  await obsidianPage.resetVault();
}

const delayable = [
  "createBinary",
  "modify",
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

/**
 * Makes `createImageBitmap`, which decodes base layers, take `ms` longer,
 * until {@link restoreDecoding}.
 */
export async function delayDecoding(ms: number): Promise<void> {
  await browser.execute((wait) => {
    const original: unknown = Reflect.get(window, "createImageBitmap");
    if (typeof original !== "function") throw new Error("no createImageBitmap");
    Reflect.set(window, "inklineCreateImageBitmap", original);
    Reflect.set(
      window,
      "createImageBitmap",
      async (...args: unknown[]): Promise<unknown> => {
        await new Promise((resolve) => window.setTimeout(resolve, wait));
        const result: unknown = await Reflect.apply(original, window, args);
        return result;
      },
    );
  }, ms);
}

/** Undoes {@link delayDecoding}. */
export async function restoreDecoding(): Promise<void> {
  await browser.execute(() => {
    const original: unknown = Reflect.get(window, "inklineCreateImageBitmap");
    if (typeof original !== "function") return;
    Reflect.set(window, "createImageBitmap", original);
    Reflect.deleteProperty(window, "inklineCreateImageBitmap");
  });
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
    name?: string;
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
      ...(draft.name === undefined ? {} : { name: draft.name }),
    }));
  });
}
