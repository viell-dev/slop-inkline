// A symbol's readings and translations in real Obsidian, when two saves of one
// symbol meet, from libraries and editors, and neither is lost. What the file
// holds is read back with the format's own code, in Obsidian's Chromium. All
// the text is synthetic.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  delayVault,
  draw,
  recordOf,
  restoreVault,
  startOver,
  symbolFiles,
  waitForStatus,
} from "../support/editor.ts";
import {
  fieldsInSecondLibrary,
  formError,
  openFields,
  openForms,
  saveFields,
  showLibrary,
  waitForClosedForm,
} from "../support/symbol-text-library.ts";
import {
  editFile,
  fieldsOf,
  fill,
  letWriteGo,
  makeNote,
  saveEditor,
  symbolWith,
} from "../support/symbol-text.ts";

/**
 * Has the next write to the vault start the other of the two saves, and go on
 * only `ms` later, so that the other has every chance to come between its read
 * and its write. `other` says which: `fields` or `editor`.
 */
async function atNextWrite(
  other: "fields" | "editor",
  ms: number,
): Promise<void> {
  await browser.executeObsidian(
    ({ app }, which, wait) => {
      const write = app.vault.modifyBinary.bind(app.vault);
      app.vault.modifyBinary = async (...args) => {
        app.vault.modifyBinary = write;
        if (which === "fields") {
          // The fields still to save, if another library's are busy.
          [
            ...document.querySelectorAll<HTMLFormElement>(
              ".inkline-library-edit-form",
            ),
          ]
            .find(
              (form) =>
                form.querySelector<HTMLButtonElement>("button[type=submit]")
                  ?.disabled === false,
            )
            ?.requestSubmit();
        } else {
          document
            .querySelector<HTMLElement>('[data-inkline-button="save"]')
            ?.click();
        }
        await new Promise((resolve) => window.setTimeout(resolve, wait));
        return write(...args);
      };
    },
    other,
    ms,
  );
}

/** Has the next read of `file` wait for {@link letReadGo}. */
async function holdNextRead(file: string): Promise<void> {
  await browser.executeObsidian(({ app }, wanted) => {
    const held = app.vault.getFileByPath(wanted);
    if (held === null) throw new Error(`no ${wanted}`);
    const read = app.vault.readBinary.bind(app.vault);
    let go = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      go = resolve;
    });
    Reflect.set(window, "inklineLetReadGo", () => {
      go();
    });
    app.vault.readBinary = async (asked) => {
      if (asked !== held) return read(asked);
      app.vault.readBinary = read;
      await gate;
      return read(asked);
    };
  }, file);
}

/** Lets go a read that {@link holdNextRead} held. */
async function letReadGo(): Promise<void> {
  await browser.execute(() => {
    const go: unknown = Reflect.get(window, "inklineLetReadGo");
    Reflect.deleteProperty(window, "inklineLetReadGo");
    if (typeof go !== "function") throw new Error("no held read");
    Reflect.apply(go, undefined, []);
  });
}

/**
 * Answers Keep mine for as long as the editor asks, until it closes. In one step
 * in the page, as a modal that closes under a driver's element holds it up.
 */
async function keepMineUntilClosed(): Promise<void> {
  await browser.waitUntil(async () =>
    browser.execute(() => {
      const top = [...document.querySelectorAll(".modal-container")].at(-1);
      [...(top?.querySelectorAll("button") ?? [])]
        .find((button) => button.textContent === "Keep mine")
        ?.click();
      return document.querySelector(".inkline-editor") === null;
    }),
  );
}

describe("A symbol's readings and translations", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("inkline-library");
    });
    await makeNote();
  });

  // The stubs below take themselves away only when the call they wait for
  // comes, which a failed test may never make: one left behind would hold up
  // or change the reads and writes of every later test.
  afterEach(async function () {
    await browser.execute(() => {
      const go: unknown = Reflect.get(window, "inklineLetReadGo");
      Reflect.deleteProperty(window, "inklineLetReadGo");
      if (typeof go === "function") Reflect.apply(go, undefined, []);
    });
    await letWriteGo();
    await restoreVault();
    await browser.executeObsidian(({ app }) => {
      Reflect.deleteProperty(app.vault, "readBinary");
      Reflect.deleteProperty(app.vault, "modifyBinary");
    });
  });

  describe("in the library", function () {
    /**
     * Opens `file`'s fields in two libraries, types each value in its own, and
     * saves both at once, with each write taking long enough for the other to
     * read the file first, if nothing stops it.
     */
    async function saveTwice(
      file: string,
      first: readonly [field: string, text: string],
      second: readonly [field: string, text: string],
    ): Promise<void> {
      await browser.executeObsidian(async ({ app }) => {
        await app.workspace
          .getLeaf("split")
          .setViewState({ type: "inkline-library", active: false });
      });
      const buttons = `.inkline-library-symbol[data-inkline-path="${file}"] [data-inkline-role="edit"]`;
      await browser.waitUntil(
        async () => (await browser.$$(buttons).length) === 2,
      );
      const saves = ".inkline-library-edit-buttons button[type=submit]";
      await browser.execute((selector) => {
        for (const button of document.querySelectorAll<HTMLElement>(selector)) {
          button.click();
        }
      }, buttons);
      await browser.waitUntil(async () =>
        browser.execute((selector) => {
          const found = document.querySelectorAll<HTMLButtonElement>(selector);
          return found.length === 2 && [...found].every((b) => !b.disabled);
        }, saves),
      );
      await delayVault("modifyBinary", 300, "before");
      await browser.execute(
        (values) => {
          const forms = document.querySelectorAll<HTMLFormElement>(
            ".inkline-library-edit-form",
          );
          forms.forEach((form, index) => {
            const [field, text] = values[index] ?? [];
            const found = form.querySelector<HTMLTextAreaElement>(
              `textarea[data-inkline-field="${field ?? ""}"]`,
            );
            if (found === null) throw new Error("no field");
            found.value = text ?? "";
            found.dispatchEvent(new Event("input", { bubbles: true }));
          });
          for (const form of forms) form.requestSubmit();
        },
        [first, second],
      );
    }

    it("keeps both of two saves of one symbol, whichever writes last", async function () {
      await symbolWith("Both.ink.png", {
        reading: ["TA"],
        translation: ["field"],
      });
      await showLibrary();
      await saveTwice(
        "Both.ink.png",
        ["reading", "FIRST"],
        ["translation", "SECOND"],
      );
      await waitForClosedForm();
      await restoreVault();
      expect(await fieldsOf("Both.ink.png")).toEqual({
        reading: ["FIRST"],
        translation: ["SECOND"],
      });
    });

    it("has an editor's save take in what a library's wrote ahead of it, without asking", async function () {
      await symbolWith("Library first.ink.png", {
        reading: ["TA"],
        translation: ["field"],
      });
      await showLibrary();
      await openFields("Library first.ink.png");
      await fill("reading", "typed");
      await editFile("Library first.ink.png");
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      const before = await recordOf("Library first.ink.png");
      // As the library starts to write, the editor saves too.
      await atNextWrite("editor", 300);
      await browser.execute(saveFields);
      await browser.$(".inkline-editor").waitForExist({ reverse: true });
      expect(await fieldsOf("Library first.ink.png")).toEqual({
        reading: ["typed"],
        translation: ["field"],
      });
      expect(await recordOf("Library first.ink.png")).not.toBe(before);
    });

    /**
     * Has a library's save of `file` hold the line for writes, on its read, with
     * an editor's save of a new stroke waiting behind it. Returns the record the
     * file had. Runs `meanwhile` as they wait, then the read goes on.
     */
    async function saveBehindLibrary(
      file: string,
      field: "reading" | "translation",
      text: string,
      meanwhile: () => Promise<void>,
    ): Promise<string> {
      await showLibrary();
      await openFields(file);
      await fill(field, text);
      await editFile(file);
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      const before = await recordOf(file);
      await holdNextRead(file);
      await browser.execute(saveFields);
      await browser.execute(saveEditor);
      await waitForStatus("Saving");
      // Long enough for the drawing to be encoded and the save to join the line.
      await browser.pause(500);
      await meanwhile();
      await letReadGo();
      return before;
    }

    it("keeps a library's save of a file put back while the editor's waited", async function () {
      const file = "Replaced.ink.png";
      await symbolWith(file, { reading: ["TA"], translation: ["field"] });
      const before = await saveBehindLibrary(
        file,
        "translation",
        "goes with the old file",
        async () => {
          // As sync can: the file goes, and the same bytes come back as a new one.
          await browser.executeObsidian(async ({ app }, wanted) => {
            const old = app.vault.getFileByPath(wanted);
            if (old === null) throw new Error(`no ${wanted}`);
            const bytes = await app.vault.adapter.readBinary(wanted);
            await app.fileManager.trashFile(old);
            while (app.vault.getFileByPath(wanted) !== null) {
              await new Promise((resolve) => window.setTimeout(resolve, 10));
            }
            await app.vault.createBinary(wanted, bytes);
          }, file);
          await fieldsInSecondLibrary(file, "reading", "typed");
          // As the editor starts to write, the second library saves too.
          await atNextWrite("fields", 300);
        },
      );
      await browser.$(".inkline-editor").waitForExist({ reverse: true });
      await browser.waitUntil(async () => (await openForms()) === 1);
      // The first library's save was of the file that went, so it is refused.
      expect(await formError().getText()).toContain("no longer in the vault");
      expect(await fieldsOf(file)).toEqual({
        reading: ["typed"],
        translation: ["field"],
      });
      expect(await recordOf(file)).not.toBe(before);
    });

    it("loses no save to a rename while saves wait, under either name", async function () {
      const file = "Before.ink.png";
      const moved = "After.ink.png";
      await symbolWith(file, { reading: ["TA"], translation: ["field"] });
      const before = await saveBehindLibrary(
        file,
        "translation",
        "FIRST",
        async () => {
          await browser.executeObsidian(
            async ({ app }, from, to) => {
              const found = app.vault.getFileByPath(from);
              if (found === null) throw new Error(`no ${from}`);
              await app.vault.rename(found, to);
            },
            file,
            moved,
          );
          await fieldsInSecondLibrary(moved, "reading", "SECOND");
          // Long enough for either to read before the other writes, if it can.
          await delayVault("modifyBinary", 300, "before");
          await browser.execute(() => {
            [
              ...document.querySelectorAll<HTMLFormElement>(
                ".inkline-library-edit-form",
              ),
            ]
              .find(
                (form) =>
                  form.querySelector<HTMLButtonElement>("button[type=submit]")
                    ?.disabled === false,
              )
              ?.requestSubmit();
          });
        },
      );
      // The first library's save goes ahead of the editor's, which asks.
      await keepMineUntilClosed();
      await waitForClosedForm();
      await restoreVault();
      expect(await symbolFiles()).toEqual([moved]);
      expect(await fieldsOf(moved)).toEqual({
        reading: ["SECOND"],
        translation: ["FIRST"],
      });
      expect(await recordOf(moved)).not.toBe(before);
    });

    it("makes a deleted file once for two editors, and the other asks", async function () {
      const file = "Symbols/Twice.ink.png";
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.createFolder("Symbols");
      });
      await symbolWith(file, { reading: ["TA"] });
      await editFile(file);
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      await browser.executeObsidian(({ app, plugins }, wanted) => {
        const found = app.vault.getFileByPath(wanted);
        if (found === null) throw new Error(`no ${wanted}`);
        void plugins.inkline.editSymbol(found);
      }, file);
      await browser.waitUntil(
        async () => (await browser.$$(".inkline-editor").length) === 2,
      );
      // The later editor changes a value, as its surface is under no pointer.
      await browser.execute(() => {
        [...document.querySelectorAll<HTMLElement>(".inkline-text-toggle")]
          .at(-1)
          ?.click();
      });
      await browser.waitUntil(async () =>
        browser.execute(() => {
          const area = [
            ...document.querySelectorAll<HTMLTextAreaElement>(
              'textarea[data-inkline-field="reading"]',
            ),
          ].at(-1);
          if (area === undefined) return false;
          area.value = "LATER";
          area.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }),
      );
      const before = await recordOf(file);
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.adapter.rmdir("Symbols", true);
      });
      await browser.waitUntil(
        async () => !(await symbolFiles()).includes(file),
      );
      await browser.execute(() => {
        for (const button of document.querySelectorAll<HTMLElement>(
          '[data-inkline-button="save"]',
        )) {
          button.click();
        }
      });
      // The drawn one first gives the other a changed drawing, which it asks
      // about. The other first changes only text, which the drawn one builds on.
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            document.querySelector(".inkline-editor") === null ||
            [...document.querySelectorAll("button")].some(
              (button) => button.textContent === "Keep mine",
            ),
        ),
      );
      const asked = await browser.execute(
        () => document.querySelector(".inkline-editor") !== null,
      );
      expect(await symbolFiles()).toEqual([file]);
      if (asked) {
        // Whichever got there first made the file, and the other wrote nothing.
        expect(await recordOf(file)).not.toBe(before);
        expect((await fieldsOf(file)).reading).toEqual(["TA"]);
      } else {
        expect(await recordOf(file)).not.toBe(before);
      }
      await keepMineUntilClosed();
      expect(await symbolFiles()).toEqual([file]);
      expect((await fieldsOf(file)).reading).toEqual(["LATER"]);
    });
  });
});
