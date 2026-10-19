// Steps for driving the editor in end-to-end tests.

import { browser } from "@wdio/globals";
import type { ChainablePromiseElement } from "webdriverio";
import { obsidianPage } from "wdio-obsidian-service";

/** Opens a note in the editor and puts the cursor where `marker` was, removing it. */
export async function openAtMarker(
  path: string,
  marker: string,
): Promise<void> {
  await obsidianPage.openFile(path);
  await browser.executeObsidian(({ app, obsidian }, text) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (view === null) throw new Error("no Markdown view");
    const editor = view.editor;
    const at = editor.getValue().indexOf(text);
    if (at === -1) throw new Error(`no ${text} in the note`);
    editor.setSelection(
      editor.offsetToPos(at),
      editor.offsetToPos(at + text.length),
    );
    editor.replaceSelection("");
    editor.focus();
  }, marker);
}

/** The active note's text, as the editor has it. */
export async function noteText(): Promise<string> {
  return browser.executeObsidian(({ app, obsidian }) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (view === null) throw new Error("no Markdown view");
    return view.editor.getValue();
  });
}

/** The editor's drawing surface. */
export function surface(): ChainablePromiseElement {
  return browser.$(".inkline-editor .inkline-surface");
}

/** Waits for the editor to be open. */
export async function waitForEditor(): Promise<void> {
  await surface().waitForDisplayed();
}

/**
 * Draws through points on the surface with a mouse, as fractions of its
 * width and height from its top left corner.
 */
export async function draw(
  points: readonly (readonly [number, number])[],
  pointerType: "mouse" | "pen" | "touch" = "mouse",
): Promise<void> {
  const canvas = surface();
  await canvas.waitForDisplayed();
  const { width, height } = await canvas.getSize();
  const at = ([x, y]: readonly [number, number]) => ({
    origin: canvas,
    // Offsets are from the element's centre.
    x: Math.round((x - 0.5) * width),
    y: Math.round((y - 0.5) * height),
  });
  const [first, ...rest] = points;
  if (first === undefined) return;
  const action = browser.action("pointer", { parameters: { pointerType } });
  action.move(at(first)).down();
  for (const point of rest) action.move({ ...at(point), duration: 20 });
  action.up();
  await action.perform();
}

/** Whether the editor is open. */
export async function editorOpen(): Promise<boolean> {
  return browser.$(".inkline-editor").isExisting();
}

/** The symbol files in the vault, by path. */
export async function symbolFiles(): Promise<string[]> {
  return browser.executeObsidian(({ app }) =>
    app.vault
      .getFiles()
      .map((file) => file.path)
      .filter((path) => path.endsWith(".ink.png"))
      .sort(),
  );
}

/** The record a symbol file holds, as JSON, or why it has none. */
export async function recordOf(path: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, filePath) => {
    const file = app.vault.getFileByPath(filePath);
    if (file === null) throw new Error(`no ${filePath}`);
    const { inkFile, record } = window.inklineTest;
    const source = await inkFile.readInkFile(
      new Uint8Array(await app.vault.readBinary(file)),
    );
    return source.kind === "record"
      ? record.serializeRecord(source.record)
      : JSON.stringify(source);
  }, path);
}

/** A button in the topmost modal, such as the close question's. */
export function topButton(text: string): ChainablePromiseElement {
  return browser.$(".modal-container:last-of-type").$(`button=${text}`);
}

/**
 * Closes every modal, discarding unsaved drawings, and every note, then
 * restores the vault, so that each test starts from the same state.
 */
export async function startOver(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await browser.$(".modal-container").isExisting())) break;
    const discard = topButton("Discard");
    if (await discard.isExisting()) await discard.click();
    else await browser.keys(["Escape"]);
  }
  await browser.executeObsidian(({ app }) => {
    app.workspace.iterateRootLeaves((leaf) => {
      leaf.detach();
    });
  });
  await obsidianPage.resetVault();
}
