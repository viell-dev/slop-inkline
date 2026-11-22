import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import { obsidianPage } from "wdio-obsidian-service";
import { brushSizes } from "../../../src/editor/session.ts";
import { unitsPerPixel } from "../../../src/format/record.ts";
import { lineBox } from "../../../src/ink/geometry.ts";
import { loadModules } from "../support/browser.ts";
import {
  editFile,
  inklineOn,
  insert,
  nameSymbol,
  nothingDrawn,
  saveOne,
  strokeCount,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  draw,
  drawAndHold,
  editorOpen,
  hold,
  letGo,
  noteText,
  recordOf,
  undoStubs,
  waitForHeld,
  startOver,
  symbolFiles,
  clickTop,
  topButton,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import { createSquare } from "../support/vault-files.ts";

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
      // The default size, M.
      strokes: [
        {
          tool: "pen",
          size: (brushSizes[1]?.em ?? 0) * lineBox.pxPerEm * unitsPerPixel,
        },
      ],
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

  /**
   * Has the status line say something else, by zooming in or out with the
   * button, which a focused name field does not take, so that a refusal it
   * says next is known to be new.
   */
  async function sayOtherwise(): Promise<void> {
    const zoomed = await browser.$(".inkline-status").getText();
    await browser.$('[data-inkline-button="zoom"]').click();
    await browser.waitUntil(async () => {
      const now = await browser.$(".inkline-status").getText();
      return now.startsWith("Zoomed") && now !== zoomed;
    });
  }

  it("saves no new symbol with nothing drawn, and says so, however it is saved", async function () {
    await insert();
    // A name is not a drawing.
    await nameSymbol("blank");
    await browser.$('[data-inkline-button="save"]').click();
    await waitForStatus(nothingDrawn);
    await sayOtherwise();
    await browser.keys(["Control", "Enter"]);
    await waitForStatus(nothingDrawn);
    await sayOtherwise();
    await browser.keys(["Control", "s"]);
    await waitForStatus(nothingDrawn);
    await sayOtherwise();
    await browser.keys(["Control", "Shift", "Enter"]);
    await waitForStatus(nothingDrawn);
    // A stroke of the eraser leaves nothing drawn either.
    await browser.$('[data-inkline-button="eraser"]').click();
    await draw(zigzag);
    await sayOtherwise();
    await browser.$('[data-inkline-button="next"]').click();
    await waitForStatus(nothingDrawn);
    // The close question's Save keeps the editor open, saying why.
    await sayOtherwise();
    await browser.keys(["Escape"]);
    await clickTop("Save");
    await waitForStatus(nothingDrawn);
    expect(await editorOpen()).toBe(true);
    expect(await symbolFiles()).toEqual([]);
    expect(await noteText()).toBe(
      "The door is marked with  which means return.\n",
    );
    // A stroke of the pen is something to save.
    await browser.$('[data-inkline-button="pen"]').click();
    await draw(zigzag);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["blank.ink.png"]);
  });

  it("still saves a symbol that has a file when it is erased to nothing", async function () {
    await saveOne();
    await editFile("001.ink.png");
    await browser.keys(["Delete"]);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await strokeCount("001.ink.png")).toBe(0);
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

  it("keeps the editor open with the drawing when saving fails", async function () {
    // A new symbol's file is written with Obsidian's adapter, once Inkline has
    // looked at its path (#413): that write fails.
    await browser.executeObsidian(({ app }) => {
      const { adapter } = app.vault;
      const write = adapter.writeBinary.bind(adapter);
      adapter.writeBinary = (path, data, options) =>
        path.endsWith(".ink.png") &&
        app.vault.getAbstractFileByPath(path) === null
          ? Promise.reject(new Error("the disk is full"))
          : write(path, data, options);
    });
    try {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "Enter"]);
      await waitForStatus("the disk is full");
      expect(await editorOpen()).toBe(true);
    } finally {
      await browser.executeObsidian(({ app }) => {
        Reflect.deleteProperty(app.vault.adapter, "writeBinary");
      });
    }
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
  });

  it("saves a stroke still being drawn when saving and closing", async function () {
    await insert();
    await draw(zigzag);
    // Saved with the button still down, in the same command, as a press held
    // into the next one would end first, as a lost capture (#391).
    await drawAndHold(
      [
        [0.3, 0.5],
        [0.7, 0.6],
      ],
      { chord: [Key.Ctrl, Key.Enter] },
    );
    await waitClosed();
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
    };
    expect(record.strokes).toHaveLength(2);
  });

  it("stays open when strokes are drawn while saving", async function () {
    await insert();
    await draw(zigzag);
    // The save waits to make the file until the stroke is drawn.
    await hold("create");
    await browser.keys(["Control", "Enter"]);
    await waitForHeld();
    await draw([
      [0.3, 0.2],
      [0.7, 0.2],
    ]);
    await letGo();
    await waitForStatus("changed while saving");
    expect(await editorOpen()).toBe(true);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
    };
    expect(record.strokes).toHaveLength(2);
  });
  it("saves without waiting for the window to be idle", async function () {
    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      await startOver();
      await createSquare();
      await editFile("square.ink.png");
      await draw([
        [0.05, 0.3],
        [0.1, 0.3],
      ]);
      // Timed inside Obsidian, from "Saving…" to "Saved", without the time
      // WebDriver takes to send keys and to poll.
      await browser.execute(() => {
        const status = document.querySelector(
          ".inkline-editor .inkline-status",
        );
        if (status === null) throw new Error("no status");
        const times: Record<string, number> = {};
        Reflect.set(window, "inklineSaveTimes", times);
        new MutationObserver(() => {
          const text = status.textContent;
          if (!(text in times)) {
            times[text] = performance.now();
          }
        }).observe(status, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      times.push(
        await browser.execute(() => {
          const marks: unknown = Reflect.get(window, "inklineSaveTimes");
          if (typeof marks !== "object" || marks === null) return Infinity;
          const saving: unknown = Reflect.get(marks, "Saving…");
          const saved: unknown = Reflect.get(marks, "Saved");
          return typeof saving === "number" && typeof saved === "number"
            ? saved - saving
            : Infinity;
        }),
      );
    }
    // Chromium 150 held a canvas's own encoding back for about a second
    // when saving a picture opened as a symbol.
    expect(Math.max(...times)).toBeLessThan(700);
  });
});
