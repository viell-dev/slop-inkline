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
