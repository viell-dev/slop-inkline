import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  delayDecoding,
  delayVault,
  draw,
  editorOpen,
  guideRows,
  fillStorage,
  freeStorage,
  noteText,
  openAtMarker,
  recordOf,
  restoreDecoding,
  restoreVault,
  settledSurface,
  storedDrafts,
  waitForEditor,
  startOver,
  surface,
  symbolFiles,
  clickTop,
  topButton,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const zigzag = [
  [0.4, 0.3],
  [0.45, 0.7],
  [0.5, 0.3],
  [0.55, 0.7],
] as const;

async function insert(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
}

async function editFile(path: string): Promise<void> {
  await browser.executeObsidian(({ app, plugins }, filePath) => {
    const file = app.vault.getFileByPath(filePath);
    if (file === null) throw new Error(`no ${filePath}`);
    void plugins.inkline.editSymbol(file);
  }, path);
  await waitForEditor();
}

async function draftCount(): Promise<number> {
  return browser.executeObsidian(({ app }) => {
    const ids: unknown = app.loadLocalStorage("inkline-drafts");
    return Array.isArray(ids) ? ids.length : 0;
  });
}

/** Saves one new symbol, 001.ink.png, with one stroke. */
async function saveOne(): Promise<void> {
  await insert();
  await draw(zigzag);
  await browser.keys(["Control", "Enter"]);
  await waitClosed();
}

async function waitClosed(): Promise<void> {
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

/**
 * Saves a new symbol whose insertion fails, so that its file exists but its
 * embed does not, then disables and enables Inkline and opens the note
 * again. The editor's draft names the file.
 */
async function interruptInsertion(): Promise<void> {
  try {
    await failInsertion();
    await obsidianPage.disablePlugin("inkline");
  } finally {
    await unlockNotes();
  }
  await obsidianPage.enablePlugin("inkline");
  await loadModules();
  await obsidianPage.openFile("Editor.md");
}

/**
 * Saves a new symbol whose insertion fails, so that its file exists but its
 * embed does not, and leaves the editor open. Notes stay locked until
 * {@link unlockNotes}.
 */
async function failInsertion(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const vault = app.vault as typeof app.vault & {
      inklineProcess?: typeof app.vault.process;
    };
    vault.inklineProcess = vault.process.bind(vault);
    vault.process = () => Promise.reject(new Error("the note is locked"));
  });
  await insert();
  await draw(zigzag);
  // Show another note in the tab, so that the insertion has to edit the
  // note's file, which fails.
  await showWelcomeInstead();
  await browser.keys(["Control", "s"]);
  await waitForStatus("the note is locked");
}

/** Lets notes be edited again after {@link failInsertion}. */
async function unlockNotes(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const vault = app.vault as typeof app.vault & {
      inklineProcess?: typeof app.vault.process;
    };
    if (vault.inklineProcess !== undefined)
      vault.process = vault.inklineProcess;
  });
}

/**
 * Shows Welcome.md in every tab that shows Editor.md, so that no editor of
 * the note is open and an insertion has to edit its file.
 */
async function showWelcomeInstead(): Promise<void> {
  const left = await browser.executeObsidian(async ({ app, obsidian }) => {
    const welcome = app.vault.getFileByPath("Welcome.md");
    if (welcome === null) throw new Error("no Welcome.md");
    const showing = () =>
      app.workspace
        .getLeavesOfType("markdown")
        .filter(
          (leaf) =>
            leaf.view instanceof obsidian.MarkdownView &&
            leaf.view.file?.path === "Editor.md",
        );
    for (const leaf of showing()) await leaf.openFile(welcome);
    return showing().length;
  });
  if (left !== 0) throw new Error("a tab still shows Editor.md");
}

/**
 * Keeps a draft for a new symbol in Editor.md, as an earlier editor would
 * have, with a black square as its kept base layer.
 */
async function plantKeptDraft(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const { canvas, drafts } = window.inklineTest;
    const data = new Uint8ClampedArray(24 * 24 * 4);
    for (let index = 0; index < 24 * 24; index++) data[index * 4 + 3] = 255;
    const png = await canvas.encodePixels({ width: 24, height: 24, data });
    const kept = new drafts.DraftStore(app).put({
      id: "planted",
      target: { kind: "new", note: "Editor.md" },
      strokes: [
        { tool: "pen", size: 256, pressure: false, points: [1600, 1600] },
      ],
      base: { kind: "kept", layer: { x: 0, y: 0, scale: 8, png } },
      savedAt: Date.now(),
    });
    if (!kept) throw new Error("the draft was not kept");
  });
}

/**
 * Where the surface's drawing starts on the screen, inside its border, and
 * how many CSS pixels a new symbol's document pixel takes.
 */
async function surfaceOrigin(): Promise<{
  left: number;
  top: number;
  scale: number;
  border: number;
}> {
  return browser.execute(() => {
    const canvas = document.querySelector(".inkline-editor .inkline-surface");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
    const rect = canvas.getBoundingClientRect();
    return {
      left: rect.left + canvas.clientLeft,
      top: rect.top + canvas.clientTop,
      scale: canvas.clientWidth / 576,
      border: canvas.clientLeft,
    };
  });
}

/** Clicks the mouse at a point in the window, in CSS pixels. */
async function clickAt(x: number, y: number): Promise<void> {
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ origin: "viewport", x: Math.round(x), y: Math.round(y) })
    .down()
    .up()
    .perform();
}

/** A note's text as its file holds it. */
async function fileText(path: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, filePath) => {
    const file = app.vault.getFileByPath(filePath);
    if (file === null) throw new Error(`no ${filePath}`);
    return app.vault.read(file);
  }, path);
}

/**
 * Writes a picture of `width × height` pixels whose alpha is noise from a
 * fixed seed, which PNG cannot compress, and returns its size in bytes.
 */
async function writeNoise(
  path: string,
  width: number,
  height: number,
): Promise<number> {
  return browser.executeObsidian(
    async ({ app }, filePath, w, h) => {
      const { canvas } = window.inklineTest;
      const data = new Uint8ClampedArray(w * h * 4);
      let seed = 7;
      for (let index = 0; index < w * h; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[index * 4 + 3] = seed >>> 24;
      }
      const bytes = await canvas.encodePixels({ width: w, height: h, data });
      await app.vault.createBinary(filePath, bytes.slice().buffer);
      return bytes.length;
    },
    path,
    width,
    height,
  );
}

/** A picture, `square.ink.png`: a black square, which opens as a base layer. */
async function createSquare(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const { canvas } = window.inklineTest;
    const data = new Uint8ClampedArray(24 * 24 * 4);
    for (let index = 0; index < 24 * 24; index++) data[index * 4 + 3] = 255;
    const bytes = await canvas.encodePixels({ width: 24, height: 24, data });
    await app.vault.createBinary("square.ink.png", bytes.slice().buffer);
  });
}

/**
 * Writes a symbol of three dots into `path`, as sync or another app would:
 * through the vault, which reports it, or straight to the disk.
 */
async function changeElsewhere(
  path: string,
  how: "vault" | "disk" = "vault",
): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, filePath, way) => {
      const { canvas } = window.inklineTest;
      const dot = (x: number) => ({
        tool: "pen" as const,
        size: 256,
        pressure: false,
        points: [x, 1600],
      });
      const { bytes } = await canvas.saveInk(
        { strokes: [dot(800), dot(1600), dot(2400)] },
        undefined,
        [],
      );
      if (way === "disk") {
        await app.vault.adapter.writeBinary(filePath, bytes.slice().buffer);
        return;
      }
      const file = app.vault.getFileByPath(filePath);
      if (file === null) throw new Error(`no ${filePath}`);
      await app.vault.modifyBinary(file, bytes.slice().buffer);
    },
    path,
    how,
  );
}

/** How many strokes a symbol file's record holds. */
async function strokeCount(path: string): Promise<number> {
  const record = JSON.parse(await recordOf(path)) as { strokes?: unknown[] };
  return record.strokes?.length ?? -1;
}

/** Marks the open editor, so that {@link waitForNext} can tell it apart. */
async function markEditor(): Promise<void> {
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
async function waitForNext(count: number): Promise<void> {
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

/** Whether a toolbar button shows itself pressed. */
async function pressed(button: string): Promise<string | null> {
  return browser
    .$(`[data-inkline-button="${button}"]`)
    .getAttribute("aria-pressed");
}

/**
 * Writes a symbol file of one stroke per x, in units, as another editor
 * would, with a text chunk that Inkline carries through its saves.
 */
async function writeSymbol(path: string, xs: readonly number[]): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, filePath, starts) => {
      const { canvas } = window.inklineTest;
      const { bytes } = await canvas.saveInk(
        {
          strokes: starts.map((x) => ({
            tool: "pen" as const,
            size: 256,
            pressure: false,
            points: [x, 800, x + 400, 2000],
          })),
        },
        undefined,
        [
          {
            chunk: {
              type: "tEXt",
              data: new TextEncoder().encode("Comment\0from the tower"),
            },
            afterData: false,
          },
        ],
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

/** How many chunks a symbol file holds that Inkline carries through saves. */
async function carriedIn(path: string): Promise<number> {
  return browser.executeObsidian(async ({ app }, filePath) => {
    const file = app.vault.getFileByPath(filePath);
    if (file === null) throw new Error(`no ${filePath}`);
    const { inkFile } = window.inklineTest;
    return inkFile.preservableChunks(
      new Uint8Array(await app.vault.readBinary(file)),
    ).length;
  }, path);
}

/** Chooses a symbol in the open choice of symbols, by typing its name. */
async function chooseSymbol(name: string): Promise<void> {
  await browser.$(".prompt-input").waitForDisplayed();
  await browser.keys(name);
  await browser.keys(["Enter"]);
}

/** Waits for a notice whose text includes `text`. */
async function waitForNotice(text: string): Promise<void> {
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

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * A new symbol's surface, for placing a picture: device pixels per document
 * pixel and per CSS pixel, the surface's border, and where the top of a
 * capital letter is, in document pixels, from an independent measurement of
 * the preview line's font.
 */
async function surfaceLayout(): Promise<{
  factor: number;
  ratio: number;
  border: number;
  capTop: number;
  xTop: number;
}> {
  return browser.execute(() => {
    const doc = activeDocument;
    const view = doc.defaultView;
    const canvas = doc.querySelector(".inkline-editor .inkline-surface");
    const line = doc.querySelector(".inkline-editor .inkline-preview");
    if (
      view === null ||
      canvas?.instanceOf(HTMLCanvasElement) !== true ||
      line?.instanceOf(HTMLElement) !== true
    ) {
      throw new Error("no surface");
    }
    const font = view.getComputedStyle(line);
    const context = new view.OffscreenCanvas(1, 1).getContext("2d");
    if (context === null) throw new Error("no context");
    context.font = `${font.fontStyle} ${font.fontWeight} 128px ${font.fontFamily}`;
    return {
      factor: canvas.width / 576,
      ratio: canvas.width / canvas.clientWidth,
      border: canvas.clientLeft,
      capTop: 144 - context.measureText("H").actualBoundingBoxAscent,
      xTop: 144 - context.measureText("x").actualBoundingBoxAscent,
    };
  });
}

/** Where the surface shows a red or blue picture, in device pixels. */
async function pictureShown(
  colour: "red" | "blue" = "red",
  editor = 0,
): Promise<(Box & { alpha: number }) | undefined> {
  // WebDriver hands back undefined as null.
  const shown = await browser.execute(
    (wanted, index) => {
      const canvas = activeDocument.querySelectorAll(
        ".inkline-editor .inkline-surface",
      )[index];
      if (canvas?.instanceOf(HTMLCanvasElement) !== true) {
        throw new Error("no surface");
      }
      return window.inklineTest.pictures.shown(canvas, wanted) ?? null;
    },
    colour,
    editor,
  );
  return shown ?? undefined;
}

/** Waits for the surface to show a picture that `test` accepts, and returns it. */
async function waitForPicture(
  test: (box: Box | undefined) => boolean,
  colour: "red" | "blue" = "red",
  editor = 0,
): Promise<(Box & { alpha: number }) | undefined> {
  let shown = await pictureShown(colour, editor);
  await browser.waitUntil(
    async () => {
      shown = await pictureShown(colour, editor);
      return test(shown);
    },
    { timeoutMsg: `the picture stayed at ${JSON.stringify(shown)}` },
  );
  return shown;
}

/** Whether every edge of `box` is within `tolerance` of `expected`'s. */
function near(box: Box | undefined, expected: Box, tolerance = 2): boolean {
  return (
    box !== undefined &&
    (["left", "top", "right", "bottom"] as const).every(
      (edge) => Math.abs(box[edge] - expected[edge]) <= tolerance,
    )
  );
}

/** `box` moved by `dx` and `dy`. */
function moved(box: Box, dx: number, dy: number): Box {
  return {
    left: box.left + dx,
    top: box.top + dy,
    right: box.right + dx,
    bottom: box.bottom + dy,
  };
}

/** `box` scaled by `factor` about the point `x`, `y`. */
function scaled(box: Box, factor: number, x: number, y: number): Box {
  return {
    left: x - (x - box.left) * factor,
    top: y - (y - box.top) * factor,
    right: x + (box.right - x) * factor,
    bottom: y + (box.bottom - y) * factor,
  };
}

/**
 * Where a new symbol's surface first shows a picture of `width` × `height`
 * pixels: as tall as from the cap height to the baseline, in the middle.
 */
async function placedBox(width: number, height: number): Promise<Box> {
  const { factor, capTop } = await surfaceLayout();
  const across = ((144 - capTop) / height) * width;
  return {
    left: (288 - across / 2) * factor,
    top: capTop * factor,
    right: (288 + across / 2) * factor,
    bottom: 144 * factor,
  };
}

/** Copies a 40 px square picture of one colour, and pastes it. */
async function pastePicture(colour: "red" | "blue"): Promise<void> {
  await browser.execute(async (fill) => {
    await window.inklineTest.pictures.copyPicture(40, 40, fill);
  }, colour);
  await browser.keys(["Control", "v"]);
}

/**
 * Drops a file of `type` on the surface: `text`, or a 20 × 60 px blue
 * picture.
 */
async function dropFile(type: string, text?: string): Promise<void> {
  await browser.execute(
    async (fileType, content) => {
      const { pictures } = window.inklineTest;
      const canvas = activeDocument.querySelector(
        ".inkline-editor .inkline-surface",
      );
      if (canvas === null) throw new Error("no surface");
      const body = content ?? (await pictures.picture(20, 60, "blue"));
      pictures.drop(canvas, new File([body], "dropped", { type: fileType }));
    },
    type,
    text,
  );
}

/** Drops a link to a vault file, as Obsidian's file explorer drags one. */
async function dropVaultFile(path: string, vault?: string): Promise<void> {
  await browser.executeObsidian(
    ({ app }, filePath, name) => {
      const canvas = activeDocument.querySelector(
        ".inkline-editor .inkline-surface",
      );
      if (canvas === null) throw new Error("no surface");
      const link = new URL("obsidian://open");
      link.searchParams.set("vault", name ?? app.vault.getName());
      link.searchParams.set("file", filePath);
      window.inklineTest.pictures.drop(canvas, { uriList: link.href });
    },
    path,
    vault,
  );
}

/** Turns the wheel by `deltaY` at `x`, `y` CSS pixels from the surface's middle. */
async function turnWheel(x: number, y: number, deltaY: number): Promise<void> {
  await browser
    .action("wheel")
    .scroll({ origin: surface(), x, y, deltaX: 0, deltaY })
    .perform();
}

/** Drags with the mouse by `dx`, `dy` CSS pixels from the surface's middle. */
async function dragBy(dx: number, dy: number): Promise<void> {
  const origin = surface();
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ origin, x: 0, y: 0 })
    .down()
    .move({
      origin,
      x: Math.round(dx / 2),
      y: Math.round(dy / 2),
      duration: 50,
    })
    .move({ origin, x: dx, y: dy, duration: 50 })
    .up()
    .perform();
}

/** How many files the vault holds. */
async function fileCount(): Promise<number> {
  return browser.executeObsidian(({ app }) => app.vault.getFiles().length);
}

/** The words next to the picture's buttons. */
async function pictureHint(): Promise<string> {
  return browser.$(".inkline-picture-hint").getText();
}

describe("The editor", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
  });

  after(async function () {
    await startOver();
  });

  it("starts each test from the vault as it was, with a note's save under way", async function () {
    const original = await fileText("Editor.md");
    await openAtMarker("Editor.md", "HERE");
    await delayVault("modify", 1500, "before");
    // A save held across the reset, as a slow disk would hold one.
    await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (view === null) throw new Error("no Markdown view");
      view.editor.setValue("Text from the test before\n");
      void view.save();
    });
    await startOver();
    await browser.pause(2000);
    expect(await fileText("Editor.md")).toBe(original);
  });

  it("saves a drawing as a new symbol and inserts it where the cursor was", async function () {
    await insert();
    await draw(zigzag);
    await saveScreenshot("editor-drawing");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect(await noteText()).toBe(
      "The door is marked with ![[001.ink.png]] which means return.\n",
    );
    const record: unknown = JSON.parse(await recordOf("001.ink.png"));
    expect(record).toMatchObject({
      format: "inkline",
      box: { pxPerEm: 128, height: 192, baseline: 144 },
      strokes: [{ tool: "pen", size: 256, pressure: false }],
    });
  });

  it("creates nothing when closed without saving", async function () {
    await insert();
    await browser.keys(["Escape"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual([]);
    expect(await noteText()).toBe(
      "The door is marked with  which means return.\n",
    );
  });

  it("asks before closing unsaved work, and keeps drawing or discards it", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Escape"]);
    await browser.waitUntil(
      async () => (await topButton("Keep drawing")) !== undefined,
    );
    await saveScreenshot("editor-close-question");
    await clickTop("Keep drawing");
    expect(await editorOpen()).toBe(true);
    await browser.keys(["Escape"]);
    await clickTop("Discard");
    await waitClosed();
    expect(await symbolFiles()).toEqual([]);
  });

  it("saves from the close question", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Escape"]);
    await clickTop("Save");
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
  });

  it("undoes, redoes, and erases", async function () {
    await insert();
    await draw([
      [0.3, 0.5],
      [0.7, 0.5],
    ]);
    await draw([
      [0.3, 0.3],
      [0.7, 0.3],
    ]);
    await browser.keys(["Control", "z"]);
    await browser.keys(["Control", "Shift", "z"]);
    await browser.keys(["Control", "z"]);
    await browser.keys(["e"]);
    await draw([
      [0.5, 0.4],
      [0.5, 0.6],
    ]);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: { tool: string }[];
    };
    expect(record.strokes.map((stroke) => stroke.tool)).toEqual([
      "pen",
      "eraser",
    ]);
  });

  it("names a second symbol with the next number, and edits a symbol again losslessly", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const first = await recordOf("001.ink.png");

    await browser.executeObsidian(({ app, plugins }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no file");
      void plugins.inkline.editSymbol(file);
    });
    await waitForEditor();
    // Nothing changed, so it closes without asking.
    await browser.keys(["Escape"]);
    await waitClosed();
    expect(await recordOf("001.ink.png")).toBe(first);

    await browser.executeObsidian(({ app, plugins }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no file");
      void plugins.inkline.editSymbol(file);
    });
    await draw([
      [0.5, 0.2],
      [0.5, 0.8],
    ]);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const edited = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
    };
    const original = JSON.parse(first) as { strokes: unknown[] };
    expect(edited.strokes).toHaveLength(2);
    expect(edited.strokes[0]).toEqual(original.strokes[0]);

    await openAtMarker("Welcome.md", "vault");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await draw(zigzag);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png", "002.ink.png"]);
  });

  it("keeps the editor open with the drawing when saving fails", async function () {
    await browser.executeObsidian(({ app }) => {
      const vault = app.vault as typeof app.vault & {
        inklineCreateBinary?: typeof app.vault.createBinary;
      };
      vault.inklineCreateBinary = vault.createBinary.bind(vault);
      vault.createBinary = () => Promise.reject(new Error("the disk is full"));
    });
    try {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "Enter"]);
      await waitForStatus("the disk is full");
      expect(await editorOpen()).toBe(true);
    } finally {
      await browser.executeObsidian(({ app }) => {
        const vault = app.vault as typeof app.vault & {
          inklineCreateBinary?: typeof app.vault.createBinary;
        };
        if (vault.inklineCreateBinary !== undefined) {
          vault.createBinary = vault.inklineCreateBinary;
        }
      });
    }
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
  });

  it("labels its controls and marks the current tool", async function () {
    await insert();
    const state = await browser.execute(() => {
      const button = (id: string): HTMLElement | null =>
        document.querySelector(`[data-inkline-button="${id}"]`);
      return {
        pen: button("pen")?.getAttribute("aria-pressed"),
        eraser: button("eraser")?.getAttribute("aria-pressed"),
        size: button("size-0")?.getAttribute("aria-label"),
        undo: button("undo")?.hasAttribute("disabled"),
        focused: document.activeElement?.classList.contains("inkline-surface"),
      };
    });
    expect(state).toEqual({
      pen: "true",
      eraser: "false",
      size: "Brush size S (1)",
      undo: true,
      focused: true,
    });
    await browser.keys(["e"]);
    const eraser = browser.$('[data-inkline-button="eraser"]');
    expect(await eraser.getAttribute("aria-pressed")).toBe("true");
    await browser.keys(["Escape"]);
    await waitClosed();
  });

  it("names each button with its text, and shows its shortcut on hover", async function () {
    await insert();
    const buttons = await browser.execute(() =>
      [...document.querySelectorAll("[data-inkline-button]")].map((button) => ({
        text: button.textContent,
        name: button.getAttribute("aria-label") ?? "",
      })),
    );
    expect(buttons.length).toBeGreaterThan(10);
    for (const { text, name } of buttons) {
      expect(name.toLowerCase()).toContain(text.toLowerCase());
    }
    const tooltip = async (id: string, text: string): Promise<void> => {
      await browser.$(`[data-inkline-button="${id}"]`).moveTo();
      await browser.waitUntil(
        async () =>
          (await browser.execute(
            () => document.querySelector(".tooltip")?.textContent ?? "",
          )) === text,
        { timeoutMsg: `no tooltip "${text}"` },
      );
      await surface().moveTo();
    };
    // The first hover after the editor opens shows no tooltip, so start
    // from the surface.
    await surface().moveTo();
    await browser.pause(500);
    await tooltip("copy", "Copy from: start from a copy of another symbol (V)");
    await tooltip("size-0", "Brush size S (1)");
    await tooltip("pen", "Pen (P)");
    await tooltip("next", "Next: save and draw the next one (Mod+Shift+Enter)");
  });

  it("saves a stroke still being drawn when saving and closing", async function () {
    await insert();
    await draw(zigzag);
    const canvas = surface();
    const { width, height } = await canvas.getSize();
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ origin: canvas, x: Math.round(-0.2 * width), y: 0 })
      .down()
      .move({
        origin: canvas,
        x: Math.round(0.2 * width),
        y: Math.round(0.1 * height),
        duration: 50,
      })
      .perform(true);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    await browser.releaseActions();
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
    };
    expect(record.strokes).toHaveLength(2);
  });

  it("stays open when strokes are drawn while saving", async function () {
    await browser.executeObsidian(({ app }) => {
      const vault = app.vault as typeof app.vault & {
        inklineCreateBinary?: typeof app.vault.createBinary;
      };
      const create = vault.createBinary.bind(vault);
      vault.inklineCreateBinary = create;
      vault.createBinary = async (path, data, options) => {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        return create(path, data, options);
      };
    });
    try {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "Enter"]);
      await draw([
        [0.3, 0.2],
        [0.7, 0.2],
      ]);
      await waitForStatus("strokes drawn while saving");
      expect(await editorOpen()).toBe(true);
    } finally {
      await browser.executeObsidian(({ app }) => {
        const vault = app.vault as typeof app.vault & {
          inklineCreateBinary?: typeof app.vault.createBinary;
        };
        if (vault.inklineCreateBinary !== undefined) {
          vault.createBinary = vault.inklineCreateBinary;
        }
      });
    }
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
    };
    expect(record.strokes).toHaveLength(2);
  });

  it("inserts into the note it was opened in, even after its tab shows another", async function () {
    await insert();
    await draw(zigzag);
    await showWelcomeInstead();
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    // Another tab may still show the note, whose editor Obsidian saves to
    // disk a moment later.
    const read = () =>
      browser.executeObsidian(async ({ app }) => {
        const text = async (path: string): Promise<string> => {
          const file = app.vault.getFileByPath(path);
          if (file === null) throw new Error(`no ${path}`);
          return app.vault.read(file);
        };
        return {
          editor: await text("Editor.md"),
          welcome: await text("Welcome.md"),
        };
      });
    await browser.waitUntil(async () =>
      (await read()).editor.includes("001.ink.png"),
    );
    const texts = await read();
    expect(texts).toEqual({
      editor: "The door is marked with ![[001.ink.png]] which means return.\n",
      welcome: "A synthetic vault for Inkline's end-to-end tests.\n",
    });
  });

  it("inserts into the note's file when its tab was closed", async function () {
    await insert();
    await draw(zigzag);
    const open = await browser.executeObsidian(({ app }) => {
      for (const leaf of app.workspace.getLeavesOfType("markdown"))
        leaf.detach();
      return app.workspace.getLeavesOfType("markdown").length;
    });
    expect(open).toBe(0);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const text = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Editor.md");
      if (file === null) throw new Error("no Editor.md");
      return app.vault.read(file);
    });
    expect(text).toBe(
      "The door is marked with ![[001.ink.png]] which means return.\n",
    );
  });
  it("tries the insertion again on the next save after it fails", async function () {
    await browser.executeObsidian(({ app }) => {
      const vault = app.vault as typeof app.vault & {
        inklineProcess?: typeof app.vault.process;
      };
      vault.inklineProcess = vault.process.bind(vault);
      vault.process = () => Promise.reject(new Error("the note is locked"));
    });
    await insert();
    await draw(zigzag);
    // Show another note in the tab, so that the insertion has to edit the
    // note's file, which fails the first time.
    await showWelcomeInstead();
    await browser.keys(["Control", "Enter"]);
    await waitForStatus("the note is locked");
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    await browser.executeObsidian(({ app }) => {
      const vault = app.vault as typeof app.vault & {
        inklineProcess?: typeof app.vault.process;
      };
      if (vault.inklineProcess !== undefined)
        vault.process = vault.inklineProcess;
    });
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    const text = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Editor.md");
      if (file === null) throw new Error("no Editor.md");
      return app.vault.read(file);
    });
    expect(text).toBe(
      "The door is marked with ![[001.ink.png]] which means return.\n",
    );
  });

  it("skips a number that a folder already has", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.createFolder("001.ink.png");
    });
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["002.ink.png"]);
  });

  it("keeps unsaved strokes as a draft when the plugin is disabled, and offers them back", async function () {
    await insert();
    await draw(zigzag);
    await obsidianPage.disablePlugin("inkline");
    expect(await editorOpen()).toBe(false);
    expect(await symbolFiles()).toEqual([]);
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    // The same note, where the cursor still is.
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
    };
    expect(record.strokes).toHaveLength(1);
  });

  it("reports a symbol file that cannot be read", async function () {
    await browser.executeObsidian(async ({ app, plugins }) => {
      const file = await app.vault.createBinary(
        "broken.ink.png",
        new ArrayBuffer(8),
      );
      await plugins.inkline.editSymbol(file);
    });
    const notice = browser.$(
      ".notice=Could not open broken.ink.png: not a PNG file",
    );
    await notice.waitForExist();
    expect(await editorOpen()).toBe(false);
  });

  it("offers a new symbol's draft for its file once it was saved", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await draw([
      [0.5, 0.2],
      [0.5, 0.8],
    ]);
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    // A new symbol in the same note is a different symbol: nothing to offer.
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    expect(await topButton("Restore")).toBeUndefined();
    await browser.keys(["Escape"]);
    await waitClosed();
    await editFile("001.ink.png");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
    };
    expect(record.strokes).toHaveLength(2);
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
  });

  it("keeps a draft whose question was dismissed for next time", async function () {
    await insert();
    await draw(zigzag);
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Not now");
    await browser.keys(["Escape"]);
    await waitClosed();
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
  });

  it("closes its questions when the plugin is disabled, keeping the draft", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Escape"]);
    await browser.waitUntil(
      async () => (await topButton("Discard")) !== undefined,
    );
    await obsidianPage.disablePlugin("inkline");
    expect(await browser.$(".modal-container").isExisting()).toBe(false);
    expect(await draftCount()).toBe(1);
    await obsidianPage.enablePlugin("inkline");
  });

  it("does not open an editor for a file read after the plugin was disabled", async function () {
    await saveOne();
    await browser.executeObsidian(({ app, plugins }) => {
      const vault = app.vault as typeof app.vault & {
        inklineReadBinary?: typeof app.vault.readBinary;
      };
      const read = vault.readBinary.bind(vault);
      vault.inklineReadBinary = read;
      vault.readBinary = async (file) => {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        return read(file);
      };
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no file");
      void plugins.inkline.editSymbol(file);
    });
    await obsidianPage.disablePlugin("inkline");
    await browser.pause(1500);
    expect(await editorOpen()).toBe(false);
    await browser.executeObsidian(({ app }) => {
      const vault = app.vault as typeof app.vault & {
        inklineReadBinary?: typeof app.vault.readBinary;
      };
      if (vault.inklineReadBinary !== undefined)
        vault.readBinary = vault.inklineReadBinary;
    });
    await obsidianPage.enablePlugin("inkline");
  });

  it("does not let an old save's completion drop a newer editor's draft", async function () {
    await saveOne();
    await browser.executeObsidian(({ app }) => {
      const vault = app.vault as typeof app.vault & {
        inklineModifyBinary?: typeof app.vault.modifyBinary;
      };
      const modify = vault.modifyBinary.bind(vault);
      vault.inklineModifyBinary = modify;
      vault.modifyBinary = async (file, data, options) => {
        await modify(file, data, options);
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
      };
    });
    await editFile("001.ink.png");
    await draw([
      [0.5, 0.2],
      [0.5, 0.8],
    ]);
    await browser.keys(["Control", "s"]);
    await draw([
      [0.3, 0.2],
      [0.7, 0.2],
    ]);
    await obsidianPage.disablePlugin("inkline");
    await browser.executeObsidian(({ app }) => {
      const vault = app.vault as typeof app.vault & {
        inklineModifyBinary?: typeof app.vault.modifyBinary;
      };
      if (vault.inklineModifyBinary !== undefined)
        vault.modifyBinary = vault.inklineModifyBinary;
    });
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await editFile("001.ink.png");
    await clickTop("Restore");
    await draw([
      [0.3, 0.8],
      [0.7, 0.8],
    ]);
    // Let the old save finish.
    await browser.pause(3000);
    expect(await draftCount()).toBe(1);
  });

  it("restores a draft in line with a base layer moved by an earlier save", async function () {
    await createSquare();
    await editFile("square.ink.png");
    // Far to the left, so that the save crops and moves everything.
    await draw([
      [0.05, 0.3],
      [0.1, 0.3],
    ]);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await draw([
      [0.45, 0.8],
      [0.55, 0.8],
    ]);
    const [draft] = await storedDrafts();
    const kept = (draft?.strokes ?? []).map((stroke) => stroke.points[0] ?? 0);
    // The base layer is the file's own, so the draft only names it.
    expect(draft?.base).toBe("file");
    const saved = JSON.parse(await recordOf("square.ink.png")) as {
      base: { x: number };
      strokes: { points: number[] }[];
    };
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await editFile("square.ink.png");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const restored = JSON.parse(await recordOf("square.ink.png")) as {
      base: { x: number };
      strokes: { points: number[] }[];
    };
    // The first stroke was saved with the base: the draft keeps its place.
    expect(kept[0]).toBe(saved.strokes[0]?.points[0]);
    // After restoring, every stroke keeps its distance from the base layer.
    const offsets = (record: typeof restored, xs: number[]) =>
      xs.map((x) => x - record.base.x);
    expect(
      offsets(
        restored,
        restored.strokes.map((stroke) => stroke.points[0] ?? 0),
      ),
    ).toEqual(offsets(saved, kept));
  });

  it("inserts through the live editor, whose text is newer than the file", async function () {
    await browser.executeObsidian(({ app, obsidian }) => {
      const vault = app.vault as typeof app.vault & {
        inklineCreateBinary?: typeof app.vault.createBinary;
      };
      const create = vault.createBinary.bind(vault);
      vault.inklineCreateBinary = create;
      vault.createBinary = async (path, data, options) => {
        const file = await create(path, data, options);
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        view?.editor.setValue("BRAND NEW UNSAVED CONTENT\n");
        return file;
      };
    });
    try {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
    } finally {
      await browser.executeObsidian(({ app }) => {
        const vault = app.vault as typeof app.vault & {
          inklineCreateBinary?: typeof app.vault.createBinary;
        };
        if (vault.inklineCreateBinary !== undefined)
          vault.createBinary = vault.inklineCreateBinary;
      });
    }
    expect(await noteText()).toBe(
      "BRAND NEW UNSAVED CONTENT\n![[001.ink.png]]\n",
    );
  });

  it("restores a base layer that a saved clearing took out of the file", async function () {
    await createSquare();
    await editFile("square.ink.png");
    await browser.$('[data-inkline-button="clear"]').click();
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await browser.keys(["Control", "z"]);
    // The file has no base layer now, so the draft keeps its own.
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.base === "kept",
    );
    const cleared = JSON.parse(await recordOf("square.ink.png")) as {
      base?: unknown;
    };
    expect(cleared.base).toBeUndefined();
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await editFile("square.ink.png");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const restored = JSON.parse(await recordOf("square.ink.png")) as {
      base?: { scale: number };
    };
    // The 24-pixel square, scaled to the line box's 192 pixels.
    expect(restored.base?.scale).toBe(8);
  });

  it("says when a draft cannot be kept, and keeps the last one until one can", async function () {
    await insert();
    await draw(zigzag);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    try {
      await fillStorage();
      await draw([
        [0.3, 0.2],
        [0.7, 0.2],
      ]);
      await browser.$(".notice*=could not keep a draft").waitForExist();
      expect(await browser.$(".inkline-status").getText()).toBe(
        "Draft not kept",
      );
      const drafts = await storedDrafts();
      expect(drafts.map((draft) => draft.strokes.length)).toEqual([1]);
    } finally {
      await freeStorage();
    }
    await draw([
      [0.3, 0.8],
      [0.7, 0.8],
    ]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 3,
    );
    expect(await browser.$(".inkline-status").getText()).toBe("Draft kept");
  });

  it("keeps an offered draft when the restored drawing's own cannot be kept", async function () {
    await insert();
    await draw(zigzag);
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    const before = (await storedDrafts()).map((draft) => draft.id);
    expect(before).toHaveLength(1);
    try {
      await fillStorage();
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await clickTop("Restore");
      await waitForStatus("Draft not kept");
      expect((await storedDrafts()).map((draft) => draft.id)).toEqual(before);
    } finally {
      await freeStorage();
    }
    // Once saved, the drawing needs neither draft.
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await storedDrafts()).toEqual([]);
  });

  it("finishes a first save that disabling interrupted, with the file it made", async function () {
    await browser.executeObsidian(({ app }) => {
      const vault = app.vault as typeof app.vault & {
        inklineCreateBinary?: typeof app.vault.createBinary;
      };
      const create = vault.createBinary.bind(vault);
      vault.inklineCreateBinary = create;
      vault.createBinary = async (path, data, options) => {
        const file = await create(path, data, options);
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        return file;
      };
    });
    try {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "s"]);
      await browser.waitUntil(async () => (await symbolFiles()).length === 1);
      await obsidianPage.disablePlugin("inkline");
      // Let the old save finish.
      await browser.pause(2500);
    } finally {
      await browser.executeObsidian(({ app }) => {
        const vault = app.vault as typeof app.vault & {
          inklineCreateBinary?: typeof app.vault.createBinary;
        };
        if (vault.inklineCreateBinary !== undefined)
          vault.createBinary = vault.inklineCreateBinary;
      });
    }
    // Disabled, Inkline inserted nothing; the draft will.
    expect(await noteText()).toBe(
      "The door is marked with  which means return.\n",
    );
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect(await noteText()).toBe(
      "The door is marked with ![[001.ink.png]] which means return.\n",
    );
  });

  it("finishes a first save whose insertion failed before disabling, with the file it made", async function () {
    await interruptInsertion();
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect((await noteText()).split("![[001.ink.png]]")).toHaveLength(2);
  });

  it("offers a draft whose kept base layer cannot be read, without it", async function () {
    await browser.executeObsidian(({ app }) => {
      const { drafts, png } = window.inklineTest;
      // A PNG whose header is sound but whose pixels do not decode.
      const header = new Uint8Array(13);
      new DataView(header.buffer).setUint32(0, 24);
      new DataView(header.buffer).setUint32(4, 24);
      header.set([8, 6, 0, 0, 0], 8);
      const broken = png.writeChunks([
        { type: "IHDR", data: header },
        { type: "IDAT", data: Uint8Array.of(1, 2, 3, 4) },
        { type: "IEND", data: new Uint8Array(0) },
      ]);
      new drafts.DraftStore(app).put({
        id: "planted",
        target: { kind: "new", note: "Editor.md" },
        strokes: [
          { tool: "pen", size: 256, pressure: false, points: [1600, 1600] },
        ],
        base: { kind: "kept", layer: { x: 0, y: 0, scale: 8, png: broken } },
        savedAt: Date.now(),
      });
    });
    await insert();
    await browser.$(".modal-content*=base layer cannot be read").waitForExist();
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
      base?: unknown;
    };
    expect(record.strokes).toHaveLength(1);
    expect(record.base).toBeUndefined();
  });

  it("refuses a picture whose ink is too large for a base layer", async function () {
    await writeNoise("large.ink.png", 4096, 2048);
    await browser.executeObsidian(({ app, plugins }) => {
      const file = app.vault.getFileByPath("large.ink.png");
      if (file === null) throw new Error("no large.ink.png");
      void plugins.inkline.editSymbol(file);
    });
    await browser
      .$(".notice*=more than a base layer can hold")
      .waitForExist({ timeout: 30_000 });
    expect(await editorOpen()).toBe(false);
  });

  it("keeps drafts with a large kept base layer quickly, storing its pixels once", async function () {
    await writeNoise("noise.png", 1024, 1024);
    const timings = await browser.executeObsidian(async ({ app }) => {
      const { drafts } = window.inklineTest;
      const file = app.vault.getFileByPath("noise.png");
      if (file === null) throw new Error("no noise.png");
      const png = new Uint8Array(await app.vault.readBinary(file));
      const store = new drafts.DraftStore(app);
      const stroke = {
        tool: "pen",
        size: 256,
        pressure: false,
        points: [1600, 1600],
      } as const;
      const times: number[] = [];
      for (let count = 1; count <= 6; count++) {
        const start = performance.now();
        const kept = store.put({
          id: "timed",
          target: { kind: "new", note: "Timing.md" },
          strokes: Array.from({ length: count }, () => stroke),
          base: { kind: "kept", layer: { x: 0, y: 0, scale: 0.1875, png } },
          savedAt: Date.now(),
        });
        times.push(kept ? performance.now() - start : Number.POSITIVE_INFINITY);
      }
      store.remove("timed");
      store.list();
      return { bytes: png.length, times };
    });
    expect(timings.bytes).toBeGreaterThan(1024 * 1024);
    // The first draft stores the pixels; the others only their strokes.
    expect(timings.times[0]).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(Math.max(...timings.times.slice(1))).toBeLessThan(50);
  });

  it("does not offer an open editor's draft to another editor", async function () {
    await insert();
    await draw(zigzag);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await browser.waitUntil(
      async () =>
        (await browser.$$(".inkline-editor").getElements()).length === 2,
    );
    await browser.pause(500);
    expect(await topButton("Restore")).toBeUndefined();
  });

  it("names the file a first save is making in the draft before making it", async function () {
    await delayVault("createBinary", 2000);
    try {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "s"]);
      await browser.waitUntil(async () => (await symbolFiles()).length === 1);
      const [draft] = await storedDrafts();
      expect(draft?.target).toMatchObject({
        kind: "new",
        note: "Editor.md",
        file: { path: "001.ink.png" },
      });
      await waitForStatus("Saved");
    } finally {
      await restoreVault();
    }
  });

  it("does not insert again an embed that an interrupted save inserted", async function () {
    await insert();
    await draw(zigzag);
    // Close the note's tab, so that the insertion edits its file.
    await browser.executeObsidian(({ app }) => {
      for (const leaf of app.workspace.getLeavesOfType("markdown"))
        leaf.detach();
    });
    await delayVault("process", 2000);
    try {
      await browser.keys(["Control", "s"]);
      await browser.waitUntil(async () =>
        (await fileText("Editor.md")).includes("001.ink.png"),
      );
      await obsidianPage.disablePlugin("inkline");
      // Let the old insertion finish.
      await browser.pause(2500);
    } finally {
      await restoreVault();
    }
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await obsidianPage.openFile("Editor.md");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect((await noteText()).split("001.ink.png")).toHaveLength(2);
  });

  it("leaves a claimed file that changed while it was read, and makes another", async function () {
    await interruptInsertion();
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Restore");
    await delayVault("readBinary", 1500);
    try {
      await browser.keys(["Control", "Enter"]);
      await browser.pause(300);
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("001.ink.png");
        if (file === null) throw new Error("no 001.ink.png");
        await app.vault.modifyBinary(file, new ArrayBuffer(10));
      });
      await waitClosed();
    } finally {
      await restoreVault();
    }
    expect(await symbolFiles()).toEqual(["001.ink.png", "002.ink.png"]);
    const size = await browser.executeObsidian(
      ({ app }) => app.vault.getFileByPath("001.ink.png")?.stat.size,
    );
    expect(size).toBe(10);
    const text = await noteText();
    expect(text).toContain("![[002.ink.png]]");
    expect(text).not.toContain("001.ink.png");
  });

  it("follows a rename of the claimed file after restoring its draft", async function () {
    await interruptInsertion();
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Restore");
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no 001.ink.png");
      await app.fileManager.renameFile(file, "renamed.ink.png");
    });
    await draw([
      [0.5, 0.2],
      [0.5, 0.8],
    ]);
    await browser.waitUntil(async () => {
      const [draft] = await storedDrafts();
      return (
        draft?.strokes.length === 2 &&
        JSON.stringify(draft.target).includes("renamed.ink.png")
      );
    });
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["renamed.ink.png"]);
    expect((await noteText()).split("renamed.ink.png")).toHaveLength(2);
  });

  for (const when of ["before", "after"] as const) {
    for (const stroke of [false, true]) {
      it(`keeps a picture that undo brought back while a save wrote, held ${when} the write${stroke ? ", with a stroke" : ""}`, async function () {
        await createSquare();
        await editFile("square.ink.png");
        await browser.$('[data-inkline-button="clear"]').click();
        await delayVault("modifyBinary", 2500, when);
        try {
          await browser.keys(["Control", "s"]);
          await waitForStatus("Saving…");
          await browser.keys(["Control", "z"]);
          if (stroke) {
            await draw([
              [0.45, 0.8],
              [0.55, 0.8],
            ]);
          }
          await obsidianPage.disablePlugin("inkline");
          // Let the old save finish: the file then holds the cleared drawing.
          await browser.pause(3000);
        } finally {
          await restoreVault();
        }
        expect(
          (JSON.parse(await recordOf("square.ink.png")) as { base?: unknown })
            .base,
        ).toBeUndefined();
        await obsidianPage.enablePlugin("inkline");
        await loadModules();
        await editFile("square.ink.png");
        await clickTop("Restore");
        await browser.keys(["Control", "Enter"]);
        await waitClosed();
        const record = JSON.parse(await recordOf("square.ink.png")) as {
          base?: { scale: number };
          strokes: unknown[];
        };
        expect(record.base?.scale).toBe(8);
        expect(record.strokes).toHaveLength(stroke ? 1 : 0);
      });
    }
  }

  it("offers a draft to one editor at a time, even before it is answered", async function () {
    await insert();
    await draw(zigzag);
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await browser.waitUntil(
      async () =>
        (await browser.$$(".inkline-editor").getElements()).length === 2,
    );
    await browser.pause(500);
    expect(await browser.$$("button=Restore").getElements()).toHaveLength(1);
    // The second editor, on top, offers nothing; closing it uncovers the
    // first one's question. Dismissed, the draft can be offered again.
    await browser.keys(["Escape"]);
    await clickTop("Not now");
    await browser.keys(["Escape"]);
    await waitClosed();
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Restore");
  });

  it("inserts a recovered symbol even when the note only links to its file", async function () {
    await interruptInsertion();
    await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (view === null) throw new Error("no Markdown view");
      view.editor.setValue("See [[001.ink.png]] for the door.\n");
    });
    await browser.waitUntil(async () =>
      browser.executeObsidian(
        ({ app }) =>
          (app.metadataCache.resolvedLinks["Editor.md"]?.["001.ink.png"] ?? 0) >
          0,
      ),
    );
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const text = await noteText();
    expect(text).toContain("![[001.ink.png]]");
    expect(text).toContain("[[001.ink.png]] for the door");
  });

  it("keeps a draft in line through a restart while a save writes the file", async function () {
    await createSquare();
    await editFile("square.ink.png");
    // Far to the left, so that the save crops and moves everything.
    await draw([
      [0.05, 0.3],
      [0.1, 0.3],
    ]);
    await delayVault("modifyBinary", 60_000);
    let draft: Awaited<ReturnType<typeof storedDrafts>>[number] | undefined;
    try {
      await browser.keys(["Control", "s"]);
      // The file is written; the save has not finished.
      let written = "";
      try {
        await browser.waitUntil(async () => {
          written = await recordOf("square.ink.png");
          const record = JSON.parse(written) as { strokes?: unknown[] };
          return record.strokes?.length === 1;
        });
      } catch (error) {
        const status = await browser.$(".inkline-status").getText();
        throw new Error(
          `the file held ${written.slice(0, 200)}, and the status said "${status}"`,
          { cause: error },
        );
      }
      [draft] = await storedDrafts();
    } finally {
      // Ends the held save, as a crash would.
      await browser.reloadObsidian();
    }
    expect(draft?.base).toBe("kept");
    const offset =
      (draft?.strokes[0]?.points[0] ?? Number.NaN) -
      (draft?.baseX ?? Number.NaN);
    await loadModules();
    await editFile("square.ink.png");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const restored = JSON.parse(await recordOf("square.ink.png")) as {
      base: { x: number };
      strokes: { points: number[] }[];
    };
    expect((restored.strokes[0]?.points[0] ?? 0) - restored.base.x).toBe(
      offset,
    );
  });

  it("maps the pointer to the drawing inside the surface's border", async function () {
    await insert();
    await settledSurface();
    const origin = await surfaceOrigin();
    expect(origin.border).toBeGreaterThan(0);
    const x = Math.round(origin.left + 100);
    const y = Math.round(origin.top + 40);
    await clickAt(x, y);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const [draft] = await storedDrafts();
    const [pointX, pointY] = draft?.strokes[0]?.points ?? [];
    expect(
      Math.abs(
        (pointX ?? Number.NaN) - ((x - origin.left) / origin.scale) * 16,
      ),
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs((pointY ?? Number.NaN) - ((y - origin.top) / origin.scale) * 16),
    ).toBeLessThanOrEqual(0.5);
  });

  it("shows a symbol wider than the usual view whole", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const { canvas } = window.inklineTest;
      const stroke = (x: number) =>
        ({
          tool: "pen",
          size: 256,
          pressure: false,
          points: [x * 16, 1600, x * 16, 1920],
        }) as const;
      const { bytes } = await canvas.saveInk(
        { strokes: [stroke(100), stroke(1100)] },
        undefined,
      );
      await app.vault.createBinary("wide.ink.png", bytes.slice().buffer);
    });
    await editFile("wide.ink.png");
    await settledSurface();
    const origin = await surfaceOrigin();
    await clickAt(origin.left + 2, origin.top + 40);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 3,
    );
    const [draft] = await storedDrafts();
    // Left of the symbol's first stroke, at 8 pixels: the view starts before.
    expect(draft?.strokes[2]?.points[0]).toBeLessThan(0);
  });

  it("lets a pen take over from a touch already drawing", async function () {
    await insert();
    const { width, height } = await settledSurface();
    // Actions run together take a found element, not a query.
    const canvas = await surface().getElement();
    const at = (x: number, y: number) => ({
      origin: canvas,
      x: Math.round((x - 0.5) * width),
      y: Math.round((y - 0.5) * height),
    });
    await browser.actions([
      browser
        .action("pointer", { id: "palm", parameters: { pointerType: "touch" } })
        .move(at(0.2, 0.8))
        .down()
        .move({ ...at(0.25, 0.8), duration: 50 })
        .pause(200)
        .move({ ...at(0.3, 0.8), duration: 50 })
        .up(),
      browser
        .action("pointer", { id: "stylus", parameters: { pointerType: "pen" } })
        .pause(100)
        .move(at(0.5, 0.2))
        .down()
        .move({ ...at(0.6, 0.3), duration: 100 })
        .up(),
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const [draft] = await storedDrafts();
    expect(draft?.strokes).toHaveLength(1);
    // The pen's stroke, near the top, not the palm's, near the bottom.
    expect(draft?.strokes[0]?.points[1]).toBeLessThan(96 * 16);
  });

  it("does not offer a note's draft once the new symbol was saved meanwhile", async function () {
    await plantKeptDraft();
    await delayDecoding(3000);
    try {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      // Let the decoding finish.
      await browser.pause(3500);
      expect(await topButton("Restore")).toBeUndefined();
    } finally {
      await restoreDecoding();
    }
    expect((await storedDrafts()).map((draft) => draft.id)).toEqual([
      "planted",
    ]);
  });

  it("does not offer a draft over the question before closing", async function () {
    await plantKeptDraft();
    await delayDecoding(3000);
    try {
      await insert();
      await draw(zigzag);
      await browser.keys(["Escape"]);
      await browser.waitUntil(
        async () => (await topButton("Keep drawing")) !== undefined,
      );
      await browser.pause(3500);
      expect(await topButton("Restore")).toBeUndefined();
      expect(await topButton("Keep drawing")).toBeDefined();
    } finally {
      await restoreDecoding();
    }
    await clickTop("Discard");
    await waitClosed();
    expect((await storedDrafts()).map((draft) => draft.id)).toEqual([
      "planted",
    ]);
  });

  it("takes over a claimed file whose last write failed after disabling", async function () {
    await browser.executeObsidian(({ app }) => {
      const vault = app.vault as typeof app.vault & {
        inklineProcess?: typeof app.vault.process;
      };
      vault.inklineProcess = vault.process.bind(vault);
      vault.process = () => Promise.reject(new Error("the note is locked"));
    });
    try {
      await insert();
      await draw(zigzag);
      await showWelcomeInstead();
      await browser.keys(["Control", "s"]);
      await waitForStatus("the note is locked");
      await draw([
        [0.5, 0.2],
        [0.5, 0.8],
      ]);
      // The next write waits, and fails once Inkline is disabled.
      await browser.executeObsidian(({ app }) => {
        const original: unknown = Reflect.get(app.vault, "modifyBinary");
        Reflect.set(app.vault, "inklineDelayed-modifyBinary", original);
        Reflect.set(app.vault, "modifyBinary", async () => {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          throw new Error("the disk is gone");
        });
      });
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saving…");
      await obsidianPage.disablePlugin("inkline");
      await browser.pause(2000);
    } finally {
      await restoreVault();
      await browser.executeObsidian(({ app }) => {
        const vault = app.vault as typeof app.vault & {
          inklineProcess?: typeof app.vault.process;
        };
        if (vault.inklineProcess !== undefined)
          vault.process = vault.inklineProcess;
      });
    }
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await obsidianPage.openFile("Editor.md");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect((await noteText()).split("001.ink.png")).toHaveLength(2);
  });

  it("shows a restored drawing whole, even one wider than its file", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const { canvas } = window.inklineTest;
      const stroke = (x: number) =>
        ({
          tool: "pen",
          size: 256,
          pressure: false,
          points: [x * 16, 1600, x * 16, 1920],
        }) as const;
      const { bytes } = await canvas.saveInk(
        { strokes: [stroke(100), stroke(1100)] },
        undefined,
      );
      await app.vault.createBinary("wide.ink.png", bytes.slice().buffer);
    });
    await editFile("wide.ink.png");
    await browser.$('[data-inkline-button="clear"]').click();
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await browser.keys(["Control", "z"]);
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    // The file now holds the cleared drawing, narrow.
    await editFile("wide.ink.png");
    await clickTop("Restore");
    await settledSurface();
    const origin = await surfaceOrigin();
    const width = await surface().getSize("width");
    await clickAt(origin.left + 2, origin.top + 40);
    await clickAt(origin.left + width - 4, origin.top + 40);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 4,
    );
    const [draft] = await storedDrafts();
    const xs = (draft?.strokes ?? []).map(
      (stroke) => stroke.points[0] ?? Number.NaN,
    );
    // Clicks at both edges land outside both restored strokes.
    expect(xs[2]).toBeLessThan(xs[0] ?? Number.NaN);
    expect(xs[3]).toBeGreaterThan(xs[1] ?? Number.NaN);
  });

  it("draws the text font's guides, and shows or hides them with G", async function () {
    await insert();
    await settledSurface();
    const shown = await guideRows();
    expect(shown.lines).toBeGreaterThanOrEqual(3);
    expect(shown.shown).toBe(shown.lines);
    const button = browser.$('[data-inkline-button="guides"]');
    expect(await button.getAttribute("aria-pressed")).toBe("true");
    await browser.keys(["g"]);
    await browser.waitUntil(async () => (await guideRows()).drawn === 0);
    expect(await button.getAttribute("aria-pressed")).toBe("false");
    await browser.keys(["g"]);
    await browser.waitUntil(
      async () => (await guideRows()).shown === shown.lines,
    );
  });

  it("measures the vault's text font, not the interface's", async function () {
    await browser.execute(() => {
      document.body.setCssProps({
        "--font-text": '"DejaVu Serif", serif',
        "--font-text-size": "28px",
      });
    });
    try {
      await insert();
      await settledSurface();
      const preview = await browser.execute(() => {
        const line = document.querySelector(".inkline-editor .inkline-preview");
        const ink = document.querySelector(
          ".inkline-editor .inkline-preview-ink",
        );
        if (!(line instanceof HTMLElement) || !(ink instanceof HTMLElement)) {
          throw new Error("no preview");
        }
        const font = getComputedStyle(line);
        return {
          family: font.fontFamily,
          size: font.fontSize,
          height: ink.getBoundingClientRect().height,
        };
      });
      expect(preview.family).toContain("DejaVu Serif");
      expect(preview.size).toBe("28px");
      expect(preview.height).toBeCloseTo(42, 1);
      const rows = await guideRows();
      expect(rows.shown).toBe(rows.lines);
    } finally {
      await browser.execute(() => {
        document.body.style.removeProperty("--font-text");
        document.body.style.removeProperty("--font-text-size");
      });
    }
  });

  it("measures the font again once it loads", async function () {
    await browser.execute(() => {
      document.body.setCssProps({ "--font-text": '"Inkline Late", monospace' });
    });
    try {
      await insert();
      await settledSurface();
      const before = await guideRows();
      expect(before.shown).toBe(before.lines);
      await browser.execute(async () => {
        const face = new FontFace("Inkline Late", "local('DejaVu Serif')");
        document.fonts.add(face);
        await face.load();
      });
      // The guides follow the loaded font, which the rows now predict.
      await browser.waitUntil(async () => {
        const after = await guideRows();
        return (
          after.shown === after.lines &&
          after.rows.join() !== before.rows.join()
        );
      });
    } finally {
      await browser.execute(() => {
        document.body.style.removeProperty("--font-text");
        for (const face of document.fonts) {
          if (face.family.includes("Inkline Late")) document.fonts.delete(face);
        }
      });
    }
  });

  it("measures the font in the window the editor opens in", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Editor.md");
      if (file === null) throw new Error("no Editor.md");
      await app.workspace.openPopoutLeaf().openFile(file);
    });
    try {
      // A font that only the popout has, as its text font.
      await browser.waitUntil(async () =>
        browser.executeObsidian(({ app, obsidian }) => {
          const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
          return (
            view !== null &&
            view.containerEl.doc !== document &&
            view.editor.getValue().includes("HERE")
          );
        }),
      );
      await browser.executeObsidian(async ({ app, obsidian }) => {
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        const doc = view?.containerEl.doc;
        const win = doc?.defaultView;
        if (
          view === null ||
          doc === undefined ||
          win === null ||
          win === undefined
        ) {
          throw new Error("no popout");
        }
        const face = new win.FontFace(
          "Inkline Popout Only",
          "local('DejaVu Serif')",
        );
        doc.fonts.add(face);
        await face.load();
        doc.body.setCssProps({
          "--font-text": '"Inkline Popout Only", monospace',
        });
        const editor = view.editor;
        const at = editor.getValue().indexOf("HERE");
        editor.setSelection(editor.offsetToPos(at), editor.offsetToPos(at + 4));
        editor.replaceSelection("");
        editor.focus();
      });
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            activeDocument !== document &&
            activeDocument.querySelector(".inkline-editor .inkline-surface") !==
              null,
        ),
      );
      // The main window does not have the font, so it measures otherwise.
      const elsewhere = await browser.execute(() => {
        const context = new OffscreenCanvas(1, 1).getContext("2d");
        if (context === null) throw new Error("no context");
        context.font = '128px "Inkline Popout Only", monospace';
        return context.measureText("x").actualBoundingBoxAscent;
      });
      const there = await browser.execute(() => {
        const view = activeDocument.defaultView;
        if (view === null) throw new Error("no window");
        const context = new view.OffscreenCanvas(1, 1).getContext("2d");
        if (context === null) throw new Error("no context");
        context.font = '128px "Inkline Popout Only", monospace';
        return context.measureText("x").actualBoundingBoxAscent;
      });
      expect(there).not.toBe(elsewhere);
      await browser.waitUntil(async () => {
        const rows = await guideRows();
        return rows.shown === rows.lines;
      });
    } finally {
      // Disabling Inkline closes the popout's editor; then the popout goes.
      await obsidianPage.disablePlugin("inkline");
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
      await browser.executeObsidian(({ app }) => {
        for (const leaf of app.workspace.getLeavesOfType("markdown")) {
          if (leaf.view.containerEl.doc !== document) leaf.detach();
        }
      });
    }
  });

  it("shows the symbol at its size in a line of text, as it is drawn", async function () {
    await insert();
    const preview = () =>
      browser.execute(() => {
        const canvas = document.querySelector(
          ".inkline-editor .inkline-preview-ink",
        );
        const line = document.querySelector(".inkline-editor .inkline-preview");
        if (
          !(canvas instanceof HTMLCanvasElement) ||
          !(line instanceof HTMLElement)
        ) {
          throw new Error("no preview");
        }
        const pixels = canvas
          .getContext("2d")
          ?.getImageData(0, 0, canvas.width, canvas.height);
        let ink = 0;
        for (let index = 3; index < (pixels?.data.length ?? 0); index += 4) {
          if ((pixels?.data[index] ?? 0) > 0) ink++;
        }
        return {
          fontSize: Number.parseFloat(getComputedStyle(line).fontSize),
          width: canvas.getBoundingClientRect().width,
          height: canvas.getBoundingClientRect().height,
          ink,
        };
      });
    const empty = await preview();
    // The line box is 1.5 em tall, and an empty symbol 3/8 em wide.
    expect(empty.height).toBeCloseTo(1.5 * empty.fontSize, 1);
    expect(empty.width).toBeCloseTo(0.375 * empty.fontSize, 1);
    expect(empty.ink).toBe(0);
    // An eraser on no ink makes no image wider.
    await browser.keys(["e"]);
    await draw([
      [0.3, 0.5],
      [0.7, 0.5],
    ]);
    expect((await preview()).width).toBeCloseTo(empty.width, 1);
    await browser.keys(["p"]);
    // While the stroke is still being drawn, the preview shows it.
    const { width, height } = await settledSurface();
    const canvas = await surface().getElement();
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ origin: canvas, x: Math.round(-0.05 * width), y: 0 })
      .down()
      .move({
        origin: canvas,
        x: Math.round(0.05 * width),
        y: Math.round(0.05 * height),
        duration: 50,
      })
      .perform(true);
    await browser.waitUntil(async () => (await preview()).ink > 0);
    await browser.releaseActions();
    const short = await preview();
    await draw([
      [0.5, 0.3],
      [0.9, 0.3],
    ]);
    await browser.waitUntil(
      async () => (await preview()).width > short.width + 1,
    );
  });

  it("shows the preview in the text colour after a theme changes it", async function () {
    await insert();
    await draw(zigzag);
    // The red of the preview's most opaque ink, or -1 with none nearly so.
    const red = () =>
      browser.execute(() => {
        const canvas = document.querySelector(
          ".inkline-editor .inkline-preview-ink",
        );
        if (!(canvas instanceof HTMLCanvasElement))
          throw new Error("no preview");
        const data =
          canvas
            .getContext("2d")
            ?.getImageData(0, 0, canvas.width, canvas.height).data ??
          new Uint8ClampedArray();
        let alpha = 0;
        let value = -1;
        for (let index = 0; index < data.length; index += 4) {
          if ((data[index + 3] ?? 0) > alpha) {
            alpha = data[index + 3] ?? 0;
            value = data[index] ?? -1;
          }
        }
        return alpha >= 200 ? value : -1;
      });
    await browser.waitUntil(async () => (await red()) >= 0);
    // A theme or snippet changes the text colour, and Obsidian says so.
    await browser.executeObsidian(({ app }) => {
      document.body.setCssProps({ "--text-normal": "rgb(200, 0, 0)" });
      app.workspace.trigger("css-change");
    });
    try {
      // Scaling the ink down can round the channel a step or two.
      await browser.waitUntil(async () => Math.abs((await red()) - 200) <= 3);
    } finally {
      await browser.executeObsidian(({ app }) => {
        document.body.style.removeProperty("--text-normal");
        app.workspace.trigger("css-change");
      });
    }
  });
  it("saves without waiting for the window to be idle", async function () {
    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      await startOver();
      await createSquare();
      await editFile("square.ink.png");
      await draw([
        [0.05, 0.3],
        [0.1, 0.3],
      ]);
      // Timed inside Obsidian, from "Saving…" to "Saved", without the time
      // WebDriver takes to send keys and to poll.
      await browser.execute(() => {
        const status = document.querySelector(
          ".inkline-editor .inkline-status",
        );
        if (status === null) throw new Error("no status");
        const times: Record<string, number> = {};
        Reflect.set(window, "inklineSaveTimes", times);
        new MutationObserver(() => {
          const text = status.textContent;
          if (!(text in times)) {
            times[text] = performance.now();
          }
        }).observe(status, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      times.push(
        await browser.execute(() => {
          const marks: unknown = Reflect.get(window, "inklineSaveTimes");
          if (typeof marks !== "object" || marks === null) return Infinity;
          const saving: unknown = Reflect.get(marks, "Saving…");
          const saved: unknown = Reflect.get(marks, "Saved");
          return typeof saving === "number" && typeof saved === "number"
            ? saved - saving
            : Infinity;
        }),
      );
    }
    // Chromium 150 held a canvas's own encoding back for about a second
    // when saving a picture opened as a symbol.
    expect(Math.max(...times)).toBeLessThan(700);
  });

  it("draws a straight segment while Shift is held", async function () {
    await insert();
    const { width, height } = await settledSurface();
    const canvas = await surface().getElement();
    const at = (x: number, y: number) => ({
      origin: canvas,
      x: Math.round((x - 0.5) * width),
      y: Math.round((y - 0.5) * height),
    });
    // The pointer wanders, but Shift keeps the stroke straight.
    await browser.actions([
      browser
        .action("key")
        .down(Key.Shift)
        .pause(10)
        .pause(10)
        .pause(10)
        .pause(10)
        .up(Key.Shift),
      browser
        .action("pointer", { parameters: { pointerType: "mouse" } })
        .move(at(0.3, 0.3))
        .down()
        .move({ ...at(0.5, 0.8), duration: 50 })
        .move({ ...at(0.7, 0.4), duration: 50 })
        .up(),
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const [draft] = await storedDrafts();
    const points = draft?.strokes[0]?.points ?? [];
    const x0 = points[0] ?? 0;
    const y0 = points[1] ?? 0;
    const x1 = points.at(-2) ?? 0;
    const y1 = points.at(-1) ?? 0;
    const length = Math.hypot(x1 - x0, y1 - y0);
    expect(length).toBeGreaterThan(16 * 50);
    // Every point within a pixel (16 units) of the line from end to end.
    for (let index = 0; index < points.length; index += 2) {
      const x = points[index] ?? 0;
      const y = points[index + 1] ?? 0;
      const off =
        Math.abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / length;
      expect(off).toBeLessThan(16);
    }
  });

  it("shows a grid with Shift+G, and snaps strokes' ends to it", async function () {
    await insert();
    await settledSurface();
    const dots = () =>
      browser.execute(() => {
        const canvas = document.querySelector(
          ".inkline-editor .inkline-surface",
        );
        if (!(canvas instanceof HTMLCanvasElement))
          throw new Error("no surface");
        const pixels = canvas
          .getContext("2d")
          ?.getImageData(0, 0, canvas.width, canvas.height);
        const factor = canvas.width / 576;
        // A grid crossing away from every guide: 2 em across, 2/8 em down.
        const x = Math.round(256 * factor);
        const y = Math.round(32 * factor);
        return pixels?.data[(y * canvas.width + x) * 4 + 3] ?? 0;
      });
    expect(await dots()).toBe(0);
    await browser.keys(["Shift", "g"]);
    await browser.waitUntil(async () => (await dots()) > 0);
    expect(
      await browser
        .$('[data-inkline-button="grid"]')
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await draw([
      [0.31, 0.27],
      [0.52, 0.41],
      [0.69, 0.73],
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const points = (await storedDrafts())[0]?.strokes[0]?.points ?? [];
    for (const value of [points[0], points[1], points.at(-2), points.at(-1)]) {
      expect((value ?? 1) % (16 * 16)).toBe(0);
    }
  });

  it("keeps a tap on the grid a dot, and the grid in place through a save", async function () {
    await insert();
    await settledSurface();
    await browser.keys(["Shift", "g"]);
    await draw([[0.31, 0.27]]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    // One point: no spur out to where the pointer was and back.
    expect((await storedDrafts())[0]?.strokes[0]?.points).toHaveLength(2);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    // The same place on screen, after the save moved the drawing.
    await draw([[0.31, 0.27]]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    const [first, second] = (await storedDrafts())[0]?.strokes ?? [];
    expect(second?.points).toEqual(first?.points);
  });

  it("lines the grid up with a reopened symbol's strokes", async function () {
    await insert();
    // Drawn before the grid is shown, so off it.
    await draw(zigzag);
    await settledSurface();
    await browser.keys(["Shift", "g"]);
    await draw([[0.62, 0.27]]);
    await draw([[0.7, 0.6]]);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    await editFile("001.ink.png");
    await settledSurface();
    await browser.keys(["Shift", "g"]);
    await draw([[0.33, 0.45]]);
    await saveScreenshot("editor-grid");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const { strokes } = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: { points: number[] }[];
    };
    // Where each stroke drawn on the grid lies within a spacing of 1/8 em,
    // 256 units.
    const columns = strokes
      .slice(1)
      .map((stroke) => (((stroke.points[0] ?? 0) % 256) + 256) % 256);
    expect(columns).toHaveLength(3);
    expect(new Set(columns).size).toBe(1);
  });

  it("restores a draft with the grid it was drawn on, and undoes that too", async function () {
    await insert();
    // Freehand, and saved: the file alone suggests another grid.
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await browser.keys(["Shift", "g"]);
    // One tap, which the zigzag's two ends outvote.
    await draw([[0.62, 0.27]]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await editFile("001.ink.png");
    await clickTop("Restore");
    await settledSurface();
    await browser.keys(["Shift", "g"]);
    await draw([[0.33, 0.45]]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 3,
    );
    // Where a stroke starts within a spacing of 1/8 em, 256 units.
    const column = (stroke: { points: readonly number[] } | undefined) =>
      (((stroke?.points[0] ?? 0) % 256) + 256) % 256;
    const restored = (await storedDrafts())[0]?.strokes ?? [];
    expect(column(restored[2])).toBe(column(restored[1]));
    // Undoing the tap and the restore leaves the file, and the grid its
    // strokes suggest: through the zigzag's start.
    await browser.keys(["Control", "z"]);
    await browser.keys(["Control", "z"]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 0);
    await draw([[0.33, 0.45]]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    const [start, tap] = (await storedDrafts())[0]?.strokes ?? [];
    expect(column(tap)).toBe(column(start));
    expect(column(tap)).not.toBe(column(restored[1]));
  });

  it("clears with Delete, and fits the drawing in view with F", async function () {
    await insert();
    await draw([
      [0.05, 0.4],
      [0.1, 0.6],
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const before = (await storedDrafts())[0]?.strokes[0]?.points ?? [];
    const centre = ((before[0] ?? 0) + (before.at(-2) ?? 0)) / 2 / 16;
    await browser.keys(["f"]);
    // The drawing is now in the middle: a dot there lands near its centre.
    await browser.pause(200);
    await draw([[0.5, 0.2]]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    const dot = (await storedDrafts())[0]?.strokes[1]?.points ?? [];
    expect(Math.abs((dot[0] ?? 0) / 16 - centre)).toBeLessThan(16);
    await browser.keys(["Delete"]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 0,
    );
    // Backspace, which a Mac's key labelled Delete sends, clears too.
    await browser.keys(["Control", "z"]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    await browser.keys(["Backspace"]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 0,
    );
  });

  it("lets a text field have the keys it types", async function () {
    await insert();
    await draw(zigzag);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    await browser.execute(() => {
      const content = document.querySelector(".inkline-editor .modal-content");
      if (content === null) throw new Error("no editor");
      const field = content.createEl("input", { type: "text" });
      field.addClass("inkline-test-field");
      field.focus();
    });
    await browser.keys(["e", "2", "3", "Backspace"]);
    const eraser = browser.$('[data-inkline-button="eraser"]');
    expect(await eraser.getAttribute("aria-pressed")).toBe("false");
    expect(
      await browser.execute(() => {
        const field = document.querySelector(".inkline-test-field");
        return field instanceof HTMLInputElement ? field.value : "";
      }),
    ).toBe("e2");
    // Away from the field, the keys are the editor's again. Backspace left
    // the drawing alone, so the click's dot is its second stroke.
    await surface().click();
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    await browser.keys(["e"]);
    await browser.waitUntil(
      async () => (await eraser.getAttribute("aria-pressed")) === "true",
    );
  });
  describe("when its file changes on disk", function () {
    it("takes in the change when nothing is unsaved", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await settledSurface();
      await changeElsewhere("001.ink.png");
      await waitForStatus("Reloaded: the file changed on disk");
      await draw([[0.5, 0.2]]);
      // The three dots, and the new stroke.
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.strokes.length === 4,
      );
    });

    it("asks first when something is unsaved, and can keep the drawing", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await draw([[0.5, 0.2]]);
      await changeElsewhere("001.ink.png");
      await clickTop("Keep mine");
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      expect(await strokeCount("001.ink.png")).toBe(2);
      // Its own saves are not changes to ask about.
      await draw([[0.6, 0.2]]);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await browser.pause(500);
      expect(await topButton("Keep mine")).toBeUndefined();
      expect(await strokeCount("001.ink.png")).toBe(3);
    });

    it("reloads when asked to, with the drawing one undo away", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await draw([[0.5, 0.2]]);
      await browser.waitUntil(async () => (await storedDrafts()).length === 1);
      await changeElsewhere("001.ink.png");
      await clickTop("Reload");
      await waitForStatus("Reloaded: the file changed on disk");
      // Nothing is unsaved now, so no draft is kept.
      await browser.waitUntil(async () => (await storedDrafts()).length === 0);
      await browser.keys(["Control", "z"]);
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.strokes.length === 2,
      );
    });

    it("finds a change when saving, and saves over it only once told to", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await draw([[0.5, 0.2]]);
      // Straight to the disk, and the save at once, before the vault notices.
      await changeElsewhere("001.ink.png", "disk");
      await browser.execute(() => {
        const save = document.querySelector('[data-inkline-button="save"]');
        if (!(save instanceof HTMLElement)) throw new Error("no Save button");
        save.click();
      });
      await waitForStatus("Not saved: the file changed on disk");
      expect(await strokeCount("001.ink.png")).toBe(3);
      // Keeping the drawing goes on with the save, and its closing.
      await clickTop("Keep mine");
      await waitClosed();
      expect(await strokeCount("001.ink.png")).toBe(2);
    });

    it("never saves over a file it cannot read", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await draw([[0.5, 0.2]]);
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("001.ink.png");
        if (file === null) throw new Error("no file");
        await app.vault.modifyBinary(
          file,
          new TextEncoder().encode("x").buffer,
        );
      });
      await waitForStatus("Not reloaded: the file changed on disk");
      await browser.keys(["Control", "s"]);
      await waitForStatus("Not saved: the file changed on disk");
      const held = await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("001.ink.png");
        if (file === null) throw new Error("no file");
        return new TextDecoder().decode(await app.vault.readBinary(file));
      });
      expect(held).toBe("x");
      // The drawing is kept as a draft meanwhile.
      expect((await storedDrafts())[0]?.strokes).toHaveLength(2);
    });

    it("saves a deleted symbol again where it was, folder and all", async function () {
      await browser.executeObsidian(async ({ app }) => {
        const { canvas } = window.inklineTest;
        const { bytes } = await canvas.saveInk(
          {
            strokes: [
              {
                tool: "pen",
                size: 256,
                pressure: false,
                points: [800, 800, 1600, 2000],
              },
            ],
          },
          undefined,
          [],
        );
        await app.vault.createFolder("Symbols");
        await app.vault.createBinary("Symbols/a.ink.png", bytes.slice().buffer);
      });
      await editFile("Symbols/a.ink.png");
      await draw([[0.5, 0.2]]);
      // Straight from the disk, as sync would.
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.adapter.rmdir("Symbols", true);
      });
      await waitForStatus("The file was deleted; saving makes it again");
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      expect(await symbolFiles()).toEqual(["Symbols/a.ink.png"]);
      expect(await strokeCount("Symbols/a.ink.png")).toBe(2);
    });

    it("still compares a restored new symbol's file after a save fails", async function () {
      await interruptInsertion();
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await browser.waitUntil(
        async () => (await topButton("Restore")) !== undefined,
      );
      // The draft's own first save made the file; nothing saved it since.
      expect(
        await browser.execute(
          () =>
            [...document.querySelectorAll(".modal-container")].at(-1)
              ?.textContent ?? "",
        ),
      ).not.toContain("saved again");
      await clickTop("Restore");
      await draw([[0.5, 0.2]]);
      await browser.executeObsidian(({ app }) => {
        Reflect.set(
          app.vault,
          "inklineDelayed-modifyBinary",
          Reflect.get(app.vault, "modifyBinary"),
        );
        app.vault.modifyBinary = () =>
          Promise.reject(new Error("the disk is full"));
      });
      try {
        // The save adopts the draft's file, then cannot write it.
        await browser.keys(["Control", "s"]);
        await waitForStatus("the disk is full");
      } finally {
        await restoreVault();
      }
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("001.ink.png");
        if (file === null) throw new Error("no file");
        await app.vault.modifyBinary(
          file,
          new TextEncoder().encode("x").buffer,
        );
      });
      await waitForStatus("Not reloaded: the file changed on disk");
      await browser.keys(["Control", "s"]);
      await waitForStatus("Not saved: the file changed on disk");
      expect(
        await browser.executeObsidian(async ({ app }) => {
          const file = app.vault.getFileByPath("001.ink.png");
          if (file === null) throw new Error("no file");
          return new TextDecoder().decode(await app.vault.readBinary(file));
        }),
      ).toBe("x");
    });

    it("saves again without asking after a save that adopted the file failed", async function () {
      await interruptInsertion();
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await clickTop("Restore");
      await draw([[0.5, 0.2]]);
      await browser.executeObsidian(({ app }) => {
        Reflect.set(
          app.vault,
          "inklineDelayed-modifyBinary",
          Reflect.get(app.vault, "modifyBinary"),
        );
        app.vault.modifyBinary = () =>
          Promise.reject(new Error("the disk is full"));
      });
      try {
        await browser.keys(["Control", "s"]);
        await waitForStatus("the disk is full");
      } finally {
        await restoreVault();
      }
      // The file still holds what the draft's first save wrote: the
      // editor's own, not a change to ask about.
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await strokeCount("001.ink.png")).toBe(2);
    });

    it("sets aside a read of the file that a save overtook", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await draw([[0.5, 0.2]]);
      // The next read of the file comes back 3 s late, with what it read.
      await browser.executeObsidian(({ app }) => {
        Reflect.set(
          app.vault,
          "inklineDelayed-readBinary",
          Reflect.get(app.vault, "readBinary"),
        );
        const read = app.vault.readBinary.bind(app.vault);
        let late = true;
        app.vault.readBinary = async (file) => {
          const bytes = await read(file);
          if (late) {
            late = false;
            await new Promise((resolve) => window.setTimeout(resolve, 3000));
          }
          return bytes;
        };
      });
      try {
        // A report of the file, unchanged, starts that read; the save then
        // writes the drawing before it comes back.
        await browser.executeObsidian(async ({ app }) => {
          const file = app.vault.getFileByPath("001.ink.png");
          if (file === null) throw new Error("no file");
          await app.vault.modifyBinary(
            file,
            await app.vault.adapter.readBinary(file.path),
          );
        });
        await browser.keys(["Control", "s"]);
        await waitForStatus("Saved");
        await browser.pause(3500);
      } finally {
        await restoreVault();
      }
      // The late read showed the file before the save: not a change.
      expect(await browser.$(".inkline-status").getText()).toBe("Saved");
      expect(await topButton("Keep mine")).toBeUndefined();
      await draw([[0.6, 0.2]]);
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.strokes.length === 3,
      );
    });

    it("follows a new symbol's file when its first save could not insert it", async function () {
      try {
        await failInsertion();
      } finally {
        await unlockNotes();
      }
      await changeElsewhere("001.ink.png");
      await clickTop("Keep mine");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await strokeCount("001.ink.png")).toBe(1);
    });

    it("follows a new symbol's file once its first save made it", async function () {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await draw([[0.5, 0.2]]);
      await changeElsewhere("001.ink.png");
      await clickTop("Keep mine");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await strokeCount("001.ink.png")).toBe(2);
    });
  });
  describe("drawing the next one", function () {
    it("saves, inserts, and opens the next symbol right after it", async function () {
      await insert();
      await draw(zigzag);
      await markEditor();
      await browser.keys(["Control", "Shift", "Enter"]);
      await waitForNext(1);
      // A blank drawing: its first stroke is the draft's only one.
      await draw([[0.5, 0.5]]);
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.strokes.length === 1,
      );
      await markEditor();
      await browser.$('[data-inkline-button="next"]').click();
      await waitForNext(2);
      await draw([[0.4, 0.3]]);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await symbolFiles()).toEqual([
        "001.ink.png",
        "002.ink.png",
        "003.ink.png",
      ]);
      expect(await noteText()).toBe(
        "The door is marked with ![[001.ink.png]]![[002.ink.png]]![[003.ink.png]] which means return.\n",
      );
    });

    it("starts the next symbol with the same tools", async function () {
      await insert();
      await draw(zigzag);
      await browser.keys(["e", "3"]);
      await browser.keys(["Shift", "g"]);
      await browser.keys(["g"]);
      await markEditor();
      await browser.keys(["Control", "Shift", "Enter"]);
      await waitForNext(1);
      expect(await pressed("eraser")).toBe("true");
      expect(await pressed("size-2")).toBe("true");
      expect(await pressed("grid")).toBe("true");
      expect(await pressed("guides")).toBe("false");
      // It can start from a copy as the first editor could.
      expect(await browser.$('[data-inkline-button="copy"]').isExisting()).toBe(
        true,
      );
    });

    it("follows the symbol before even when the note's tab shows another", async function () {
      await insert();
      await draw(zigzag);
      await markEditor();
      await browser.keys(["Control", "Shift", "Enter"]);
      await waitForNext(1);
      // The next embed then goes into the note's file.
      await showWelcomeInstead();
      await draw([[0.5, 0.5]]);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await fileText("Editor.md")).toBe(
        "The door is marked with ![[001.ink.png]]![[002.ink.png]] which means return.\n",
      );
    });

    it("stays when the symbol could not be inserted, and goes on once it is", async function () {
      try {
        await browser.executeObsidian(({ app }) => {
          const vault = app.vault as typeof app.vault & {
            inklineProcess?: typeof app.vault.process;
          };
          vault.inklineProcess = vault.process.bind(vault);
          vault.process = () => Promise.reject(new Error("the note is locked"));
        });
        await insert();
        await draw(zigzag);
        await showWelcomeInstead();
        await browser.keys(["Control", "Shift", "Enter"]);
        await waitForStatus("the note is locked");
        expect(await browser.$$(".inkline-editor").length).toBe(1);
      } finally {
        await unlockNotes();
      }
      await markEditor();
      await browser.keys(["Control", "Shift", "Enter"]);
      await waitForNext(1);
      // Inserted into the note's file, and the next follows it there.
      await draw([[0.5, 0.5]]);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await fileText("Editor.md")).toBe(
        "The door is marked with ![[001.ink.png]]![[002.ink.png]] which means return.\n",
      );
    });

    it("opens one next editor however often Next is asked during its save", async function () {
      await insert();
      await draw(zigzag);
      await delayVault("createBinary", 1500);
      await markEditor();
      await browser.$('[data-inkline-button="next"]').click();
      await browser.keys(["Control", "Shift", "Enter"]);
      await browser.keys(["Control", "Shift", "Enter"]);
      await waitForNext(1);
      await browser.pause(2000);
      expect(await browser.$$(".inkline-editor").length).toBe(1);
    });

    it("follows a restored symbol's embed however the note writes it", async function () {
      await interruptInsertion();
      // The first save's embed did reach the note, written another way.
      await browser.executeObsidian(async ({ app }) => {
        const note = app.vault.getFileByPath("Editor.md");
        if (note === null) throw new Error("no Editor.md");
        await app.vault.modify(note, "Before ![[001.ink.png|symbol]] after.\n");
      });
      await browser.waitUntil(async () =>
        browser.executeObsidian(({ app }) => {
          const note = app.vault.getFileByPath("Editor.md");
          if (note === null) return false;
          const embeds = app.metadataCache.getFileCache(note)?.embeds ?? [];
          return embeds.some((embed) => embed.link === "001.ink.png");
        }),
      );
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await clickTop("Restore");
      await markEditor();
      await browser.keys(["Control", "Shift", "Enter"]);
      await waitForNext(1);
      await draw([[0.5, 0.5]]);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      // The note is open, so the embed went in through its editor.
      expect(await noteText()).toBe(
        "Before ![[001.ink.png|symbol]]![[002.ink.png]] after.\n",
      );
    });

    it("has no Next for a symbol file", async function () {
      await saveOne();
      await editFile("001.ink.png");
      expect(await browser.$('[data-inkline-button="next"]').isExisting()).toBe(
        false,
      );
      await draw([[0.5, 0.2]]);
      await browser.keys(["Control", "Shift", "Enter"]);
      await browser.pause(500);
      expect(await editorOpen()).toBe(true);
      expect(await symbolFiles()).toEqual(["001.ink.png"]);
      expect(await strokeCount("001.ink.png")).toBe(1);
    });
  });

  describe("starting from a copy", function () {
    it("starts a new symbol from a copy of another, which Undo takes back", async function () {
      await writeSymbol("Glyphs/tower.ink.png", [800, 1600]);
      await insert();
      await browser.keys(["v"]);
      await chooseSymbol("tower");
      await waitForStatus("Started from a copy of tower");
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.strokes.length === 2,
      );
      await browser.keys(["Control", "z"]);
      await browser.waitUntil(async () => (await storedDrafts()).length === 0);
      await browser.keys(["Control", "Shift", "z"]);
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.strokes.length === 2,
      );
      await draw([[0.5, 0.2]]);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await symbolFiles()).toEqual([
        "001.ink.png",
        "Glyphs/tower.ink.png",
      ]);
      expect(await strokeCount("001.ink.png")).toBe(3);
      expect(await strokeCount("Glyphs/tower.ink.png")).toBe(2);
      // The tower's text stays with its own file.
      expect(await carriedIn("Glyphs/tower.ink.png")).toBe(1);
      expect(await carriedIn("001.ink.png")).toBe(0);
    });

    it("copies a base layer with the strokes", async function () {
      await createSquare();
      await insert();
      await browser.$('[data-inkline-button="copy"]').click();
      await chooseSymbol("square");
      await waitForStatus("Started from a copy of square");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      const record = JSON.parse(await recordOf("001.ink.png")) as {
        base?: unknown;
      };
      expect(record.base).toBeDefined();
    });

    it("keeps the drawing when the choice cannot be opened, or is put off", async function () {
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.createBinary(
          "bad.ink.png",
          new TextEncoder().encode("not a PNG").buffer,
        );
      });
      await insert();
      await draw(zigzag);
      await browser.keys(["v"]);
      await chooseSymbol("bad");
      await waitForNotice("Could not open bad.ink.png");
      await browser.keys(["v"]);
      await browser.$(".prompt-input").waitForDisplayed();
      await browser.keys(["Escape"]);
      await browser.$(".prompt").waitForExist({ reverse: true });
      expect(await editorOpen()).toBe(true);
      expect((await storedDrafts())[0]?.strokes).toHaveLength(1);
    });

    it("closes the choice with its editor", async function () {
      await writeSymbol("tower.ink.png", [800]);
      await insert();
      await draw(zigzag);
      await delayVault("createBinary", 1500);
      // Save and close, then the choice, while the save still runs.
      await browser.keys(["Control", "Enter"]);
      await browser.keys(["v"]);
      await browser.$(".prompt-input").waitForDisplayed();
      await waitClosed();
      await browser.$(".prompt").waitForExist({ reverse: true });
    });

    it("closes the choice when Inkline is disabled", async function () {
      await writeSymbol("tower.ink.png", [800]);
      await insert();
      await browser.keys(["v"]);
      await browser.$(".prompt-input").waitForDisplayed();
      await obsidianPage.disablePlugin("inkline");
      await browser.$(".prompt").waitForExist({ reverse: true });
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    });

    it("says when there is no symbol to start from", async function () {
      await insert();
      await browser.keys(["v"]);
      await waitForNotice("There are no symbols to start from yet.");
      expect(await browser.$(".prompt").isExisting()).toBe(false);
    });

    it("has no Copy from for a symbol file", async function () {
      await saveOne();
      await editFile("001.ink.png");
      expect(await browser.$('[data-inkline-button="copy"]').isExisting()).toBe(
        false,
      );
      await browser.keys(["v"]);
      await browser.pause(500);
      expect(await browser.$(".prompt").isExisting()).toBe(false);
    });
  });

  describe("tracing over a picture", function () {
    it("shows a pasted picture faintly, as tall as a capital, outside the drawing", async function () {
      await insert();
      expect(await pictureHint()).toBe(
        "Paste or drop a picture to trace over it.",
      );
      await pastePicture("red");
      await waitForStatus("Tracing over the picture");
      const expected = await placedBox(40, 40);
      const shown = await waitForPicture((box) => near(box, expected));
      await saveScreenshot("editor-tracing-pasted");
      // Faint: about a third opaque, under the guides and the ink.
      expect(Math.abs((shown?.alpha ?? 0) - 0.35 * 255)).toBeLessThanOrEqual(3);
      const { factor, xTop } = await surfaceLayout();
      const guide = await browser.execute(
        (row, from, to) => {
          const canvas = activeDocument.querySelector(
            ".inkline-editor .inkline-surface",
          );
          if (canvas?.instanceOf(HTMLCanvasElement) !== true) {
            throw new Error("no surface");
          }
          return window.inklineTest.pictures.greyIn(canvas, row, from, to);
        },
        Math.round(xTop * factor),
        Math.ceil(shown?.left ?? 0),
        Math.floor(shown?.right ?? 0),
      );
      // The x-height's dashes, about half of the row, cross it unblended.
      expect(guide).toBeGreaterThan(
        0.3 * ((shown?.right ?? 0) - (shown?.left ?? 0)),
      );
      expect(await pictureHint()).toBe(
        "Tracing over a picture, which is not saved.",
      );
      expect(await browser.$('[data-inkline-button="move"]').isEnabled()).toBe(
        true,
      );
      // Not part of the drawing: nothing to keep, and nothing to ask.
      expect(await storedDrafts()).toHaveLength(0);
      await browser.keys(["Escape"]);
      await waitClosed();
      expect(await symbolFiles()).toEqual([]);
    });

    it("takes a dropped picture, and says when a drop or paste holds none", async function () {
      await insert();
      const files = await fileCount();
      await dropFile("text/plain", "not a picture");
      await waitForStatus("only a picture can be traced over");
      await dropFile("image/png", "not a PNG");
      await waitForStatus("Inkline cannot read this picture");
      await browser.execute(() => {
        window.inklineTest.pictures.copyText("not a picture");
      });
      await browser.keys(["Control", "v"]);
      await waitForStatus("The clipboard holds no picture to trace over");
      expect(await pictureShown("blue")).toBeUndefined();
      await dropFile("image/png");
      const expected = await placedBox(20, 60);
      await waitForPicture((box) => near(box, expected), "blue");
      expect(await surface().getAttribute("class")).not.toContain(
        "is-drop-target",
      );
      // Obsidian took nothing into the vault.
      expect(await fileCount()).toBe(files);
    });

    it("takes a picture dragged from Obsidian's file explorer", async function () {
      await browser.executeObsidian(async ({ app }) => {
        const blob = await window.inklineTest.pictures.picture(20, 60, "blue");
        await app.vault.createFolder("Pictures");
        await app.vault.createBinary(
          "Pictures/glyph one.png",
          await blob.arrayBuffer(),
        );
        await app.vault.create("Pictures/notes.md", "Not a picture.");
      });
      await insert();
      // Another vault's picture, and this one's note, are not taken.
      await dropVaultFile("Pictures/glyph one.png", "Another vault");
      await waitForStatus("only a picture can be traced over");
      await dropVaultFile("Pictures/notes.md");
      await browser.pause(300);
      expect(await pictureShown("blue")).toBeUndefined();
      await dropVaultFile("Pictures/glyph one.png");
      await waitForStatus("Tracing over the picture");
      const expected = await placedBox(20, 60);
      await waitForPicture((box) => near(box, expected), "blue");
    });

    it("scales a picture over 4096 pixels a side down, keeping its proportions", async function () {
      const sizes = await browser.execute(async () => {
        const { pictures, reference } = window.inklineTest;
        const size = async (width: number, height: number) => {
          const image = await reference.decodePicture(
            await pictures.picture(width, height, "red"),
          );
          const found = [image.width, image.height];
          image.close();
          return found;
        };
        return { large: await size(5000, 100), fits: await size(300, 200) };
      });
      expect(sizes.large).toEqual([4096, 82]);
      expect(sizes.fits).toEqual([300, 200]);
    });

    it("takes a paste only in the editor on top", async function () {
      await insert();
      // A second editor, over the first, as the command palette can open.
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await browser.waitUntil(
        async () =>
          (await browser.$$(".inkline-editor").getElements()).length === 2,
      );
      await browser.pause(300);
      await pastePicture("red");
      await waitForPicture((box) => box !== undefined, "red", 1);
      await browser.pause(300);
      expect(await pictureShown("red", 0)).toBeUndefined();
    });

    it("keeps following the pointer when a save moves the view mid-drag", async function () {
      await insert();
      // Far to the left, so that the save crops a lot off.
      await draw([
        [0.1, 0.4],
        [0.15, 0.6],
      ]);
      await pastePicture("red");
      const placed = await waitForPicture((box) => box !== undefined);
      if (placed === undefined) throw new Error("no picture");
      const { ratio } = await surfaceLayout();
      await browser.keys(["m"]);
      // A mouse's events, dispatched on the surface: WebDriver lets go of a
      // button between its calls, and a drag must outlast the save.
      const mouse = (type: string, dx: number, dy: number, buttons: number) =>
        browser.execute(
          (event, x, y, held) => {
            const canvas = activeDocument.querySelector(
              ".inkline-editor .inkline-surface",
            );
            if (canvas === null) throw new Error("no surface");
            const rect = canvas.getBoundingClientRect();
            canvas.dispatchEvent(
              new PointerEvent(event, {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                button: event === "pointermove" ? -1 : 0,
                buttons: held,
                clientX: rect.left + rect.width / 2 + x,
                clientY: rect.top + rect.height / 2 + y,
              }),
            );
          },
          type,
          dx,
          dy,
          buttons,
        );
      await mouse("pointerdown", 0, 0, 1);
      await mouse("pointermove", 10, 5, 1);
      await waitForPicture((box) =>
        near(box, moved(placed, 10 * ratio, 5 * ratio)),
      );
      // The save crops the drawing, and moves the view with it.
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await mouse("pointermove", 30, 15, 1);
      await mouse("pointerup", 30, 15, 0);
      await waitForPicture((box) =>
        near(box, moved(placed, 30 * ratio, 15 * ratio)),
      );
    });

    it("moves the picture in Move mode, and scales it about the pointer", async function () {
      await insert();
      await pastePicture("red");
      const placed = await waitForPicture((box) => box !== undefined);
      if (placed === undefined) throw new Error("no picture");
      const { factor, ratio, border } = await surfaceLayout();
      await browser.keys(["m"]);
      expect(await pressed("move")).toBe("true");
      expect(await pressed("pen")).toBe("false");
      expect(await surface().getAttribute("class")).toContain("is-moving");

      // Dragging moves it with the pointer.
      await dragBy(30, 15);
      const dragged = await waitForPicture((box) =>
        near(box, moved(placed, 30 * ratio, 15 * ratio)),
      );
      if (dragged === undefined) throw new Error("no picture");

      // The wheel scales it about the point under the pointer.
      const { width, height } = await settledSurface();
      const x = (width / 2 - 20 - border) * ratio;
      const y = (height / 2 - 10 - border) * ratio;
      const notch = Math.exp(100 / 500);
      await turnWheel(-20, -10, -100);
      const wheeled = await waitForPicture((box) =>
        near(box, scaled(dragged, notch, x, y), 3),
      );
      if (wheeled === undefined) throw new Error("no picture");

      // The arrow keys move it by a pixel, or by a grid spacing with Shift.
      await browser.keys(["ArrowRight"]);
      await browser.keys(["ArrowRight"]);
      // Up, so that the picture stays whole on the surface as it grows.
      await browser.keys(["Shift", "ArrowUp"]);
      const nudged = await waitForPicture((box) =>
        near(box, moved(wheeled, 2 * factor, -16 * factor)),
      );
      if (nudged === undefined) throw new Error("no picture");

      // + and = scale it up about its middle, and − down.
      const middleX = (nudged.left + nudged.right) / 2;
      const middleY = (nudged.top + nudged.bottom) / 2;
      for (const grow of ["+", "="]) {
        await browser.keys([grow]);
        await waitForPicture((box) =>
          near(box, scaled(nudged, notch, middleX, middleY), 3),
        );
        await browser.keys(["-"]);
        await waitForPicture((box) => near(box, nudged, 3));
      }
      await browser.keys(["-"]);
      const shrunk = await waitForPicture((box) =>
        near(box, scaled(nudged, 1 / notch, middleX, middleY), 3),
      );
      if (shrunk === undefined) throw new Error("no picture");

      // The pen draws again, and leaves the picture where it is.
      await browser.keys(["p"]);
      expect(await pressed("move")).toBe("false");
      expect(await pressed("pen")).toBe("true");
      await draw([
        [0.05, 0.5],
        [0.15, 0.5],
      ]);
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.strokes.length === 1,
      );
      expect(near(await pictureShown(), shrunk, 1)).toBe(true);
    });

    it("never saves the picture", async function () {
      await insert();
      await pastePicture("red");
      await waitForPicture((box) => box !== undefined);
      await draw(zigzag);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      const record = JSON.parse(await recordOf("001.ink.png")) as {
        strokes?: unknown[];
        base?: unknown;
      };
      expect(record.strokes).toHaveLength(1);
      expect(record.base).toBeUndefined();
      // Every inked pixel is the ink's own grey.
      const coloured = await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("001.ink.png");
        if (file === null) throw new Error("no 001.ink.png");
        const { canvas } = window.inklineTest;
        const bitmap = await canvas.decodePng(
          new Uint8Array(await app.vault.readBinary(file)),
        );
        const { data } = canvas.readPixels(bitmap);
        let count = 0;
        for (let at = 0; at < data.length; at += 4) {
          const [r = 0, g = 0, b = 0, a = 0] = data.subarray(at, at + 4);
          if (a > 0 && (Math.abs(r - g) > 2 || Math.abs(g - b) > 2)) count++;
        }
        return count;
      });
      expect(coloured).toBe(0);
    });

    it("stays where it is on the surface through a save, and into the next symbol", async function () {
      await insert();
      await pastePicture("red");
      const placed = await waitForPicture((box) => box !== undefined);
      if (placed === undefined) throw new Error("no picture");
      // Far to the left, so that the save crops a lot off.
      await draw([
        [0.1, 0.4],
        [0.15, 0.6],
      ]);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await browser.pause(100);
      expect(near(await pictureShown(), placed, 1)).toBe(true);
      await markEditor();
      await browser.keys(["Control", "Shift", "Enter"]);
      await waitForNext(1);
      await waitForPicture((box) => near(box, placed, 1));
      expect(await pictureHint()).toBe(
        "Tracing over a picture, which is not saved.",
      );
      // Nothing to save in the next one yet.
      await browser.keys(["Escape"]);
      await waitClosed();
    });

    it("leaves a paste into a text field to the field", async function () {
      await writeSymbol("tower.ink.png", [800]);
      await insert();
      await browser.keys(["v"]);
      await browser.$(".prompt-input").waitForDisplayed();
      await pastePicture("red");
      await browser.pause(500);
      expect(await pictureShown()).toBeUndefined();
      expect(await browser.$(".inkline-status").getText()).toBe("");
      await browser.keys(["Escape"]);
      await browser.$(".prompt").waitForExist({ reverse: true });
      // With the focus back on the editor, the same paste is its.
      await pastePicture("red");
      await waitForPicture((box) => box !== undefined);
    });

    it("replaces the picture with the next one pasted, and removes it", async function () {
      await insert();
      await pastePicture("red");
      await waitForPicture((box) => box !== undefined);
      await pastePicture("blue");
      await waitForPicture((box) => box !== undefined, "blue");
      expect(await pictureShown("red")).toBeUndefined();
      await browser.$('[data-inkline-button="remove"]').click();
      await waitForStatus("Picture removed");
      // The focus goes back to the surface, from the disabled button.
      expect(
        await browser.execute(
          () =>
            activeDocument.activeElement?.classList.contains(
              "inkline-surface",
            ) === true,
        ),
      ).toBe(true);
      await waitForPicture((box) => box === undefined, "blue");
      expect(await browser.$('[data-inkline-button="move"]').isEnabled()).toBe(
        false,
      );
      expect(await pictureHint()).toBe(
        "Paste or drop a picture to trace over it.",
      );
      await browser.keys(["m"]);
      await waitForStatus("Paste or drop a picture first, to move it");
      expect(await pressed("move")).toBe("false");
    });
  });
});
