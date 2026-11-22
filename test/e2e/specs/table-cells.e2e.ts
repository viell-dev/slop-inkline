import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { save, waitClosed, zigzag } from "../support/editing.ts";
import {
  createSymbol,
  draw,
  noteText,
  startOver,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import {
  chooseExisting,
  next,
  openBeside,
  rewrite,
  searchExisting,
  setLinkUpdates,
  type,
  waitForNoteFocus,
} from "../support/insertion.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import {
  backIntoCell,
  holdInklineTimers,
  intoCell,
  letInklineTimersGo,
  waitForLastRow,
  waitForRowEverywhere,
} from "../support/table-cell.ts";

describe("Symbols in a table cell in Live Preview", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await setLinkUpdates(false);
  });

  it("lands after a symbol that Save inserts, and typing goes on there", async function () {
    await intoCell("Table.md");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    await save();
    await waitForLastRow("| same![[001.ink.png]] | same |");
    await type("xy");
    await waitForLastRow("| same![[001.ink.png]]xy | same |");
    await saveScreenshot("cursor-after-symbol-in-table-cell");
  });

  it("keeps a run from Next in order, in rows that read the same", async function () {
    await intoCell("Table.md");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    await next(1);
    await waitForLastRow("| same![[001.ink.png]] | same |");
    await draw([[0.5, 0.5]]);
    await next(2);
    await waitForLastRow("| same![[001.ink.png]]![[002.ink.png]] | same |");
    await draw([[0.4, 0.3]]);
    await save();
    await waitForLastRow(
      "| same![[001.ink.png]]![[002.ink.png]]![[003.ink.png]] | same |",
    );
    await type("xy");
    await waitForLastRow(
      "| same![[001.ink.png]]![[002.ink.png]]![[003.ink.png]]xy | same |",
    );
    // The row above reads the same, and stays as it was.
    const rows = (await noteText()).split("\n");
    expect(rows[2]?.replace(/ +/g, " ")).toBe("| same | same |");
  });

  it("stays after the last of a run when the last editor is discarded", async function () {
    await intoCell("Table.md");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    await next(1);
    await browser.keys(["Escape"]);
    await waitClosed();
    await type("xy");
    await waitForLastRow("| same![[001.ink.png]]xy | same |");
  });

  // A rename through Obsidian's question, with Just once and Do not update, is
  // in unsaved-text-renames.e2e.ts's "A rename while the note holds unsaved
  // text", in a table cell.

  it("keeps a run in order after a symbol renamed on its way", async function () {
    await setLinkUpdates(true);
    await intoCell("Table.md");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await browser.$(".inkline-editor .inkline-name").setValue("the long gate");
    await next(1);
    await waitForLastRow("| same![[the long gate.ink.png]] | same |");
    await draw([[0.5, 0.5]]);
    await save();
    await waitForLastRow(
      "| same![[the long gate.ink.png]]![[001.ink.png]] | same |",
    );
    await type("xy");
    await waitForLastRow(
      "| same![[the long gate.ink.png]]![[001.ink.png]]xy | same |",
    );
  });

  it("lands after a symbol from Insert existing symbol", async function () {
    await createSymbol("gate.ink.png");
    await intoCell("Table.md");
    await chooseExisting("gat");
    await waitForLastRow("| same![[gate.ink.png]] | same |");
    await type("xy");
    await waitForLastRow("| same![[gate.ink.png]]xy | same |");
  });

  // A key straight after the choice, before what Obsidian does on a timer as
  // a cell takes a change, as on a busy machine (#415).
  it("keeps a symbol from Insert existing symbol and a key that comes first", async function () {
    await createSymbol("gate.ink.png");
    await intoCell("Table.md");
    await searchExisting("gat");
    await holdInklineTimers();
    await browser.keys(["Enter"]);
    await type("x");
    // The late return of the focus, at least, which shows the hold works.
    expect(await letInklineTimersGo()).toBeGreaterThan(0);
    await type("y");
    await waitForLastRow("| same![[gate.ink.png]]xy | same |");
  });

  // With no key after it, the symbol is an edit like any other: saved, and
  // passed to the note's other panes (#428's review).
  it("saves a symbol from Insert existing symbol and passes it to another pane", async function () {
    await createSymbol("gate.ink.png");
    await intoCell("Table.md");
    await openBeside("Table.md");
    await backIntoCell();
    await chooseExisting("gat");
    await waitForRowEverywhere("| same![[gate.ink.png]] | same |");
    // An edit in the other pane keeps it.
    await browser.executeObsidian(({ app, obsidian }) => {
      const views = app.workspace
        .getLeavesOfType("markdown")
        .map(({ view }) => view)
        .filter(
          (view): view is InstanceType<typeof obsidian.MarkdownView> =>
            view instanceof obsidian.MarkdownView &&
            view.file?.path === "Table.md",
        );
      const other = views.find(
        (view) =>
          view !== app.workspace.getActiveViewOfType(obsidian.MarkdownView),
      );
      if (other === undefined) throw new Error("no other pane");
      other.editor.replaceRange("Edited.\n\n", { line: 0, ch: 0 });
    });
    await waitForRowEverywhere("| same![[gate.ink.png]] | same |");
  });

  it("keeps a symbol from Insert existing symbol through a change on disk straight after", async function () {
    await createSymbol("gate.ink.png");
    await intoCell("Table.md");
    await chooseExisting("gat");
    await waitForLastRow("| same![[gate.ink.png]] | same |");
    // As sync writes the note.
    await browser.executeObsidian(async ({ app }) => {
      const note = app.vault.getFileByPath("Table.md");
      if (note === null) throw new Error("no Table.md");
      await app.vault.process(note, (text) => `Prefix\n\n${text}`);
    });
    await waitForRowEverywhere("| same![[gate.ink.png]] | same |");
  });

  it("lands after a symbol from the ;; list", async function () {
    await createSymbol("gate.ink.png");
    await intoCell("Table.md");
    await type(";;gat");
    await browser.$(".suggestion-item").waitForExist();
    await browser.keys(["Enter"]);
    await waitForLastRow("| same![[gate.ink.png]] | same |");
    await type("xy");
    await waitForLastRow("| same![[gate.ink.png]]xy | same |");
  });

  it("writes successive symbols from the library in order", async function () {
    await createSymbol("gate.ink.png");
    await createSymbol("path.ink.png");
    await intoCell("Table.md");
    await browser.executeObsidianCommand("inkline:show-library");
    const row = (name: string) =>
      browser.$(
        `//div[contains(@class, "inkline-library-symbol")][.//div[contains(@class, "inkline-library-name")][text()="${name}"]]`,
      );
    await row("gate").waitForExist();
    await row("gate").$(".inkline-library-picture").click();
    await waitForLastRow("| same![[gate.ink.png]] | same |");
    await row("path").$(".inkline-library-picture").click();
    await waitForLastRow("| same![[gate.ink.png]]![[path.ink.png]] | same |");
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("inkline-library");
    });
  });

  it("types on after a disk edit took the cell's editor away", async function () {
    await intoCell("Table.md");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    await rewrite("Table.md", (text) => `Prefix\n\n${text}`);
    await save();
    await waitForLastRow("| same![[001.ink.png]] | same |");
    await waitForNoteFocus();
    await type("xy");
    await waitForLastRow("| same![[001.ink.png]]xy | same |");
  });

  it("types on after that when a run ends without another symbol", async function () {
    await intoCell("Table.md");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    await next(1);
    await rewrite("Table.md", (text) => `Prefix\n\n${text}`);
    await browser.keys(["Escape"]);
    await waitClosed();
    await waitForNoteFocus();
    await type("xy");
    await waitForLastRow("| same![[001.ink.png]]xy | same |");
  });

  it("types on after that during Insert existing symbol's search", async function () {
    await createSymbol("gate.ink.png");
    await intoCell("Table.md");
    await searchExisting("gat");
    await rewrite("Table.md", (text) => `Prefix\n\n${text}`);
    await browser.keys(["Enter"]);
    await waitForLastRow("| same![[gate.ink.png]] | same |");
    await waitForNoteFocus();
    await type("xy");
    await waitForLastRow("| same![[gate.ink.png]]xy | same |");
  });
});
