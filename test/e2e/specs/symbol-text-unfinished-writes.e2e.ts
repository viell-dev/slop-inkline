// A symbol's readings and translations in real Obsidian, when Obsidian does not
// finish a write: what the library and the editor say, and what they keep. What
// the file holds is read back with the format's own code, in Obsidian's
// Chromium. All the text is synthetic.

import { browser, expect } from "@wdio/globals";
import { stalledAfter } from "../../../src/notes/file-writes.ts";
import { loadModules } from "../support/browser.ts";
import { editFile } from "../support/editing.ts";
import {
  clickTop,
  createSymbol,
  delayVault,
  draw,
  fillStorage,
  freeStorage,
  recordOf,
  restoreVault,
  startOver,
  symbolFiles,
  waitForNotice,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import {
  fieldsInSecondLibrary,
  formSave,
  openFields,
  openForms,
  saveFields,
  showLibrary,
  waitForClosedForm,
  waitForValues,
} from "../support/symbol-text-library.ts";
import {
  fieldsOf,
  fill,
  letWriteGo,
  makeNote,
  newSymbol,
  symbolWith,
} from "../support/symbol-text.ts";
import { bytesOf } from "../support/vault-files.ts";

/**
 * Has the next write to the vault wait for {@link letWriteGo}, as one on a drive
 * that has stopped answering does, and returns once it is waiting.
 */
async function holdNextWrite(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const write = app.vault.modifyBinary.bind(app.vault);
    let go = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      go = resolve;
    });
    Reflect.set(window, "inklineLetWriteGo", () => {
      go();
    });
    app.vault.modifyBinary = async (...args) => {
      app.vault.modifyBinary = write;
      Reflect.set(window, "inklineWriteHeld", true);
      await gate;
      return write(...args);
    };
  });
}

/** Waits for a write that {@link holdNextWrite} set up to reach the vault. */
async function waitForHeldWrite(): Promise<void> {
  await browser.waitUntil(async () =>
    browser.execute(() => Reflect.get(window, "inklineWriteHeld") === true),
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

  describe("when Obsidian does not finish a write", function () {
    /** Long enough for a save to have waited, with a margin for a busy machine. */
    const waited = stalledAfter + 15_000;

    const editorWait = () => browser.$(".inkline-editor .inkline-save-wait");

    /** The form with `typed` as its reading, marked for the driver to find. */
    function form(typed: string): ReturnType<typeof browser.$> {
      return browser.$(`[data-test-form="${typed}"]`);
    }

    const formButton = (typed: string, text: "Save" | "Cancel") =>
      form(typed).$(`button=${text}`);

    /** Marks the form with `typed` as its reading for {@link form}. */
    async function markForm(typed: string): Promise<void> {
      await browser.execute((wanted) => {
        for (const area of document.querySelectorAll<HTMLTextAreaElement>(
          'textarea[data-inkline-field="reading"]',
        )) {
          if (area.value === wanted) {
            area.closest("form")?.setAttribute("data-test-form", wanted);
          }
        }
      }, typed);
    }

    /** Waits for that form to say its save waits, and returns what it says. */
    async function waitForFormWait(typed: string): Promise<string> {
      const wait = form(typed).$(".inkline-save-wait");
      await browser.waitUntil(async () => (await wait.getText()) !== "", {
        timeout: waited,
        timeoutMsg: `the form with ${typed} never said its save waits`,
      });
      return wait.getText();
    }

    /**
     * Has a library's save of `Held.ink.png` hold the line for writes, at its
     * write, and opens the fields of `Other.ink.png` in a second library, with
     * `typed` in them.
     */
    async function behindHeldWrite(typed: string): Promise<void> {
      await symbolWith("Held.ink.png", { reading: ["TA"] });
      await symbolWith("Other.ink.png", { reading: ["DA"] });
      await showLibrary();
      await openFields("Held.ink.png");
      await fill("reading", "FIRST");
      await holdNextWrite();
      await browser.execute(saveFields);
      await waitForHeldWrite();
      await fieldsInSecondLibrary("Other.ink.png", "reading", typed);
      await markForm(typed);
    }

    /** Has the editor save `file`'s new stroke, and hold that at its write. */
    async function editorHeldAtWrite(file: string): Promise<void> {
      await editFile(file);
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      await holdNextWrite();
      await browser.keys(["Control", "s"]);
      await waitForHeldWrite();
    }

    /** Waits for the editor to say its save waits, and returns what it says. */
    async function waitForEditorWait(): Promise<string> {
      await browser.waitUntil(
        async () => (await editorWait().getText()) !== "",
        {
          timeout: waited,
          timeoutMsg: "the editor never said its save waits",
        },
      );
      return editorWait().getText();
    }

    /** How many strokes the record in `file` holds. */
    async function strokesIn(file: string): Promise<number> {
      const { strokes } = JSON.parse(await recordOf(file)) as {
        strokes: unknown[];
      };
      return strokes.length;
    }

    /**
     * The steps of "shows nothing for a save that takes less than the wait",
     * with its watch on the page set.
     */
    async function shownNothingWhileSaving(file: string): Promise<void> {
      await openFields(file);
      await fill("reading", "typed");
      await delayVault("modifyBinary", stalledAfter / 2, "before");
      await formSave().click();
      await waitForClosedForm();
      await editFile(file);
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await restoreVault();
      expect((await fieldsOf(file)).reading).toEqual(["typed"]);
      expect(
        await browser.execute(
          () => Reflect.get(window, "inklineSawWait") === true,
        ),
      ).toBe(false);
      expect(await browser.$(".notice*=Saved Slow").isExisting()).toBe(false);
    }

    it("shows nothing for a save that takes less than the wait", async function () {
      const file = "Slow.ink.png";
      await symbolWith(file, { reading: ["TA"] });
      await showLibrary();
      await browser.execute(() => {
        const watching = new MutationObserver(() => {
          const shown = document.querySelector(".inkline-save-wait");
          if (shown !== null && shown.textContent !== "") {
            Reflect.set(window, "inklineSawWait", true);
          }
        });
        watching.observe(document.body, {
          childList: true,
          characterData: true,
          subtree: true,
        });
        Reflect.set(window, "inklineWaitWatch", watching);
      });
      try {
        await shownNothingWhileSaving(file);
      } finally {
        await browser.execute(() => {
          const watching: unknown = Reflect.get(window, "inklineWaitWatch");
          Reflect.deleteProperty(window, "inklineWaitWatch");
          Reflect.deleteProperty(window, "inklineSawWait");
          if (watching instanceof MutationObserver) watching.disconnect();
        });
      }
    });

    it("tells a form behind a held write, keeps what was typed, and saves when the write ends", async function () {
      await behindHeldWrite("typed");
      await formButton("typed", "Save").click();
      const said = await waitForFormWait("typed");
      expect(said).toContain("Waiting for Obsidian to finish writing a file.");
      expect(said).toContain("goes on by itself when it does");
      expect(said).toContain("copy what you typed and restart Obsidian");
      expect(said).toContain("Cancel closes this, and stops the save");
      await saveScreenshot("save-wait-library", form("typed"));
      // What was typed is there to copy, from the field that has the focus.
      const shown = await browser.execute(() => {
        const active = document.activeElement;
        if (active?.tagName !== "TEXTAREA") return undefined;
        const area = active as HTMLTextAreaElement;
        area.select();
        return {
          selected: area.value.slice(area.selectionStart, area.selectionEnd),
          readOnly: area.readOnly,
        };
      });
      expect(shown).toEqual({ selected: "typed", readOnly: true });
      expect(await formButton("typed", "Save").isEnabled()).toBe(false);
      expect(await formButton("typed", "Cancel").isEnabled()).toBe(true);
      expect((await fieldsOf("Other.ink.png")).reading).toEqual(["DA"]);
      await letWriteGo();
      await waitForClosedForm();
      expect((await fieldsOf("Held.ink.png")).reading).toEqual(["FIRST"]);
      expect((await fieldsOf("Other.ink.png")).reading).toEqual(["typed"]);
      await waitForNotice("Saved Other");
      await waitForValues("Other.ink.png", "typed");
    });

    for (const [how, leave] of [
      ["Cancel", async (typed: string) => formButton(typed, "Cancel").click()],
      ["Esc", async () => browser.keys(["Escape"])],
    ] as const) {
      it(`leaves a save behind a held write with ${how}, which then writes nothing`, async function () {
        await behindHeldWrite("dropped");
        const before = await bytesOf("Other.ink.png");
        await formButton("dropped", "Save").click();
        await waitForFormWait("dropped");
        await leave("dropped");
        await browser.waitUntil(async () => (await openForms()) === 1);
        await letWriteGo();
        await waitForClosedForm();
        expect((await fieldsOf("Held.ink.png")).reading).toEqual(["FIRST"]);
        expect(await bytesOf("Other.ink.png")).toBe(before);
      });
    }

    it("lets a form with its own write held close, and says it may still finish", async function () {
      const file = "Own.ink.png";
      await symbolWith(file, { reading: ["TA"] });
      await showLibrary();
      await openFields(file);
      await fill("reading", "typed");
      await markForm("typed");
      await holdNextWrite();
      await formButton("typed", "Save").click();
      await waitForHeldWrite();
      await waitForFormWait("typed");
      await formButton("typed", "Cancel").click();
      await waitForClosedForm();
      await waitForNotice("may still finish");
      expect((await fieldsOf(file)).reading).toEqual(["TA"]);
      await letWriteGo();
      await waitForNotice("Saved Own");
      expect((await fieldsOf(file)).reading).toEqual(["typed"]);
      await waitForValues(file, "typed");
    });

    it("says so in the editor, goes on drawing, and ends with the write", async function () {
      const file = "Drawn.ink.png";
      await createSymbol(file);
      await editorHeldAtWrite(file);
      await waitForStatus("Saving");
      const said = await waitForEditorWait();
      expect(said).toContain("Waiting for Obsidian to finish writing a file.");
      expect(said).toContain("goes on by itself when it does");
      expect(said).toContain("Your strokes are safe in a draft");
      expect(said).toContain("restart Obsidian and open this symbol again");
      await saveScreenshot("save-wait-editor");
      await draw([
        [0.2, 0.3],
        [0.3, 0.6],
      ]);
      // Other news in the status line leaves what it says in place, as does
      // trying to close, which a save still under way refuses.
      await browser.keys(["Escape"]);
      await waitForStatus("Saving");
      expect(await editorWait().getText()).toBe(said);
      expect(await browser.$(".inkline-editor").isExisting()).toBe(true);
      expect(await strokesIn(file)).toBe(1);
      await letWriteGo();
      await waitForStatus("Saved");
      expect(await editorWait().getText()).toBe("");
      expect(await strokesIn(file)).toBe(2);
      await browser.keys(["Control", "s"]);
      await browser.waitUntil(async () => (await strokesIn(file)) === 3);
    });

    it("says how a new symbol's strokes come back", async function () {
      await newSymbol();
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      await delayVault("createBinary", stalledAfter + 1500, "before");
      await browser.keys(["Control", "s"]);
      expect(await waitForEditorWait()).toContain(
        "restart Obsidian and start a new symbol in this note",
      );
      await waitForStatus("Saved");
      expect(await editorWait().getText()).toBe("");
    });

    it("gives the strokes back after a restart, where the message says", async function () {
      const file = "Restarted.ink.png";
      await createSymbol(file);
      const before = await recordOf(file);
      await editorHeldAtWrite(file);
      await waitForEditorWait();
      await draw([
        [0.2, 0.3],
        [0.3, 0.6],
      ]);
      await browser.reloadObsidian();
      await loadModules();
      expect(await recordOf(file)).toBe(before);
      await editFile(file);
      await clickTop("Restore");
      await browser.keys(["Control", "Enter"]);
      await browser.$(".inkline-editor").waitForExist({ reverse: true });
      expect(await strokesIn(file)).toBe(3);
    });

    it("does not call the strokes safe when no draft could be kept", async function () {
      const file = "Unkept.ink.png";
      await createSymbol(file);
      await editFile(file);
      await fillStorage();
      await draw([
        [0.5, 0.3],
        [0.7, 0.6],
      ]);
      await holdNextWrite();
      await browser.keys(["Control", "s"]);
      await waitForHeldWrite();
      const said = await waitForEditorWait();
      await freeStorage();
      expect(said).toContain("could not be kept in a draft");
      expect(said).not.toContain("safe");
      await letWriteGo();
      await waitForStatus("Saved");
    });

    it("leaves a rename free while a write is held", async function () {
      await behindHeldWrite("unused");
      // Both libraries are busy with fields, so a third does the renaming.
      await browser.executeObsidian(async ({ app }) => {
        await app.workspace
          .getLeaf("split")
          .setViewState({ type: "inkline-library", active: false });
      });
      // Only a Quick edit whose form is closed: one that is open would close.
      const button =
        '[data-inkline-path="Other.ink.png"] [data-inkline-role="edit"][aria-expanded="false"]';
      // The third library's form is the one with nothing typed in it, once its
      // fields have read the file and Save can go: the second has a reading.
      await browser.waitUntil(async () =>
        browser.execute((selector) => {
          for (const found of document.querySelectorAll<HTMLElement>(
            selector,
          )) {
            found.click();
          }
          return [
            ...document.querySelectorAll<HTMLFormElement>(
              ".inkline-library-edit-form",
            ),
          ].some(
            (form) =>
              form.querySelector<HTMLTextAreaElement>("textarea")?.value ===
                "DA" &&
              form.querySelector<HTMLButtonElement>("button[type=submit]")
                ?.disabled === false,
          );
        }, button),
      );
      await browser.execute(() => {
        const renaming = [
          ...document.querySelectorAll<HTMLFormElement>(
            ".inkline-library-edit-form",
          ),
        ].find(
          (form) =>
            form.querySelector<HTMLTextAreaElement>("textarea")?.value === "DA",
        );
        const name = renaming?.querySelector("input");
        if (renaming === undefined || name === null || name === undefined) {
          throw new Error("no form to rename in");
        }
        name.value = "Renamed";
        renaming.requestSubmit();
      });
      await browser.waitUntil(async () =>
        (await symbolFiles()).includes("Renamed.ink.png"),
      );
    });
  });
});
