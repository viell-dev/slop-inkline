// Steps for driving the editor in end-to-end tests.

import { browser } from "@wdio/globals";
import type { TFile } from "obsidian";
import { Key, type ChainablePromiseElement } from "webdriverio";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "./browser.ts";
import { framesDrawn } from "./waits.ts";

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
  // Any editor's: a second can open over the first, as the command palette
  // can open it, and the frames below are drawn for both.
  await browser
    .$(".inkline-editor .inkline-surface", { strict: false })
    .waitForDisplayed();
  await framesDrawn();
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
 * and returns its size: until two reads of its size 50 ms apart agree. The
 * reads and the waits between them run in the page, in one round trip. The
 * size is the element's layout size in whole pixels, `offsetWidth` and
 * `offsetHeight`, which is what WebDriver's element rect, and so
 * `getSize()`, gives in Obsidian's chromedriver.
 */
export async function settledSurface(): Promise<{
  width: number;
  height: number;
}> {
  await surface().waitForDisplayed();
  const timeout = browser.options.waitforTimeout ?? 20_000;
  const settled = await browser.execute(async (wait) => {
    // The element surface() finds, in the window the test is in.
    const read = () => {
      const canvas = document.querySelector(".inkline-editor .inkline-surface");
      // Obsidian's check, since a popout's elements can come from either
      // window.
      if (canvas?.instanceOf(HTMLElement) !== true) return null;
      return { width: canvas.offsetWidth, height: canvas.offsetHeight };
    };
    const until = performance.now() + wait;
    let size = read();
    while (size !== null) {
      const previous = size;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      size = read();
      if (size?.width === previous.width && size.height === previous.height) {
        return size;
      }
      if (performance.now() > until) return "unsettled";
    }
    return "missing";
  }, timeout);
  if (settled === "missing") throw new Error("the surface went missing");
  if (settled === "unsettled") {
    throw new Error(`the surface did not settle in ${String(timeout)} ms`);
  }
  return settled;
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
  await loadModules();
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
  await waitForTop(text);
  await (await topButton(text))?.click();
}

/** The answers to Obsidian's question about updating links after a rename. */
const linkAnswers: readonly string[] = [
  "Always update",
  "Just once",
  "Do not update",
];

/**
 * Waits for a button to appear in the topmost modal. If it is one of the
 * answers to Obsidian's question about links and does not come, the error
 * also says what Obsidian knew at each rename since the test began, as
 * {@link recordRenames} kept it, so that a rename that ends without the
 * question says why (#386).
 */
export async function waitForTop(text: string): Promise<void> {
  try {
    await browser.waitUntil(async () => (await topButton(text)) !== undefined, {
      timeoutMsg: `no "${text}" button`,
    });
  } catch (error) {
    if (!linkAnswers.includes(text)) throw error;
    const renames = await browser.execute(() =>
      JSON.stringify(Reflect.get(window, "inklineRenameRecord") ?? null),
    );
    throw new Error(`no "${text}" button; the renames: ${renames}`, {
      cause: error,
    });
  }
}

/**
 * Keeps a record in the renderer, until the next {@link undoStubs}, of what
 * Obsidian knew at each rename, for {@link waitForTop} to report. Obsidian
 * asks about links only if its index, once clean, knows of some to the file,
 * and only while its setting says to ask. So as each rename starts, the record
 * holds whether the index is clean, how many files it is still reading, the
 * notes that its resolved links say link to the file, and, for each open note,
 * whether its cache knows the link; and, once Obsidian has collected the links
 * to update, how many lead to the file, from which notes, whether the setting
 * says to ask, and how long the update took, question and all. The index and
 * the link update are Obsidian's own, so what is not of the type expected is
 * left out. Each call goes straight on to Obsidian's, with nothing awaited.
 */
async function recordRenames(): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }) => {
    const { fileManager: manager, metadataCache: cache, vault } = app;
    const record: Record<string, unknown>[] = [];
    const started = performance.now();
    const now = (): number => Math.round(performance.now() - started);
    /** The file the latest rename moves, which its link update is about. */
    let renaming: unknown;
    const index = (): Record<string, unknown> => {
      const clean: unknown = Reflect.get(cache, "isCacheClean");
      const reading: unknown = Reflect.get(cache, "inProgressTaskCount");
      return {
        clean:
          typeof clean === "function"
            ? (Reflect.apply(clean, cache, []) as unknown)
            : undefined,
        reading: typeof reading === "number" ? reading : undefined,
      };
    };
    const asks = (): unknown => {
      const config: unknown = Reflect.get(vault, "getConfig");
      return typeof config === "function"
        ? Reflect.apply(config, vault, ["alwaysUpdateLinks"]) !== true
        : undefined;
    };
    const linkedFrom = (file: TFile): Record<string, string> => {
      const notes: Record<string, string> = {};
      for (const { view } of app.workspace.getLeavesOfType("markdown")) {
        if (!(view instanceof obsidian.MarkdownView) || view.file === null) {
          continue;
        }
        const from = view.file.path;
        const known = cache.getFileCache(view.file);
        const links = [...(known?.links ?? []), ...(known?.embeds ?? [])];
        notes[from] =
          known === null
            ? "no cache"
            : links.some(
                  ({ link }) =>
                    cache.getFirstLinkpathDest(
                      obsidian.getLinkpath(link),
                      from,
                    ) === file,
                )
              ? "links"
              : "no link";
      }
      return notes;
    };
    const wrap = (
      name: "renameFile" | "updateAllLinks",
      note: (args: unknown[]) => Record<string, unknown>,
    ): (() => void) => {
      const original: unknown = Reflect.get(manager, name);
      if (typeof original !== "function") return () => undefined;
      const ownBefore = Object.hasOwn(manager, name);
      const recording = function (this: unknown, ...args: unknown[]): unknown {
        const entry = { at: now(), step: name, ...note(args) };
        record.push(entry);
        const result: unknown = Reflect.apply(original, this, args);
        if (result instanceof Promise) {
          const ended = (): void => {
            Reflect.set(entry, "took", now() - entry.at);
          };
          void result.then(ended, ended);
        }
        return result;
      };
      Reflect.set(manager, name, recording);
      return () => {
        if (Reflect.get(manager, name) !== recording) return;
        if (ownBefore) Reflect.set(manager, name, original);
        else Reflect.deleteProperty(manager, name);
      };
    };
    const undo = [
      wrap("renameFile", ([file, to]) => {
        renaming = file;
        if (!(file instanceof obsidian.TFile)) return { to };
        return {
          from: file.path,
          to,
          ...index(),
          resolved: Object.entries(cache.resolvedLinks)
            .filter(([, targets]) => (targets[file.path] ?? 0) > 0)
            .map(([from]) => from),
          open: linkedFrom(file),
        };
      }),
      wrap("updateAllLinks", ([links]) => {
        const found = Array.isArray(links) ? (links as unknown[]) : [];
        const sources = found.flatMap((link) => {
          if (typeof link !== "object" || link === null) return [];
          const source: unknown = Reflect.get(link, "sourceFile");
          return Reflect.get(link, "resolvedFile") === renaming &&
            source instanceof obsidian.TFile
            ? [source.path]
            : [];
        });
        return {
          links: found.length,
          toFile: sources,
          asks: asks(),
          ...index(),
        };
      }),
    ];
    Reflect.set(window, "inklineRenameRecord", record);
    Reflect.set(window, "inklineAtEnd-rename-record", () => {
      for (const step of undo) step();
      Reflect.deleteProperty(window, "inklineRenameRecord");
    });
  });
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
 * A symbol's file is written another way, so that goes on working. Each save
 * that fails is counted, for {@link waitForFailedSaves}.
 *
 * A note saves itself two seconds after an edit, which a busy machine can take
 * to reach any later step. So a test has saves fail before it adds the text
 * that must stay unsaved, and reads the note's file before it calls what this
 * returns, once it has waited for that save to fail too: with saves working,
 * that save could be under way at the test's next save of the note, which on
 * Obsidian 1.13 then returns before the text is written.
 */
export async function failSaves(): Promise<() => Promise<void>> {
  await browser.executeObsidian(({ app }) => {
    const failed: string[] = [];
    Reflect.set(window, "inklineFailedSaves", failed);
    app.vault.modify = (file) => {
      failed.push(file.path);
      return Promise.reject(new Error("the disk is full"));
    };
  });
  return async () => {
    await browser.executeObsidian(({ app }) => {
      Reflect.deleteProperty(app.vault, "modify");
      Reflect.deleteProperty(window, "inklineFailedSaves");
    });
  };
}

/**
 * Waits for {@link failSaves} to have failed `count` saves of the note at
 * `path`.
 */
export async function waitForFailedSaves(
  path: string,
  count: number,
): Promise<void> {
  let failed = 0;
  try {
    await browser.waitUntil(async () => {
      failed = await browser.execute((file) => {
        const paths: unknown = Reflect.get(window, "inklineFailedSaves");
        return Array.isArray(paths)
          ? paths.filter((failure) => failure === file).length
          : 0;
      }, path);
      return failed >= count;
    });
  } catch (error) {
    throw new Error(
      `waited for ${String(count)} failed saves of ${path}, but saw ${String(failed)}`,
      { cause: error },
    );
  }
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

/** How many modals are open, and whether the topmost has a Discard button. */
interface ModalState {
  readonly count: number;
  readonly discard: boolean;
}

/** The longest {@link startOver} waits after acting on a modal. */
const modalPause = 300;

/**
 * Waits after {@link startOver} acted on the modals as they were `before`,
 * in the window the test is in, and gives them as they then are: `longest`
 * ms, or less once what it acts on next is there, a modal fewer, or a
 * Discard button on top that was not, once that modal's opening animations
 * have finished. Any other change, such as a modal more without one, waits
 * the whole time, as a modal that is still being built might. With no
 * `before`, it only reads them.
 */
async function waitForModalChange(
  before?: ModalState,
  longest = 0,
): Promise<ModalState> {
  return browser.execute(
    async (was, wait) => {
      const until = performance.now() + wait;
      const left = () => until - performance.now();
      const pause = (ms: number) =>
        new Promise((resolve) => window.setTimeout(resolve, ms));
      for (;;) {
        const containers = document.querySelectorAll(".modal-container");
        const top = Array.from(containers).at(-1);
        const now = {
          count: containers.length,
          discard:
            top !== undefined &&
            Array.from(top.querySelectorAll("button")).some(
              (button) => button.textContent.trim() === "Discard",
            ),
        };
        if (was === null || left() <= 0 || now.count < was.count) return now;
        if (top !== undefined && now.discard && !was.discard) {
          const opening = top
            .getAnimations({ subtree: true })
            .filter(
              (animation) =>
                animation.playState !== "finished" &&
                animation.effect?.getComputedTiming().endTime !== Infinity,
            );
          if (opening.length === 0) return now;
          await Promise.race([
            Promise.allSettled(opening.map((animation) => animation.finished)),
            pause(left()),
          ]);
          // Read again: the animations can end with the modal changed.
          continue;
        }
        await pause(Math.min(10, left()));
      }
    },
    before ?? null,
    longest,
  );
}

/**
 * The methods of Obsidian's objects that tests replace, by the object they
 * are on. A replacement is the object's own, over what its prototype has, so
 * that removing it puts Obsidian's back.
 */
const replaceable = {
  vault: [
    "copy",
    "create",
    "createBinary",
    "modify",
    "modifyBinary",
    "process",
    "read",
    "readBinary",
    "rename",
  ],
  adapter: ["read", "readBinary", "rename", "write", "writeBinary"],
  fileManager: ["renameFile", "trashFile"],
  subtle: ["digest"],
} as const;

/**
 * The longest {@link undoStubs} waits for what it let go to finish, as long as
 * {@link startOver} waits for a note's save.
 */
const letGoBound = 15_000;

/**
 * Takes away whatever a test held or replaced and did not put back, as a test
 * that fails midway leaves it, so that one failure does not become many.
 *
 * It ends every operation still held by {@link hold} or {@link holdDecoding},
 * or by any other gate that registered to be ended here. Such a gate keeps
 * how to end what it holds as a property of the renderer's window, named
 * `inklineAtEnd-` and a name of the gate's own, which this calls once and
 * removes. A gate that does not register ends what it holds in its own test's
 * `finally` or its block's `afterEach`.
 *
 * What Obsidian itself does is let go, as if the test had let it go: what
 * {@link hold} holds as `move`, `save`, or `index`, on the adapter, or as
 * `link`. Failing it would reject it inside Obsidian's own rename or link
 * update, which need not recover for the tests after it. Only Inkline's own
 * vault calls that {@link hold} holds are failed, with "The test ended with
 * this held.", so that what they would do next does not happen. What
 * {@link holdDecoding} holds is let go, and so must be what a gate of a spec
 * file holds on the adapter or `fileManager`. So is what `holdNextRead` and
 * `holdNextWrite` in support/symbol-text.ts hold, as their tests' own
 * clean-up let it go before these gates registered here.
 *
 * A gate that lets a call go, here or in its own test, can keep the call in
 * the renderer's `inklineLetGo`, a set of `{ gate, call }` with the gate's
 * name and the call's promise, until the call ends, as `holdNextRead` and
 * `holdNextWrite` do. This waits for every call in it to end, whether it
 * resolves or rejects, before anything else, so that what was let go is done
 * before {@link startOver} resets the vault: a write let go could otherwise
 * land after the reset. It waits at most `letGoBound` ms, {@link letGoBound}
 * unless a test says otherwise, and then fails, naming each gate whose call
 * had not ended, once the rest of this is done, so that one test that cannot
 * finish does not leave its stubs to the tests after it. A call that had not
 * ended stays in the set, so that the next clean-up waits for it too.
 *
 * It then takes {@link hold}'s gate away, so that a later {@link waitForHeld}
 * or {@link letGo} cannot take it for its own; undoes {@link delayVault} and
 * {@link holdDecoding}; and removes every replacement of a method in
 * `replaceable` that Obsidian's object did not have as its own when this
 * first ran in the window, with the originals tests keep beside them under
 * names that start with `inkline`. {@link startOver} does this first.
 */
export async function undoStubs({
  letGoBound: bound = letGoBound,
}: { letGoBound?: number } = {}): Promise<void> {
  const unfinished = await browser.execute(async (longest) => {
    for (const key of Object.keys(window)) {
      if (!key.startsWith("inklineAtEnd-")) continue;
      const end: unknown = Reflect.get(window, key);
      Reflect.deleteProperty(window, key);
      if (typeof end === "function") Reflect.apply(end, undefined, []);
    }
    // Its gate, settled now, which a later test's waitForHeld() or letGo()
    // would otherwise take for its own.
    Reflect.deleteProperty(window, "inklineHoldGate");
    Reflect.deleteProperty(window, "inklineFollowedStatus");
    // Every call let go that has not ended, from this clean-up or before.
    const known: unknown = Reflect.get(window, "inklineLetGo");
    const letGo: { gate: string; call: Promise<unknown> }[] = [];
    if (known instanceof Set) {
      for (const entry of known) {
        const gate: unknown = Reflect.get(entry as object, "gate");
        const call: unknown = Reflect.get(entry as object, "call");
        if (typeof gate === "string" && call instanceof Promise) {
          letGo.push({ gate, call });
        }
      }
    }
    const ended = new Set<Promise<unknown>>();
    const ignore = (): void => undefined;
    let timer = 0;
    await Promise.race([
      Promise.all(
        letGo.map(async ({ call }) => {
          await call.then(ignore, ignore);
          ended.add(call);
        }),
      ),
      new Promise((resolve) => {
        timer = window.setTimeout(resolve, longest);
      }),
    ]);
    window.clearTimeout(timer);
    return letGo.filter(({ call }) => !ended.has(call)).map(({ gate }) => gate);
  }, bound);
  await restoreVault();
  await restoreDecoding();
  await browser.executeObsidian(({ app }, methods) => {
    const owners: Record<keyof typeof methods, object> = {
      vault: app.vault,
      adapter: app.vault.adapter,
      fileManager: app.fileManager,
      subtle: crypto.subtle,
    };
    // What Obsidian had as its own when the window was new, which is left.
    const known: unknown = Reflect.get(window, "inklineOwnMethods");
    const own = Array.isArray(known) ? known : [];
    if (!Array.isArray(known)) {
      for (const [owner, names] of Object.entries(methods)) {
        const target = owners[owner as keyof typeof methods];
        for (const name of names) {
          if (Object.hasOwn(target, name)) own.push(`${owner}.${name}`);
        }
      }
      Reflect.set(window, "inklineOwnMethods", own);
    }
    for (const [owner, names] of Object.entries(methods)) {
      const target = owners[owner as keyof typeof methods];
      for (const name of names) {
        if (Object.hasOwn(target, name) && !own.includes(`${owner}.${name}`)) {
          Reflect.deleteProperty(target, name);
        }
      }
      for (const key of Object.keys(target)) {
        if (key.startsWith("inkline")) Reflect.deleteProperty(target, key);
      }
    }
  }, replaceable);
  if (unfinished.length > 0) {
    throw new Error(
      `undoStubs() let go what ${unfinished.map((name) => `the ${name} gate`).join(" and ")} held, and it did not finish within ${String(bound)} ms`,
    );
  }
}

/**
 * Closes every modal, discarding unsaved drawings, and every note, then
 * restores the vault and clears drafts, so that each test starts from the
 * same state. It first takes away what a test held or replaced, with
 * {@link undoStubs}, which it gives `options`, and resets nothing if that
 * fails. Last, it starts the test's record of renames, which
 * {@link waitForTop} reports from.
 */
export async function startOver(
  options: Parameters<typeof undoStubs>[0] = {},
): Promise<void> {
  await undoStubs(options);
  let modals: ModalState | undefined;
  await browser.waitUntil(
    async () => {
      const before = modals ?? (await waitForModalChange());
      modals = undefined;
      if (before.count === 0) return true;
      const discard = await topButton("Discard");
      if (discard !== undefined) await discard.click();
      else await browser.keys(["Escape"]);
      modals = await waitForModalChange(before, modalPause);
      return false;
    },
    { interval: 1, timeoutMsg: "modals stayed open" },
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
  await obsidianPage.resetVault();
  // A notice outlives the test that raised it, as Obsidian's "Updated 1 link
  // in 1 file." after a rename does, and stands over the top right of the
  // window for seconds, over the library's buttons. WebdriverIO 9 sent a
  // click it intercepted again, up to three times; WebdriverIO 10 does not.
  // So each test starts with no notice of the one before.
  await browser.execute(() => {
    for (const notice of document.querySelectorAll(".notice")) {
      notice.remove();
    }
  });
  await recordRenames();
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
 * can act meanwhile. Each call is counted as it starts and as it ends, delay
 * and all, for {@link waitForDelayed}.
 */
export async function delayVault(
  name: (typeof delayable)[number],
  ms: number,
  when: "before" | "after" = "after",
): Promise<void> {
  await browser.executeObsidian(
    ({ app }, method, wait, when) => {
      const original: unknown = Reflect.get(app.vault, method);
      if (typeof original !== "function") throw new Error(`no ${method}`);
      const pause = () =>
        new Promise((resolve) => window.setTimeout(resolve, wait));
      const calls = { started: 0, ended: 0 };
      Reflect.set(window, `inklineDelayedCalls-${method}`, calls);
      Reflect.set(app.vault, `inklineDelayed-${method}`, original);
      Reflect.set(
        app.vault,
        method,
        async (...args: unknown[]): Promise<unknown> => {
          calls.started++;
          try {
            if (when === "before") await pause();
            const result: unknown = await Reflect.apply(
              original,
              app.vault,
              args,
            );
            if (when === "after") await pause();
            return result;
          } finally {
            calls.ended++;
          }
        },
      );
    },
    name,
    ms,
    when,
  );
}

/**
 * Waits until every call of `name` that the latest {@link delayVault} of it
 * delayed has ended, once one has started, even after {@link restoreVault}.
 */
export async function waitForDelayed(
  name: (typeof delayable)[number],
): Promise<void> {
  let seen = "";
  try {
    await browser.waitUntil(async () => {
      const calls = await browser.execute(
        (method) =>
          (Reflect.get(window, `inklineDelayedCalls-${method}`) as
            { started: number; ended: number } | undefined) ?? {
            started: 0,
            ended: 0,
          },
        name,
      );
      seen = JSON.stringify(calls);
      return calls.started > 0 && calls.ended === calls.started;
    });
  } catch (error) {
    throw new Error(`waited for the delayed ${name} to end, but saw ${seen}`, {
      cause: error,
    });
  }
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
 * What a save or a rename can stop in, as on a drive that stopped answering.
 * `obsidians` marks what Obsidian itself does, which {@link undoStubs} lets
 * go rather than fails, as {@link undoStubs} says.
 */
const holdable = {
  /** Obsidian's own move of a file, in the real `renameFile`. */
  move: {
    owner: "adapter",
    method: "rename",
    ending: ".ink.png",
    obsidians: true,
  },
  /** A note's save, which comes before the move. */
  save: { owner: "adapter", method: "write", ending: ".md", obsidians: true },
  /**
   * A note's read, as a rename reads each open note before the move, to see
   * whether it has text to save.
   */
  read: { owner: "vault", method: "read", ending: ".md", obsidians: false },
  /** A symbol's save, which comes before an editor's rename. */
  write: {
    owner: "vault",
    method: "modifyBinary",
    ending: ".ink.png",
    obsidians: false,
  },
  /** A new symbol's first save, which makes its file. */
  create: {
    owner: "vault",
    method: "createBinary",
    ending: ".ink.png",
    obsidians: false,
  },
  /**
   * A symbol's read, as opening it reads it, or a look at it before a save or
   * after the vault reports a change to it.
   */
  readSymbol: {
    owner: "vault",
    method: "readBinary",
    ending: ".ink.png",
    obsidians: false,
  },
  /**
   * A link's update in a note, which comes after the move. Inkline inserts
   * its embeds through the same method, which this holds as well, and
   * {@link undoStubs} lets go too.
   */
  link: { owner: "vault", method: "process", ending: ".md", obsidians: true },
  /**
   * Obsidian's index reading a note it has not indexed yet, which it reads as
   * bytes. Obsidian's `renameFile` waits for the index before the move.
   */
  index: {
    owner: "adapter",
    method: "readBinary",
    ending: ".md",
    obsidians: true,
  },
} as const;

/**
 * Has `what` wait until {@link letGo}, for every file whose path ends with
 * `ending`, `what`'s own by default: before it starts its work, or, `after`,
 * once it has done it and before its caller hears. Failed by {@link letGo},
 * it rejects, having done its work if it was held after it. A test that ends
 * with one held leaves it to {@link undoStubs}, which lets it go if Obsidian
 * owns it and fails it otherwise.
 *
 * Each call makes a gate of its own, the renderer's `inklineHoldGate` until
 * the next call replaces it whole: what reaches the gate,
 * {@link waitForHeld}, and {@link letGo} all go by that one object, so that
 * an older operation, reaching its own gate or settling, never marks a newer
 * gate as reached.
 */
export async function hold(
  what: keyof typeof holdable,
  ending: string = holdable[what].ending,
  when: "before" | "after" = "before",
): Promise<void> {
  await browser.executeObsidian(
    ({ app }, { owner, method, obsidians }, end, when) => {
      const target = owner === "adapter" ? app.vault.adapter : app.vault;
      const original: unknown = Reflect.get(target, method);
      if (typeof original !== "function") throw new Error(`no ${method}`);
      let settle: (failure?: string) => void = () => undefined;
      const released = new Promise<void>((resolve, reject) => {
        settle = (failure) => {
          if (failure === undefined) resolve();
          else reject(new Error(failure));
        };
      });
      // Failed with nothing held, it fails no one.
      released.catch(() => undefined);
      const wrapper = async (...args: unknown[]): Promise<unknown> => {
        const [file] = args;
        const path =
          typeof file === "object" && file !== null
            ? (Reflect.get(file, "path") as unknown)
            : file;
        const held = typeof path === "string" && path.endsWith(end);
        if (held && when === "before") {
          gate.reached = true;
          await released;
        }
        const result: unknown = await Reflect.apply(original, target, args);
        if (held && when === "after") {
          gate.reached = true;
          await released;
        }
        return result;
      };
      const gate = {
        owner,
        method,
        reached: false,
        settle,
        wrapper,
        original,
        // What a let-go puts back: the object's own method, if it had one,
        // as a stub of the test's that this holds over.
        ownBefore: Object.hasOwn(target, method),
        // One of its own, as a test can hold again once it has let go.
        atEnd: `inklineAtEnd-hold-${crypto.randomUUID()}`,
      };
      Reflect.set(window, "inklineHoldGate", gate);
      Reflect.set(window, gate.atEnd, () => {
        settle(obsidians ? undefined : "The test ended with this held.");
      });
      Reflect.set(target, method, wrapper);
    },
    holdable[what],
    ending,
    when,
  );
}

/** Has `what` wait as {@link hold} does, once it has done its work. */
export async function holdAfter(
  what: keyof typeof holdable,
  ending: string = holdable[what].ending,
): Promise<void> {
  await hold(what, ending, "after");
}

/**
 * Waits for the operation that the latest {@link hold} holds to reach its
 * gate, for up to `timeout` milliseconds, WebdriverIO's default otherwise.
 */
export async function waitForHeld(timeout?: number): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const gate: unknown = Reflect.get(window, "inklineHoldGate");
        return (
          typeof gate === "object" &&
          gate !== null &&
          Reflect.get(gate, "reached") === true
        );
      }),
    {
      ...(timeout === undefined ? {} : { timeout }),
      timeoutMsg: "nothing reached the gate",
    },
  );
}

/**
 * Lets go what the latest {@link hold} holds, or fails it with `failure`,
 * and takes its gate away, putting back what the gate replaced if the gate
 * is still there: it removes nothing that is not its own, and does nothing
 * once {@link undoStubs} has taken the gate away.
 */
export async function letGo(failure?: string): Promise<void> {
  await browser.executeObsidian(({ app }, reason) => {
    const gate: unknown = Reflect.get(window, "inklineHoldGate");
    Reflect.deleteProperty(window, "inklineHoldGate");
    if (typeof gate !== "object" || gate === null) return;
    const { owner, method, settle, wrapper, original, ownBefore, atEnd } =
      gate as Record<string, unknown>;
    if (typeof atEnd === "string") Reflect.deleteProperty(window, atEnd);
    const target = owner === "adapter" ? app.vault.adapter : app.vault;
    if (typeof method === "string" && Reflect.get(target, method) === wrapper) {
      if (ownBefore === true) Reflect.set(target, method, original);
      else Reflect.deleteProperty(target, method);
    }
    if (typeof settle === "function") {
      Reflect.apply(settle, undefined, [reason ?? undefined]);
    }
  }, failure ?? null);
}

/**
 * Renames the file at `from` to `to` through the vault, as sync would, past
 * what {@link hold} holds of Obsidian's moves, which goes on holding the rest.
 */
export async function renamePastHold(from: string, to: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, path, next) => {
      const file = app.vault.getFileByPath(path);
      if (file === null) throw new Error(`no ${path}`);
      const { adapter } = app.vault;
      // Held, it is the adapter's own, over what its prototype has.
      const held: unknown = Object.hasOwn(adapter, "rename")
        ? Reflect.get(adapter, "rename")
        : undefined;
      Reflect.deleteProperty(adapter, "rename");
      try {
        await app.vault.rename(file, next);
      } finally {
        if (held !== undefined) Reflect.set(adapter, "rename", held);
      }
    },
    from,
    to,
  );
}

/**
 * Holds Obsidian's index, until {@link letGo}, on a note it creates through
 * the vault, which the index reads as it would one that sync brings in, so
 * that what waits for the index to catch up with the whole vault waits, as
 * Obsidian's `renameFile` does before it moves a file.
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
 * Has the next call of `createImageBitmap`, as when a draft's base layer is
 * decoded to offer the draft, wait until {@link letDecodingGo}, until
 * {@link restoreDecoding}; the calls after it go on. It notes when the
 * picture that call decodes is closed, for {@link waitForDecoded}.
 */
export async function holdDecoding(): Promise<void> {
  await browser.execute(() => {
    const original: unknown = Reflect.get(window, "createImageBitmap");
    if (typeof original !== "function") throw new Error("no createImageBitmap");
    let go = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      go = resolve;
    });
    const state = { held: false, closed: false };
    Reflect.set(window, "inklineHeldDecoding", state);
    Reflect.set(window, "inklineLetDecodingGo", go);
    Reflect.set(window, "inklineAtEnd-decoding", go);
    Reflect.set(window, "inklineCreateImageBitmap", original);
    let first = true;
    Reflect.set(
      window,
      "createImageBitmap",
      async (...args: unknown[]): Promise<unknown> => {
        if (!first) return Reflect.apply(original, window, args) as unknown;
        first = false;
        state.held = true;
        await gate;
        const result: unknown = await Reflect.apply(original, window, args);
        const close: unknown =
          typeof result === "object" && result !== null
            ? Reflect.get(result, "close")
            : undefined;
        if (typeof close === "function") {
          Reflect.set(result as object, "close", () => {
            state.closed = true;
            Reflect.apply(close, result, []);
          });
        }
        return result;
      },
    );
  });
}

/** Waits for the call that {@link holdDecoding} holds to be made. */
export async function waitForHeldDecoding(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const state: unknown = Reflect.get(window, "inklineHeldDecoding");
        return (
          typeof state === "object" &&
          state !== null &&
          Reflect.get(state, "held") === true
        );
      }),
    { timeoutMsg: "nothing was decoded" },
  );
}

/** Lets go the call that {@link holdDecoding} held. */
export async function letDecodingGo(): Promise<void> {
  await browser.execute(() => {
    const go: unknown = Reflect.get(window, "inklineLetDecodingGo");
    if (typeof go === "function") Reflect.apply(go, undefined, []);
  });
}

/**
 * Waits until the picture that {@link holdDecoding} held is closed. A draft's
 * base layer, decoded to offer the draft, is closed once it has been drawn,
 * and the editor decides about the draft in that turn.
 */
export async function waitForDecoded(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const state: unknown = Reflect.get(window, "inklineHeldDecoding");
        return (
          typeof state === "object" &&
          state !== null &&
          Reflect.get(state, "closed") === true
        );
      }),
    { timeoutMsg: "the decoded picture was never closed" },
  );
}

/** Undoes {@link holdDecoding}. */
export async function restoreDecoding(): Promise<void> {
  await browser.execute(() => {
    Reflect.deleteProperty(window, "inklineLetDecodingGo");
    Reflect.deleteProperty(window, "inklineHeldDecoding");
    const original: unknown = Reflect.get(window, "inklineCreateImageBitmap");
    if (typeof original !== "function") return;
    Reflect.set(window, "createImageBitmap", original);
    Reflect.deleteProperty(window, "inklineCreateImageBitmap");
  });
}

/**
 * Keeps hold of the open editor's status line while a save that it says is
 * under way runs, for {@link waitForSaveEnd}, which reads it even once the
 * editor has closed, as disabling Inkline closes it. Fails unless the status
 * says "Saving…".
 */
export async function followSave(): Promise<void> {
  const said = await browser.execute(() => {
    const status = document.querySelector(".inkline-editor .inkline-status");
    if (status === null) throw new Error("no status line");
    Reflect.set(window, "inklineFollowedStatus", status);
    return status.textContent;
  });
  if (said !== "Saving…") {
    throw new Error(`followed a save, but the status said "${said}"`);
  }
}

/**
 * Waits for the save that {@link followSave} followed to end. A save says on
 * its editor's status line how it ended, whether the editor is open or not,
 * and does everything else it does as it ends in that same turn, such as
 * keeping the draft of an editor closed while it ran. With `or`, it waits
 * until either the save has ended or `or.until` holds, as `or.what` says.
 */
export async function waitForSaveEnd(or?: {
  what: string;
  until: () => Promise<boolean>;
}): Promise<void> {
  let said = "";
  try {
    await browser.waitUntil(async () => {
      said = await browser.execute(() => {
        const status: unknown = Reflect.get(window, "inklineFollowedStatus");
        return status instanceof Element ? status.textContent : "no status";
      });
      return (
        said.startsWith("Saved") ||
        said.startsWith("Not saved") ||
        (or !== undefined && (await or.until()))
      );
    });
  } catch (error) {
    const alternative = or === undefined ? "" : `, or ${or.what},`;
    throw new Error(
      `waited for a save to end${alternative} but its status said "${said}"`,
      { cause: error },
    );
  }
}

const fillerPrefix = "inkline-test-filler:";

/**
 * Fills the renderer's local storage until it refuses even a few characters
 * more, as a full disk or a quota would, or until `room` characters more
 * would fit, and returns how many characters it took. {@link freeStorage}
 * empties it again.
 */
export async function fillStorage(room = 0): Promise<number> {
  return browser.execute(
    (prefix, left) => {
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
      // The room asked for, from the last and smallest written, and what
      // that freed beyond it written back.
      let freed = 0;
      while (freed < left && count > 0) {
        count--;
        const key = `${prefix}${String(count)}`;
        freed += window.localStorage.getItem(key)?.length ?? 0;
        window.localStorage.removeItem(key);
      }
      if (freed > left) {
        window.localStorage.setItem(
          `${prefix}${String(count)}`,
          "x".repeat(freed - left),
        );
      }
      return filled - Math.min(freed, left);
    },
    fillerPrefix,
    room,
  );
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
