import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  draftCount,
  editFile,
  inklineOn,
  insert,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  draw,
  followSave,
  hold,
  holdAfter,
  letGo,
  noteText,
  recordOf,
  storedDrafts,
  undoStubs,
  waitForEditor,
  waitForHeld,
  waitForSaveEnd,
  startOver,
  symbolFiles,
  clickTop,
  topButton,
  waitForStatus,
} from "../support/editor.ts";
import {
  interruptInsertion,
  showWelcomeInstead,
} from "../support/failed-insertion.ts";
import { createSquare, fileText } from "../support/vault-files.ts";

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

  it("finishes a first save that disabling interrupted, with the file it made", async function () {
    await insert();
    await draw(zigzag);
    // The file is made, and the save goes on only once Inkline is off.
    await holdAfter("create");
    await browser.keys(["Control", "s"]);
    await waitForHeld();
    await browser.waitUntil(async () => (await symbolFiles()).length === 1);
    await followSave();
    await obsidianPage.disablePlugin("inkline");
    await letGo();
    await waitForSaveEnd();
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

  it("drops a new symbol's draft that its file holds, once its first save ends after Inkline is disabled", async function () {
    await insert();
    await draw(zigzag);
    // Close the note's tab, so that the insertion edits its file.
    await browser.executeObsidian(({ app }) => {
      for (const leaf of app.workspace.getLeavesOfType("markdown"))
        leaf.detach();
    });
    // The embed is written, and the insertion goes on only once Inkline is
    // off.
    await holdAfter("link");
    try {
      await browser.keys(["Control", "s"]);
      await waitForHeld();
      await browser.waitUntil(async () =>
        (await fileText("Editor.md")).includes("001.ink.png"),
      );
      await obsidianPage.disablePlugin("inkline");
      // Kept while the insertion is under way.
      expect(await draftCount()).toBe(1);
      await letGo();
      // The old insertion finishes, and with it the save: the draft is kept
      // for the file, as the symbol is that file once its embed is in.
      await browser.waitUntil(
        async () => {
          const [draft] = await storedDrafts();
          return (
            draft?.target !== null &&
            typeof draft?.target === "object" &&
            Reflect.get(draft.target, "kind") === "file"
          );
        },
        {
          timeout: 5000,
          timeoutMsg: "the draft was not kept for the file once the save ended",
        },
      );
      expect(await storedDrafts()).toMatchObject([
        { target: { kind: "file", path: "001.ink.png" } },
      ]);
    } finally {
      await letGo();
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
    await obsidianPage.openFile("Editor.md");
    // A new symbol in the note is another symbol.
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    expect(await topButton("Restore")).toBeUndefined();
    await browser.keys(["Escape"]);
    await waitClosed();
    // The file holds every stroke the draft does, so its editor drops it.
    await editFile("001.ink.png");
    expect(await topButton("Restore")).toBeUndefined();
    expect(await draftCount()).toBe(0);
    await browser.keys(["Escape"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect((await fileText("Editor.md")).split("001.ink.png")).toHaveLength(2);
  });

  it("does not insert again an embed that an interrupted save inserted", async function () {
    await insert();
    await draw(zigzag);
    // Close the note's tab, so that the insertion edits its file.
    await browser.executeObsidian(({ app }) => {
      for (const leaf of app.workspace.getLeavesOfType("markdown"))
        leaf.detach();
    });
    // The insertion edits the note's file and then fails, after Inkline is
    // disabled, as when it was cut short once the embed was written: the
    // draft, which names the file, is what finishes the save.
    await holdAfter("link");
    try {
      await browser.keys(["Control", "s"]);
      await waitForHeld();
      await browser.waitUntil(async () =>
        (await fileText("Editor.md")).includes("001.ink.png"),
      );
      await followSave();
      await obsidianPage.disablePlugin("inkline");
      await letGo("the note's save was cut short");
      await waitForSaveEnd();
    } finally {
      await letGo();
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
    expect(await draftCount()).toBe(1);
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
    // The save's read of the file it claims comes back once the file has
    // changed, with what the file held before.
    await holdAfter("readSymbol");
    await browser.keys(["Control", "Enter"]);
    await waitForHeld();
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no 001.ink.png");
      await app.vault.modifyBinary(file, new ArrayBuffer(10));
    });
    await letGo();
    await waitClosed();
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
        // Held until Inkline is off.
        await hold("write", undefined, when);
        await browser.keys(["Control", "s"]);
        await waitForHeld();
        await waitForStatus("Saving…");
        await followSave();
        await browser.keys(["Control", "z"]);
        if (stroke) {
          await draw([
            [0.45, 0.8],
            [0.55, 0.8],
          ]);
        }
        await obsidianPage.disablePlugin("inkline");
        // The old save finishes: the file then holds the cleared drawing.
        await letGo();
        await waitForSaveEnd();
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
          base?: { height: number };
          strokes: unknown[];
        };
        expect(record.base?.height).toBe(192 * 16);
        expect(record.strokes).toHaveLength(stroke ? 1 : 0);
      });
    }
  }

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
      await hold("write");
      await browser.keys(["Control", "s"]);
      await waitForHeld();
      await waitForStatus("Saving…");
      await followSave();
      await obsidianPage.disablePlugin("inkline");
      await letGo("the disk is gone");
      await waitForSaveEnd();
    } finally {
      await letGo();
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
});
