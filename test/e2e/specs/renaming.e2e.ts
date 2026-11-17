import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { stalledAfter } from "../../../src/notes/file-writes.ts";
import { loadModules } from "../support/browser.ts";
import {
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
  addUnsaved,
  draw,
  editorOpen,
  failSaves,
  hold,
  letGo,
  noteText,
  openAtMarker,
  undoStubs,
  waitForEditor,
  waitForFailedSaves,
  waitForHeld,
  waitForNotice,
  waitForPanes,
  startOver,
  symbolFiles,
  clickTop,
  topButton,
  waitForStatus,
} from "../support/editor.ts";
import { noteOnDisk, waitForLink } from "../support/vault-files.ts";

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

  it("renames a symbol whose name changes, as Obsidian updates links", async function () {
    await saveOne();
    await editFile("001.ink.png");
    expect(await nameField()).toEqual({ value: "001", placeholder: "001" });
    // Emptied, the field keeps the symbol's name.
    await nameSymbol("");
    await draw([
      [0.6, 0.3],
      [0.6, 0.7],
    ]);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    // With only the name changed, closing asks first.
    await nameSymbol("tower");
    await browser.keys(["Escape"]);
    await browser.$("button=Keep drawing").waitForDisplayed();
    await browser.$("button=Keep drawing").click();
    // Obsidian asks whether to update the links to it, as its settings say,
    // once its cache knows of them, and the save waits for the answer.
    await waitForLink("Editor.md", "001.ink.png");
    await browser.keys(["Control", "Enter"]);
    await browser.$("button=Just once").waitForDisplayed();
    expect(await editorOpen()).toBe(true);
    await browser.$("button=Just once").click();
    await waitClosed();
    expect(await symbolFiles()).toEqual(["tower.ink.png"]);
    await browser.waitUntil(async () =>
      (await noteOnDisk("Editor.md")).includes("![[tower.ink.png]]"),
    );
  });

  it("puts the next symbol after one renamed as Obsidian updates its link", async function () {
    // With the note open, Obsidian rewrites the embed after the rename; with
    // its tab showing another note, before, in the note's file.
    for (const [note, tab] of [
      ["Inscription.md", "open"],
      ["Closed inscription.md", "closed"],
    ] as const) {
      await browser.executeObsidian(async ({ app }, path) => {
        await app.vault.create(path, "Symbols: HERE");
      }, note);
      const before = await symbolFiles();
      await openAtMarker(note, "HERE");
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await waitForEditor();
      await draw(zigzag);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      // Once Obsidian knows the embed, it rewrites it itself, at the end of
      // the note, where nothing after it shows where the next one goes.
      const first = (await symbolFiles()).find(
        (path) => !before.includes(path),
      );
      if (first === undefined) throw new Error("no new symbol");
      await waitForLink(note, first);
      if (tab === "closed") {
        await browser.executeObsidian(async ({ app, obsidian }, path) => {
          const welcome = app.vault.getFileByPath("Welcome.md");
          if (welcome === null) throw new Error("no Welcome.md");
          for (const leaf of app.workspace.getLeavesOfType("markdown")) {
            if (
              leaf.view instanceof obsidian.MarkdownView &&
              leaf.view.file?.path === path
            ) {
              await leaf.openFile(welcome);
            }
          }
        }, note);
      }
      const name = tab === "open" ? "gate" : "gate two";
      await nameSymbol(name);
      await browser.keys(["Control", "Shift", "Enter"]);
      await browser.$("button=Just once").waitForDisplayed();
      await browser.$("button=Just once").click();
      await waitForEditor();
      await browser.waitUntil(async () => (await nameField()).value === "");
      await draw(zigzag);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      let text = "";
      await browser
        .waitUntil(async () => {
          text = await noteOnDisk(note);
          return text.startsWith(`Symbols: ![[${name}.ink.png]]![[`);
        })
        .catch(() => undefined);
      expect(text).toBe(`Symbols: ![[${name}.ink.png]]![[${first}]]`);
      expect(
        await browser.execute(() =>
          Array.from(document.querySelectorAll(".notice")).some((notice) =>
            notice.textContent.includes("added at the end"),
          ),
        ),
      ).toBe(false);
    }
  });

  describe("when Obsidian does not finish a rename", function () {
    const wait = () => browser.$(".inkline-editor .inkline-save-wait");

    /** Has Obsidian's own move of a file wait until {@link letMoveGo}. */
    async function holdMove(): Promise<void> {
      await browser.executeObsidian(({ app }) => {
        const { adapter } = app.vault;
        const move = adapter.rename.bind(adapter);
        let go = (): void => undefined;
        const gate = new Promise<void>((resolve) => {
          go = resolve;
        });
        Reflect.set(window, "inklineLetMoveGo", go);
        adapter.rename = async (...args) => {
          await gate;
          return move(...args);
        };
      });
    }

    async function letMoveGo(): Promise<void> {
      await browser.executeObsidian(({ app }) => {
        const go: unknown = Reflect.get(window, "inklineLetMoveGo");
        Reflect.deleteProperty(window, "inklineLetMoveGo");
        Reflect.deleteProperty(app.vault.adapter, "rename");
        if (typeof go === "function") Reflect.apply(go, undefined, []);
      });
    }

    afterEach(async function () {
      await letMoveGo();
    });

    it("says so of a rename held back, and ends with it", async function () {
      await saveOne();
      await waitForLink("Editor.md", "001.ink.png");
      await editFile("001.ink.png");
      await nameSymbol("tower");
      await holdMove();
      await browser.keys(["Control", "s"]);
      await browser.waitUntil(async () => (await wait().getText()) !== "", {
        timeout: stalledAfter + 15_000,
        timeoutMsg: "the editor never said its rename waits",
      });
      expect(await wait().getText()).toContain("Your strokes are safe");
      // The drawing is written, and the rename is all that is left of the save.
      expect(await symbolFiles()).toEqual(["001.ink.png"]);
      await letMoveGo();
      // The move ends, and only then does Obsidian ask about the links, which
      // is a person's to answer, so that the message goes.
      await browser.waitUntil(
        async () => (await topButton("Just once")) !== undefined,
      );
      await browser.waitUntil(async () => (await wait().getText()) === "");
      await clickTop("Just once");
      await waitForStatus("Saved");
      expect(await symbolFiles()).toEqual(["tower.ink.png"]);
    });

    it("says nothing during Obsidian's question, however long it stays open", async function () {
      await saveOne();
      await waitForLink("Editor.md", "001.ink.png");
      await editFile("001.ink.png");
      await nameSymbol("tower");
      await browser.keys(["Control", "s"]);
      await browser.waitUntil(
        async () => (await topButton("Just once")) !== undefined,
      );
      await browser.pause(stalledAfter + 1500);
      expect(await wait().getText()).toBe("");
      await clickTop("Just once");
      await waitForStatus("Saved");
      expect(await symbolFiles()).toEqual(["tower.ink.png"]);
    });
  });

  it("keeps a name it could not give the file, for the next save to try", async function () {
    await saveOne();
    await editFile("001.ink.png");
    await browser.executeObsidian(({ app }) => {
      const manager = app.fileManager as typeof app.fileManager & {
        inklineRenameFile?: typeof app.fileManager.renameFile;
      };
      manager.inklineRenameFile = manager.renameFile.bind(manager);
      manager.renameFile = () => Promise.reject(new Error("the disk says no"));
    });
    try {
      await nameSymbol("tower");
      await draw([
        [0.6, 0.3],
        [0.6, 0.7],
      ]);
      await browser.keys(["Control", "Enter"]);
      await waitForNotice(
        "001.ink.png is saved, but could not be renamed: the disk says no",
      );
      // The drawing is saved; the name is not, so the editor stays open.
      await waitForStatus("Saved, but not renamed");
      expect(await editorOpen()).toBe(true);
      expect((await nameField()).value).toBe("tower");
      expect(await strokeCount("001.ink.png")).toBe(2);
      // Failing again, held until a stroke is drawn meanwhile, which is not
      // saved either, and the status says both. The rename fails only once
      // the stroke is drawn, however long drawing it takes.
      await browser.executeObsidian(({ app }) => {
        const held = window as Window & { inklineFailRename?: () => void };
        app.fileManager.renameFile = () =>
          new Promise((_resolve, reject) => {
            held.inklineFailRename = () => {
              reject(new Error("the disk says no"));
            };
          });
      });
      await browser.keys(["Control", "Enter"]);
      // The save has written the drawing, and waits for the rename.
      await browser.waitUntil(async () =>
        browser.execute(() => "inklineFailRename" in window),
      );
      await draw([
        [0.3, 0.5],
        [0.7, 0.5],
      ]);
      await browser.execute(() => {
        const held = window as Window & { inklineFailRename?: () => void };
        const fail = held.inklineFailRename;
        delete held.inklineFailRename;
        fail?.();
      });
      await waitForStatus(
        "Saved, except for the name and what changed while saving",
      );
      expect(await editorOpen()).toBe(true);
      expect(await strokeCount("001.ink.png")).toBe(2);
    } finally {
      await browser.executeObsidian(({ app }) => {
        const manager = app.fileManager as typeof app.fileManager & {
          inklineRenameFile?: typeof app.fileManager.renameFile;
        };
        if (manager.inklineRenameFile !== undefined) {
          manager.renameFile = manager.inklineRenameFile;
          delete manager.inklineRenameFile;
        }
        delete (window as Window & { inklineFailRename?: () => void })
          .inklineFailRename;
      });
    }
    // The next save renames it, Obsidian asking about the links if its
    // cache knows them by then.
    await browser.keys(["Control", "Enter"]);
    const update = browser.$("button=Just once");
    await browser.waitUntil(
      async () => !(await editorOpen()) || (await update.isDisplayed()),
    );
    if (await update.isDisplayed()) await update.click();
    await waitClosed();
    expect(await symbolFiles()).toEqual(["tower.ink.png"]);
    expect(await strokeCount("tower.ink.png")).toBe(3);
  });

  describe("renaming a symbol that an open note holding unsaved text embeds", function () {
    const saved =
      "The door is marked with ![[001.ink.png]] which means return.\n";
    const opening = "Opening unsaved line.\n";
    const renamed = `${opening}The door is marked with ![[tower.ink.png]] which means return.\n`;

    /** Opens the editor of a symbol that `Editor.md` embeds. */
    async function editEmbedded(): Promise<void> {
      await saveOne();
      await waitForLink("Editor.md", "001.ink.png");
      await editFile("001.ink.png");
    }

    // A note's own save falling due during Obsidian's question is
    // unsaved-text-renames.e2e.ts's, through the same rename, which saves the
    // open notes first for an existing symbol's editor as for a new symbol's.
    it("refuses the rename if the note cannot be saved, and keeps the name to try", async function () {
      await editEmbedded();
      // Saves fail before the text is added, and until the file is read and
      // the note's own save has failed as well as the rename's (#234).
      const restore = await failSaves();
      try {
        await addUnsaved("Editor.md", opening, "start");
        await nameSymbol("tower");
        await browser.keys(["Control", "Enter"]);
        await waitForNotice(
          "001.ink.png is saved, but could not be renamed: the note Editor could not be saved first",
        );
        await waitForStatus("Saved, but not renamed");
        await waitForFailedSaves("Editor.md", 2);
        expect(await noteOnDisk("Editor.md")).toBe(saved);
      } finally {
        await restore();
      }
      expect(await editorOpen()).toBe(true);
      expect((await nameField()).value).toBe("tower");
      expect(await symbolFiles()).toEqual(["001.ink.png"]);
      await waitForPanes("Editor.md", `${opening}${saved}`);
      await browser.keys(["Control", "Enter"]);
      await browser.$("button=Just once").waitForDisplayed();
      await browser.$("button=Just once").click();
      await waitClosed();
      await waitForPanes("Editor.md", renamed);
      await browser.waitUntil(
        async () => (await noteOnDisk("Editor.md")) === renamed,
      );
    });
  });

  it("says only that it saved when the symbol was renamed elsewhere meanwhile", async function () {
    await saveOne();
    await editFile("001.ink.png");
    await draw([
      [0.6, 0.3],
      [0.6, 0.7],
    ]);
    // Renamed as the file explorer or sync would, while the save writes.
    await hold("write");
    await browser.keys(["Control", "s"]);
    await waitForHeld();
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no 001");
      await app.vault.rename(file, "tower.ink.png");
    });
    await letGo();
    // No rename was asked, so none failed.
    await waitForStatus("Saved");
    expect(await browser.$(".inkline-status").getText()).toBe("Saved");
    expect((await nameField()).value).toBe("tower");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["tower.ink.png"]);
    expect(await strokeCount("tower.ink.png")).toBe(2);
  });

  it("reports a successful rename when another rename follows before it resolves", async function () {
    await saveOne();
    await editFile("001.ink.png");
    await waitForLink("Editor.md", "001.ink.png");
    await browser.executeObsidian(({ app }) => {
      const rename = app.fileManager.renameFile.bind(app.fileManager);
      Reflect.set(window, "inklineRestoreRename", () => {
        app.fileManager.renameFile = rename;
      });
      app.fileManager.renameFile = async (...args) => {
        await rename(...args);
        await new Promise<void>((resolve) => {
          Reflect.set(window, "inklineFinishRename", resolve);
        });
      };
    });
    try {
      await nameSymbol("tower");
      await browser.keys(["Control", "s"]);
      await browser.$("button=Just once").waitForDisplayed();
      await browser.$("button=Just once").click();
      await browser.waitUntil(async () =>
        browser.execute(() => "inklineFinishRename" in window),
      );
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("tower.ink.png");
        if (file === null) throw new Error("no tower");
        await app.vault.rename(file, "external.ink.png");
      });
    } finally {
      await browser.execute(() => {
        for (const key of ["inklineFinishRename", "inklineRestoreRename"]) {
          const action: unknown = Reflect.get(window, key);
          if (typeof action === "function") Reflect.apply(action, window, []);
          Reflect.deleteProperty(window, key);
        }
      });
    }
    await waitForStatus("Saved");
    expect(await browser.$(".inkline-status").getText()).toBe("Saved");
    expect(await nameField()).toEqual({
      value: "external",
      placeholder: "external",
    });
    expect(await symbolFiles()).toEqual(["external.ink.png"]);
    expect(await strokeCount("external.ink.png")).toBe(1);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
  });

  it("keeps an external rename during a new symbol's later save fingerprint", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await draw([
      [0.6, 0.3],
      [0.6, 0.7],
    ]);
    await browser.execute(() => {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      let calls = 0;
      Reflect.set(window, "inklineRestoreDigest", () => {
        crypto.subtle.digest = digest;
      });
      crypto.subtle.digest = async (...args) => {
        // The save checks the file, fingerprints its new bytes, then the
        // new-symbol writer fingerprints them for interrupted-save recovery.
        if (++calls === 3) {
          await new Promise<void>((resolve) => {
            Reflect.set(window, "inklineFinishDigest", resolve);
          });
        }
        return digest(...args);
      };
    });
    try {
      await browser.keys(["Control", "s"]);
      await browser.waitUntil(async () =>
        browser.execute(() => "inklineFinishDigest" in window),
      );
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("001.ink.png");
        if (file === null) throw new Error("no 001");
        await app.vault.rename(file, "external.ink.png");
      });
    } finally {
      await browser.execute(() => {
        for (const key of ["inklineRestoreDigest", "inklineFinishDigest"]) {
          const action: unknown = Reflect.get(window, key);
          if (typeof action === "function") Reflect.apply(action, window, []);
          Reflect.deleteProperty(window, key);
        }
      });
    }
    // A rename requested by mistake may ask about links. Answer it so the
    // assertion reports the filename instead of leaving a pending save.
    await browser.waitUntil(
      async () =>
        (await browser.$(".inkline-status").getText()) !== "Saving…" ||
        (await browser.$("button=Just once").isDisplayed()),
    );
    if (await browser.$("button=Just once").isDisplayed()) {
      await browser.$("button=Just once").click();
    }
    await waitForStatus("Saved");
    expect(await symbolFiles()).toEqual(["external.ink.png"]);
    expect(await strokeCount("external.ink.png")).toBe(2);
    expect(await nameField()).toEqual({
      value: "external",
      placeholder: "external",
    });
  });

  it("renames a new symbol saved under a number once it is named", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    expect(await nameField()).toEqual({ value: "001", placeholder: "001" });
    // Named straight after its first save, the note is saved first, and
    // Obsidian waits for its cache to take that in, so it knows the embed and
    // asks. Inkline updates the embed itself if the answer leaves it.
    await nameSymbol("gate");
    await browser.keys(["Control", "Enter"]);
    await clickTop("Do not update");
    await waitClosed();
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    const text =
      "The door is marked with ![[gate.ink.png]] which means return.\n";
    expect(await noteText()).toBe(text);
    expect(await noteOnDisk("Editor.md")).toBe(text);
  });

  it("brings a new symbol's embed to its new name when Inkline is disabled during Obsidian's question", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await nameSymbol("gate");
    await browser.keys(["Control", "Enter"]);
    await browser.waitUntil(
      async () => (await topButton("Do not update")) !== undefined,
    );
    // Obsidian has the rename, which goes on without Inkline, and the embed
    // follows it all the same.
    await obsidianPage.disablePlugin("inkline");
    try {
      expect(await editorOpen()).toBe(false);
      await clickTop("Do not update");
      const text =
        "The door is marked with ![[gate.ink.png]] which means return.\n";
      await browser
        .waitUntil(async () => (await noteOnDisk("Editor.md")) === text)
        .catch(() => undefined);
      expect(await noteOnDisk("Editor.md")).toBe(text);
      expect(await symbolFiles()).toEqual(["gate.ink.png"]);
      await browser.waitUntil(async () => (await noteText()) === text, {
        timeoutMsg: "the note's editor kept the old embed",
      });
      // The symbol is saved, and its embed has followed it, so nothing says
      // otherwise.
      const notices = await browser.execute(() =>
        [...document.querySelectorAll(".notice")].map(
          (notice) => notice.textContent,
        ),
      );
      expect(
        notices.filter((notice) =>
          /Could not save the symbol|could not be renamed|old name/.test(
            notice,
          ),
        ),
      ).toEqual([]);
    } finally {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
  });
});
