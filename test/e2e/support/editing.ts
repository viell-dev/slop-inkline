// Steps for the editor tests that start from Editor.md: opening the editor at
// its marker or on a symbol file, saving one symbol, and reading the name
// field, the strokes and the drafts, in end-to-end tests.

import { browser } from "@wdio/globals";
import { draw, openAtMarker, recordOf, waitForEditor } from "./editor.ts";

export const zigzag = [
  [0.4, 0.3],
  [0.45, 0.7],
  [0.5, 0.3],
  [0.55, 0.7],
] as const;

export async function insert(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
}

export async function editFile(path: string): Promise<void> {
  await browser.executeObsidian(({ app, plugins }, filePath) => {
    const file = app.vault.getFileByPath(filePath);
    if (file === null) throw new Error(`no ${filePath}`);
    void plugins.inkline.editSymbol(file);
  }, path);
  await waitForEditor();
}

export async function draftCount(): Promise<number> {
  return browser.executeObsidian(({ app }) => {
    const ids: unknown = app.loadLocalStorage("inkline-drafts");
    return Array.isArray(ids) ? ids.length : 0;
  });
}

/** Saves one new symbol, 001.ink.png, with one stroke. */
export async function saveOne(): Promise<void> {
  await insert();
  await draw(zigzag);
  await browser.keys(["Control", "Enter"]);
  await waitClosed();
}

/** Puts `name` in the open editor's name field, in place of what it holds. */
export async function nameSymbol(name: string): Promise<void> {
  await browser.$(".inkline-editor .inkline-name").setValue(name);
}

/** What the open editor's name field holds, and its placeholder. */
export async function nameField(): Promise<{
  value: string;
  placeholder: string;
}> {
  return browser.execute(() => {
    const field = document.querySelector(".inkline-editor .inkline-name");
    return field instanceof HTMLInputElement
      ? { value: field.value, placeholder: field.placeholder }
      : { value: "none", placeholder: "none" };
  });
}

export async function waitClosed(): Promise<void> {
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

/** Whether Inkline is enabled, which needs no Inkline to tell. */
export async function inklineOn(): Promise<boolean> {
  return browser.executeObsidian(({ app }) => {
    const plugins: unknown = Reflect.get(app, "plugins");
    const on: unknown =
      typeof plugins === "object" && plugins !== null
        ? Reflect.get(plugins, "enabledPlugins")
        : undefined;
    return on instanceof Set && on.has("inkline");
  });
}

/** How many strokes a symbol file's record holds. */
export async function strokeCount(path: string): Promise<number> {
  const record = JSON.parse(await recordOf(path)) as { strokes?: unknown[] };
  return record.strokes?.length ?? -1;
}

/** Whether a toolbar button shows itself pressed. */
export async function pressed(button: string): Promise<string | null> {
  return browser
    .$(`[data-inkline-button="${button}"]`)
    .getAttribute("aria-pressed");
}

/** Chooses a symbol in the open choice of symbols, by typing its name. */
export async function chooseSymbol(name: string): Promise<void> {
  await browser.$(".prompt-input").waitForDisplayed();
  await browser.keys(name);
  await browser.keys(["Enter"]);
}

export const nothingDrawn = "Not saved: nothing drawn yet";
