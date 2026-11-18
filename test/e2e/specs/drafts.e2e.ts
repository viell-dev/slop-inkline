import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  draftCount,
  editFile,
  inklineOn,
  insert,
  nameField,
  nameSymbol,
  saveOne,
  strokeCount,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  delayVault,
  draw,
  editorOpen,
  followSave,
  fillStorage,
  freeStorage,
  hold,
  holdAfter,
  holdDecoding,
  letDecodingGo,
  letGo,
  noteText,
  recordOf,
  restoreDecoding,
  storedDrafts,
  undoStubs,
  waitForDecoded,
  waitForEditor,
  waitForHeld,
  waitForHeldDecoding,
  waitForNotice,
  waitForSaveEnd,
  startOver,
  symbolFiles,
  clickTop,
  topButton,
  waitForStatus,
} from "../support/editor.ts";
import { createSquare } from "../support/vault-files.ts";

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
      strokes: [{ tool: "pen", size: 256, points: [1600, 1600] }],
      base: {
        kind: "kept",
        layer: { x: 0, y: 0, width: 3072, height: 3072, png },
      },
      savedAt: Date.now(),
    });
    if (!kept) throw new Error("the draft was not kept");
  });
}

/**
 * Writes a picture of `width × height` pixels whose alpha is noise from a
 * fixed seed, which PNG cannot compress, and returns its size in bytes.
 */
async function writeNoiseAndMeasureBytes(
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

describe("The editor", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
  });

  // A test that fails midway can leave a file operation held or replaced, or
  // Inkline off, which every test after it would then fail on.
  afterEach(async function () {
    await undoStubs();
    if (!(await inklineOn())) {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
  });

  it("keeps unsaved strokes as a draft when the plugin is disabled, and offers them back", async function () {
    await insert();
    await draw(zigzag);
    // The name typed comes back with the strokes.
    await nameSymbol("gate");
    await obsidianPage.disablePlugin("inkline");
    expect(await editorOpen()).toBe(false);
    expect(await symbolFiles()).toEqual([]);
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    // The same note, where the cursor still is.
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Restore");
    expect((await nameField()).value).toBe("gate");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const record = JSON.parse(await recordOf("gate.ink.png")) as {
      strokes: unknown[];
    };
    expect(record.strokes).toHaveLength(1);
  });

  it("offers the draft of a symbol renamed while Inkline was off once it has its old name again", async function () {
    await saveOne();
    await editFile("001.ink.png");
    await draw([
      [0.6, 0.3],
      [0.6, 0.7],
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    await obsidianPage.disablePlugin("inkline");
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no 001.ink.png");
      await app.vault.rename(file, "moved.ink.png");
    });
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    // Under its new name, nothing is offered.
    await editFile("moved.ink.png");
    await browser.pause(500);
    expect(await topButton("Restore")).toBeUndefined();
    await browser.keys(["Escape"]);
    await waitClosed();
    expect(await draftCount()).toBe(1);
    // Renamed back, with Inkline on, it is.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("moved.ink.png");
      if (file === null) throw new Error("no moved.ink.png");
      await app.vault.rename(file, "001.ink.png");
    });
    await editFile("001.ink.png");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await strokeCount("001.ink.png")).toBe(2);
    expect(await draftCount()).toBe(0);
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
    // The editor's read of the file waits until Inkline is off.
    await hold("readSymbol");
    await browser.executeObsidian(({ app, plugins }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no file");
      const opened = { done: false };
      Reflect.set(window, "inklineOpened", opened);
      void plugins.inkline.editSymbol(file).finally(() => {
        opened.done = true;
      });
    });
    await waitForHeld();
    await obsidianPage.disablePlugin("inkline");
    await letGo();
    // Whatever it decided, opening has ended.
    await browser.waitUntil(async () =>
      browser.execute(() => {
        const opened: unknown = Reflect.get(window, "inklineOpened");
        return (
          typeof opened === "object" &&
          opened !== null &&
          Reflect.get(opened, "done") === true
        );
      }),
    );
    expect(await editorOpen()).toBe(false);
    await obsidianPage.enablePlugin("inkline");
  });

  it("does not let an old save's completion drop a newer editor's draft", async function () {
    await saveOne();
    await editFile("001.ink.png");
    await draw([
      [0.5, 0.2],
      [0.5, 0.8],
    ]);
    // The save writes the file, and ends only once a newer editor has
    // taken its draft over and drawn.
    await holdAfter("write");
    await browser.keys(["Control", "s"]);
    await waitForHeld();
    await followSave();
    await draw([
      [0.3, 0.2],
      [0.7, 0.2],
    ]);
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await editFile("001.ink.png");
    await clickTop("Restore");
    await draw([
      [0.3, 0.8],
      [0.7, 0.8],
    ]);
    await letGo();
    await waitForSaveEnd();
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
      base?: { height: number };
    };
    // The 24-pixel square, scaled to the line box's 192 pixels, in units.
    expect(restored.base?.height).toBe(192 * 16);
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

  it("says when a drawing has gone past what a symbol can hold", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const { canvas } = window.inklineTest;
      // As many points as a symbol can hold, all in one dot.
      const points = new Array<number>(500_000).fill(800);
      const saved = await canvas.saveInk(
        { strokes: [{ tool: "pen", size: 96, points }] },
        undefined,
      );
      await app.vault.createBinary("full.ink.png", saved.bytes.slice().buffer);
    });
    await editFile("full.ink.png");
    await draw(zigzag);
    await browser.$(".notice*=past what a symbol can hold").waitForExist();
    expect(await browser.$(".inkline-status").getText()).toBe("Draft not kept");
    expect(await storedDrafts()).toEqual([]);
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

  it("keeps an adopted file known when a restored draft's name collides", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const { canvas, drafts } = window.inklineTest;
      const note = app.vault.getFileByPath("Editor.md");
      if (note === null) throw new Error("no Editor.md");
      const drawing = {
        strokes: [{ tool: "pen", size: 256, points: [1600, 1600] }],
      } as const;
      const { bytes } = await canvas.saveInk(drawing, undefined);
      await app.vault.createBinary("001.ink.png", bytes.slice().buffer);
      await app.vault.createBinary("taken.ink.png", bytes.slice().buffer);
      await app.vault.modify(note, "A symbol ![[001.ink.png]]HERE here.\n");
      // A crash after inserting, before the draft recorded the insertion.
      new drafts.DraftStore(app).put({
        id: "claimed-collision",
        target: {
          kind: "new",
          note: note.path,
          file: {
            path: "001.ink.png",
            fingerprint: await drafts.fingerprintOf(bytes),
          },
        },
        strokes: drawing.strokes,
        base: { kind: "none" },
        name: "taken",
        savedAt: Date.now(),
      });
    });
    await insert();
    await clickTop("Restore");
    await browser.keys(["Control", "s"]);
    await waitForNotice("already has a symbol named taken");
    await waitForStatus("Not saved");
    // Checking after a refused name must not mistake the adopted file for
    // an external edit, or forget that its embed may already be in the note.
    await nameSymbol("001");
    expect(await topButton("Keep mine")).toBeUndefined();
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await noteText()).toBe("A symbol ![[001.ink.png]] here.\n");
    expect(await strokeCount("001.ink.png")).toBe(1);
    expect(await symbolFiles()).toEqual(["001.ink.png", "taken.ink.png"]);
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
        strokes: [{ tool: "pen", size: 256, points: [1600, 1600] }],
        base: {
          kind: "kept",
          layer: { x: 0, y: 0, width: 3072, height: 3072, png: broken },
        },
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
    await writeNoiseAndMeasureBytes("large.ink.png", 4096, 2048);
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
    await writeNoiseAndMeasureBytes("noise.png", 1024, 1024);
    const timings = await browser.executeObsidian(async ({ app }) => {
      const { drafts } = window.inklineTest;
      const file = app.vault.getFileByPath("noise.png");
      if (file === null) throw new Error("no noise.png");
      const png = new Uint8Array(await app.vault.readBinary(file));
      const store = new drafts.DraftStore(app);
      const stroke = {
        tool: "pen",
        size: 256,
        points: [1600, 1600],
      } as const;
      const times: number[] = [];
      for (let count = 1; count <= 6; count++) {
        const start = performance.now();
        const kept = store.put({
          id: "timed",
          target: { kind: "new", note: "Timing.md" },
          strokes: Array.from({ length: count }, () => stroke),
          base: {
            kind: "kept",
            layer: { x: 0, y: 0, width: 3072, height: 3072, png },
          },
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
    await insert();
    await draw(zigzag);
    // The file is made, and the save has not ended.
    await holdAfter("create");
    await browser.keys(["Control", "s"]);
    await waitForHeld();
    await browser.waitUntil(async () => (await symbolFiles()).length === 1);
    const [draft] = await storedDrafts();
    expect(draft?.target).toMatchObject({
      kind: "new",
      note: "Editor.md",
      file: { path: "001.ink.png" },
    });
    await letGo();
    await waitForStatus("Saved");
  });

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

  it("does not offer a note's draft once the new symbol was saved meanwhile", async function () {
    await plantKeptDraft();
    // The draft's base layer is decoded to offer it once the symbol is saved.
    await holdDecoding();
    try {
      await insert();
      await waitForHeldDecoding();
      await draw(zigzag);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await letDecodingGo();
      await waitForDecoded();
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
    // The draft's base layer is decoded to offer it once the question is up.
    await holdDecoding();
    try {
      await insert();
      await waitForHeldDecoding();
      await draw(zigzag);
      await browser.keys(["Escape"]);
      await browser.waitUntil(
        async () => (await topButton("Keep drawing")) !== undefined,
      );
      await letDecodingGo();
      await waitForDecoded();
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

  it("keeps a newer version's draft and its base layer, and says so, through its symbol's editor and a rename", async function () {
    await saveOne();
    // As a later version might keep a draft, in a layout of its own that
    // names its base layer in a field this version does not know.
    const planted = await browser.executeObsidian(({ app }) => {
      const { drafts } = window.inklineTest;
      const key = crypto.randomUUID();
      const text = JSON.stringify({
        version: drafts.draftVersion + 1,
        target: { kind: "file", path: "001.ink.png" },
        savedAt: Date.now(),
        pictures: [{ id: key, x: 0, y: 0 }],
        pages: [{ strokes: [[1600, 1600]] }],
      });
      const ids: unknown = app.loadLocalStorage("inkline-drafts");
      app.saveLocalStorage("inkline-draft:later", text);
      app.saveLocalStorage("inkline-drafts", [
        ...(Array.isArray(ids) ? ids.map(String) : []),
        "later",
      ]);
      app.saveLocalStorage(`inkline-draft-base:${key}`, "iVBORw0KGgo=");
      app.saveLocalStorage("inkline-draft-bases", [key]);
      return { key, text };
    });
    const storage = async (): Promise<unknown[]> =>
      browser.executeObsidian(
        ({ app }, key): unknown[] => [
          app.loadLocalStorage("inkline-draft:later"),
          app.loadLocalStorage(`inkline-draft-base:${key}`),
          app.loadLocalStorage("inkline-draft-bases"),
        ],
        planted.key,
      );
    const kept = [planted.text, "iVBORw0KGgo=", [planted.key]];
    await editFile("001.ink.png");
    await waitForNotice("unsaved changes from a newer version of Inkline");
    await browser.pause(500);
    expect(await topButton("Restore")).toBeUndefined();
    // This editor's own draft goes beside it, and goes as the symbol saves.
    await draw([
      [0.6, 0.3],
      [0.6, 0.7],
    ]);
    await browser.waitUntil(async () => (await draftCount()) === 2);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await strokeCount("001.ink.png")).toBe(2);
    expect(await draftCount()).toBe(1);
    expect(await storage()).toEqual(kept);
    // A rename moves this version's drafts, and leaves that one where it was.
    await browser.executeObsidian(async ({ app }) => {
      const { drafts } = window.inklineTest;
      const put = new drafts.DraftStore(app).put({
        id: "planted",
        target: { kind: "file", path: "001.ink.png" },
        strokes: [{ tool: "pen", size: 256, points: [1600, 1600] }],
        base: { kind: "file" },
        savedAt: Date.now(),
      });
      if (!put) throw new Error("the draft was not kept");
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no 001.ink.png");
      await app.vault.rename(file, "moved.ink.png");
    });
    expect(
      (await storedDrafts()).map(({ id, target }) => [id, target]),
    ).toEqual([["planted", { kind: "file", path: "moved.ink.png" }]]);
    expect(await storage()).toEqual(kept);
  });
});
