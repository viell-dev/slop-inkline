import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  openAtMarker,
  settledSurface,
  startOver,
  storedDrafts,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** What the file chooser holds after a choice: its value and its files. */
interface Chooser {
  /** Whether the chooser is in the window the editor is in. */
  readonly here: boolean;
  readonly value: string;
  readonly files: number;
}

/**
 * Gives the editor's file chooser, in the window the editor is in, a file as
 * the system's file dialog does once one is chosen: a synthetic picture all in
 * one colour, or text that is no picture.
 */
async function choose(kind: "red" | "blue" | "text"): Promise<Chooser> {
  return browser.execute(async (what) => {
    const doc = activeDocument;
    const view = doc.defaultView;
    if (view === null) throw new Error("no window");
    const input = doc.querySelector(
      '.inkline-editor .inkline-picture input[type="file"]',
    );
    if (input?.instanceOf(HTMLInputElement) !== true) {
      throw new Error("no file chooser");
    }
    const blob =
      what === "text"
        ? new Blob(["not a picture"], { type: "text/plain" })
        : await window.inklineTest.pictures.picture(60, 40, what);
    const transfer = new view.DataTransfer();
    transfer.items.add(
      new view.File([blob], `${what}.png`, { type: "image/png" }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new view.Event("change"));
    return {
      here: input.ownerDocument === doc,
      value: input.value,
      files: input.files.length,
    };
  }, kind);
}

/** Which of a red and a blue picture the drawing area shows. */
async function pictureShown(): Promise<{ red: boolean; blue: boolean }> {
  return browser.execute(() => {
    const canvas = activeDocument.querySelector(
      ".inkline-editor .inkline-surface",
    );
    if (canvas?.instanceOf(HTMLCanvasElement) !== true) {
      throw new Error("no surface");
    }
    const { shown } = window.inklineTest.pictures;
    return {
      red: shown(canvas, "red") !== undefined,
      blue: shown(canvas, "blue") !== undefined,
    };
  });
}

/** Whether the drawing area has the focus. */
async function surfaceFocused(): Promise<boolean> {
  return browser.execute(
    () =>
      activeDocument.activeElement?.matches(
        ".inkline-editor .inkline-surface",
      ) === true,
  );
}

/** Puts the focus on Choose picture, as Tab or a click does before a dialog. */
async function focusChooseButton(): Promise<void> {
  await browser.execute(() => {
    const button = activeDocument.querySelector(
      '[data-inkline-button="choose"]',
    );
    if (button?.instanceOf(HTMLElement) !== true) throw new Error("no button");
    button.focus();
  });
}
/** Whether the picture bar's Move button can be used, as with a picture. */
async function canMove(): Promise<boolean> {
  return browser.execute(
    () =>
      activeDocument
        .querySelector('[data-inkline-button="move"]')
        ?.hasAttribute("disabled") === false,
  );
}

async function openEditor(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await settledSurface();
}

describe("Choose picture", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
  });
  after(async function () {
    await startOver();
  });

  it("opens the system's file dialog from its button, and says so in its hint", async function () {
    await openEditor();
    const hint = await browser.$(".inkline-picture-hint").getText();
    expect(hint).toBe("Paste, drop, or choose a picture to trace over it.");
    // The dialog itself is the system's; the button asks the chooser for it.
    await browser.execute(() => {
      const input = activeDocument.querySelector(
        '.inkline-editor .inkline-picture input[type="file"]',
      );
      if (input?.instanceOf(HTMLInputElement) !== true) {
        throw new Error("no file chooser");
      }
      input.click = () => {
        Reflect.set(window, "inklineChooserOpened", input.accept);
      };
    });
    const button = browser.$('[data-inkline-button="choose"]');
    expect(await button.getText()).toBe("Choose picture…");
    expect(await button.getAttribute("aria-label")).toContain(
      "open a picture file to trace over",
    );
    await button.click();
    expect(
      await browser.execute((): unknown =>
        Reflect.get(window, "inklineChooserOpened"),
      ),
    ).toBe("image/*");
    // The chooser is hidden, and out of the Tab order.
    const chooser = browser.$(
      '.inkline-editor .inkline-picture input[type="file"]',
    );
    expect(await chooser.isDisplayed()).toBe(false);
    expect(await chooser.getAttribute("tabindex")).toBe("-1");
  });

  it("traces a chosen picture as a pasted one, and says when it cannot", async function () {
    await openEditor();
    expect(await canMove()).toBe(false);
    const chosen = await choose("red");
    // Emptied after each choice, so that choosing the same file again is a
    // change too; the system's own dialog is outside what this can show.
    expect(chosen).toEqual({ here: true, value: "", files: 0 });
    await waitForStatus("Tracing over the picture");
    await browser.waitUntil(canMove);
    await browser.waitUntil(async () => (await pictureShown()).red);
    await saveScreenshot("choose-picture");
    // A file that is no picture leaves the one traced.
    await choose("text");
    await waitForStatus("Not traced: Inkline cannot read this picture");
    expect(await pictureShown()).toEqual({ red: true, blue: false });
    // Another choice replaces it.
    await choose("blue");
    await browser.waitUntil(async () => {
      const shown = await pictureShown();
      return shown.blue && !shown.red;
    });
  });

  it("gives the focus back to the drawing after a choice or a cancel", async function () {
    await openEditor();
    await draw([
      [0.3, 0.3],
      [0.6, 0.6],
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    await focusChooseButton();
    await choose("red");
    await browser.waitUntil(surfaceFocused);
    await browser.waitUntil(async () => (await pictureShown()).red);
    // Cancelling the dialog keeps the picture and the drawing.
    await focusChooseButton();
    expect(await surfaceFocused()).toBe(false);
    await browser.execute(() => {
      const view = activeDocument.defaultView;
      const input = activeDocument.querySelector(
        '.inkline-editor .inkline-picture input[type="file"]',
      );
      if (view === null || input === null) throw new Error("no file chooser");
      input.dispatchEvent(new view.Event("cancel"));
    });
    await browser.waitUntil(surfaceFocused);
    expect((await pictureShown()).red).toBe(true);
    expect((await storedDrafts())[0]?.strokes).toHaveLength(1);
  });
  it("chooses in the window the editor is in", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Editor.md");
      if (file === null) throw new Error("no Editor.md");
      await app.workspace.openPopoutLeaf().openFile(file);
    });
    try {
      await browser.waitUntil(async () =>
        browser.executeObsidian(({ app, obsidian }) => {
          const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
          return (
            view !== null &&
            view.containerEl.doc !== document &&
            view.editor.getValue().includes("HERE")
          );
        }),
      );
      await browser.executeObsidian(({ app, obsidian }) => {
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (view === null) throw new Error("no popout");
        const editor = view.editor;
        const at = editor.getValue().indexOf("HERE");
        editor.setSelection(editor.offsetToPos(at), editor.offsetToPos(at + 4));
        editor.replaceSelection("");
        editor.focus();
      });
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            activeDocument !== document &&
            activeDocument.querySelector(".inkline-editor .inkline-surface") !==
              null,
        ),
      );
      expect((await choose("red")).here).toBe(true);
      await browser.waitUntil(canMove);
    } finally {
      // Disabling Inkline closes the popout's editor; then the popout goes.
      await obsidianPage.disablePlugin("inkline");
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
      await browser.executeObsidian(({ app }) => {
        for (const leaf of app.workspace.getLeavesOfType("markdown")) {
          if (leaf.view.containerEl.doc !== document) leaf.detach();
        }
      });
    }
  });
});
