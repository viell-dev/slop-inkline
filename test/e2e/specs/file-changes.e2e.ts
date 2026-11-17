import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  editFile,
  inklineOn,
  insert,
  saveOne,
  strokeCount,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  draw,
  restoreVault,
  settledSurface,
  storedDrafts,
  undoStubs,
  startOver,
  symbolFiles,
  clickTop,
  topButton,
  waitForStatus,
} from "../support/editor.ts";
import {
  failInsertion,
  interruptInsertion,
  unlockNotes,
} from "../support/failed-insertion.ts";
import { changeElsewhere } from "../support/vault-files.ts";

/** Two readings, as the data of the `iTXt` chunk that holds them. */
const readings = "Inkline reading\0\0\0\0\0TA\nた";

/** The data of a symbol file's `iTXt` chunks, as text. */
async function textIn(path: string): Promise<string[]> {
  return browser.executeObsidian(async ({ app }, filePath) => {
    const file = app.vault.getFileByPath(filePath);
    if (file === null) throw new Error(`no ${filePath}`);
    const { png } = window.inklineTest;
    return png
      .readChunks(new Uint8Array(await app.vault.readBinary(file)))
      .filter((chunk) => chunk.type === "iTXt")
      .map((chunk) => new TextDecoder().decode(chunk.data));
  }, path);
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
  describe("when its file changes on disk", function () {
    it("takes in the change when nothing is unsaved", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await settledSurface();
      await changeElsewhere("001.ink.png");
      await waitForStatus("Reloaded: the file changed on disk");
      await draw([[0.5, 0.2]]);
      // The three dots, and the new stroke.
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.strokes.length === 4,
      );
    });

    it("asks first when something is unsaved, and can keep the drawing", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await draw([[0.5, 0.2]]);
      await changeElsewhere("001.ink.png");
      await clickTop("Keep mine");
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      expect(await strokeCount("001.ink.png")).toBe(2);
      // Its own saves are not changes to ask about.
      await draw([[0.6, 0.2]]);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await browser.pause(500);
      expect(await topButton("Keep mine")).toBeUndefined();
      expect(await strokeCount("001.ink.png")).toBe(3);
    });

    it("reloads when asked to, with the drawing one undo away", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await draw([[0.5, 0.2]]);
      await browser.waitUntil(async () => (await storedDrafts()).length === 1);
      await changeElsewhere("001.ink.png");
      await clickTop("Reload");
      await waitForStatus("Reloaded: the file changed on disk");
      // Nothing is unsaved now, so no draft is kept.
      await browser.waitUntil(async () => (await storedDrafts()).length === 0);
      await browser.keys(["Control", "z"]);
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.strokes.length === 2,
      );
    });

    it("finds a change when saving, and saves over it only once told to", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await draw([[0.5, 0.2]]);
      // Straight to the disk, and the save at once, before the vault notices.
      await changeElsewhere("001.ink.png", "disk");
      await browser.execute(() => {
        const save = document.querySelector('[data-inkline-button="save"]');
        if (!(save instanceof HTMLElement)) throw new Error("no Save button");
        save.click();
      });
      await waitForStatus("Not saved: the file changed on disk");
      expect(await strokeCount("001.ink.png")).toBe(3);
      // Keeping the drawing goes on with the save, and its closing.
      await clickTop("Keep mine");
      await waitClosed();
      expect(await strokeCount("001.ink.png")).toBe(2);
    });

    it("never saves over a file it cannot read", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await draw([[0.5, 0.2]]);
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("001.ink.png");
        if (file === null) throw new Error("no file");
        await app.vault.modifyBinary(
          file,
          new TextEncoder().encode("x").buffer,
        );
      });
      await waitForStatus("Not reloaded: the file changed on disk");
      await browser.keys(["Control", "s"]);
      await waitForStatus("Not saved: the file changed on disk");
      const held = await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("001.ink.png");
        if (file === null) throw new Error("no file");
        return new TextDecoder().decode(await app.vault.readBinary(file));
      });
      expect(held).toBe("x");
      // The drawing is kept as a draft meanwhile.
      expect((await storedDrafts())[0]?.strokes).toHaveLength(2);
    });

    it("saves a deleted symbol again where it was, folder and all", async function () {
      await browser.executeObsidian(async ({ app }) => {
        const { canvas } = window.inklineTest;
        const { bytes } = await canvas.saveInk(
          {
            strokes: [
              {
                tool: "pen",
                size: 256,
                points: [800, 800, 1600, 2000],
              },
            ],
          },
          undefined,
          [],
        );
        await app.vault.createFolder("Symbols");
        await app.vault.createBinary("Symbols/a.ink.png", bytes.slice().buffer);
      });
      await editFile("Symbols/a.ink.png");
      await draw([[0.5, 0.2]]);
      // Straight from the disk, as sync would.
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.adapter.rmdir("Symbols", true);
      });
      await waitForStatus("The file was deleted; saving makes it again");
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      expect(await symbolFiles()).toEqual(["Symbols/a.ink.png"]);
      expect(await strokeCount("Symbols/a.ink.png")).toBe(2);
    });

    it("still compares a restored new symbol's file after a save fails", async function () {
      await interruptInsertion();
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await browser.waitUntil(
        async () => (await topButton("Restore")) !== undefined,
      );
      // The draft's own first save made the file; nothing saved it since.
      expect(
        await browser.execute(
          () =>
            [...document.querySelectorAll(".modal-container")].at(-1)
              ?.textContent ?? "",
        ),
      ).not.toContain("saved again");
      await clickTop("Restore");
      await draw([[0.5, 0.2]]);
      await browser.executeObsidian(({ app }) => {
        Reflect.set(
          app.vault,
          "inklineDelayed-modifyBinary",
          Reflect.get(app.vault, "modifyBinary"),
        );
        app.vault.modifyBinary = () =>
          Promise.reject(new Error("the disk is full"));
      });
      try {
        // The save adopts the draft's file, then cannot write it.
        await browser.keys(["Control", "s"]);
        await waitForStatus("the disk is full");
      } finally {
        await restoreVault();
      }
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("001.ink.png");
        if (file === null) throw new Error("no file");
        await app.vault.modifyBinary(
          file,
          new TextEncoder().encode("x").buffer,
        );
      });
      await waitForStatus("Not reloaded: the file changed on disk");
      await browser.keys(["Control", "s"]);
      await waitForStatus("Not saved: the file changed on disk");
      expect(
        await browser.executeObsidian(async ({ app }) => {
          const file = app.vault.getFileByPath("001.ink.png");
          if (file === null) throw new Error("no file");
          return new TextDecoder().decode(await app.vault.readBinary(file));
        }),
      ).toBe("x");
    });

    it("saves again without asking after a save that adopted the file failed", async function () {
      await interruptInsertion();
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await clickTop("Restore");
      await draw([[0.5, 0.2]]);
      await browser.executeObsidian(({ app }) => {
        Reflect.set(
          app.vault,
          "inklineDelayed-modifyBinary",
          Reflect.get(app.vault, "modifyBinary"),
        );
        app.vault.modifyBinary = () =>
          Promise.reject(new Error("the disk is full"));
      });
      try {
        await browser.keys(["Control", "s"]);
        await waitForStatus("the disk is full");
      } finally {
        await restoreVault();
      }
      // The file still holds what the draft's first save wrote: the
      // editor's own, not a change to ask about.
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await strokeCount("001.ink.png")).toBe(2);
    });

    it("sets aside a read of the file that a save overtook", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await draw([[0.5, 0.2]]);
      // The reads of the file that a report of it starts come back only once
      // the save has written the drawing, with what they read before. Every
      // read is counted.
      await browser.executeObsidian(({ app }) => {
        const read = app.vault.readBinary.bind(app.vault);
        const reads = { started: 0, held: 0, holding: true };
        Reflect.set(window, "inklineReads", reads);
        let go = (): void => undefined;
        const gate = new Promise<void>((resolve) => {
          go = resolve;
        });
        Reflect.set(window, "inklineLetOvertakenReadsGo", go);
        app.vault.readBinary = async (file) => {
          reads.started++;
          const late = reads.holding;
          const bytes = await read(file);
          if (late) {
            reads.held++;
            await gate;
          }
          return bytes;
        };
      });
      try {
        const reads = () =>
          browser.execute(
            () =>
              Reflect.get(window, "inklineReads") as {
                started: number;
                held: number;
              },
          );
        // A report of the file, unchanged, starts the editor's read of it, and
        // the index's; the save then writes the drawing before they come back.
        await browser.executeObsidian(async ({ app }) => {
          const file = app.vault.getFileByPath("001.ink.png");
          if (file === null) throw new Error("no file");
          await app.vault.modifyBinary(
            file,
            await app.vault.adapter.readBinary(file.path),
          );
        });
        await browser.waitUntil(async () => {
          const { started, held } = await reads();
          return started > 0 && held === started;
        });
        await browser.execute(() => {
          const state: unknown = Reflect.get(window, "inklineReads");
          if (typeof state === "object" && state !== null) {
            Reflect.set(state, "holding", false);
          }
        });
        await browser.keys(["Control", "s"]);
        await waitForStatus("Saved");
        // The editor takes the late read in, or sets it aside, and then looks
        // at the file again, as the save that ran meanwhile has it do: it then
        // fingerprints the file as the save left it, which nothing else does.
        await browser.executeObsidian(async ({ app }) => {
          const saved = new Uint8Array(
            await app.vault.adapter.readBinary("001.ink.png"),
          );
          const looked = { again: false };
          Reflect.set(window, "inklineLookedAgain", looked);
          const digest = crypto.subtle.digest.bind(crypto.subtle);
          crypto.subtle.digest = async (algorithm, data) => {
            const bytes = ArrayBuffer.isView(data)
              ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
              : new Uint8Array(data);
            if (
              bytes.length === saved.length &&
              bytes.every((byte, at) => byte === saved[at])
            ) {
              looked.again = true;
            }
            return digest(algorithm, data);
          };
          const go: unknown = Reflect.get(window, "inklineLetOvertakenReadsGo");
          if (typeof go === "function") Reflect.apply(go, undefined, []);
        });
        await browser.waitUntil(
          async () =>
            browser.execute(() => {
              const looked: unknown = Reflect.get(window, "inklineLookedAgain");
              return (
                typeof looked === "object" &&
                looked !== null &&
                Reflect.get(looked, "again") === true
              );
            }),
          { timeoutMsg: "the editor did not look at the file again" },
        );
        // The late read showed the file before the save: not a change.
        expect(await browser.$(".inkline-status").getText()).toBe("Saved");
        expect(await topButton("Keep mine")).toBeUndefined();
        await draw([[0.6, 0.2]]);
        await browser.waitUntil(
          async () => (await storedDrafts())[0]?.strokes.length === 3,
        );
      } finally {
        await browser.executeObsidian(({ app }) => {
          // Both replacements are the objects' own, over their prototypes'.
          Reflect.deleteProperty(app.vault, "readBinary");
          Reflect.deleteProperty(crypto.subtle, "digest");
          const go: unknown = Reflect.get(window, "inklineLetOvertakenReadsGo");
          Reflect.deleteProperty(window, "inklineLetOvertakenReadsGo");
          if (typeof go === "function") Reflect.apply(go, undefined, []);
        });
      }
    });

    it("follows a new symbol's file when its first save could not insert it", async function () {
      try {
        await failInsertion();
      } finally {
        await unlockNotes();
      }
      await changeElsewhere("001.ink.png");
      await clickTop("Keep mine");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await strokeCount("001.ink.png")).toBe(1);
    });

    it("follows a new symbol's file once its first save made it", async function () {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await draw([[0.5, 0.2]]);
      await changeElsewhere("001.ink.png");
      await clickTop("Keep mine");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await strokeCount("001.ink.png")).toBe(2);
    });
  });
  describe("keeping the text about a symbol", function () {
    // Through an edit and a save alone, symbol-text-editor.e2e.ts keeps a
    // file's readings and translations; this keeps its chunk byte for byte,
    // through a draft as well.
    it("keeps it through a draft offered back", async function () {
      await saveOne();
      await changeElsewhere("001.ink.png", "vault", readings);
      await editFile("001.ink.png");
      await draw([[0.5, 0.2]]);
      await obsidianPage.disablePlugin("inkline");
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
      await editFile("001.ink.png");
      await clickTop("Restore");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await strokeCount("001.ink.png")).toBe(4);
      expect(await textIn("001.ink.png")).toEqual([readings]);
    });

    it("takes in what a change it reloads added", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await settledSurface();
      await changeElsewhere("001.ink.png", "vault", readings);
      await waitForStatus("Reloaded: the file changed on disk");
      await draw([[0.5, 0.2]]);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      expect(await strokeCount("001.ink.png")).toBe(4);
      expect(await textIn("001.ink.png")).toEqual([readings]);
    });

    // Keep mine, asked as the vault reports the change, is
    // symbol-text-editor.e2e.ts's; asked as a save finds it, it takes the same
    // chunks the same way.
    it("keeps what a change added when a save found it", async function () {
      await saveOne();
      await editFile("001.ink.png");
      await draw([[0.5, 0.2]]);
      // Straight to the disk, and the save at once, before the vault notices.
      await changeElsewhere("001.ink.png", "disk", readings);
      await browser.execute(() => {
        const save = document.querySelector('[data-inkline-button="save"]');
        if (!(save instanceof HTMLElement)) throw new Error("no Save button");
        save.click();
      });
      await waitForStatus("Not saved: the file changed on disk");
      await clickTop("Keep mine");
      await waitClosed();
      expect(await strokeCount("001.ink.png")).toBe(2);
      expect(await textIn("001.ink.png")).toEqual([readings]);
    });
  });
});
