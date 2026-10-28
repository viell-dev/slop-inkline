import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  openAtMarker,
  settledSurface,
  startOver,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/**
 * Gives the editor's file chooser, in the window the editor is in, a file as
 * the system's file dialog does once one is chosen: a synthetic picture, or
 * text that is no picture. Returns whether the chooser is in that window.
 */
async function choose(kind: "picture" | "text"): Promise<boolean> {
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
      what === "picture"
        ? await window.inklineTest.pictures.picture(60, 40, "white", [
            { x: 20, y: 10, width: 20, height: 20, colour: "black" },
          ])
        : new Blob(["not a picture"], { type: "text/plain" });
    const transfer = new view.DataTransfer();
    transfer.items.add(
      new view.File([blob], what === "picture" ? "sign.png" : "notes.png", {
        type: "image/png",
      }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new view.Event("change"));
    return input.ownerDocument === doc;
  }, kind);
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
    await choose("picture");
    await waitForStatus("Tracing over the picture");
    await browser.waitUntil(canMove);
    await saveScreenshot("choose-picture");
    // A file that is no picture leaves the one traced.
    await choose("text");
    await waitForStatus("Not traced: Inkline cannot read this picture");
    expect(await canMove()).toBe(true);
    // Choosing again replaces it, the same file included.
    await choose("picture");
    await waitForStatus("Tracing over the picture");
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
      expect(await choose("picture")).toBe(true);
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
