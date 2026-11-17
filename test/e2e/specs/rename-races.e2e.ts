import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
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
  draw,
  editorOpen,
  hold,
  holdIndex,
  letGo,
  noteText,
  renamePastHold,
  undoStubs,
  waitForHeld,
  waitForIndexWait,
  waitForNotice,
  startOver,
  symbolFiles,
  topButton,
  waitForStatus,
} from "../support/editor.ts";
import {
  bytesOfFile,
  noteOnDisk,
  waitForLink,
  writeSymbol,
} from "../support/vault-files.ts";

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

  describe("renaming a symbol that changes while the rename waits", function () {
    const stroke = [
      [0.6, 0.3],
      [0.6, 0.7],
    ] as const;

    afterEach(async function () {
      await letGo();
    });

    /** Replaces `001.ink.png` with a file of another drawing, as sync could. */
    async function replaceSymbol(): Promise<number[]> {
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("001.ink.png");
        if (file === null) throw new Error("no 001");
        await app.fileManager.trashFile(file);
      });
      await writeSymbol("001.ink.png", [1200, 1800]);
      return bytesOfFile("001.ink.png");
    }

    /**
     * Opens the editor of `001.ink.png`, which the open note `Editor.md`
     * embeds, adds a stroke, names it `tower`, and saves, holding the save
     * where it reaches `what`: its write of the drawing, or, once that is
     * written, the rename's read of the open note, to see whether it has text
     * to save.
     */
    async function saveHeld(what: "write" | "read"): Promise<void> {
      await saveOne();
      await waitForLink("Editor.md", "001.ink.png");
      await editFile("001.ink.png");
      await draw(stroke);
      await nameSymbol("tower");
      await hold(what);
      await browser.keys(["Control", "s"]);
      await waitForHeld();
      if (what === "read") {
        await browser.waitUntil(
          async () => (await strokeCount("001.ink.png")) === 2,
        );
      }
    }

    it("saves a symbol deleted and replaced while open notes are saved, but does not rename the replacement", async function () {
      await saveHeld("read");
      const replacement = await replaceSymbol();
      await letGo();
      await waitForNotice(
        "001.ink.png is saved, but could not be renamed: the file was deleted or replaced meanwhile",
      );
      expect((await nameField()).value).toBe("tower");
      expect(await symbolFiles()).toEqual(["001.ink.png"]);
      expect(await bytesOfFile("001.ink.png")).toEqual(replacement);
    });

    for (const what of ["write", "read"] as const) {
      const during =
        what === "write" ? "its drawing is written" : "open notes are saved";
      it(`keeps a name given elsewhere while ${during}, and takes the typed one when saved again`, async function () {
        await saveHeld(what);
        // Renamed as sync would, without Inkline.
        await browser.executeObsidian(async ({ app }) => {
          const file = app.vault.getFileByPath("001.ink.png");
          if (file === null) throw new Error("no 001");
          await app.vault.rename(file, "elsewhere.ink.png");
        });
        await letGo();
        await waitForNotice(
          "001.ink.png is saved, but could not be renamed: the file was renamed to elsewhere.ink.png meanwhile",
        );
        await waitForStatus("Saved, but not renamed");
        expect(await nameField()).toEqual({
          value: "tower",
          placeholder: "elsewhere",
        });
        expect(await symbolFiles()).toEqual(["elsewhere.ink.png"]);
        expect(await strokeCount("elsewhere.ink.png")).toBe(2);
        await browser.keys(["Control", "Enter"]);
        const update = browser.$("button=Just once");
        await browser.waitUntil(
          async () => !(await editorOpen()) || (await update.isDisplayed()),
        );
        if (await update.isDisplayed()) await update.click();
        await waitClosed();
        expect(await symbolFiles()).toEqual(["tower.ink.png"]);
        expect(await strokeCount("tower.ink.png")).toBe(2);
      });
    }

    it("renames nothing once Inkline is disabled while open notes are saved", async function () {
      await saveHeld("read");
      await obsidianPage.disablePlugin("inkline");
      try {
        expect(await editorOpen()).toBe(false);
        await letGo();
        await waitForNotice(
          "001.ink.png is saved, but could not be renamed: Inkline was disabled",
        );
        expect(await symbolFiles()).toEqual(["001.ink.png"]);
      } finally {
        await obsidianPage.enablePlugin("inkline");
        await loadModules();
      }
      expect(await strokeCount("001.ink.png")).toBe(2);
    });

    it("saves a new symbol replaced while a later save renames it, but does not rename the replacement", async function () {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await draw(stroke);
      await nameSymbol("tower");
      await hold("read");
      await browser.keys(["Control", "s"]);
      await waitForHeld();
      await browser.waitUntil(
        async () => (await strokeCount("001.ink.png")) === 2,
      );
      const replacement = await replaceSymbol();
      await letGo();
      await waitForNotice(
        "001.ink.png is saved, but could not be renamed: the file was deleted or replaced meanwhile",
      );
      expect((await nameField()).value).toBe("tower");
      expect(await symbolFiles()).toEqual(["001.ink.png"]);
      expect(await bytesOfFile("001.ink.png")).toEqual(replacement);
      expect(await noteOnDisk("Editor.md")).toContain("![[001.ink.png]]");
    });

    for (const what of ["write", "read"] as const) {
      const during =
        what === "write" ? "its drawing is written" : "open notes are saved";
      it(`leaves a new symbol's embed to a rename made elsewhere while ${during}`, async function () {
        await insert();
        await draw(zigzag);
        await browser.keys(["Control", "s"]);
        await waitForStatus("Saved");
        await draw(stroke);
        await nameSymbol("tower");
        await hold(what);
        await browser.keys(["Control", "s"]);
        await waitForHeld();
        // Renamed as sync would, which leaves the links as they were.
        await browser.executeObsidian(async ({ app }) => {
          const file = app.vault.getFileByPath("001.ink.png");
          if (file === null) throw new Error("no 001");
          await app.vault.rename(file, "elsewhere.ink.png");
        });
        await letGo();
        await waitForNotice(
          "001.ink.png is saved, but could not be renamed: the file was renamed to elsewhere.ink.png meanwhile",
        );
        expect(await symbolFiles()).toEqual(["elsewhere.ink.png"]);
        expect(await strokeCount("elsewhere.ink.png")).toBe(2);
        // Said once the save, and anything it does to the note, is over.
        await waitForStatus("Saved, but not renamed");
        // As every other link to the file is, by whichever way it went.
        expect(await noteOnDisk("Editor.md")).toContain("![[001.ink.png]]");
        expect(await noteText()).toContain("![[001.ink.png]]");
      });
    }

    /**
     * Opens the editor of `001.ink.png`, which the open note `Editor.md`
     * embeds, adds a stroke, names it `tower`, and saves, with Obsidian's
     * index held on another note, as on a slow disk or while sync brings in
     * notes. Obsidian's `renameFile` waits for the index before it moves a
     * file; this waits until the rename waits for it, with the drawing written.
     */
    async function saveWhileIndexing(): Promise<void> {
      await saveOne();
      await waitForLink("Editor.md", "001.ink.png");
      await editFile("001.ink.png");
      await draw(stroke);
      await nameSymbol("tower");
      await holdIndex();
      await browser.keys(["Control", "s"]);
      await waitForIndexWait();
      await browser.waitUntil(
        async () => (await strokeCount("001.ink.png")) === 2,
      );
    }

    it("saves a symbol deleted and replaced while Obsidian indexes the vault, but does not rename the replacement", async function () {
      await saveWhileIndexing();
      const replacement = await replaceSymbol();
      await letGo();
      await waitForNotice(
        "001.ink.png is saved, but could not be renamed: the file was deleted or replaced meanwhile",
      );
      expect((await nameField()).value).toBe("tower");
      expect(await symbolFiles()).toEqual(["001.ink.png"]);
      expect(await bytesOfFile("001.ink.png")).toEqual(replacement);
    });

    it("renames nothing, and says so at once, once Inkline is disabled while Obsidian indexes the vault", async function () {
      await saveWhileIndexing();
      await obsidianPage.disablePlugin("inkline");
      try {
        expect(await editorOpen()).toBe(false);
        // Said while Obsidian still waits for its index.
        await waitForNotice(
          "001.ink.png is saved, but could not be renamed: Inkline was disabled",
        );
        await letGo();
        // The index catches up, and nothing follows it.
        await browser.waitUntil(async () =>
          browser.executeObsidian(
            ({ app }) => app.metadataCache.getCache("Synced.md") !== null,
          ),
        );
        await browser.pause(500);
        expect(await symbolFiles()).toEqual(["001.ink.png"]);
      } finally {
        await obsidianPage.enablePlugin("inkline");
        await loadModules();
      }
      expect(await strokeCount("001.ink.png")).toBe(2);
    });

    it("says what happened to a symbol replaced as Obsidian moves it", async function () {
      await saveOne();
      await waitForLink("Editor.md", "001.ink.png");
      await editFile("001.ink.png");
      await draw(stroke);
      await nameSymbol("tower");
      // Past every check, as a change already on its way to the disk, or one
      // made outside Obsidian, would be.
      await hold("move");
      await browser.keys(["Control", "s"]);
      await waitForHeld();
      const replacement = await replaceSymbol();
      await letGo();
      const said =
        "001.ink.png is saved, but the file was deleted while Obsidian was renaming it, and Obsidian renamed another file to tower.ink.png";
      // Obsidian can ask about the links to the file it was asked to rename.
      await browser.waitUntil(async () => {
        const once = await topButton("Just once");
        if (once !== undefined) await once.click();
        return browser.execute(
          (wanted) =>
            [...document.querySelectorAll(".notice")].some((notice) =>
              notice.textContent.includes(wanted),
            ),
          said,
        );
      });
      // Not taken for a rename that went as asked, the name stays to retry.
      // The status line goes on to say what the editor sees of its file.
      expect((await nameField()).value).toBe("tower");
      expect(await symbolFiles()).toEqual(["tower.ink.png"]);
      expect(await bytesOfFile("tower.ink.png")).toEqual(replacement);
    });

    /**
     * Opens the editor of `001.ink.png`, which the open note `Editor.md`
     * embeds, adds a stroke, names it `tower`, and saves, holding Obsidian's
     * move of the file, past every check, as a change already on its way to
     * the disk, or one made outside Obsidian, would be.
     */
    async function saveHeldInMove(): Promise<void> {
      await saveOne();
      await waitForLink("Editor.md", "001.ink.png");
      await editFile("001.ink.png");
      await draw(stroke);
      await nameSymbol("tower");
      await hold("move");
      await browser.keys(["Control", "s"]);
      await waitForHeld();
    }

    it("says the symbol stays where it was when a file comes by the new name as Obsidian moves it", async function () {
      await saveHeldInMove();
      // As sync would bring in a file of that name.
      await writeSymbol("tower.ink.png", [1200, 1800]);
      const arrived = await bytesOfFile("tower.ink.png");
      await letGo();
      await waitForNotice(
        "001.ink.png is saved, but tower.ink.png was created while Obsidian was renaming it, and the file is still 001.ink.png",
      );
      await waitForStatus("Saved, but not renamed");
      expect(await nameField()).toEqual({ value: "tower", placeholder: "001" });
      expect(await symbolFiles()).toEqual(["001.ink.png", "tower.ink.png"]);
      expect(await strokeCount("001.ink.png")).toBe(2);
      expect(await bytesOfFile("tower.ink.png")).toEqual(arrived);
      expect(await noteOnDisk("Editor.md")).toContain("![[001.ink.png]]");
    });

    it("says the symbol has the new name when it is renamed to it elsewhere as Obsidian moves it", async function () {
      await saveHeldInMove();
      // The very rename, as sync would make it, which leaves the links.
      await renamePastHold("001.ink.png", "tower.ink.png");
      await letGo();
      await waitForNotice(
        "001.ink.png is saved, but Obsidian did not finish the rename, though the file is tower.ink.png now, so links to it may still have the old name",
      );
      await waitForStatus("Saved");
      expect(await browser.$(".inkline-status").getText()).toBe("Saved");
      expect(await nameField()).toEqual({
        value: "tower",
        placeholder: "tower",
      });
      expect(await symbolFiles()).toEqual(["tower.ink.png"]);
      expect(await strokeCount("tower.ink.png")).toBe(2);
      expect(await noteOnDisk("Editor.md")).toContain("![[001.ink.png]]");
    });
  });
});
