import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  draftCount,
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
  noteText,
  openAtMarker,
  undoStubs,
  waitForEditor,
  waitForNotice,
  startOver,
  symbolFiles,
  clickTop,
  waitForStatus,
} from "../support/editor.ts";
import {
  interruptInsertion,
  showWelcomeInstead,
} from "../support/failed-insertion.ts";
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

  it("inserts after a link or embed the cursor was in, never inside", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create(
        "Links.md",
        // The third link's text wraps onto the next line, and the last is a
        // bare address, which only a space ends.
        "See [[gate|the HEREgate]] and ![](Old%20(2)/towTHEREer.png) now.\nA [wrapped\nlink WHEREtext](w.md) ends.\nGo to https://example.com/paMARKth now.\n",
      );
    });
    for (const [marker, expected] of [
      [
        "HERE",
        "See [[gate|the gate]]![[001.ink.png]] and ![](Old%20(2)/towTHEREer.png) now.\nA [wrapped\nlink WHEREtext](w.md) ends.\nGo to https://example.com/paMARKth now.\n",
      ],
      [
        "THERE",
        "See [[gate|the gate]]![[001.ink.png]] and ![](Old%20(2)/tower.png)![[002.ink.png]] now.\nA [wrapped\nlink WHEREtext](w.md) ends.\nGo to https://example.com/paMARKth now.\n",
      ],
      [
        "WHERE",
        "See [[gate|the gate]]![[001.ink.png]] and ![](Old%20(2)/tower.png)![[002.ink.png]] now.\nA [wrapped\nlink text](w.md)![[003.ink.png]] ends.\nGo to https://example.com/paMARKth now.\n",
      ],
      [
        "MARK",
        "See [[gate|the gate]]![[001.ink.png]] and ![](Old%20(2)/tower.png)![[002.ink.png]] now.\nA [wrapped\nlink text](w.md)![[003.ink.png]] ends.\nGo to https://example.com/path ![[004.ink.png]] now.\n",
      ],
    ] as const) {
      await openAtMarker("Links.md", marker);
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await waitForEditor();
      await draw(zigzag);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      await browser
        .waitUntil(async () => (await noteText()) === expected)
        .catch(() => undefined);
      expect(await noteText()).toBe(expected);
    }
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

  /** Moves the note `path` to the trash, as sync or another device can. */
  async function trashNote(path: string): Promise<void> {
    await browser.executeObsidian(async ({ app }, notePath) => {
      const file = app.vault.getFileByPath(notePath);
      if (file === null) throw new Error(`no ${notePath}`);
      await app.fileManager.trashFile(file);
    }, path);
  }

  /** The text of every notice shown. */
  async function notices(): Promise<string[]> {
    return browser.execute(() =>
      [...document.querySelectorAll(".notice")].map(
        (notice) => notice.textContent,
      ),
    );
  }

  const notInserted =
    "gone.ink.png is saved, but was not inserted, as the note it was for, Editor, was deleted.";

  it("saves a new symbol whose note was deleted, says it was not inserted, and saves again without it", async function () {
    await insert();
    await draw(zigzag);
    await nameSymbol("gone");
    await trashNote("Editor.md");
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await waitForNotice(notInserted);
    expect(await symbolFiles()).toEqual(["gone.ink.png"]);
    expect(await strokeCount("gone.ink.png")).toBe(1);
    // A later save only writes the file, and closes as a save does.
    await draw([
      [0.6, 0.3],
      [0.6, 0.7],
    ]);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await strokeCount("gone.ink.png")).toBe(2);
    expect(await draftCount()).toBe(0);
    const shown = await notices();
    expect(shown.filter((text) => text === notInserted)).toHaveLength(1);
    expect(shown.some((text) => /ENOENT|Not saved|Could not/.test(text))).toBe(
      false,
    );
  });

  it("saves and closes from Next when the note was deleted, with no editor after it", async function () {
    await insert();
    await draw(zigzag);
    await nameSymbol("gone");
    await trashNote("Editor.md");
    await browser.$('[data-inkline-button="next"]').click();
    await waitClosed();
    await waitForNotice(notInserted);
    // No next editor, as there is nowhere for its symbol to go.
    await browser.pause(500);
    expect(await editorOpen()).toBe(false);
    expect(await strokeCount("gone.ink.png")).toBe(1);
    expect(await draftCount()).toBe(0);
  });

  it("saves and closes from the close question when the note was deleted", async function () {
    await insert();
    await draw(zigzag);
    await nameSymbol("gone");
    await trashNote("Editor.md");
    await browser.keys(["Escape"]);
    await clickTop("Save");
    await waitClosed();
    await waitForNotice(notInserted);
    expect(await symbolFiles()).toEqual(["gone.ink.png"]);
    expect(await draftCount()).toBe(0);
  });

  /** Whether a notice says a save or an insertion failed. */
  async function failureShown(): Promise<boolean> {
    return (await notices()).some((text) =>
      /ENOENT|Not saved|Could not|could not/.test(text),
    );
  }

  it("opens no next editor for a note deleted after its symbol went in, and says so", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    expect(await noteText()).toContain("![[001.ink.png]]");
    await trashNote("Editor.md");
    await draw([
      [0.6, 0.3],
      [0.6, 0.7],
    ]);
    await browser.$('[data-inkline-button="next"]').click();
    await waitClosed();
    await waitForNotice(
      "No next symbol was started, as the note it was for, Editor, was deleted.",
    );
    await browser.pause(500);
    expect(await editorOpen()).toBe(false);
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect(await strokeCount("001.ink.png")).toBe(2);
    expect(await draftCount()).toBe(0);
    expect(await failureShown()).toBe(false);
  });

  /**
   * Holds the first call of the vault's `method` on Editor.md, before or
   * after its own work, until {@link releaseHold}, and records that it began,
   * for {@link waitForHold}, so that a test can change the note meanwhile.
   */
  async function holdNote(
    method: "read" | "process",
    when: "before" | "after",
  ): Promise<void> {
    await browser.executeObsidian(
      ({ app, obsidian }, name, when) => {
        const original: unknown = Reflect.get(app.vault, name);
        if (typeof original !== "function") throw new Error(`no ${name}`);
        const hold = { started: false, released: false, taken: false };
        Reflect.set(window, "inklineHold", hold);
        Reflect.set(app.vault, `inklineHeld-${name}`, original);
        const wait = async (): Promise<void> => {
          hold.started = true;
          while (!hold.released) {
            await new Promise((resolve) => window.setTimeout(resolve, 20));
          }
        };
        Reflect.set(
          app.vault,
          name,
          async (...args: unknown[]): Promise<unknown> => {
            const [file] = args;
            const mine =
              !hold.taken &&
              file instanceof obsidian.TFile &&
              file.path === "Editor.md";
            if (mine) hold.taken = true;
            if (mine && when === "before") await wait();
            const result: unknown = await Reflect.apply(
              original,
              app.vault,
              args,
            );
            if (mine && when === "after") await wait();
            return result;
          },
        );
      },
      method,
      when,
    );
  }

  async function waitForHold(): Promise<void> {
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const hold: unknown = Reflect.get(window, "inklineHold");
          return (
            typeof hold === "object" &&
            hold !== null &&
            Reflect.get(hold, "started") === true
          );
        }),
      { timeoutMsg: "the held call on Editor.md did not begin" },
    );
  }

  /** Lets the held call go on, and puts the vault's method back. */
  async function releaseHold(method: "read" | "process"): Promise<void> {
    await browser.executeObsidian(({ app }, name) => {
      const hold: unknown = Reflect.get(window, "inklineHold");
      if (typeof hold === "object" && hold !== null) {
        Reflect.set(hold, "released", true);
      }
      const original: unknown = Reflect.get(app.vault, `inklineHeld-${name}`);
      if (typeof original === "function")
        Reflect.set(app.vault, name, original);
    }, method);
  }

  const replacement = "Another note, put where Editor.md was.\n";

  /**
   * Deletes Editor.md, as sync can, and puts another note at its path, which
   * holds `text`.
   */
  async function replaceNote(text = replacement): Promise<void> {
    await trashNote("Editor.md");
    await browser.executeObsidian(async ({ app }, content) => {
      await app.vault.create("Editor.md", content);
    }, text);
  }

  /**
   * Records every call of the vault's `process` that is given Editor.md's
   * file as it is now, once the vault no longer has that file at its path,
   * until {@link stopWatchingNote}. Each call goes on to Obsidian's own.
   */
  async function watchNote(): Promise<void> {
    await browser.executeObsidian(({ app }) => {
      const note = app.vault.getFileByPath("Editor.md");
      if (note === null) throw new Error("no Editor.md");
      const original: unknown = Reflect.get(app.vault, "process");
      if (typeof original !== "function") throw new Error("no process");
      const calls: string[] = [];
      Reflect.set(window, "inklineGoneNoteCalls", calls);
      Reflect.set(app.vault, "inklineWatched-process", original);
      Reflect.set(app.vault, "process", (...args: unknown[]): unknown => {
        if (args[0] === note && app.vault.getFileByPath(note.path) !== note) {
          calls.push(note.path);
        }
        const result: unknown = Reflect.apply(original, app.vault, args);
        return result;
      });
    });
  }

  /** How many calls {@link watchNote} recorded. */
  async function goneNoteCalls(): Promise<number> {
    return browser.execute(() => {
      const calls: unknown = Reflect.get(window, "inklineGoneNoteCalls");
      return Array.isArray(calls) ? calls.length : -1;
    });
  }

  async function stopWatchingNote(): Promise<void> {
    await browser.executeObsidian(({ app }) => {
      const original: unknown = Reflect.get(
        app.vault,
        "inklineWatched-process",
      );
      if (typeof original === "function") {
        Reflect.set(app.vault, "process", original);
      }
    });
  }

  /** The status line once a save has ended, saved or not. */
  async function savedOrNot(): Promise<string> {
    let shown = "";
    await browser.waitUntil(
      async () => {
        shown = await browser.$(".inkline-status").getText();
        return shown.startsWith("Saved") || shown.startsWith("Not saved");
      },
      { timeoutMsg: "the save did not end" },
    );
    return shown;
  }

  it("saves and renames a symbol whose note was deleted after it went in, leaving that note alone", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await watchNote();
    try {
      await trashNote("Editor.md");
      await nameSymbol("tower");
      await browser.keys(["Control", "s"]);
      // The rename's save, not the first one's.
      await browser.waitUntil(
        async () => (await symbolFiles())[0] === "tower.ink.png",
      );
      const status = await savedOrNot();
      // Nothing was asked to write into the deleted note.
      expect(await goneNoteCalls()).toBe(0);
      expect(status).toBe("Saved");
    } finally {
      await stopWatchingNote();
    }
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["tower.ink.png"]);
    expect(await strokeCount("tower.ink.png")).toBe(1);
    expect(await failureShown()).toBe(false);
  });

  it("leaves a note put in the deleted one's place as a rename followed the embed into it", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    // The note as the save left it: the replacement holds the same embed in
    // the same text, so that following the rename there would change it.
    const before = await noteText();
    expect(before).toBe(
      "The door is marked with ![[001.ink.png]] which means return.\n",
    );
    await waitForLink("Editor.md", "001.ink.png");
    // Obsidian leaves the embed, and Inkline's own following of the rename
    // is the only write into the note, which is held as it begins.
    await holdNote("process", "before");
    try {
      await nameSymbol("tower");
      await browser.keys(["Control", "s"]);
      await clickTop("Do not update");
      await waitForHold();
      // The held write comes after the rename, as following it does; the
      // note's own saves come before it.
      expect(await symbolFiles()).toEqual(["tower.ink.png"]);
      await replaceNote(before);
    } finally {
      await releaseHold("process");
    }
    const status = await savedOrNot();
    expect(await noteOnDisk("Editor.md")).toBe(before);
    expect(status).toBe("Saved");
    expect(await symbolFiles()).toEqual(["tower.ink.png"]);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await noteOnDisk("Editor.md")).toBe(before);
    expect(await failureShown()).toBe(false);
  });

  it("leaves a note put in the deleted one's place while a restored save read it", async function () {
    await interruptInsertion();
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await clickTop("Restore");
    // No editor of the note, so that the save reads its file for the embed
    // the interrupted save may have inserted.
    await showWelcomeInstead();
    await holdNote("read", "after");
    try {
      await browser.keys(["Control", "Enter"]);
      await waitForHold();
      await replaceNote();
    } finally {
      await releaseHold("read");
    }
    await waitClosed();
    await waitForNotice(
      "001.ink.png is saved, but was not inserted, as the note it was for, Editor, was deleted.",
    );
    expect(await noteOnDisk("Editor.md")).toBe(replacement);
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect(await draftCount()).toBe(0);
  });

  it("leaves a note put in the deleted one's place as the embed was being written", async function () {
    await insert();
    await draw(zigzag);
    await showWelcomeInstead();
    await holdNote("process", "before");
    try {
      await browser.keys(["Control", "Enter"]);
      await waitForHold();
      await replaceNote();
    } finally {
      await releaseHold("process");
    }
    await waitClosed();
    await waitForNotice(
      "001.ink.png is saved, but was not inserted, as the note it was for, Editor, was deleted.",
    );
    expect(await noteOnDisk("Editor.md")).toBe(replacement);
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
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

  it("inserts through the live editor, whose text is newer than the file", async function () {
    // As the symbol's file is made, with Obsidian's adapter once Inkline has
    // looked at its path (#413).
    await browser.executeObsidian(({ app, obsidian }) => {
      const { adapter } = app.vault;
      const write = adapter.writeBinary.bind(adapter);
      adapter.writeBinary = async (path, data, options) => {
        const making =
          path.endsWith(".ink.png") &&
          app.vault.getAbstractFileByPath(path) === null;
        await write(path, data, options);
        if (!making) return;
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        view?.editor.setValue("BRAND NEW UNSAVED CONTENT\n");
      };
    });
    try {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
    } finally {
      await browser.executeObsidian(({ app }) => {
        Reflect.deleteProperty(app.vault.adapter, "writeBinary");
      });
    }
    expect(await noteText()).toBe(
      "BRAND NEW UNSAVED CONTENT\n![[001.ink.png]]\n",
    );
  });
});
