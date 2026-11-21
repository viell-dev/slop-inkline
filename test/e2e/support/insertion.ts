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
 */
export async function setLinkUpdates(always: boolean): Promise<void> {
  await browser.executeObsidian(({ app }, value) => {
    const vault: object = app.vault;
    const settable = (
      candidate: object,
    ): candidate is { setConfig(key: string, value: unknown): void } =>
      "setConfig" in candidate && typeof candidate.setConfig === "function";
    if (!settable(vault)) throw new Error("no vault settings");
    vault.setConfig("alwaysUpdateLinks", value);
  }, always);
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

/**
 * Holds every timer with no delay that an Inkline modal sets in its `onClose`,
 * until {@link letClosingTimersGo}, as a busy machine can run such a timer
 * after a person's first keys: the editor's wait for the modal to finish
 * closing is one. Each held timer still fires, and runs its callback once let
 * go. A test that ends with them held has `undoStubs` let them go.
 */
export async function holdClosingTimers(): Promise<void> {
  await browser.execute(() => {
    const original: unknown = Reflect.get(window, "setTimeout");
    if (typeof original !== "function") throw new Error("no setTimeout");
    const later = (...args: unknown[]): number =>
      Reflect.apply(original, window, args) as number;
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    const holding = (
      handler: unknown,
      delay?: number,
      ...args: unknown[]
    ): number => {
      const closing = (new Error().stack ?? "")
        .split("\n")
        .some(
          (frame) =>
            frame.includes("onClose") && frame.includes("plugin:inkline"),
        );
      if (typeof handler !== "function" || (delay ?? 0) > 0 || !closing) {
        return later(handler, delay, ...args);
      }
      held++;
      return later(() => {
        void released.then(() => {
          Reflect.apply(handler, window, args);
        });
      });
    };
    const letGo = (): number => {
      Reflect.set(window, "setTimeout", original);
      Reflect.deleteProperty(window, "inklineLetClosingTimersGo");
      Reflect.deleteProperty(window, "inklineAtEnd-closing-timers");
      release();
      return held;
    };
    Reflect.set(window, "inklineLetClosingTimersGo", letGo);
    Reflect.set(window, "inklineAtEnd-closing-timers", letGo);
    Reflect.set(window, "setTimeout", holding);
  });
}

/**
 * Lets the timers that {@link holdClosingTimers} holds run, once each has
 * fired, and says how many it held.
 */
export async function letClosingTimersGo(): Promise<number> {
  return browser.execute(async () => {
    const letGo: unknown = Reflect.get(window, "inklineLetClosingTimersGo");
    if (typeof letGo !== "function") throw new Error("no timers held");
    const held = Reflect.apply(letGo, window, []) as number;
    // Each runs its callback as its timer fires, which a task gives time to.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return held;
  });
}
