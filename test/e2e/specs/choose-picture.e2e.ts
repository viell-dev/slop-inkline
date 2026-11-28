import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { encodePng } from "../../support/png.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  openAtMarker,
  settledSurface,
  startOver,
  storedDrafts,
  symbolFiles,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import type { Box } from "../support/pointer.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import { near } from "../support/tracing.ts";
import { waitOrSay } from "../support/waits.ts";

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
async function chooseFromFileInput(
  kind: "red" | "blue" | "text",
): Promise<Chooser> {
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

/**
 * Gives the editor's file chooser the vault file at `path`, as the system's
 * file dialog does once that file is chosen.
 */
async function chooseVaultFile(path: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, filePath) => {
    const doc = activeDocument;
    const view = doc.defaultView;
    if (view === null) throw new Error("no window");
    const input = doc.querySelector(
      '.inkline-editor .inkline-picture input[type="file"]',
    );
    if (input?.instanceOf(HTMLInputElement) !== true) {
      throw new Error("no file chooser");
    }
    const file = app.vault.getFileByPath(filePath);
    if (file === null) throw new Error(`no ${filePath}`);
    const bytes = await app.vault.readBinary(file);
    const transfer = new view.DataTransfer();
    transfer.items.add(
      new view.File([bytes], file.name, { type: "image/png" }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new view.Event("change"));
  }, path);
}

/**
 * Where the drawing area shows anything but its guides, in its device
 * pixels: the ink, or the picture where there is none.
 */
async function drawnOnSurface(): Promise<Box | undefined> {
  const box = await browser.execute(() => {
    const canvas = activeDocument.querySelector(
      ".inkline-editor .inkline-surface",
    );
    if (canvas?.instanceOf(HTMLCanvasElement) !== true) {
      throw new Error("no surface");
    }
    // WebDriver hands back undefined as null.
    return window.inklineTest.pictures.drawnBox(canvas) ?? null;
  });
  return box ?? undefined;
}

/** Which of a red and a blue picture the drawing area shows. */
async function pictureColoursShown(): Promise<{ red: boolean; blue: boolean }> {
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
    const chosen = await chooseFromFileInput("red");
    // Emptied after each choice, so that choosing the same file again is a
    // change too; the system's own dialog is outside what this can show.
    expect(chosen).toEqual({ here: true, value: "", files: 0 });
    await waitForStatus("Tracing over the picture");
    await browser.waitUntil(canMove);
    await browser.waitUntil(async () => (await pictureColoursShown()).red);
    await saveScreenshot("choose-picture");
    // A file that is no picture leaves the one traced.
    await chooseFromFileInput("text");
    await waitForStatus("Not traced: Inkline cannot read this picture");
    expect(await pictureColoursShown()).toEqual({ red: true, blue: false });
    // Another choice replaces it.
    await chooseFromFileInput("blue");
    await browser.waitUntil(async () => {
      const shown = await pictureColoursShown();
      return shown.blue && !shown.red;
    });
  });

  it("reads a picture chosen from outside the vault, and puts none of it there", async function () {
    // A synthetic picture in a new folder beside the test vault, not in it,
    // chosen as the system's dialog would: WebDriver gives a file input a
    // file from this machine by its path.
    const folder = mkdtempSync(path.join(tmpdir(), "inkline-outside-"));
    try {
      const file = path.join(folder, "outside.png");
      const data = new Uint8Array(60 * 40 * 4);
      for (let at = 0; at < data.length; at += 4) {
        data.set([255, 0, 0, 255], at);
      }
      writeFileSync(file, encodePng({ width: 60, height: 40, data }));
      const vault = await browser.executeObsidian(({ app, obsidian }) => {
        if (!(app.vault.adapter instanceof obsidian.FileSystemAdapter)) {
          throw new Error("This check requires a desktop test vault");
        }
        return app.vault.adapter.getBasePath();
      });
      const from = path.relative(realpathSync(vault), realpathSync(file));
      expect(from.split(path.sep)[0]).toBe("..");
      const files = async () =>
        browser.executeObsidian(({ app }) =>
          app.vault
            .getFiles()
            .map((found) => found.path)
            .sort(),
        );
      const before = await files();
      await openEditor();
      await browser
        .$('.inkline-editor .inkline-picture input[type="file"]')
        .addValue(file);
      await waitForStatus("Tracing over the picture");
      await browser.waitUntil(async () => (await pictureColoursShown()).red);
      await saveScreenshot("choose-picture-outside");
      expect(await files()).toEqual(before);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  // A symbol's image is one line at the drawing's own pixels, so chosen as
  // the picture it lies over the strokes it was saved from, from the top of
  // the drawing area to its bottom, rather than shrunk to a capital (#472).
  it("lays a symbol's own image over the strokes it shows", async function () {
    await openEditor();
    // From near the top of the drawing area to near its bottom, as from the
    // ascender to the descender, with a bar across, left of the middle.
    await draw([
      [0.3, 0.06],
      [0.31, 0.94],
    ]);
    await draw([
      [0.2, 0.5],
      [0.4, 0.5],
    ]);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    const [saved] = await symbolFiles();
    if (saved === undefined) throw new Error("not saved");
    // The save crops the image to the ink, and moves the view with it, so
    // that the ink stays where it was.
    const inked = await drawnOnSurface();
    if (inked === undefined) throw new Error("no ink shown");
    await chooseVaultFile(saved);
    await waitForStatus("Tracing over the picture");
    // Cleared, the drawing area shows the picture alone, where the ink was:
    // faint, so its softest edge pixels can vanish.
    await browser.keys(["Delete"]);
    let shown: Box | undefined;
    await waitOrSay(
      async () => {
        shown = await drawnOnSurface();
        return near(shown, inked, 2);
      },
      () =>
        `the ink was at ${JSON.stringify(inked)}, the picture at ${JSON.stringify(shown)}`,
    );
    await saveScreenshot("choose-picture-symbol");
  });

  it("gives the focus back to the drawing after a choice or a cancel", async function () {
    await openEditor();
    await draw([
      [0.3, 0.3],
      [0.6, 0.6],
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    await focusChooseButton();
    await chooseFromFileInput("red");
    await browser.waitUntil(surfaceFocused);
    await browser.waitUntil(async () => (await pictureColoursShown()).red);
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
    expect((await pictureColoursShown()).red).toBe(true);
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
      expect((await chooseFromFileInput("red")).here).toBe(true);
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
