import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  editFile,
  inklineOn,
  insert,
  nothingDrawn,
  pressed,
  saveOne,
  strokeCount,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  draw,
  editorOpen,
  holdAfter,
  letGo,
  markEditor,
  noteText,
  undoStubs,
  waitForHeld,
  waitForNext,
  startOver,
  symbolFiles,
  clickTop,
  waitForStatus,
} from "../support/editor.ts";
import {
  interruptInsertion,
  showWelcomeInstead,
  unlockNotes,
} from "../support/failed-insertion.ts";
import { fileText } from "../support/vault-files.ts";

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
  // A run of three from Next, in order, is cursor-placement.e2e.ts's, with the
  // cursor after each.
  describe("drawing the next one", function () {
    it("makes no empty symbol from clicks on Next that reach the next editor", async function () {
      await insert();
      await draw(zigzag);
      await markEditor();
      // A double-click, and then quick clicks, where Next is: the clicks
      // after the first reach the next editor's Next once it is open.
      const next = browser.$('[data-inkline-button="next"]');
      const { x, y } = await next.getLocation();
      const { width, height } = await next.getSize();
      await next.doubleClick();
      const at = {
        x: Math.round(x + width / 2),
        y: Math.round(y + height / 2),
      };
      let clicks = browser.action("pointer").move(at);
      for (let count = 0; count < 5; count++) {
        clicks = clicks.down().up().pause(40);
      }
      await clicks.perform();
      // Not waitForNext, as a click there may have set the status already.
      await browser.waitUntil(
        async () =>
          (await symbolFiles()).length > 0 &&
          (await browser
            .$(".inkline-editor:not([data-inkline-test-before])")
            .isExisting()),
      );
      await browser.pause(1000);
      expect(await symbolFiles()).toEqual(["001.ink.png"]);
      expect(await noteText()).toBe(
        "The door is marked with ![[001.ink.png]] which means return.\n",
      );
      // The next editor's Next, clicked with nothing drawn, says why.
      await browser.$('[data-inkline-button="next"]').click();
      await waitForStatus(nothingDrawn);
      expect(await symbolFiles()).toEqual(["001.ink.png"]);
      expect(await browser.$$(".inkline-editor").getElements()).toHaveLength(1);
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

    // After a symbol that went in through the note's editor, the next goes in
    // through its file once no editor shows the note, as
    // cursor-placement.e2e.ts checks with the note in Reading view, the same
    // way to the file.
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
      // The file is made, and the save ends only once Next is asked again.
      await holdAfter("create");
      await markEditor();
      await browser.$('[data-inkline-button="next"]').click();
      await waitForHeld();
      await browser.keys(["Control", "Shift", "Enter"]);
      await browser.keys(["Control", "Shift", "Enter"]);
      await letGo();
      await waitForNext(1);
      // Today, Next asked again goes no further than that save, which opens
      // the next editor in the turn it ends; but a Next that started a save
      // of its own would open another later, writing the same file, so only
      // a while with no other editor shows that none opens.
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
});
