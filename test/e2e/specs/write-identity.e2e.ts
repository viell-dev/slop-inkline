// A symbol deleted and replaced at its path while Inkline saves it, in real
// Obsidian. Obsidian runs every read, write, and deletion of the vault's files
// in one line, one after another, and takes the file's path, not the file, when
// a write joins it. So something another plugin or a sync tool asks of the disk
// while a save reads the file for the last time runs after that read and before
// the save's write, and a deletion and a new file there are what the write then
// lands on. Nothing here holds a step: the line keeps its own order. Every
// symbol is synthetic.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  createSymbol,
  draw,
  editFile,
  startOver,
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
