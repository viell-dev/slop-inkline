// Steps for driving the editor in end-to-end tests.

import { browser } from "@wdio/globals";
import { Key, type ChainablePromiseElement } from "webdriverio";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "./browser.ts";

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
 * frame it sizes its preview line, so that a preview measured before it
 * would read the size of an empty canvas. Keyboard focus is ready at once.
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

/** Marks the open editor, so that {@link waitForNext} can tell it apart. */
export async function markEditor(): Promise<void> {
  await browser.execute(() => {
    for (const editor of document.querySelectorAll(".inkline-editor")) {
      editor.setAttribute("data-inkline-test-before", "");
    }
  });
}

/**
 * Waits for the next editor after Next: `count` symbol files saved, and an
 * editor that {@link markEditor} did not mark, whose status is still empty.
 */
export async function waitForNext(count: number): Promise<void> {
  const fresh = ".inkline-editor:not([data-inkline-test-before])";
  await browser.waitUntil(
    async () =>
      (await symbolFiles()).length === count &&
      (await browser.$(fresh).isExisting()) &&
      (await browser.$(`${fresh} .inkline-status`).getText()) === "",
    { timeoutMsg: `no editor after ${String(count)} symbols` },
  );
  await waitForEditor();
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

/** How to reach a fraction of the surface in an action with several sources. */
async function surfaceOffsets() {
  const { width, height } = await settledSurface();
  const canvas = await surface().getElement();
  return ([x, y]: readonly [number, number]) => ({
    origin: canvas,
    // Offsets are from the element's centre.
    x: Math.round((x - 0.5) * width),
    y: Math.round((y - 0.5) * height),
  });
}

/** A point of {@link drawShifted}, and whether Shift is down at it. */
export interface ShiftedPoint {
  /** Fractions of the surface's width and height from its top left corner. */
  readonly at: readonly [number, number];
  readonly shift: boolean;
}

/**
 * Draws with a mouse as {@link draw} does, with Shift down or up at each
 * point: pressed at the first, moved through the rest, and let go at the last
 * with Shift as `release` says, by default as it is there. Shift changes in a
 * step of its own before the pointer's, so that no pointer event comes between
 * the change and the event that reports it. It is up again afterwards.
 */
export async function drawShifted(
  points: readonly ShiftedPoint[],
  release = points.at(-1)?.shift ?? false,
): Promise<void> {
  const [first, ...rest] = points;
  if (first === undefined) return;
  const at = await surfaceOffsets();
  const keys = browser.action("key");
  const pointer = browser.action("pointer", {
    parameters: { pointerType: "mouse" },
  });
  let held = false;
  /** Brings Shift to `wanted`, while the pointer waits. */
  const shift = (wanted: boolean): void => {
    if (wanted === held) return;
    held = wanted;
    if (wanted) keys.down(Key.Shift);
    else keys.up(Key.Shift);
    pointer.pause(10);
  };
  /** Keeps the keys in step with the pointer's next action. */
  const step = (): void => {
    keys.pause(10);
  };
  shift(first.shift);
  step();
  pointer.move(at(first.at));
  step();
  pointer.down();
  for (const point of rest) {
    shift(point.shift);
    step();
    pointer.move({ ...at(point.at), duration: 20 });
  }
  shift(release);
  step();
  pointer.up();
  shift(false);
  await browser.actions([keys, pointer]);
}

/** Clicks at each point, as fractions of the surface, with Shift held. */
export async function shiftClick(
  ...points: readonly (readonly [number, number])[]
): Promise<void> {
  for (const at of points) await drawShifted([{ at, shift: true }]);
}

/**
 * Draws through points as {@link draw} does, with Shift held from before the
 * press until after the release, so that with the grid on the stroke starts
 * and ends on it.
 */
export async function drawHoldingShift(
  points: readonly (readonly [number, number])[],
): Promise<void> {
  await drawShifted(points.map((at) => ({ at, shift: true })));
}

/**
 * Moves a mouse to a point on the surface with no button down, with Shift
 * down or up as it says, and up again after.
 */
export async function hoverShifted({ at, shift }: ShiftedPoint): Promise<void> {
  const place = await surfaceOffsets();
  const keys = browser.action("key");
  const pointer = browser.action("pointer", {
    parameters: { pointerType: "mouse" },
  });
  if (shift) {
    keys.down(Key.Shift);
    pointer.pause(10);
  }
  keys.pause(10);
  pointer.move({ ...place(at), duration: 20 });
  if (shift) {
    keys.up(Key.Shift);
    pointer.pause(10);
  }
  await browser.actions([keys, pointer]);
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

/**
 * The open editor's usual grid, zoomed or not, in document pixels: from its
 * preview line's font, measured in the active window, and from Inkline's
 * stored settings, as `fontGrid` makes it.
 */
export async function editorGrid(): Promise<{
  spacing: number;
  rows: number[];
}> {
  if (!(await browser.execute(() => "inklineTest" in window))) {
    await loadModules();
  }
  return browser.executeObsidian(async ({ app }) => {
    const { guides, settings, view } = window.inklineTest;
    const line = activeDocument.querySelector(
      ".inkline-editor .inkline-preview",
    );
    if (line?.instanceOf(HTMLElement) !== true) throw new Error("no preview");
    const font = activeWindow.getComputedStyle(line);
    const metrics = view.measureFont(
      {
        style: font.fontStyle,
        weight: font.fontWeight,
        family: font.fontFamily,
      },
      activeDocument,
    );
    const path = `${app.vault.configDir}/plugins/inkline/data.json`;
    const stored: unknown = (await app.vault.adapter.exists(path))
      ? JSON.parse(await app.vault.adapter.read(path))
      : undefined;
    const chosen = settings.readSettings(stored, 4);
    const shown = settings.shownGuides(chosen);
    const { spacing, rows } = guides.fontGrid(
      guides.fontGuides(metrics).filter((guide) => shown.has(guide.name)),
      metrics.xHeight * 128,
      chosen.gridCells,
    );
    return { spacing, rows: [...rows] };
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

/**
 * Writes a symbol file at `path`, with its folders, holding one stroke 16
 * pixels wide for each of `xs`, in the format the editor saves. Needs
 * `loadModules`, from browser.ts.
 */
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
 * Adds `text` at the start or end of the note at `path`, through its editor in
 * `pane`, in the workspace's order, and leaves it unsaved. Waits for every
 * editor of the note to have it, as Obsidian passes it on a moment later.
 */
export async function addUnsaved(
  path: string,
  text: string,
  place: "start" | "end",
  pane = 0,
): Promise<void> {
  const wanted = await browser.executeObsidian(
    ({ app, obsidian }, file, added, end, index) => {
      const editors = [];
      for (const { view } of app.workspace.getLeavesOfType("markdown")) {
        if (view instanceof obsidian.MarkdownView && view.file?.path === file) {
          editors.push(view.editor);
        }
      }
      const editor = editors[index];
      if (editor === undefined)
        throw new Error(`no pane ${String(index)} of ${file}`);
      const at = end ? editor.getValue().length : 0;
      editor.replaceRange(added, editor.offsetToPos(at));
      return editor.getValue();
    },
    path,
    text,
    place === "end",
    pane,
  );
  await waitForPanes(path, wanted);
}

/** Waits for every editor of the note at `path` to read `text`. */
export async function waitForPanes(path: string, text: string): Promise<void> {
  let read: string[] = [];
  try {
    await browser.waitUntil(async () => {
      read = await browser.executeObsidian(({ app, obsidian }, file) => {
        const shown: string[] = [];
        for (const { view } of app.workspace.getLeavesOfType("markdown")) {
          if (
            view instanceof obsidian.MarkdownView &&
            view.file?.path === file
          ) {
            shown.push(view.editor.getValue());
          }
        }
        return shown;
      }, path);
      return read.length > 0 && read.every((shown) => shown === text);
    });
  } catch (error) {
    throw new Error(
      `waited for ${JSON.stringify(text)}, but ${path} read ${JSON.stringify(read)}`,
      { cause: error },
    );
  }
}

/**
 * Has saving a note fail, as on a full disk, until what it returns is called.
 * A symbol's file is written another way, so that goes on working.
 */
export async function failSaves(): Promise<() => Promise<void>> {
  await browser.executeObsidian(({ app }) => {
    app.vault.modify = () => Promise.reject(new Error("the disk is full"));
  });
  return async () => {
    await browser.executeObsidian(({ app }) => {
      Reflect.deleteProperty(app.vault, "modify");
    });
  };
}

/**
 * Writes a picture as a symbol: a `side` square of noise, which PNG cannot
 * compress, in every `spacing`th pixel.
 */
export async function writeNoise(
  file: string,
  side: number,
  spacing = 1,
): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, filePath, size, every) => {
      const { canvas } = window.inklineTest;
      const data = new Uint8ClampedArray(size * size * 4);
      let seed = 7;
      for (let index = 0; index < size * size; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        if (index % every === 0) data[index * 4 + 3] = seed >>> 24;
      }
      const bytes = await canvas.encodePixels({
        width: size,
        height: size,
        data,
      });
      await app.vault.createBinary(filePath, bytes.slice().buffer);
    },
    file,
    side,
    spacing,
  );
}

/** Opens the editor on a symbol file. */
export async function editFile(file: string): Promise<void> {
  await browser.executeObsidian(({ app, plugins }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    void plugins.inkline.editSymbol(found);
  }, file);
  await waitForEditor();
}

/**
 * Opens the editor on a symbol file, and reports what that took: until it was
 * there, and until it had painted, and what the main thread went through
 * meanwhile. A long task still running would not be reported yet.
 */
export async function timedEditorOpen(file: string) {
  return browser.executeObsidian(async ({ app, plugins }, wanted) => {
    const { mainThread } = window.inklineTest;
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const thread = mainThread.watchMainThread();
    const start = performance.now();
    void plugins.inkline.editSymbol(found);
    while (document.querySelector(".inkline-editor") === null) {
      await new Promise((resolve) => window.setTimeout(resolve, 2));
    }
    const shownMs = performance.now() - start;
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
    const totalMs = performance.now() - start;
    return { shownMs, totalMs, thread: thread() };
  }, file);
}

/**
 * Saves the open editor by its button, which closes it, and reports what that
 * took: from pressing it to the editor closing, and each read and write of the
 * vault meanwhile, which is the part that a stalled save would wait on.
 */
export async function timedEditorSave() {
  return browser.executeObsidian(async ({ app }) => {
    const { mainThread } = window.inklineTest;
    const button = document.querySelector<HTMLElement>(
      '[data-inkline-button="save"]',
    );
    if (button === null) throw new Error("no save button");
    const thread = mainThread.watchMainThread();
    const vault = mainThread.watchVault(app.vault);
    const bases = mainThread.watchDraftBases(app);
    const start = performance.now();
    button.click();
    while (document.querySelector(".inkline-editor") !== null) {
      await new Promise((resolve) => window.setTimeout(resolve, 2));
    }
    const totalMs = performance.now() - start;
    return { totalMs, thread: thread(), vault: vault(), bases: bases() };
  });
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

/** What a save or a rename can stop in, as on a drive that stopped answering. */
const holdable = {
  /** Obsidian's own move of a file, in the real `renameFile`. */
  move: { owner: "adapter", method: "rename", ending: ".ink.png" },
  /** A note's save, which comes before the move. */
  save: { owner: "adapter", method: "write", ending: ".md" },
  /**
   * A note's read, as a rename reads each open note before the move, to see
   * whether it has text to save.
   */
  read: { owner: "vault", method: "read", ending: ".md" },
  /** A symbol's save, which comes before an editor's rename. */
  write: { owner: "vault", method: "modifyBinary", ending: ".ink.png" },
  /** A link's update in a note, which comes after the move. */
  link: { owner: "vault", method: "process", ending: ".md" },
  /**
   * Obsidian's index reading a note it has not indexed yet, which it reads as
   * bytes. Obsidian's `renameFile` waits for the index before the move.
   */
  index: { owner: "adapter", method: "readBinary", ending: ".md" },
} as const;

/**
 * Has `what` wait until {@link letGo}, for every file whose path ends with
 * `ending`, `what`'s own by default.
 */
export async function hold(
  what: keyof typeof holdable,
  ending: string = holdable[what].ending,
): Promise<void> {
  await browser.executeObsidian(
    ({ app }, { owner, method }, end) => {
      const target = owner === "adapter" ? app.vault.adapter : app.vault;
      const original: unknown = Reflect.get(target, method);
      if (typeof original !== "function") throw new Error(`no ${method}`);
      let settle: (failure?: string) => void = () => undefined;
      const gate = new Promise<void>((resolve, reject) => {
        settle = (failure) => {
          if (failure === undefined) resolve();
          else reject(new Error(failure));
        };
      });
      Reflect.set(window, "inklineHeldOwner", owner);
      Reflect.set(window, "inklineHeldMethod", method);
      Reflect.set(window, "inklineSettle", settle);
      Reflect.set(
        target,
        method,
        async (...args: unknown[]): Promise<unknown> => {
          const [first] = args;
          const path =
            typeof first === "object" && first !== null
              ? (Reflect.get(first, "path") as unknown)
              : first;
          if (typeof path === "string" && path.endsWith(end)) {
            Reflect.set(window, "inklineHeld", true);
            await gate;
          }
          return Reflect.apply(original, target, args) as unknown;
        },
      );
    },
    holdable[what],
    ending,
  );
}

/** Waits for what {@link hold} held to be reached. */
export async function waitForHeld(): Promise<void> {
  await browser.waitUntil(async () =>
    browser.execute(() => Reflect.get(window, "inklineHeld") === true),
  );
}

/** Lets go what {@link hold} held, or fails it with `failure`. */
export async function letGo(failure?: string): Promise<void> {
  await browser.executeObsidian(({ app }, reason) => {
    const settle: unknown = Reflect.get(window, "inklineSettle");
    const owner: unknown = Reflect.get(window, "inklineHeldOwner");
    const method: unknown = Reflect.get(window, "inklineHeldMethod");
    if (typeof method === "string") {
      // Held, it became the object's own, over what its prototype has.
      Reflect.deleteProperty(
        owner === "adapter" ? app.vault.adapter : app.vault,
        method,
      );
    }
    for (const key of [
      "inklineSettle",
      "inklineHeldOwner",
      "inklineHeldMethod",
      "inklineHeld",
    ]) {
      Reflect.deleteProperty(window, key);
    }
    if (typeof settle === "function") {
      Reflect.apply(settle, undefined, [reason ?? undefined]);
    }
  }, failure ?? null);
}

/**
 * Holds Obsidian's index, until {@link letGo}, on a note that arrives in the
 * vault as from sync, so that what waits for the index to catch up with the
 * whole vault waits, as Obsidian's `renameFile` does before it moves a file.
 */
export async function holdIndex(): Promise<void> {
  await hold("index", "Synced.md");
  await browser.executeObsidian(async ({ app }) => {
    // New text each time, which the index has not seen.
    await app.vault.create("Synced.md", `Arrived at ${String(Date.now())}.\n`);
  });
  await waitForHeld();
}

/**
 * Waits until something waits for Obsidian's index, as Obsidian's `renameFile`
 * does before it moves a file, and a rename by Inkline before it calls that.
 * Obsidian keeps what waits in the metadata cache's `onCleanCacheCallbacks`,
 * which is not in its API.
 */
export async function waitForIndexWait(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(({ app }) => {
        const waiting: unknown = Reflect.get(
          app.metadataCache,
          "onCleanCacheCallbacks",
        );
        return Array.isArray(waiting) && waiting.length > 0;
      }),
    { timeoutMsg: "nothing waited for Obsidian's index" },
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
    strokes: { tool: string; points: readonly number[]; kind?: string }[];
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
      strokes: draft.strokes.map((stroke) => ({
        tool: stroke.tool,
        points: stroke.points,
        ...(stroke.kind === undefined ? {} : { kind: stroke.kind }),
      })),
      base: draft.base.kind,
      ...(draft.base.kind === "kept" ? { baseX: draft.base.layer.x } : {}),
      ...(draft.name === undefined ? {} : { name: draft.name }),
    }));
  });
}
