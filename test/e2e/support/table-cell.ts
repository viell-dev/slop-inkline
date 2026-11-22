// A note with a table, and a symbol inserted into one of its cells in Live
// Preview, in end-to-end tests.

import { browser } from "@wdio/globals";
import { createNote } from "./insertion.ts";

export const table =
  "| A | B |\n| --- | --- |\n| same | same |\n| same | same |\n";

/**
 * Opens the note `table` holds in Live Preview, clicks the first cell of its
 * last row, and takes the cursor to the end of that cell with a real key.
 */
export async function intoCell(path: string): Promise<void> {
  await createNote(path, table);
  await browser.executeObsidian(async ({ app }, file) => {
    const note = app.vault.getFileByPath(file);
    if (note === null) throw new Error(`no ${file}`);
    await app.workspace.getLeaf(false).openFile(note);
  }, path);
  const cell = browser.$(
    ".workspace-leaf.mod-active .cm-table-widget tbody tr:last-child td:first-child",
  );
  await cell.waitForExist();
  await cell.click();
  await browser
    .$(".workspace-leaf.mod-active .table-cell-wrapper .cm-content")
    .waitForExist();
  await browser.keys(["End"]);
}

/**
 * Makes the first tab of `Table.md` the active one again, as after another
 * pane on it opened, clicks the first cell of its last row, and takes the
 * cursor to the end of that cell with a real key.
 */
export async function backIntoCell(): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }) => {
    const leaf = app.workspace
      .getLeavesOfType("markdown")
      .find(
        ({ view }) =>
          view instanceof obsidian.MarkdownView &&
          view.file?.path === "Table.md",
      );
    if (leaf === undefined) throw new Error("Table.md is not open");
    app.workspace.setActiveLeaf(leaf, { focus: true });
  });
  const cell = browser.$(
    ".workspace-leaf.mod-active .cm-table-widget tbody tr:last-child td:first-child",
  );
  await cell.waitForExist();
  await cell.click();
  await browser
    .$(".workspace-leaf.mod-active .table-cell-wrapper .cm-content")
    .waitForExist();
  await browser.keys(["End"]);
}

/**
 * Waits for the last row of the table in `Table.md` to read `row`, whatever
 * its padding, in every editor of the note and in its file: an edit that one
 * pane holds reaches the others and the file as Obsidian saves and passes it
 * on, a moment later.
 */
export async function waitForRowEverywhere(row: string): Promise<void> {
  let read: string[] = [];
  try {
    await browser.waitUntil(async () => {
      read = await browser.executeObsidian(async ({ app, obsidian }) => {
        const last = (text: string): string =>
          (text.trimEnd().split("\n").at(-1) ?? "").replace(/ +/g, " ");
        const rows = app.workspace
          .getLeavesOfType("markdown")
          .flatMap(({ view }) =>
            view instanceof obsidian.MarkdownView &&
            view.file?.path === "Table.md"
              ? [last(view.editor.getValue())]
              : [],
          );
        const file = app.vault.getFileByPath("Table.md");
        if (file === null) throw new Error("no Table.md");
        return [...rows, last(await app.vault.read(file))];
      });
      return read.length > 1 && read.every((shown) => shown === row);
    });
  } catch (error) {
    throw new Error(
      `waited for ${JSON.stringify(row)} in every editor and the file, which read ${JSON.stringify(read)}`,
      { cause: error },
    );
  }
}

/**
 * Waits for the last row of the table in `Table.md` to read `row`, whatever
 * its padding, with `|` not marking anything here.
 */
export async function waitForLastRow(row: string): Promise<void> {
  let read = "";
  try {
    await browser.waitUntil(async () => {
      read = await browser.executeObsidian(({ app, obsidian }) => {
        const leaf = app.workspace
          .getLeavesOfType("markdown")
          .find(
            ({ view }) =>
              view instanceof obsidian.MarkdownView &&
              view.file?.path === "Table.md",
          );
        if (!(leaf?.view instanceof obsidian.MarkdownView)) return "no note";
        const lines = leaf.view.editor.getValue().trimEnd().split("\n");
        return (lines.at(-1) ?? "").replace(/ +/g, " ");
      });
      return read === row;
    });
  } catch (error) {
    throw new Error(
      `waited for ${JSON.stringify(row)}, but the row read ${JSON.stringify(read)}`,
      { cause: error },
    );
  }
}

/**
 * Holds every timer with no delay that is set while Inkline's code runs, until
 * {@link letInklineTimersGo}, as a busy machine can run such a timer after a
 * person's next key: Obsidian hands a change inside the cell being edited to
 * the cell's own editor in one (#415). Each held timer still fires, and runs
 * its callback once let go. A test that ends with them held has `undoStubs`
 * let them go.
 */
export async function holdInklineTimers(): Promise<void> {
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
      const inkline = (new Error().stack ?? "").includes("plugin:inkline");
      if (typeof handler !== "function" || (delay ?? 0) > 0 || !inkline) {
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
      Reflect.deleteProperty(window, "inklineLetInklineTimersGo");
      Reflect.deleteProperty(window, "inklineAtEnd-inkline-timers");
      release();
      return held;
    };
    Reflect.set(window, "inklineLetInklineTimersGo", letGo);
    Reflect.set(window, "inklineAtEnd-inkline-timers", letGo);
    Reflect.set(window, "setTimeout", holding);
  });
}

/**
 * Lets the timers that {@link holdInklineTimers} holds run, once each has
 * fired, and says how many it held.
 */
export async function letInklineTimersGo(): Promise<number> {
  return browser.execute(async () => {
    const letGo: unknown = Reflect.get(window, "inklineLetInklineTimersGo");
    if (typeof letGo !== "function") throw new Error("no timers held");
    const held = Reflect.apply(letGo, window, []) as number;
    // Each runs its callback as its timer fires, which a task gives time to.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return held;
  });
}
