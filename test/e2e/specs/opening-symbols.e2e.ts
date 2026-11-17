import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  chooseSymbol,
  draftCount,
  editFile,
  inklineOn,
  insert,
  nameSymbol,
  strokeCount,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  draw,
  editorOpen,
  recordOf,
  storedDrafts,
  undoStubs,
  waitForNotice,
  startOver,
  symbolFiles,
  clickTop,
  topButton,
  waitForStatus,
} from "../support/editor.ts";
import { bytesOfFile, createSquare } from "../support/vault-files.ts";

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

  /** Writes a symbol whose record chunk holds `chunk`, over plain pixels. */
  async function writeWithRecord(
    name: string,
    chunk: readonly number[],
  ): Promise<void> {
    await browser.executeObsidian(
      async ({ app }, fileName, data) => {
        const { canvas, inkFile, png } = window.inklineTest;
        const pixels = new Uint8ClampedArray(48 * 192 * 4);
        for (let at = 3; at < pixels.length; at += 4) pixels[at] = 200;
        const image = await canvas.encodePixels({
          width: 48,
          height: 192,
          data: pixels,
        });
        const [header, ...rest] = png.readChunks(image);
        if (header === undefined) throw new Error("no header");
        const file = png.writeChunks([
          header,
          { type: inkFile.recordChunkType, data: Uint8Array.from(data) },
          ...rest,
        ]);
        await app.vault.createBinary(fileName, file.slice().buffer);
      },
      name,
      [...chunk],
    );
  }

  /** Asks to edit a symbol that is not expected to open. */
  async function tryToEdit(path: string): Promise<void> {
    await browser.executeObsidian(async ({ app, plugins }, filePath) => {
      const file = app.vault.getFileByPath(filePath);
      if (file === null) throw new Error(`no ${filePath}`);
      await plugins.inkline.editSymbol(file);
    }, path);
  }

  it("says why a file with no strokes opens as a picture, and only then", async function () {
    await createSquare();
    await editFile("square.ink.png");
    await waitForStatus("as this file holds no strokes");
    // Saved, it holds a record, even one with no stroke left in it.
    await draw([
      [0.45, 0.8],
      [0.55, 0.8],
    ]);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await browser.keys(["Control", "z"]);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const saved = JSON.parse(await recordOf("square.ink.png")) as {
      strokes: unknown[];
      base?: unknown;
    };
    expect(saved.strokes).toHaveLength(0);
    expect(saved.base).toBeDefined();
    await editFile("square.ink.png");
    expect(await browser.$(".inkline-status").getText()).toBe("");
  });

  it("does not open a symbol from a later version, and says so", async function () {
    await writeWithRecord("later.ink.png", [0, 0, 0, 2]);
    await tryToEdit("later.ink.png");
    await browser.$(".notice*=saved by a newer version").waitForExist();
    expect(await editorOpen()).toBe(false);
  });

  it("does not open a symbol whose strokes cannot be read, and says so", async function () {
    await writeWithRecord("harmed.ink.png", [0, 0, 0, 1, 0xff, 0xff]);
    await tryToEdit("harmed.ink.png");
    await browser.$(".notice*=The strokes in harmed").waitForExist();
    expect(await editorOpen()).toBe(false);
  });

  it("starts a copy from what a symbol shows when its strokes cannot be read", async function () {
    await writeWithRecord("harmed.ink.png", [0, 0, 0, 1, 0xff, 0xff]);
    const before = await bytesOfFile("harmed.ink.png");
    await insert();
    await browser.keys(["v"]);
    await chooseSymbol("harmed");
    await waitForStatus("Started from a copy of harmed");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const copy = JSON.parse(await recordOf("001.ink.png")) as {
      base?: unknown;
      strokes: unknown[];
    };
    expect(copy.base).toBeDefined();
    expect(copy.strokes).toEqual([]);
    expect(await bytesOfFile("harmed.ink.png")).toEqual(before);
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

  /** The text of the topmost modal, as a question's. */
  async function questionText(): Promise<string> {
    return browser.execute(
      () =>
        [...document.querySelectorAll(".modal-container")].at(-1)
          ?.textContent ?? "",
    );
  }

  it("says that a symbol which does not open has a draft, which a new symbol at its path offers back", async function () {
    // A picture to draw over, in a folder of its own, so that the draft
    // relies on the file for its base layer.
    await browser.executeObsidian(async ({ app }) => {
      const { canvas } = window.inklineTest;
      const data = new Uint8ClampedArray(24 * 24 * 4);
      for (let index = 0; index < 24 * 24; index++) data[index * 4 + 3] = 255;
      const bytes = await canvas.encodePixels({ width: 24, height: 24, data });
      await app.vault.createFolder("Signs");
      await app.vault.createBinary(
        "Signs/square.ink.png",
        bytes.slice().buffer,
      );
    });
    await editFile("Signs/square.ink.png");
    await draw(zigzag);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    expect((await storedDrafts())[0]?.base).toBe("file");
    // A crash as a save wrote the file: the draft kept, and the file cut
    // short.
    await obsidianPage.disablePlugin("inkline");
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Signs/square.ink.png");
      if (file === null) throw new Error("no Signs/square.ink.png");
      const bytes = await app.vault.readBinary(file);
      await app.vault.modifyBinary(file, bytes.slice(0, bytes.byteLength / 2));
    });
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await tryToEdit("Signs/square.ink.png");
    const kept =
      " Unsaved changes to it are kept as a draft. To get them back, see Saving and recovery in Inkline's guide.";
    await waitForNotice(kept);
    // The reason comes first, as from any file that is not a whole PNG.
    const notice = await browser.execute(
      (text) =>
        [...document.querySelectorAll(".notice")]
          .map((each) => each.textContent)
          .find((each) => each.includes(text)) ?? "",
      kept.trim(),
    );
    expect(notice).toMatch(
      /^Could not open square\.ink\.png: \S.*\S\. Unsaved/,
    );
    expect(notice.endsWith(kept)).toBe(true);
    expect(await editorOpen()).toBe(false);
    expect(await draftCount()).toBe(1);
    // The way back that Saving and recovery gives: the file deleted, a new
    // symbol of two dots given its name and saved, and moved into its folder,
    // which the draft does not follow, as it is for another path.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Signs/square.ink.png");
      if (file === null) throw new Error("no Signs/square.ink.png");
      await app.fileManager.trashFile(file);
    });
    await insert();
    await draw([[0.4, 0.5]]);
    await draw([[0.6, 0.5]]);
    await nameSymbol("square");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["square.ink.png"]);
    expect(await strokeCount("square.ink.png")).toBe(2);
    expect(await draftCount()).toBe(1);
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("square.ink.png");
      if (file === null) throw new Error("no square.ink.png");
      await app.vault.rename(file, "Signs/square.ink.png");
    });
    await editFile("Signs/square.ink.png");
    await browser.waitUntil(
      async () => (await topButton("Restore")) !== undefined,
    );
    expect(await questionText()).toContain(
      "The symbol was saved again since then, so its strokes may not line up.",
    );
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    // The draft's one stroke in place of the dots, without the file's own
    // base layer.
    const record = JSON.parse(await recordOf("Signs/square.ink.png")) as {
      strokes: unknown[];
      base?: unknown;
    };
    expect(record.strokes).toHaveLength(1);
    expect(record.base).toBeUndefined();
    expect(await draftCount()).toBe(0);
  });
});
