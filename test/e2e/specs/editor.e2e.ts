import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  editorOpen,
  fillStorage,
  freeStorage,
  noteText,
  openAtMarker,
  recordOf,
  storedDrafts,
  waitForEditor,
  startOver,
  surface,
  symbolFiles,
  clickTop,
  topButton,
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
      const status = browser.$(".inkline-status");
      await status.waitUntil(async () =>
        (await status.getText()).includes("the disk is full"),
      );
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
      size: "Brush size S",
      undo: true,
      focused: true,
    });
    await browser.keys(["e"]);
    const eraser = browser.$('[data-inkline-button="eraser"]');
    expect(await eraser.getAttribute("aria-pressed")).toBe("true");
    await browser.keys(["Escape"]);
    await waitClosed();
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
      const status = browser.$(".inkline-status");
      await status.waitUntil(async () =>
        (await status.getText()).includes("strokes drawn while saving"),
      );
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
    await browser.executeObsidian(async ({ app }) => {
      const welcome = app.vault.getFileByPath("Welcome.md");
      if (welcome === null) throw new Error("no Welcome.md");
      await app.workspace.getLeaf(false).openFile(welcome);
    });
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
    await browser.waitUntil(
      async () => (await read()).editor.includes("001.ink.png"),
      {
        timeout: 10_000,
      },
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
    await browser.executeObsidian(async ({ app }) => {
      const welcome = app.vault.getFileByPath("Welcome.md");
      if (welcome === null) throw new Error("no Welcome.md");
      await app.workspace.getLeaf(false).openFile(welcome);
    });
    await browser.keys(["Control", "Enter"]);
    const status = browser.$(".inkline-status");
    await status.waitUntil(async () =>
      (await status.getText()).includes("the note is locked"),
    );
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
    await browser.$(".inkline-status=Saved").waitForExist();
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
    await browser.$(".inkline-status=Saved").waitForExist();
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
    await browser.$(".inkline-status=Saved").waitForExist();
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
      await browser.$(".inkline-status=Draft not kept").waitForExist();
      expect((await storedDrafts()).map((draft) => draft.id)).toEqual(before);
    } finally {
      await freeStorage();
    }
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
      // Show another note in the tab, so that the insertion has to edit the
      // note's file, which fails.
      await browser.executeObsidian(async ({ app }) => {
        const welcome = app.vault.getFileByPath("Welcome.md");
        if (welcome === null) throw new Error("no Welcome.md");
        await app.workspace.getLeaf(false).openFile(welcome);
      });
      await browser.keys(["Control", "s"]);
      const status = browser.$(".inkline-status");
      await status.waitUntil(async () =>
        (await status.getText()).includes("the note is locked"),
      );
      await obsidianPage.disablePlugin("inkline");
    } finally {
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
});
