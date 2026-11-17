// A symbol's readings and translations in real Obsidian, when only its text
// changes on disk while the editor is open: taken in, asked about, or kept.
// What the file holds is read back with the format's own code, in Obsidian's
// Chromium. All the text is synthetic.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { editFile } from "../support/editing.ts";
import {
  clickTop,
  draw,
  markEditor,
  recordOf,
  startOver,
  storedDrafts,
  symbolFiles,
  topButton,
  waitForNext,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import {
  openFields,
  saveFields,
  showLibrary,
  waitForClosedForm,
} from "../support/symbol-text-library.ts";
import {
  area,
  changeOnDisk,
  fieldsOf,
  fill,
  makeNote,
  newSymbol,
  redrawOnDisk,
  restartInkline,
  saveAndClose,
  saveEditor,
  showFields,
  symbolWith,
  toggle,
} from "../support/symbol-text.ts";

/**
 * Has a sync tool change `file`'s reading just as the next read of the file
 * starts, which is a save's look at it just before it writes: writing to the
 * disk tells the vault at once, so that a change made before a save would be
 * taken in before it starts.
 */
async function changeAtNextRead(file: string, reading: string): Promise<void> {
  await browser.executeObsidian(
    ({ app }, wanted, value) => {
      const read = app.vault.readBinary.bind(app.vault);
      app.vault.readBinary = async (target) => {
        if (target.path !== wanted) return read(target);
        app.vault.readBinary = read;
        const { text } = window.inklineTest;
        const bytes = await text.writeText(
          new Uint8Array(await read(target)),
          "reading",
          [value],
        );
        await app.vault.adapter.writeBinary(wanted, bytes.slice().buffer);
        return read(target);
      };
    },
    file,
    reading,
  );
}

/** What a file holds now, to put back with {@link writeBase64}. */
async function bytesAsBase64(file: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const bytes = new Uint8Array(await app.vault.readBinary(found));
    return btoa(String.fromCharCode(...bytes));
  }, file);
}

/** Puts back what {@link bytesAsBase64} gave. */
async function writeBase64(file: string, held: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, wanted, base64) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      await app.vault.modifyBinary(found, bytes.buffer);
    },
    file,
    held,
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

  describe("in the editor", function () {
    describe("when only its text changes on disk", function () {
      const file = "Sync.ink.png";
      const note = () => browser.$(".inkline-editor .inkline-text-note");

      /** How many strokes the record in `file` holds. */
      async function strokes(): Promise<number> {
        const { strokes: held } = JSON.parse(await recordOf(file)) as {
          strokes: unknown[];
        };
        return held.length;
      }

      /** Whether a modal stands above the editor, as a question does. */
      async function asked(): Promise<boolean> {
        return browser.execute(
          () => document.querySelectorAll(".modal-container").length > 1,
        );
      }

      /** Opens the editor on a symbol, and draws a stroke it does not save. */
      async function withStroke(): Promise<void> {
        await symbolWith(file, { reading: ["TA"], translation: ["field"] });
        await editFile(file);
        await showFields();
        await draw([
          [0.5, 0.3],
          [0.7, 0.6],
        ]);
      }

      /**
       * Has the editor keep its changes as a draft, and turns Inkline off and
       * on, which closes the editor and keeps the draft again as it does. The
       * tests that use this are about the wording of the question that offers
       * the draft, which is the same however the editor went. That a draft
       * kept as the strokes and the text were made comes back after Obsidian
       * itself restarts, with no save under way, is shown by "says to look
       * over text a draft would put back, and restores it after a restart".
       */
      async function leaveDraft(): Promise<void> {
        await browser.waitUntil(
          async () => (await storedDrafts()).length === 1,
        );
        await restartInkline();
      }

      /** What the question about a draft says, once it opens. */
      async function draftQuestion(): Promise<string> {
        await browser.waitUntil(
          async () => (await topButton("Restore")) !== undefined,
        );
        return browser.execute(
          () =>
            [...document.querySelectorAll(".modal-container")].at(-1)
              ?.textContent ?? "",
        );
      }

      it("takes it in without asking, and leaves unsaved strokes alone", async function () {
        await withStroke();
        await changeOnDisk(file, { reading: ["KA"] });
        await browser.waitUntil(
          async () => (await area("reading").getValue()) === "KA",
        );
        await waitForStatus("Readings and translations updated");
        expect(await asked()).toBe(false);
        expect(await area("translation").getValue()).toBe("field");
        await saveAndClose();
        expect(await fieldsOf(file)).toEqual({
          reading: ["KA"],
          translation: ["field"],
        });
        expect(await strokes()).toBe(2);
      });

      it("takes in a save from the library the same way", async function () {
        await symbolWith(file, { reading: ["TA"] });
        await showLibrary();
        await openFields(file);
        await fill("translation", "from the library");
        await editFile(file);
        await showFields();
        await draw([
          [0.5, 0.3],
          [0.7, 0.6],
        ]);
        await browser.execute(saveFields);
        await waitForClosedForm();
        await browser.waitUntil(
          async () =>
            (await area("translation").getValue()) === "from the library",
        );
        expect(await asked()).toBe(false);
        await saveAndClose();
        expect((await fieldsOf(file)).translation).toEqual([
          "from the library",
        ]);
        expect(await strokes()).toBe(2);
      });

      it("reloads nothing with nothing unsaved, so Undo has nothing to take back", async function () {
        await symbolWith(file, { reading: ["TA"] });
        await editFile(file);
        await showFields();
        await changeOnDisk(file, { reading: ["KA"] });
        await waitForStatus("Readings and translations updated");
        expect(await area("reading").getValue()).toBe("KA");
        expect(
          await browser
            .$('[data-inkline-button="undo"]')
            .getProperty("disabled"),
        ).toBe(true);
        // Nothing to save, so nothing is kept as if it were.
        expect(await storedDrafts()).toEqual([]);
      });

      it("keeps what was typed in a field it changed, and says what saving replaces", async function () {
        await symbolWith(file, { reading: ["TA"], translation: ["field"] });
        await editFile(file);
        await showFields();
        await fill("reading", "typed");
        // Closed, to show that the fields open to say so.
        await toggle().click();
        expect(await area("reading").isDisplayed()).toBe(false);
        await changeOnDisk(file, {
          reading: ["theirs"],
          translation: ["plot"],
        });
        await waitForStatus("saving replaces what it now says");
        expect(await asked()).toBe(false);
        expect(await area("reading").isDisplayed()).toBe(true);
        expect(await area("reading").getValue()).toBe("typed");
        expect(await area("translation").getValue()).toBe("plot");
        const said = await note().getText();
        expect(said).toContain("Saving replaces what it now says");
        expect(said).toContain("Reading: theirs");
        expect(said).not.toContain("plot");
        await saveScreenshot("text-editor-replaced");
        // The file keeps its value until a person saves over it.
        expect((await fieldsOf(file)).reading).toEqual(["theirs"]);
        await browser.keys(["Control", "s"]);
        await waitForStatus("Saved");
        expect(await note().getText()).toBe("");
        expect(await fieldsOf(file)).toEqual({
          reading: ["typed"],
          translation: ["plot"],
        });
      });

      it("shows every value saving replaces, however many there are", async function () {
        await symbolWith(file, { reading: ["TA"] });
        await editFile(file);
        await showFields();
        await fill("reading", "typed");
        const theirs = Array.from(
          { length: 12 },
          (_, index) => `theirs${String(index)}`,
        );
        await changeOnDisk(file, { reading: theirs });
        await waitForStatus("saving replaces what it now says");
        const said = await note().getText();
        for (const value of theirs) expect(said).toContain(value);
        expect(said).not.toContain("more");
      });

      it("drops the note once the typing no longer replaces anything", async function () {
        await symbolWith(file, { reading: ["TA"] });
        await editFile(file);
        await showFields();
        await fill("reading", "typed");
        await changeOnDisk(file, { reading: ["theirs"] });
        await waitForStatus("saving replaces what it now says");
        await fill("reading", "theirs");
        await browser.waitUntil(async () => (await note().getText()) === "");
      });

      it("stops a save that finds a change to a field typed in, with nothing written", async function () {
        await symbolWith(file, { reading: ["TA"] });
        await editFile(file);
        await showFields();
        await fill("reading", "typed");
        await changeAtNextRead(file, "theirs");
        await browser.execute(saveEditor);
        await waitForStatus("Not saved: the file changed text you typed");
        expect(await asked()).toBe(false);
        expect((await fieldsOf(file)).reading).toEqual(["theirs"]);
        expect(await note().getText()).toContain("Reading: theirs");
        expect(await area("reading").getValue()).toBe("typed");
        await browser.$('[data-inkline-button="save"]').click();
        await browser.$(".inkline-editor").waitForExist({ reverse: true });
        expect((await fieldsOf(file)).reading).toEqual(["typed"]);
      });

      it("goes on with a save that finds a change it can keep, and closes", async function () {
        await withStroke();
        await changeAtNextRead(file, "KA");
        await browser.execute(saveEditor);
        await browser.$(".inkline-editor").waitForExist({ reverse: true });
        expect(await fieldsOf(file)).toEqual({
          reading: ["KA"],
          translation: ["field"],
        });
        expect(await strokes()).toBe(2);
      });

      it("goes on with Next through a change found as it saves", async function () {
        await newSymbol();
        await draw([
          [0.5, 0.3],
          [0.7, 0.6],
        ]);
        await browser.keys(["Control", "s"]);
        await waitForStatus("Saved");
        await draw([
          [0.2, 0.3],
          [0.3, 0.6],
        ]);
        const [made] = await symbolFiles();
        if (made === undefined) throw new Error("no symbol");
        await changeAtNextRead(made, "KA");
        await markEditor();
        await browser.$('[data-inkline-button="next"]').click();
        await waitForNext(1);
        expect((await fieldsOf(made)).reading).toEqual(["KA"]);
      });

      it("takes in text on top of a change that Keep mine replaces", async function () {
        await withStroke();
        await redrawOnDisk(file, { reading: ["theirs"] });
        await clickTop("Keep mine");
        await browser.waitUntil(
          async () => (await area("reading").getValue()) === "theirs",
        );
        await changeOnDisk(file, { translation: ["plot"] });
        await browser.waitUntil(
          async () => (await area("translation").getValue()) === "plot",
        );
        expect(await asked()).toBe(false);
        await saveAndClose();
        expect(await fieldsOf(file)).toEqual({
          reading: ["theirs"],
          translation: ["plot"],
        });
        // The drawing kept: the first stroke and the new one, not three dots.
        expect(await strokes()).toBe(2);
      });

      it("looks at the file again once a question is answered", async function () {
        await withStroke();
        const original = await bytesAsBase64(file);
        await redrawOnDisk(file, {});
        await browser.waitUntil(
          async () => (await topButton("Keep mine")) !== undefined,
        );
        // Back to the drawing the editor knows, with other text, under the
        // question: what that question read is out of date.
        await writeBase64(file, original);
        await changeOnDisk(file, { reading: ["KA"] });
        await clickTop("Keep mine");
        await browser.waitUntil(
          async () => (await area("reading").getValue()) === "KA",
        );
        await saveAndClose();
        expect((await fieldsOf(file)).reading).toEqual(["KA"]);
        expect(await strokes()).toBe(2);
      });

      it("offers a draft without saying its strokes may not line up", async function () {
        await withStroke();
        await leaveDraft();
        await changeOnDisk(file, { reading: ["KA"] });
        await editFile(file);
        const said = await draftQuestion();
        expect(said).toContain("has unsaved changes");
        expect(said).not.toContain("may not line up");
        expect(said).not.toContain("look over what you typed");
        await clickTop("Restore");
        await saveAndClose();
        expect((await fieldsOf(file)).reading).toEqual(["KA"]);
        expect(await strokes()).toBe(2);
      });

      // A restart of Obsidian, unlike turning Inkline off, closes no editor,
      // so the draft that comes back is the one kept as the stroke was drawn
      // and the text typed, as after a crash. No save is under way, so it is
      // the draft of the drawing as the file holds it.
      it("says to look over text a draft would put back, and restores it after a restart", async function () {
        await withStroke();
        await fill("reading", "typed");
        await browser.waitUntil(
          async () => (await storedDrafts()).length === 1,
        );
        await browser.reloadObsidian();
        await loadModules();
        await changeOnDisk(file, { translation: ["plot"] });
        await editFile(file);
        const said = await draftQuestion();
        expect(said).toContain("look over what you typed");
        expect(said).not.toContain("may not line up");
        await clickTop("Restore");
        await area("reading").waitForDisplayed();
        expect(await area("reading").getValue()).toBe("typed");
        await saveAndClose();
        expect(await fieldsOf(file)).toEqual({
          reading: ["typed"],
          translation: ["plot"],
        });
        expect(await strokes()).toBe(2);
      });

      it("still says so of a draft whose drawing changed", async function () {
        await withStroke();
        await leaveDraft();
        await redrawOnDisk(file, { reading: ["KA"] });
        await editFile(file);
        expect(await draftQuestion()).toContain("may not line up");
      });
    });
  });
});
