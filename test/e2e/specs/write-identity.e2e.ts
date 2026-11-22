// A symbol deleted and replaced at its path while Inkline saves it, in real
// Obsidian. Obsidian runs every read, write, and deletion of the vault's files
// in one line, one after another, and takes the file's path, not the file, when
// a write joins it. So something another plugin or a sync tool asks of the disk
// while a save reads the file for the last time runs after that read and before
// the save's write, and a deletion and a new file there are what the write then
// lands on. So too around the look at the disk that a save takes as it makes a
// symbol's file, again or for the first time: a file asked for just before that
// look, or just after it, as the next thing to run. Nothing here holds a step:
// the line keeps its own order. Every symbol is synthetic.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  editFile,
  insert,
  nameSymbol,
  strokeCount,
} from "../support/editing.ts";
import {
  clickTop,
  createSymbol,
  draw,
  noteText,
  startOver,
  symbolFiles,
  waitForNotice,
  waitForStatus,
} from "../support/editor.ts";

/** What the symbol at `path` says as its reading, from the file itself. */
async function readingOf(path: string): Promise<readonly string[] | null> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const file = app.vault.getFileByPath(wanted);
    if (file === null) return null;
    const { png, text } = window.inklineTest;
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    return (await text.readText(png.readChunks(bytes))).reading;
  }, path);
}

/** Gives the symbol at `path` the reading `value`, as the editor would. */
async function giveReading(path: string, value: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, wanted, reading) => {
      const file = app.vault.getFileByPath(wanted);
      if (file === null) throw new Error(`no ${wanted}`);
      const bytes = await window.inklineTest.text.writeText(
        new Uint8Array(await app.vault.readBinary(file)),
        "reading",
        [reading],
      );
      await app.vault.modifyBinary(file, bytes.slice().buffer);
    },
    path,
    value,
  );
}

/**
 * Has the `nth` read of `path` asked of the vault from now on ask, while it is
 * under way, for the file at `path` to be deleted and another
 * symbol, whose reading is "theirs", to be put there: `adapter` asks both at
 * once of Obsidian's file system, as a plugin or a sync tool working through
 * it can; `vault` deletes it through the vault, and puts the other there once
 * that is done.
 */
async function replaceDuringRead(
  path: string,
  nth: number,
  how: "adapter" | "vault",
): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, wanted, count, way) => {
      const { canvas, text } = window.inklineTest;
      const { bytes } = await canvas.saveInk(
        {
          strokes: [
            {
              tool: "pen" as const,
              size: 256,
              points: [2000, 800, 6000, 2000],
            },
          ],
        },
        undefined,
        [],
      );
      const theirs = (
        await text.writeText(bytes, "reading", ["theirs"])
      ).slice().buffer;
      const read = app.vault.readBinary.bind(app.vault);
      let seen = 0;
      Reflect.set(window, "inklineReplaced", false);
      app.vault.readBinary = (file) => {
        const reading = read(file);
        if (file.path === wanted && ++seen === count) {
          Reflect.deleteProperty(app.vault, "readBinary");
          // The first moment other code runs once the read has joined the
          // line, long before the disk answers it.
          queueMicrotask(() => {
            if (way === "adapter") {
              void app.vault.adapter.remove(wanted);
              void app.vault.adapter
                .writeBinary(wanted, theirs)
                .then(() => Reflect.set(window, "inklineReplaced", true));
            } else {
              void app.fileManager
                .trashFile(file)
                .then(() => app.vault.createBinary(wanted, theirs))
                .then(
                  () => Reflect.set(window, "inklineReplaced", true),
                  () => Reflect.set(window, "inklineReplaced", "refused"),
                );
            }
          });
        }
        return reading;
      };
    },
    path,
    nth,
    how,
  );
}

/**
 * Has the vault's next `createFolder` of `path`, as a save makes a deleted
 * symbol's folder again, find one already asked of Obsidian's file system, as a
 * plugin or a sync tool working through it can: the vault looks at the disk
 * only once what was asked before has run. {@link waitForReplaced} waits for it.
 */
async function folderAsMade(path: string): Promise<void> {
  await browser.executeObsidian(({ app }, wanted) => {
    const made = (): void => {
      Reflect.set(window, "inklineReplaced", true);
    };
    Reflect.set(window, "inklineReplaced", false);
    const create = app.vault.createFolder.bind(app.vault);
    app.vault.createFolder = (folder) => {
      if (folder === wanted) {
        Reflect.deleteProperty(app.vault, "createFolder");
        void app.vault.adapter.mkdir(wanted).then(made);
      }
      return create(folder);
    };
  }, path);
}

/**
 * Has the next look at the disk for `path`, Obsidian's adapter's `exists`, as
 * a save makes a symbol's file there, meet a file asked of Obsidian's file
 * system, as a plugin or a sync tool working through it can: asked just
 * `before` the look, or just `after` it, as the next thing to run. The file
 * holds a symbol whose reading is "theirs". This is the look the vault's own
 * `createBinary` takes before it writes, as well as Inkline's.
 * {@link waitForReplaced} waits for the file.
 */
async function landAt(path: string, when: "before" | "after"): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, wanted, moment) => {
      const made = (): void => {
        Reflect.set(window, "inklineReplaced", true);
      };
      Reflect.set(window, "inklineReplaced", false);
      const { canvas, text } = window.inklineTest;
      const { bytes } = await canvas.saveInk(
        {
          strokes: [
            {
              tool: "pen" as const,
              size: 256,
              points: [2000, 800, 6000, 2000],
            },
          ],
        },
        undefined,
        [],
      );
      const theirs = (
        await text.writeText(bytes, "reading", ["theirs"])
      ).slice().buffer;
      const { adapter } = app.vault;
      const exists = adapter.exists.bind(adapter);
      const land = (): void => {
        void adapter.writeBinary(wanted, theirs).then(made);
      };
      adapter.exists = (asked, sensitive) => {
        if (asked !== wanted) return exists(asked, sensitive);
        Reflect.deleteProperty(adapter, "exists");
        if (moment === "before") land();
        const looking = exists(asked, sensitive);
        if (moment === "after") queueMicrotask(land);
        return looking;
      };
    },
    path,
    when,
  );
}

/**
 * Has Obsidian's adapter answer a look at the disk as on Windows and macOS,
 * whose file systems do not tell names apart by letter case: anything in the
 * vault whose path differs only in letter case is there, as Obsidian 1.13.4's
 * and 1.15.1's `exists` find it there unless asked to tell case apart. The
 * end-to-end tests run on Linux, whose file systems do.
 */
async function lookWithoutCase(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const { adapter } = app.vault;
    const exists = adapter.exists.bind(adapter);
    adapter.exists = async (asked, sensitive) => {
      if (await exists(asked, sensitive)) return true;
      if (sensitive === true) return false;
      const lower = asked.toLowerCase();
      return app.vault
        .getAllLoadedFiles()
        .some((file) => file.path.toLowerCase() === lower);
    };
  });
}

/**
 * Has Obsidian's adapter find something at `path` that Obsidian has not
 * listed, at every look, as a disk that tells letter case apart would for a
 * file just written there from outside Obsidian. Nothing is written, so that
 * Obsidian does not list it meanwhile.
 */
async function unlistedAt(path: string): Promise<void> {
  await browser.executeObsidian(({ app }, wanted) => {
    const { adapter } = app.vault;
    const exists = adapter.exists.bind(adapter);
    adapter.exists = (asked, sensitive) =>
      asked === wanted ? Promise.resolve(true) : exists(asked, sensitive);
  }, path);
}

/** How many bytes the file at `path` holds on the disk, or null. */
async function sizeOnDisk(path: string): Promise<number | null> {
  return browser.executeObsidian(
    async ({ app }, wanted) =>
      (await app.vault.adapter.stat(wanted))?.size ?? null,
    path,
  );
}

/**
 * Has the next write of `path` by Obsidian's file system stop after its first
 * `cut` bytes and fail as on a full disk, leaving those bytes in the file.
 * Taken off by its first such write, or by `undoStubs()`.
 */
async function fillDiskAt(path: string, cut = 64): Promise<void> {
  await browser.executeObsidian(
    ({ app }, wanted, at) => {
      const promises: unknown = Reflect.get(app.vault.adapter, "fsPromises");
      if (typeof promises !== "object" || promises === null) {
        throw new Error("no file system to fill");
      }
      const write: unknown = Reflect.get(promises, "writeFile");
      if (typeof write !== "function") throw new Error("no writeFile");
      const restore = (): void => {
        Reflect.set(promises, "writeFile", write);
        Reflect.deleteProperty(window, "inklineAtEnd-full-disk");
      };
      Reflect.set(window, "inklineAtEnd-full-disk", restore);
      Reflect.set(
        promises,
        "writeFile",
        async (
          full: unknown,
          data: unknown,
          ...rest: unknown[]
        ): Promise<unknown> => {
          if (
            typeof full !== "string" ||
            !full.endsWith(wanted) ||
            !ArrayBuffer.isView(data)
          ) {
            const written: unknown = Reflect.apply(write, promises, [
              full,
              data,
              ...rest,
            ]);
            return written;
          }
          restore();
          const part = new Uint8Array(
            data.buffer,
            data.byteOffset,
            Math.min(at, data.byteLength),
          );
          await Reflect.apply(write, promises, [full, part, ...rest]);
          throw Object.assign(
            new Error("ENOSPC: no space left on device, write"),
            { code: "ENOSPC" },
          );
        },
      );
    },
    path,
    cut,
  );
}

/** Waits for {@link replaceDuringRead}'s new file, and says how it went. */
async function waitForReplaced(): Promise<unknown> {
  let replaced: unknown = false;
  await browser.waitUntil(async () => {
    replaced = await browser.execute((): unknown =>
      Reflect.get(window, "inklineReplaced"),
    );
    return replaced !== false;
  });
  return replaced;
}

describe("A symbol replaced at its path as it is saved", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("inkline-library");
    });
  });

  afterEach(async function () {
    await browser.executeObsidian(({ app }) => {
      Reflect.deleteProperty(app.vault, "readBinary");
      Reflect.deleteProperty(app.vault, "modifyBinary");
      Reflect.deleteProperty(app.vault, "createBinary");
      Reflect.deleteProperty(app.vault, "createFolder");
      Reflect.deleteProperty(app.vault.adapter, "exists");
    });
  });

  const form = () => browser.$(".inkline-library-edit-form");

  /** Opens Quick edit on gate, and types the reading KA. */
  async function typeInLibrary(): Promise<ReturnType<typeof browser.$>> {
    await browser.executeObsidianCommand("inkline:show-library");
    const row = browser.$(
      '.inkline-library-symbol[data-inkline-path="gate.ink.png"]',
    );
    await row.$(".inkline-library-edit").click();
    const save = form().$("button=Save");
    await save.waitForEnabled();
    await form().$('textarea[data-inkline-field="reading"]').setValue("KA");
    return save;
  }

  /** Waits for Quick edit's row to say `text`, of why it was not saved. */
  async function waitForReason(text: string): Promise<void> {
    await browser.waitUntil(async () =>
      (await form().$(".inkline-library-edit-error").getText()).includes(text),
    );
  }

  /** Checks that Quick edit stays, with KA typed, to save again. */
  async function expectFieldsKept(): Promise<void> {
    expect(await form().isExisting()).toBe(true);
    expect(
      await form().$('textarea[data-inkline-field="reading"]').getValue(),
    ).toBe("KA");
  }

  for (const how of ["adapter", "vault"] as const) {
    it(`leaves a new file alone from Quick edit, when the old went through the ${how}`, async function () {
      await createSymbol("gate.ink.png");
      await giveReading("gate.ink.png", "TA");
      const save = await typeInLibrary();
      // A save reads the file twice, and writes after the second read.
      await replaceDuringRead("gate.ink.png", 2, how);
      await save.click();
      expect(await waitForReplaced()).toBe(true);
      await waitForReason("no longer in the vault");
      // The new file keeps what it holds, and what was typed stays to save.
      expect(await readingOf("gate.ink.png")).toEqual(["theirs"]);
      await expectFieldsKept();
    });
  }

  it("leaves a new file alone from the editor, and asks about it", async function () {
    await createSymbol("gate.ink.png");
    await giveReading("gate.ink.png", "TA");
    await editFile("gate.ink.png");
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    // The save looks at the file once, just before it writes.
    await replaceDuringRead("gate.ink.png", 1, "adapter");
    await browser.keys(["Control", "s"]);
    expect(await waitForReplaced()).toBe(true);
    await waitForStatus("Not saved: the file changed on disk");
    expect(await readingOf("gate.ink.png")).toEqual(["theirs"]);
    // The editor is still open, with what was drawn not saved over it.
    expect(await browser.$(".inkline-editor").isExisting()).toBe(true);
  });

  it("asks about a new file that lands as the editor makes a deleted one again", async function () {
    // #379: the same replacement, with the save between its two halves.
    await createSymbol("gate.ink.png");
    await editFile("gate.ink.png");
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.adapter.remove("gate.ink.png");
    });
    await waitForStatus("The file was deleted; saving makes it again");
    await landAt("gate.ink.png", "before");
    await browser.keys(["Control", "s"]);
    expect(await waitForReplaced()).toBe(true);
    // Not Obsidian's "File already exists.": the question a change asks.
    await waitForStatus("Not saved: the file changed on disk");
    expect(await readingOf("gate.ink.png")).toEqual(["theirs"]);
    expect(await strokeCount("gate.ink.png")).toBe(1);
    // Keeping the drawing saves it over the new file, as for any change.
    await clickTop("Keep mine");
    await waitForStatus("Saved");
    expect(await strokeCount("gate.ink.png")).toBe(2);
  });

  it("asks about a new file that lands just after the editor looks, as it makes a deleted one again", async function () {
    // #413: the vault's createBinary would ask for its write behind the new
    // file, and write over it.
    await createSymbol("gate.ink.png");
    await editFile("gate.ink.png");
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.adapter.remove("gate.ink.png");
    });
    await waitForStatus("The file was deleted; saving makes it again");
    await landAt("gate.ink.png", "after");
    await browser.keys(["Control", "s"]);
    expect(await waitForReplaced()).toBe(true);
    await waitForStatus("Not saved: the file changed on disk");
    expect(await readingOf("gate.ink.png")).toEqual(["theirs"]);
    expect(await strokeCount("gate.ink.png")).toBe(1);
    await clickTop("Keep mine");
    await waitForStatus("Saved");
    expect(await strokeCount("gate.ink.png")).toBe(2);
  });

  it("says, in its own words, that a file of the same name in another letter case stands in the way", async function () {
    // #414, as on Windows and macOS: the disk finds Gate.ink.png at
    // gate.ink.png's path, which the vault has nothing at.
    await createSymbol("gate.ink.png");
    await editFile("gate.ink.png");
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.adapter.remove("gate.ink.png");
    });
    await waitForStatus("The file was deleted; saving makes it again");
    await createSymbol("Gate.ink.png");
    await giveReading("Gate.ink.png", "theirs");
    await lookWithoutCase();
    await browser.keys(["Control", "s"]);
    await waitForStatus(
      "Not saved: the vault's top folder has Gate.ink.png, whose name differs from gate.ink.png only in letter case",
    );
    expect(await symbolFiles()).toEqual(["Gate.ink.png"]);
    expect(await readingOf("Gate.ink.png")).toEqual(["theirs"]);
    expect(await browser.$(".inkline-editor").isExisting()).toBe(true);
  });

  it("says that a folder stands at a deleted symbol's path, and calls it one", async function () {
    await createSymbol("gate.ink.png");
    await editFile("gate.ink.png");
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.adapter.remove("gate.ink.png");
    });
    await waitForStatus("The file was deleted; saving makes it again");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.createFolder("gate.ink.png");
    });
    await browser.keys(["Control", "s"]);
    await waitForStatus(
      "Not saved: the vault's top folder already has a folder named gate.ink.png",
    );
    expect(await symbolFiles()).toEqual([]);
  });

  it("names no file in another letter case for one Obsidian has not listed yet", async function () {
    // On a disk that tells letter case apart, Gate.ink.png and gate.ink.png
    // are two files: what stands in the way is the one not listed yet.
    await createSymbol("gate.ink.png");
    await editFile("gate.ink.png");
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.adapter.remove("gate.ink.png");
    });
    await waitForStatus("The file was deleted; saving makes it again");
    await createSymbol("Gate.ink.png");
    await unlistedAt("gate.ink.png");
    await browser.keys(["Control", "s"]);
    await waitForStatus(
      "Not saved: a file came to gate.ink.png that Obsidian has not listed yet, and was left as it is",
    );
    expect(await symbolFiles()).toEqual(["Gate.ink.png"]);
  });

  it("makes a deleted symbol again in a folder that lands as it makes that", async function () {
    await createSymbol("Signs/gate.ink.png");
    await editFile("Signs/gate.ink.png");
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.adapter.rmdir("Signs", true);
    });
    await waitForStatus("The file was deleted; saving makes it again");
    await folderAsMade("Signs");
    await browser.keys(["Control", "s"]);
    expect(await waitForReplaced()).toBe(true);
    // Not Obsidian's "Folder already exists.": the folder does.
    await waitForStatus("Saved");
    expect(await symbolFiles()).toEqual(["Signs/gate.ink.png"]);
    expect(await strokeCount("Signs/gate.ink.png")).toBe(2);
  });

  it("says why it could not make a deleted symbol again, when its write stops part-way, and writes it whole the next time", async function () {
    // The vault has the part that was written before the create fails: the
    // save's own, which it is not to ask about as a file that came meanwhile.
    await createSymbol("gate.ink.png");
    await editFile("gate.ink.png");
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.adapter.remove("gate.ink.png");
    });
    await waitForStatus("The file was deleted; saving makes it again");
    await fillDiskAt("gate.ink.png");
    await browser.keys(["Control", "s"]);
    // The save's own reason, and what the part left is (#425).
    await waitForNotice(
      "Could not save the symbol: ENOSPC: no space left on device, write; gate.ink.png holds what was written before it stopped, which saving again writes whole",
    );
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect(await browser.$(".inkline-editor").isExisting()).toBe(true);
    // The editor knows the part left as its own: the next save, with room on
    // the disk again, writes over it, where it used to refuse every save.
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    expect(await strokeCount("gate.ink.png")).toBe(2);
  });

  it("writes a deleted symbol whole once its writes have stopped part-way twice", async function () {
    // The second write goes over the part the first left, as a save of any
    // file does, and leaves less of other bytes, with a stroke drawn between.
    await createSymbol("gate.ink.png");
    await editFile("gate.ink.png");
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.adapter.remove("gate.ink.png");
    });
    await waitForStatus("The file was deleted; saving makes it again");
    await fillDiskAt("gate.ink.png");
    await browser.keys(["Control", "s"]);
    await waitForNotice(
      "gate.ink.png holds what was written before it stopped, which saving again writes whole",
    );
    await draw([
      [0.3, 0.6],
      [0.6, 0.4],
    ]);
    await fillDiskAt("gate.ink.png", 32);
    await browser.keys(["Control", "s"]);
    await browser.waitUntil(
      async () => (await sizeOnDisk("gate.ink.png")) === 32,
    );
    await waitForStatus(
      "ENOSPC: no space left on device, write; gate.ink.png holds what was written before it stopped",
    );
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect(await strokeCount("gate.ink.png")).toBe(3);
  });

  it("writes a symbol whole on the next save, when its write over the file stops part-way", async function () {
    // #425's title: an ordinary save of a symbol whose file is there.
    await createSymbol("gate.ink.png");
    await editFile("gate.ink.png");
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    await fillDiskAt("gate.ink.png");
    await browser.keys(["Control", "s"]);
    await waitForNotice(
      "Could not save the symbol: ENOSPC: no space left on device, write; gate.ink.png holds what was written before it stopped, which saving again writes whole",
    );
    expect(await sizeOnDisk("gate.ink.png")).toBe(64);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    expect(await strokeCount("gate.ink.png")).toBe(2);
  });

  it("writes a new symbol whole on the next save, when its first write stops part-way", async function () {
    // #425, at a new symbol's first save: the part left is the save's own.
    await insert();
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    await fillDiskAt("001.ink.png");
    await browser.keys(["Control", "s"]);
    await waitForNotice(
      "Could not save the symbol: ENOSPC: no space left on device, write; 001.ink.png holds what was written before it stopped, which saving again writes whole",
    );
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    // That file, not another number, and inserted in the note.
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect(await strokeCount("001.ink.png")).toBe(1);
    expect(await noteText()).toContain("![[001.ink.png]]");
  });

  it("writes a new symbol whole once its first two writes have stopped part-way", async function () {
    // The second save takes the part the first left as the file it made, and
    // writes over it, which stops part-way too.
    await insert();
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    await fillDiskAt("001.ink.png");
    await browser.keys(["Control", "s"]);
    await waitForNotice(
      "001.ink.png holds what was written before it stopped, which saving again writes whole",
    );
    await fillDiskAt("001.ink.png", 32);
    await browser.keys(["Control", "s"]);
    await browser.waitUntil(
      async () => (await sizeOnDisk("001.ink.png")) === 32,
    );
    await waitForStatus(
      "ENOSPC: no space left on device, write; 001.ink.png holds what was written before it stopped",
    );
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect(await strokeCount("001.ink.png")).toBe(1);
    expect(await noteText()).toContain("![[001.ink.png]]");
  });

  // #388: a new symbol's first save, at a path it found free.
  for (const when of ["before", "after"] as const) {
    it(`takes the next number for a new symbol, when a file lands just ${when} its look`, async function () {
      await insert();
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      await landAt("001.ink.png", when);
      await browser.keys(["Control", "s"]);
      expect(await waitForReplaced()).toBe(true);
      await waitForStatus("Saved");
      expect(await symbolFiles()).toEqual(["001.ink.png", "002.ink.png"]);
      expect(await readingOf("001.ink.png")).toEqual(["theirs"]);
      expect(await strokeCount("001.ink.png")).toBe(1);
      expect(await readingOf("002.ink.png")).toEqual([]);
    });
  }

  it("refuses a typed name for a new symbol, when a file lands at it as it is made", async function () {
    await insert();
    await draw([
      [0.5, 0.3],
      [0.7, 0.6],
    ]);
    await nameSymbol("gate");
    await landAt("gate.ink.png", "after");
    await browser.keys(["Control", "s"]);
    expect(await waitForReplaced()).toBe(true);
    await waitForStatus(
      "Not saved: the vault's top folder already has a symbol named gate",
    );
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect(await readingOf("gate.ink.png")).toEqual(["theirs"]);
  });

  it("refuses a write that lands once the file was replaced, and keeps what was typed", async function () {
    await createSymbol("gate.ink.png");
    await giveReading("gate.ink.png", "TA");
    const save = await typeInLibrary();
    // As the review's probe: the write held between Inkline and Obsidian, and
    // the file replaced through the vault meanwhile. Obsidian takes the path
    // as the write reaches it, so this stands for the moment no check can
    // reach, and the write does land on the new file; what is said after it is
    // what this holds.
    await browser.executeObsidian(async ({ app }) => {
      const { canvas, text } = window.inklineTest;
      const { bytes } = await canvas.saveInk({ strokes: [] }, undefined, []);
      const theirs = (
        await text.writeText(bytes, "reading", ["theirs"])
      ).slice().buffer;
      const write = app.vault.modifyBinary.bind(app.vault);
      app.vault.modifyBinary = async (file, data, options) => {
        Reflect.deleteProperty(app.vault, "modifyBinary");
        await app.fileManager.trashFile(file);
        await app.vault.createBinary(file.path, theirs);
        await write(file, data, options);
      };
    });
    await save.click();
    await waitForReason("deleted or replaced as it was written");
    await expectFieldsKept();
  });
});
