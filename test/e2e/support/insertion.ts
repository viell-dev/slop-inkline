// Steps for the tests of where a symbol goes in a note, and what becomes of
// the note's text and cursor around it: drawing and saving from a marked
// note, changing the note meanwhile, and reading it back, in end-to-end
// tests.

import { browser } from "@wdio/globals";
import { markEditor, noteText, waitForNext } from "./editor.ts";

/** Presses Next, and waits for the editor of the symbol after `count`. */
export async function next(count: number): Promise<void> {
  await markEditor();
  await browser.keys(["Control", "Shift", "Enter"]);
  await waitForNext(count);
}

/**
 * The text of each open editor of the note at `path`, in the workspace's
 * order, with `|` where its cursor is, or `«` and `»` around its selection.
 */
export async function marked(path: string): Promise<string[]> {
  return browser.executeObsidian(({ app, obsidian }, file) => {
    const shown: string[] = [];
    for (const { view } of app.workspace.getLeavesOfType("markdown")) {
      if (!(view instanceof obsidian.MarkdownView)) continue;
      if (view.file?.path !== file) continue;
      const { editor } = view;
      const text = editor.getValue();
      const from = editor.posToOffset(editor.getCursor("from"));
      const to = editor.posToOffset(editor.getCursor("to"));
      shown.push(
        from === to
          ? `${text.slice(0, from)}|${text.slice(from)}`
          : `${text.slice(0, from)}«${text.slice(from, to)}»${text.slice(to)}`,
      );
    }
    return shown;
  }, path);
}

/** Types `text` with the keyboard, into whatever has the focus. */
export async function type(text: string): Promise<void> {
  for (const key of text) await browser.keys([key]);
}

/** The note's text on disk, once that is `text`. */
export async function waitForFile(path: string, text: string): Promise<void> {
  let read = "";
  try {
    await browser.waitUntil(async () => {
      read = await browser.executeObsidian(async ({ app }, file) => {
        const note = app.vault.getFileByPath(file);
        if (note === null) throw new Error(`no ${file}`);
        return app.vault.read(note);
      }, path);
      return read === text;
    });
  } catch (error) {
    throw new Error(
      `waited for ${JSON.stringify(text)}, but ${path} read ${JSON.stringify(read)}`,
      { cause: error },
    );
  }
}

/**
 * How long to leave after the setup's edit, in milliseconds: the editor joins
 * changes made within half a second into one undo step, which a person drawing
 * a symbol never does, but a fast test run can.
 */
export const undoGroup = 600;

/** Waits for the active note's editor to read `text`. */
export async function waitForNote(text: string): Promise<void> {
  let read = "";
  try {
    await browser.waitUntil(async () => {
      read = await noteText();
      return read === text;
    });
  } catch (error) {
    throw new Error(
      `waited for ${JSON.stringify(text)}, but the note read ${JSON.stringify(read)}`,
      { cause: error },
    );
  }
}

/** Writes the note at `path` through the vault, as sync would. */
export async function rewrite(
  path: string,
  change: (text: string) => string,
): Promise<void> {
  const before = await browser.executeObsidian(async ({ app }, file) => {
    const note = app.vault.getFileByPath(file);
    if (note === null) throw new Error(`no ${file}`);
    return app.vault.read(note);
  }, path);
  const text = change(before);
  await browser.executeObsidian(
    async ({ app }, file, written) => {
      const note = app.vault.getFileByPath(file);
      if (note === null) throw new Error(`no ${file}`);
      await app.vault.modify(note, written);
    },
    path,
    text,
  );
  await waitForNote(text);
}

/**
 * Has Obsidian update links without asking, or ask. It asks only once its
 * cache knows the embed, which depends on how soon a test gets there, so a
 * test that a question would stop answers none.
 *
 * Obsidian saves its settings to `app.json` a second after a change. Half a
 * second after it hears of a write to that file, its own included, it reads
 * the file back, unless the file is older than the time it noted as its last
 * save finished. A save that finishes more than that half second after the
 * write, as on a loaded machine, is read back, and so is one whose file time,
 * which Obsidian rounds to the millisecond, comes out later than the time it
 * noted. Either takes back a change made since the save began. This waits
 * until the setting holds both in Obsidian and in the file, setting it again
 * if it was taken back, so that a test starts with the setting it asked for
 * (#386).
 */
export async function setLinkUpdates(always: boolean): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(async ({ app }, value) => {
        const vault: object = app.vault;
        const configurable = (
          candidate: object,
        ): candidate is {
          getConfig(key: string): unknown;
          setConfig(key: string, value: unknown): void;
        } =>
          "getConfig" in candidate &&
          typeof candidate.getConfig === "function" &&
          "setConfig" in candidate &&
          typeof candidate.setConfig === "function";
        if (!configurable(vault)) throw new Error("no vault settings");
        if (vault.getConfig("alwaysUpdateLinks") !== value) {
          vault.setConfig("alwaysUpdateLinks", value);
          return false;
        }
        const file = `${app.vault.configDir}/app.json`;
        const saved: unknown = (await app.vault.adapter.exists(file))
          ? JSON.parse(await app.vault.adapter.read(file))
          : {};
        // Obsidian asks unless the setting is on.
        const stored =
          typeof saved === "object" && saved !== null
            ? Reflect.get(saved, "alwaysUpdateLinks") === true
            : false;
        return stored === value;
      }, always),
    {
      timeoutMsg: `Obsidian kept alwaysUpdateLinks from being ${String(always)}`,
    },
  );
}

/** Opens a second pane on the note at `path`, leaving the focus where it is. */
export async function openBeside(path: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, file) => {
    const note = app.vault.getFileByPath(file);
    if (note === null) throw new Error(`no ${file}`);
    await app.workspace.getLeaf("split").openFile(note, { active: false });
  }, path);
  await browser.waitUntil(async () => (await marked(path)).length === 2);
}

/** Makes the note at `path`, with `text` exactly as given. */
export async function createNote(path: string, text: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, file, written) => {
      await app.vault.create(file, written);
    },
    path,
    text,
  );
}

/** Closes every tab of the note at `path`. */
export async function closeTabs(path: string): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }, file) => {
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      if (
        leaf.view instanceof obsidian.MarkdownView &&
        leaf.view.file?.path === file
      ) {
        leaf.detach();
      }
    }
  }, path);
}

/** Opens the search for a symbol, and chooses the one `name` finds. */
export async function chooseExisting(name: string): Promise<void> {
  await searchExisting(name);
  await browser.keys(["Enter"]);
}

/** Opens the search for a symbol, and types `name` in it. */
export async function searchExisting(name: string): Promise<void> {
  await browser.executeObsidianCommand("inkline:insert-existing-symbol");
  await browser.$(".prompt-input").waitForDisplayed();
  await type(name);
  await browser.$(".suggestion-item").waitForExist();
}

/** Switches every tab of the note at `path` to Reading view or back. */
export async function showAs(
  path: string,
  mode: "preview" | "source",
): Promise<void> {
  await browser.executeObsidian(
    async ({ app, obsidian }, file, wanted) => {
      for (const { view } of app.workspace.getLeavesOfType("markdown")) {
        if (!(view instanceof obsidian.MarkdownView)) continue;
        if (view.file?.path !== file) continue;
        await view.setState(
          { ...view.getState(), mode: wanted },
          { history: false },
        );
      }
    },
    path,
    mode,
  );
}
