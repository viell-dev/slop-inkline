import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  draftCount,
  editFile,
  inklineOn,
  nameField,
  strokeCount,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  clickTop,
  createSymbol,
  draw,
  editorOpen,
  openAtMarker,
  recordOf,
  startOver,
  storedDrafts,
  symbolFiles,
  topButton,
  undoStubs,
  waitForEditor,
  waitForNotice,
  waitForStatus,
} from "../support/editor.ts";
import { failInsertion, unlockNotes } from "../support/failed-insertion.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import { bytesOfFile, noteOnDisk } from "../support/vault-files.ts";

/**
 * Drafts kept for a symbol whose file is gone or does not open, and for a new
 * symbol whose note is gone.
 */
describe("Draft recovery", function () {
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

  /** Asks to edit a symbol that is not expected to open. */
  async function tryToEdit(path: string): Promise<void> {
    await browser.executeObsidian(async ({ app, plugins }, filePath) => {
      const file = app.vault.getFileByPath(filePath);
      if (file === null) throw new Error(`no ${filePath}`);
      await plugins.inkline.editSymbol(file);
    }, path);
  }

  /** The text of the topmost modal, as a question's. */
  async function questionText(): Promise<string> {
    return browser.execute(
      () =>
        [...document.querySelectorAll(".modal-container")].at(-1)
          ?.textContent ?? "",
    );
  }

  /**
   * Leaves a draft of `path` with one more stroke than the file has, as a
   * crash would: drawn in the editor, which Inkline's unloading closes, and
   * kept, with Inkline off afterwards, so that the file can change unseen.
   */
  async function draftThenStop(path: string): Promise<void> {
    await editFile(path);
    await draw(zigzag);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1, {
      timeoutMsg: "the drawing was never kept as a draft",
    });
    await obsidianPage.disablePlugin("inkline");
  }

  async function restart(): Promise<void> {
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
  }

  /** The rows the list of drafts shows: their text and their picture. */
  async function listedRows(): Promise<{ text: string; picture: number }[]> {
    await browser.$(".prompt .inkline-suggestion").waitForExist();
    return browser.execute(() =>
      [...document.querySelectorAll(".prompt .inkline-suggestion")].map(
        (row) => {
          const picture = row.querySelector("img");
          return {
            text: row.textContent,
            picture:
              picture?.src.startsWith("data:image/png") === true
                ? picture.naturalWidth
                : 0,
          };
        },
      ),
    );
  }

  it("offers a draft whose file does not open as a new symbol, which leaves the file as it is", async function () {
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
    await draftThenStop("Signs/square.ink.png");
    expect((await storedDrafts())[0]?.base).toBe("file");
    // The file cut short, as by a crash as a save wrote it.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Signs/square.ink.png");
      if (file === null) throw new Error("no Signs/square.ink.png");
      const bytes = await app.vault.readBinary(file);
      await app.vault.modifyBinary(file, bytes.slice(0, bytes.byteLength / 2));
    });
    const cut = await bytesOfFile("Signs/square.ink.png");
    await restart();
    await tryToEdit("Signs/square.ink.png");
    await browser.waitUntil(
      async () => (await topButton("Open as new symbol")) !== undefined,
      { timeoutMsg: "no question about the draft" },
    );
    await saveScreenshot("draft-recovery-question-unopened");
    const question = await questionText();
    expect(question).toContain("Open the unsaved drawing as a new symbol?");
    expect(question).toMatch(
      /square\.ink\.png does not open: \S.*\S\. Inkline/,
    );
    expect(question).toContain(
      "They can open in a new symbol, saved in Signs, and square.ink.png stays as it is.",
    );
    expect(question).toContain(
      "Its base layer was in that file, so only its strokes would come back.",
    );
    await clickTop("Open as new symbol");
    await waitForEditor();
    await waitForStatus("Opened the unsaved drawing as a new symbol");
    // Its folder has a symbol of the file's name, so the field starts empty,
    // for the next number there.
    expect((await nameField()).value).toBe("");
    // The editor's own draft takes the old one's place, and is not listed.
    await browser.waitUntil(async () => (await draftCount()) === 1);
    expect((await storedDrafts())[0]?.target).toEqual({
      kind: "file",
      path: "Signs/square.ink.png",
    });
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual([
      "Signs/001.ink.png",
      "Signs/square.ink.png",
    ]);
    const record = JSON.parse(await recordOf("Signs/001.ink.png")) as {
      strokes: unknown[];
      base?: unknown;
    };
    expect(record.strokes).toHaveLength(1);
    expect(record.base).toBeUndefined();
    expect(await bytesOfFile("Signs/square.ink.png")).toEqual(cut);
    expect(await draftCount()).toBe(0);
    // Inserted nowhere.
    expect(await noteOnDisk("Editor.md")).not.toContain("001.ink.png");
  });

  it("lists a draft whose file was deleted, and saves it at the file's path", async function () {
    await createSymbol("Runes/tower.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Uses.md", "The tower: ![[tower.ink.png]]\n");
    });
    await draftThenStop("Runes/tower.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Runes/tower.ink.png");
      if (file === null) throw new Error("no Runes/tower.ink.png");
      await app.fileManager.trashFile(file);
    });
    await restart();
    await browser.executeObsidianCommand("inkline:recover-drafts");
    const rows = await listedRows();
    await saveScreenshot("draft-recovery-list");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toMatch(/^towerRunesKept .+\. Deleted or moved$/);
    // A picture of the two strokes, as the first save would draw them.
    expect(rows[0]?.picture).toBeGreaterThan(0);
    await browser.keys(["Enter"]);
    await browser.waitUntil(
      async () => (await topButton("Open as new symbol")) !== undefined,
      { timeoutMsg: "no question about the draft" },
    );
    await saveScreenshot("draft-recovery-question-gone");
    const question = await questionText();
    expect(question).toContain(
      "tower.ink.png is no longer in the vault, but Inkline kept unsaved changes to it from",
    );
    expect(question).toContain(
      "They can open in a new symbol, saved in Runes.",
    );
    await clickTop("Open as new symbol");
    await waitForEditor();
    expect((await nameField()).value).toBe("tower");
    await saveScreenshot("draft-recovery-editor");
    // While its editor is open, the draft is that editor's, and not listed.
    await browser.executeObsidianCommand("inkline:recover-drafts");
    await waitForNotice("No draft is waiting for a symbol");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["Runes/tower.ink.png"]);
    expect(await strokeCount("Runes/tower.ink.png")).toBe(2);
    expect(await draftCount()).toBe(0);
    // The note that embeds it shows it again, unchanged.
    await browser.waitUntil(
      () =>
        browser.executeObsidian(
          ({ app }) =>
            (app.metadataCache.resolvedLinks["Uses.md"]?.[
              "Runes/tower.ink.png"
            ] ?? 0) > 0,
        ),
      { timeoutMsg: "Uses.md never linked to the new tower" },
    );
    expect(await noteOnDisk("Uses.md")).toBe("The tower: ![[tower.ink.png]]\n");
  });

  it("keeps a draft offered for later, and discards it from the list", async function () {
    await createSymbol("gate.ink.png");
    await draftThenStop("gate.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("gate.ink.png");
      if (file === null) throw new Error("no gate.ink.png");
      await app.vault.modifyBinary(file, new ArrayBuffer(8));
    });
    await restart();
    await tryToEdit("gate.ink.png");
    await clickTop("Not now");
    expect(await editorOpen()).toBe(false);
    expect(await draftCount()).toBe(1);
    await browser.executeObsidianCommand("inkline:recover-drafts");
    const rows = await listedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toMatch(
      /^gateKept .+\. Does not open: not a PNG file$/,
    );
    await browser.keys(["Enter"]);
    await clickTop("Discard");
    await browser.waitUntil(async () => (await draftCount()) === 0, {
      timeoutMsg: "the draft was not discarded",
    });
    expect(await editorOpen()).toBe(false);
    expect(await bytesOfFile("gate.ink.png")).toEqual(new Array(8).fill(0));
    await browser.executeObsidianCommand("inkline:recover-drafts");
    await waitForNotice("No draft is waiting for a symbol");
  });

  it("lists no draft of a later layout, and leaves it as it is", async function () {
    const later = JSON.stringify({
      version: 3,
      id: "later",
      target: { kind: "file", path: "Gone/later.ink.png" },
      savedAt: Date.now(),
      pages: [{ strokes: [[16, 32]] }],
    });
    await browser.executeObsidian(({ app }, text) => {
      app.saveLocalStorage("inkline-draft:later", text);
      app.saveLocalStorage("inkline-drafts", ["later"]);
    }, later);
    await browser.executeObsidianCommand("inkline:recover-drafts");
    await waitForNotice("No draft is waiting for a symbol");
    expect(
      await browser.executeObsidian(({ app }): unknown[] => [
        app.loadLocalStorage("inkline-draft:later"),
        app.loadLocalStorage("inkline-drafts"),
      ]),
    ).toEqual([later, ["later"]]);
  });

  /** Moves the note at `path` to the vault's trash. */
  async function trash(path: string): Promise<void> {
    await browser.executeObsidian(async ({ app }, file) => {
      const note = app.vault.getFileByPath(file);
      if (note === null) throw new Error(`no ${file}`);
      await app.fileManager.trashFile(note);
    }, path);
  }

  /** Chooses the only draft listed, and opens it as a new symbol. */
  async function openListed(): Promise<string> {
    await browser.keys(["Enter"]);
    await browser.waitUntil(
      async () => (await topButton("Open as new symbol")) !== undefined,
      { timeoutMsg: "no question about the draft" },
    );
    const question = await questionText();
    await clickTop("Open as new symbol");
    await waitForEditor();
    return question;
  }

  it("lists a new symbol's draft whose note was deleted, and saves it where new symbols go, inserted nowhere", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Doomed.md", "The gate HERE opens.\n");
    });
    await openAtMarker("Doomed.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1, {
      timeoutMsg: "the drawing was never kept as a draft",
    });
    await obsidianPage.disablePlugin("inkline");
    await trash("Doomed.md");
    await restart();
    await browser.executeObsidianCommand("inkline:recover-drafts");
    const rows = await listedRows();
    await saveScreenshot("draft-recovery-list-new");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toMatch(
      /^New symbolStarted in Doomed\.mdKept .+\. Its note was deleted or moved$/,
    );
    expect(rows[0]?.picture).toBeGreaterThan(0);
    const question = await openListed();
    expect(question).toContain(
      "Doomed, the note a new symbol was started in, is no longer in the vault, but Inkline kept the symbol's unsaved drawing from",
    );
    expect(question).toContain(
      "They can open in a new symbol, saved where new symbols go, and inserted in no note.",
    );
    expect((await nameField()).value).toBe("");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    // The test vault puts new attachments at its top.
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect(await strokeCount("001.ink.png")).toBe(1);
    expect(await draftCount()).toBe(0);
    expect(await noteOnDisk("Editor.md")).not.toContain("001.ink.png");
    expect(await noteOnDisk("Welcome.md")).not.toContain("001.ink.png");
  });

  /**
   * Leaves a new symbol's draft whose first save made 001.ink.png but could
   * not insert it, with one stroke more than that file, and whose note is
   * gone, with Inkline on again.
   */
  async function newDraftWithItsFile(): Promise<void> {
    try {
      await failInsertion();
      await draw([
        [0.6, 0.3],
        [0.6, 0.7],
      ]);
      await browser.waitUntil(
        async () =>
          (await storedDrafts()).some((draft) => draft.strokes.length === 2),
        { timeoutMsg: "the second stroke was never kept as a draft" },
      );
      await obsidianPage.disablePlugin("inkline");
    } finally {
      await unlockNotes();
    }
    await trash("Editor.md");
  }

  it("writes over the file a new symbol's first save made, as restoring it in its note would", async function () {
    await newDraftWithItsFile();
    await restart();
    expect(await strokeCount("001.ink.png")).toBe(1);
    await browser.executeObsidianCommand("inkline:recover-drafts");
    const rows = await listedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toMatch(
      /^001Started in Editor\.mdKept .+\. Its note was deleted or moved$/,
    );
    const question = await openListed();
    expect(question).toContain(
      "They can open in a new symbol, saved in the vault's top folder and inserted in no note. Its first save made 001.ink.png: saving writes over that file if nothing changed it since, and otherwise makes another beside it.",
    );
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect(await strokeCount("001.ink.png")).toBe(2);
    expect(await draftCount()).toBe(0);
  });

  it("leaves the file a new symbol's first save made once it changed, and saves another beside it", async function () {
    await newDraftWithItsFile();
    // Changed since, as by its own editor or sync: three strokes of its own.
    await createSymbol("Other/001.ink.png", [200, 800, 1400]);
    await browser.executeObsidian(async ({ app }) => {
      const source = app.vault.getFileByPath("Other/001.ink.png");
      const file = app.vault.getFileByPath("001.ink.png");
      if (source === null || file === null) throw new Error("no file");
      await app.vault.modifyBinary(file, await app.vault.readBinary(source));
      await app.vault.delete(source);
    });
    const changed = await bytesOfFile("001.ink.png");
    await restart();
    await browser.executeObsidianCommand("inkline:recover-drafts");
    await listedRows();
    await openListed();
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png", "002.ink.png"]);
    expect(await bytesOfFile("001.ink.png")).toEqual(changed);
    expect(await strokeCount("002.ink.png")).toBe(2);
    expect(await draftCount()).toBe(0);
  });
});
