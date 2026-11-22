import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  chooseSymbol,
  draftCount,
  editFile,
  inklineOn,
  insert,
  nameField,
  strokeCount,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  clickTop,
  createSymbol,
  delayVault,
  draw,
  editorOpen,
  holdDecoding,
  letDecodingGo,
  openAtMarker,
  recordOf,
  startOver,
  storedDrafts,
  symbolFiles,
  topButton,
  undoStubs,
  waitForEditor,
  waitForHeldDecoding,
  waitForNotice,
  waitForStatus,
} from "../support/editor.ts";
import {
  failInsertion,
  showWelcomeInstead,
  unlockNotes,
} from "../support/failed-insertion.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import {
  bytesOfFile,
  createSquare,
  noteOnDisk,
} from "../support/vault-files.ts";

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

  /**
   * The rows the list of drafts shows: their text, and their picture's width
   * and height in pixels, 0 for none.
   */
  async function listedRows(): Promise<
    { text: string; picture: number; height: number }[]
  > {
    await browser.$(".prompt .inkline-suggestion").waitForExist();
    return browser.execute(() =>
      [...document.querySelectorAll(".prompt .inkline-suggestion")].map(
        (row) => {
          const picture = row.querySelector("img");
          const drawn = picture?.src.startsWith("data:image/png") === true;
          return {
            text: row.textContent,
            picture: drawn ? picture.naturalWidth : 0,
            height: drawn ? picture.naturalHeight : 0,
          };
        },
      ),
    );
  }

  /** What each stored draft says of the file its strokes line up with. */
  async function storedPrints(): Promise<
    { fingerprint: string | null; drawing: string | null }[]
  > {
    return browser.executeObsidian(({ app }) => {
      const { drafts } = window.inklineTest;
      return new drafts.DraftStore(app).list().map((draft) => ({
        fingerprint: draft.fingerprint ?? null,
        drawing: draft.drawing ?? null,
      }));
    });
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
    // A picture of the two strokes, as the first save would draw them, and
    // no larger than its row needs.
    expect(rows[0]?.picture).toBeGreaterThan(0);
    expect(rows[0]?.picture).toBeLessThanOrEqual(256);
    expect(rows[0]?.height).toBeGreaterThan(0);
    expect(rows[0]?.height).toBeLessThanOrEqual(64);
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
    expect(await nameField()).toEqual({
      value: "",
      placeholder: "New symbol: name it, or leave it to keep the name 001",
    });
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

  /** Writes `bytes` over the file at `path`, as sync or a backup would. */
  async function putBack(
    path: string,
    bytes: readonly number[],
  ): Promise<void> {
    await browser.executeObsidian(
      async ({ app }, file, data) => {
        const found = app.vault.getFileByPath(file);
        if (found === null) throw new Error(`no ${file}`);
        await app.vault.modifyBinary(found, Uint8Array.from(data).buffer);
      },
      path,
      [...bytes],
    );
  }

  /**
   * A picture drawn over, whose draft relies on the file for its base layer,
   * the file cut short as by a crash, and the draft opened as a new symbol,
   * whose editor's own draft has taken its place. Returns the file as it was
   * whole, and what the draft found said of it.
   */
  async function pictureDraftOpenedAsNew(): Promise<{
    whole: number[];
    prints: { fingerprint: string | null; drawing: string | null };
  }> {
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
    const whole = await bytesOfFile("Signs/square.ink.png");
    await draftThenStop("Signs/square.ink.png");
    const [prints] = await storedPrints();
    if (prints?.fingerprint == null || prints.drawing == null) {
      throw new Error("the draft says nothing of its file");
    }
    await putBack(
      "Signs/square.ink.png",
      whole.slice(0, Math.floor(whole.length / 2)),
    );
    await restart();
    await tryToEdit("Signs/square.ink.png");
    await clickTop("Open as new symbol");
    await waitForEditor();
    await browser.waitUntil(async () => {
      const drafts = await storedDrafts();
      return drafts.length === 1 && drafts[0]?.base === "file";
    });
    return { whole, prints };
  }

  /**
   * With Inkline off, puts the file back whole, as from a backup, opens it,
   * restores the draft, and saves: the base layer is there, with the draft's
   * stroke, and nothing said of a save since.
   */
  async function restoredOnWholeFile(whole: readonly number[]): Promise<void> {
    await putBack("Signs/square.ink.png", whole);
    await restart();
    await editFile("Signs/square.ink.png");
    await browser.waitUntil(
      async () => (await topButton("Restore")) !== undefined,
      { timeoutMsg: "the draft was not offered" },
    );
    expect(await questionText()).not.toContain("saved again since then");
    await clickTop("Restore");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const record = JSON.parse(await recordOf("Signs/square.ink.png")) as {
      strokes: unknown[];
      base?: unknown;
    };
    expect(record.strokes).toHaveLength(1);
    expect(record.base).toBeDefined();
    expect(await draftCount()).toBe(0);
  }

  it("keeps a draft it opens as a new symbol for its file, base layer and all, until the first save", async function () {
    const { whole, prints } = await pictureDraftOpenedAsNew();
    // The editor's own draft takes the old one's place, as that draft was,
    // with what it said of the file.
    expect((await storedDrafts())[0]?.target).toEqual({
      kind: "file",
      path: "Signs/square.ink.png",
    });
    expect(await storedPrints()).toEqual([prints]);
    // Ended without Save or Discard, as when Inkline is turned off.
    await obsidianPage.disablePlugin("inkline");
    await restoredOnWholeFile(whole);
  });

  it("keeps it so through a first save that Inkline's unloading cuts short", async function () {
    const { whole, prints } = await pictureDraftOpenedAsNew();
    // The save's first hash waits, as a large drawing's takes long, while
    // Inkline unloads, before the save has named its new file.
    await browser.execute(() => {
      const { subtle } = crypto;
      const digest = subtle.digest.bind(subtle);
      let go = (): void => undefined;
      const gate = new Promise<void>((resolve) => {
        go = resolve;
      });
      const state = { reached: 0, ended: 0 };
      Reflect.set(window, "inklineHeldDigest", state);
      Reflect.set(window, "inklineLetDigestGo", go);
      Reflect.set(window, "inklineAtEnd-digest", go);
      subtle.digest = async (algorithm, data) => {
        state.reached++;
        await gate;
        try {
          return await digest(algorithm, data);
        } finally {
          state.ended++;
        }
      };
    });
    const digests = (): Promise<{ reached: number; ended: number }> =>
      browser.execute(() => {
        const state: unknown = Reflect.get(window, "inklineHeldDigest");
        return typeof state === "object" && state !== null
          ? {
              reached: Number(Reflect.get(state, "reached")),
              ended: Number(Reflect.get(state, "ended")),
            }
          : { reached: 0, ended: 0 };
      });
    await browser.keys(["Control", "Enter"]);
    await browser.waitUntil(async () => (await digests()).reached > 0, {
      timeoutMsg: "the save never hashed",
    });
    // Kept as Inkline unloads, during the save.
    await obsidianPage.disablePlugin("inkline");
    const kept = (): Promise<unknown> =>
      browser.executeObsidian(({ app }) => {
        const { drafts } = window.inklineTest;
        return new drafts.DraftStore(app).list().map((draft) => ({
          target: draft.target,
          base: draft.base.kind,
          fingerprint: draft.fingerprint ?? null,
          drawing: draft.drawing ?? null,
        }));
      });
    const expected = [
      {
        target: { kind: "file", path: "Signs/square.ink.png" },
        base: "file",
        ...prints,
      },
    ];
    expect(await kept()).toEqual(expected);
    // And again as the save ends, stopped by the unloading.
    await browser.execute(() => {
      const go: unknown = Reflect.get(window, "inklineLetDigestGo");
      if (typeof go === "function") Reflect.apply(go, undefined, []);
    });
    await browser.waitUntil(async () => (await digests()).ended >= 2, {
      timeoutMsg: "the save never went on",
    });
    await browser.pause(500);
    expect(await kept()).toEqual(expected);
    expect(await symbolFiles()).toEqual(["Signs/square.ink.png"]);
    await restoredOnWholeFile(whole);
  });

  /**
   * Leaves a new symbol's draft that keeps its own base layer, a copy of
   * square.ink.png's picture, and a stroke, with its note, Editor.md,
   * deleted, and Inkline off. Copy from is a new symbol's.
   */
  async function keptBaseThenDelete(): Promise<void> {
    await createSquare();
    await insert();
    await browser.keys(["v"]);
    await chooseSymbol("square");
    await waitForStatus("Started from a copy of square");
    await draw(zigzag);
    await browser.waitUntil(
      async () => {
        const [draft] = await storedDrafts();
        return draft?.base === "kept" && draft.strokes.length === 1;
      },
      { timeoutMsg: "the draft never kept its base layer" },
    );
    await obsidianPage.disablePlugin("inkline");
    await trash("Editor.md");
  }

  it("brings back a base layer the draft kept itself", async function () {
    await keptBaseThenDelete();
    await restart();
    await browser.executeObsidianCommand("inkline:recover-drafts");
    const rows = await listedRows();
    expect(rows[0]?.picture).toBeGreaterThan(0);
    const question = await openListed();
    expect(question).not.toContain("base layer");
    await waitForStatus("Opened the unsaved drawing as a new symbol");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png", "square.ink.png"]);
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
      base?: unknown;
    };
    expect(record.strokes).toHaveLength(1);
    expect(record.base).toBeDefined();
    expect(await draftCount()).toBe(0);
  });

  it("says when a base layer the draft kept cannot be read, and brings back its strokes", async function () {
    await keptBaseThenDelete();
    // Its PNG in storage keeps its chunks, and so passes every check of
    // their form, but holds image data that cannot be inflated.
    await browser.executeObsidian(({ app }) => {
      const { png, record } = window.inklineTest;
      const keys: unknown = app.loadLocalStorage("inkline-draft-bases");
      if (!Array.isArray(keys) || keys.length !== 1) throw new Error("bases");
      const key = `inkline-draft-base:${String(keys[0])}`;
      const stored: unknown = app.loadLocalStorage(key);
      if (typeof stored !== "string") throw new Error("no base layer");
      const bytes = Uint8Array.from(atob(stored), (char) => char.charCodeAt(0));
      const chunks = png.readChunks(bytes).map((chunk) =>
        chunk.type === "IDAT"
          ? {
              type: chunk.type,
              data: new Uint8Array(chunk.data.length).fill(255),
            }
          : { type: chunk.type, data: chunk.data },
      );
      app.saveLocalStorage(key, record.toBase64(png.writeChunks(chunks)));
    });
    await restart();
    await browser.executeObsidianCommand("inkline:recover-drafts");
    const rows = await listedRows();
    // Nothing to draw it with, so no picture.
    expect(rows[0]?.picture).toBe(0);
    await openListed();
    await waitForNotice(
      "The unsaved drawing's base layer cannot be read, so only its strokes came back.",
    );
    // Still kept, in case it can be read another time, until a save.
    const bases = (): Promise<unknown> =>
      browser.executeObsidian(({ app }) => {
        const keys: unknown = app.loadLocalStorage("inkline-draft-bases");
        return Array.isArray(keys) ? keys.length : 0;
      });
    expect((await storedDrafts())[0]?.base).toBe("kept");
    expect(await bases()).toBe(1);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await bases()).toBe(0);
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
      base?: unknown;
    };
    expect(record.strokes).toHaveLength(1);
    expect(record.base).toBeUndefined();
  });

  /**
   * Leaves a new symbol's draft that keeps its own base layer, a copy of
   * square.ink.png's picture, and whose first save made 001.ink.png, with
   * that picture and a stroke, but could not insert it; its note, Editor.md,
   * deleted, and Inkline off. Returns that file's bytes.
   */
  async function keptBaseWithItsFile(): Promise<number[]> {
    await createSquare();
    await browser.executeObsidian(({ app }) => {
      const vault = app.vault as typeof app.vault & {
        inklineProcess?: typeof app.vault.process;
      };
      vault.inklineProcess = vault.process.bind(vault);
      vault.process = () => Promise.reject(new Error("the note is locked"));
    });
    try {
      await insert();
      await browser.keys(["v"]);
      await chooseSymbol("square");
      await waitForStatus("Started from a copy of square");
      await draw(zigzag);
      await showWelcomeInstead();
      await browser.keys(["Control", "s"]);
      await waitForStatus("the note is locked");
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.base === "kept",
        { timeoutMsg: "the draft never kept its base layer" },
      );
      await obsidianPage.disablePlugin("inkline");
    } finally {
      await unlockNotes();
    }
    await trash("Editor.md");
    return bytesOfFile("001.ink.png");
  }

  it("says when the editor overtook a draft as its base layer was read, and leaves the draft and its first save's file", async function () {
    const first = await keptBaseWithItsFile();
    await restart();
    await browser.executeObsidianCommand("inkline:recover-drafts");
    await listedRows();
    // Its base layer is read once the editor is open, which waits here,
    // while the person draws and saves in the editor.
    await holdDecoding();
    await browser.keys(["Enter"]);
    await clickTop("Open as new symbol");
    await waitForEditor();
    await waitForHeldDecoding();
    await draw([
      [0.6, 0.3],
      [0.6, 0.7],
    ]);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await letDecodingGo();
    await waitForNotice(
      "The unsaved drawing was not opened, as the editor was in use while it was read. It is still kept: run Inkline: Recover drafts to open it.",
    );
    // The save took no claim on the first save's file, as the draft was not
    // restored: that file is as it was, and the save made another.
    expect(await bytesOfFile("001.ink.png")).toEqual(first);
    expect(await symbolFiles()).toEqual([
      "001.ink.png",
      "002.ink.png",
      "square.ink.png",
    ]);
    expect(await strokeCount("002.ink.png")).toBe(1);
    expect(await editorOpen()).toBe(true);
    await browser.keys(["Escape"]);
    await waitClosed();
    // The draft found is still kept, to be opened again.
    await browser.executeObsidianCommand("inkline:recover-drafts");
    expect(await listedRows()).toHaveLength(1);
    await browser.keys(["Escape"]);
  });

  it("follows a rename of the file a new symbol's first save made, while its draft is open", async function () {
    await newDraftWithItsFile();
    await restart();
    await browser.executeObsidianCommand("inkline:recover-drafts");
    await listedRows();
    await openListed();
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no 001.ink.png");
      await app.vault.rename(file, "gate.ink.png");
    });
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect(await strokeCount("gate.ink.png")).toBe(2);
    expect(await draftCount()).toBe(0);
  });

  it("closes the list and the question as it unloads, and does nothing from them after", async function () {
    await createSymbol("gate.ink.png");
    await draftThenStop("gate.ink.png");
    await trash("gate.ink.png");
    await restart();
    await browser.executeObsidianCommand("inkline:recover-drafts");
    await listedRows();
    await obsidianPage.disablePlugin("inkline");
    await browser.$(".prompt").waitForExist({ reverse: true });
    await restart();
    await browser.executeObsidianCommand("inkline:recover-drafts");
    await listedRows();
    await browser.keys(["Enter"]);
    await browser.waitUntil(
      async () => (await topButton("Open as new symbol")) !== undefined,
    );
    // The button, kept to be clicked once the question has gone.
    await browser.execute(() => {
      const button = [...document.querySelectorAll("button")].find(
        (each) => each.textContent === "Open as new symbol",
      );
      Reflect.set(window, "inklineAnswer", button);
    });
    await obsidianPage.disablePlugin("inkline");
    await browser.waitUntil(
      async () => (await topButton("Open as new symbol")) === undefined,
      { timeoutMsg: "the question stayed open" },
    );
    await browser.execute(() => {
      const button: unknown = Reflect.get(window, "inklineAnswer");
      if (!(button instanceof HTMLButtonElement)) throw new Error("no button");
      button.click();
    });
    await browser.pause(300);
    expect(await editorOpen()).toBe(false);
    expect(await draftCount()).toBe(1);
    // Kept, and no longer held: listed again once Inkline is back.
    await restart();
    await browser.executeObsidianCommand("inkline:recover-drafts");
    expect(await listedRows()).toHaveLength(1);
    await browser.keys(["Escape"]);
  });

  it("says in a notice, rather than asking, when another window opened while the symbol was read", async function () {
    await createSymbol("gate.ink.png");
    await draftThenStop("gate.ink.png");
    await putBack("gate.ink.png", new Array<number>(8).fill(0));
    await restart();
    await delayVault("readBinary", 1000);
    await browser.executeObsidian(({ app, plugins }) => {
      const file = app.vault.getFileByPath("gate.ink.png");
      if (file === null) throw new Error("no gate.ink.png");
      void plugins.inkline.editSymbol(file);
    });
    await browser.executeObsidianCommand("command-palette:open");
    await browser.$(".prompt-input").waitForDisplayed();
    await waitForNotice(
      "Unsaved changes to it are kept as a draft. To get them back, run Inkline: Recover drafts from the command palette.",
    );
    expect(await topButton("Open as new symbol")).toBeUndefined();
    await browser.keys(["Escape"]);
    expect(await editorOpen()).toBe(false);
    expect(await draftCount()).toBe(1);
  });
});
