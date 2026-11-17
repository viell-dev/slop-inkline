import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  clickTop,
  createSymbol,
  draw,
  openAtMarker,
  startOver,
  symbolFiles,
  waitForEditor,
  waitForNotice,
  waitForStatus,
} from "../support/editor.ts";
import {
  chooseExisting,
  createNote,
  insert,
  marked,
  next,
  openBeside,
  rewrite,
  save,
  searchExisting,
  setLinkUpdates,
  showAs,
  type,
  undoGroup,
  waitClosed,
  waitForFile,
  waitForLink,
  waitForNote,
  zigzag,
} from "../support/insertion.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** Shows `other` in the first tab that shows `path`, which moves on from it. */
async function moveOn(path: string, other: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app, obsidian }, file, shown) => {
      const note = app.vault.getFileByPath(shown);
      if (note === null) throw new Error(`no ${shown}`);
      const leaf = app.workspace
        .getLeavesOfType("markdown")
        .find(
          ({ view }) =>
            view instanceof obsidian.MarkdownView && view.file?.path === file,
        );
      if (leaf === undefined) throw new Error(`${file} is not open`);
      await leaf.openFile(note);
    },
    path,
    other,
  );
}

/** Selects `text` in the active note. */
async function selectText(text: string): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }, wanted) => {
    const editor = app.workspace.getActiveViewOfType(
      obsidian.MarkdownView,
    )?.editor;
    if (editor === undefined) throw new Error("no note editor");
    const start = editor.getValue().indexOf(wanted);
    editor.setSelection(
      editor.offsetToPos(start),
      editor.offsetToPos(start + wanted.length),
    );
  }, text);
}

describe("Where the cursor lands after a symbol", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await setLinkUpdates(false);
  });

  it("lands after a new symbol that Save inserts, and typing goes on there", async function () {
    await insert();
    await draw(zigzag);
    await save();
    expect(await marked("Editor.md")).toEqual([
      "The door is marked with ![[001.ink.png]]| which means return.\n",
    ]);
    await type("xy");
    await waitForNote(
      "The door is marked with ![[001.ink.png]]xy which means return.\n",
    );
  });

  it("lands there when Mod+S inserts it, and stays through a later save", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    expect(await marked("Editor.md")).toEqual([
      "The door is marked with ![[001.ink.png]]| which means return.\n",
    ]);
    await draw([[0.5, 0.2]]);
    await save();
    expect(await marked("Editor.md")).toEqual([
      "The door is marked with ![[001.ink.png]]| which means return.\n",
    ]);
    await type("xy");
    await waitForNote(
      "The door is marked with ![[001.ink.png]]xy which means return.\n",
    );
  });

  it("follows a run from Next, in the order it was drawn", async function () {
    await insert();
    await draw(zigzag);
    await next(1);
    expect(await marked("Editor.md")).toEqual([
      "The door is marked with ![[001.ink.png]]| which means return.\n",
    ]);
    await draw([[0.5, 0.5]]);
    await next(2);
    expect(await marked("Editor.md")).toEqual([
      "The door is marked with ![[001.ink.png]]![[002.ink.png]]| which means return.\n",
    ]);
    await draw([[0.4, 0.3]]);
    await save();
    expect(await marked("Editor.md")).toEqual([
      "The door is marked with ![[001.ink.png]]![[002.ink.png]]![[003.ink.png]]| which means return.\n",
    ]);
    await type("xy");
    await waitForNote(
      "The door is marked with ![[001.ink.png]]![[002.ink.png]]![[003.ink.png]]xy which means return.\n",
    );
  });

  it("stays after the last of a run when the last editor is discarded", async function () {
    await insert();
    await draw(zigzag);
    await next(1);
    await browser.keys(["Escape"]);
    await waitClosed();
    await type("xy");
    await waitForNote(
      "The door is marked with ![[001.ink.png]]xy which means return.\n",
    );
  });

  it("returns to the last of a run when the note changed before the discard", async function () {
    await insert();
    await draw(zigzag);
    await next(1);
    // Obsidian takes the cursor to the start of the note here.
    await rewrite("Editor.md", (text) => `Prefix\n${text}`);
    await browser.keys(["Escape"]);
    await waitClosed();
    expect(await marked("Editor.md")).toEqual([
      "Prefix\nThe door is marked with ![[001.ink.png]]| which means return.\n",
    ]);
    await type("xy");
    await waitForNote(
      "Prefix\nThe door is marked with ![[001.ink.png]]xy which means return.\n",
    );
  });

  it("returns there when strokes are discarded too, and inserts nothing", async function () {
    await insert();
    await draw(zigzag);
    await next(1);
    await draw([[0.5, 0.5]]);
    await rewrite("Editor.md", (text) => `Prefix\n${text}`);
    await browser.keys(["Escape"]);
    await clickTop("Discard");
    await waitClosed();
    expect(await marked("Editor.md")).toEqual([
      "Prefix\nThe door is marked with ![[001.ink.png]]| which means return.\n",
    ]);
    expect(await symbolFiles()).toHaveLength(1);
  });

  it("leaves the cursor alone at a run's end once the place is gone", async function () {
    await insert();
    await draw(zigzag);
    await next(1);
    await rewrite("Editor.md", () => "Line one.\nLine two.\n");
    await browser.keys(["Escape"]);
    await waitClosed();
    expect(await marked("Editor.md")).toEqual(["|Line one.\nLine two.\n"]);
  });

  it("leaves a selection's text, and lands past the symbol beside it", async function () {
    await openAtMarker("Editor.md", "HERE");
    await selectText("door");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    await save();
    expect(await marked("Editor.md")).toEqual([
      "The door![[001.ink.png]]| is marked with  which means return.\n",
    ]);
    // Typed over the selection, this would take "door" with it.
    await type("xy");
    await waitForNote(
      "The door![[001.ink.png]]xy is marked with  which means return.\n",
    );
  });

  it("lands past a symbol that went after a link or an address", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Link.md", "See [[Wel HEREcome]] and on.\n");
      await app.vault.create(
        "Address.md",
        "See https://example.com/HEREpage and on.\n",
      );
    });
    await openAtMarker("Link.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    await save();
    expect(await marked("Link.md")).toEqual([
      "See [[Wel come]]![[001.ink.png]]| and on.\n",
    ]);
    await openAtMarker("Address.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    await save();
    expect(await marked("Address.md")).toEqual([
      "See https://example.com/page ![[002.ink.png]]| and on.\n",
    ]);
  });

  it("lands where the note's changes moved the symbol, through a run", async function () {
    await insert();
    await draw(zigzag);
    // Obsidian takes the cursor to the start of the note here, away from
    // where the symbol goes.
    await rewrite("Editor.md", (text) => `A new first line.\n${text}`);
    await next(1);
    expect(await marked("Editor.md")).toEqual([
      "A new first line.\nThe door is marked with ![[001.ink.png]]| which means return.\n",
    ]);
    await draw([[0.5, 0.5]]);
    await rewrite("Editor.md", (text) => text.replace("first", "opening"));
    await save();
    expect(await marked("Editor.md")).toEqual([
      "A new opening line.\nThe door is marked with ![[001.ink.png]]![[002.ink.png]]| which means return.\n",
    ]);
    await type("xy");
    await waitForNote(
      "A new opening line.\nThe door is marked with ![[001.ink.png]]![[002.ink.png]]xy which means return.\n",
    );
  });

  it("lands after a symbol added at the end, once its place is gone", async function () {
    await insert();
    await draw(zigzag);
    await rewrite("Editor.md", () => "Line one.\nLine two.\n");
    await next(1);
    await waitForNotice("it was added at the end of Editor");
    expect(await marked("Editor.md")).toEqual([
      "Line one.\nLine two.\n![[001.ink.png]]|\n",
    ]);
    await draw([[0.5, 0.5]]);
    await save();
    expect(await marked("Editor.md")).toEqual([
      "Line one.\nLine two.\n![[001.ink.png]]![[002.ink.png]]|\n",
    ]);
    await type("xy");
    await waitForNote(
      "Line one.\nLine two.\n![[001.ink.png]]![[002.ink.png]]xy\n",
    );
  });

  it("lands on a line of its own at the end of a note with no last line break", async function () {
    await insert();
    await draw(zigzag);
    await rewrite("Editor.md", () => "Line one.\nLine two.");
    await save();
    await waitForNotice("it was added at the end of Editor");
    expect(await marked("Editor.md")).toEqual([
      "Line one.\nLine two.\n![[001.ink.png]]|\n",
    ]);
    await type("xy");
    await waitForNote("Line one.\nLine two.\n![[001.ink.png]]xy\n");
  });

  it("moves only the cursor of the pane the symbol started in", async function () {
    await insert();
    await draw(zigzag);
    await openBeside("Editor.md");
    await save();
    // Obsidian passes the change to the other pane a moment later.
    await browser.waitUntil(async () =>
      (await marked("Editor.md")).every((text) => text.includes("001.ink.png")),
    );
    expect(await marked("Editor.md")).toEqual([
      "The door is marked with ![[001.ink.png]]| which means return.\n",
      "|The door is marked with ![[001.ink.png]] which means return.\n",
    ]);
    await type("xy");
    await waitForNote(
      "The door is marked with ![[001.ink.png]]xy which means return.\n",
    );
  });

  it("lands in the pane that takes the symbol once its own tab moved on", async function () {
    await insert();
    await draw(zigzag);
    await next(1);
    await openBeside("Editor.md");
    await moveOn("Editor.md", "Welcome.md");
    const other = await marked("Welcome.md");
    await draw([[0.5, 0.5]]);
    await next(2);
    await draw([[0.4, 0.3]]);
    await save();
    expect(await marked("Editor.md")).toEqual([
      "The door is marked with ![[001.ink.png]]![[002.ink.png]]![[003.ink.png]]| which means return.\n",
    ]);
    // The note in the tab that moved on stays as it was, with its cursor.
    expect(await marked("Welcome.md")).toEqual(other);
  });

  it("reaches the note from a pane in Reading view, through a run", async function () {
    await insert();
    await draw(zigzag);
    // The first through its editor, the others through its file.
    await next(1);
    await showAs("Editor.md", "preview");
    await draw([[0.5, 0.5]]);
    await next(2);
    await draw([[0.4, 0.3]]);
    await save();
    const inserted =
      "The door is marked with ![[001.ink.png]]![[002.ink.png]]![[003.ink.png]] which means return.\n";
    await waitForFile("Editor.md", inserted);
    await showAs("Editor.md", "source");
    await waitForNote(inserted);
  });

  it("stays after the embed when a later save renames the symbol", async function () {
    await setLinkUpdates(true);
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await browser.$(".inkline-editor .inkline-name").setValue("the long gate");
    await save();
    await browser.waitUntil(async () =>
      (await symbolFiles()).includes("the long gate.ink.png"),
    );
    await waitForNote(
      "The door is marked with ![[the long gate.ink.png]] which means return.\n",
    );
    expect(await marked("Editor.md")).toEqual([
      "The door is marked with ![[the long gate.ink.png]]| which means return.\n",
    ]);
    await type("xy");
    await waitForNote(
      "The door is marked with ![[the long gate.ink.png]]xy which means return.\n",
    );
  });

  // Once Obsidian's cache knows the embed, it asks about the links, and either
  // rewrites the embed itself or leaves it for Inkline.
  for (const answer of ["Just once", "Do not update"]) {
    it(`stays after the embed through Obsidian's question, with ${answer}`, async function () {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await waitForLink("Editor.md", "001.ink.png");
      await browser
        .$(".inkline-editor .inkline-name")
        .setValue("the long gate");
      await browser.keys(["Control", "Enter"]);
      await clickTop(answer);
      await waitClosed();
      await waitForNote(
        "The door is marked with ![[the long gate.ink.png]] which means return.\n",
      );
      expect(await marked("Editor.md")).toEqual([
        "The door is marked with ![[the long gate.ink.png]]| which means return.\n",
      ]);
      await type("xy");
      await waitForNote(
        "The door is marked with ![[the long gate.ink.png]]xy which means return.\n",
      );
    });
  }

  it("keeps the following symbol after one renamed on its way", async function () {
    await setLinkUpdates(true);
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await browser.$(".inkline-editor .inkline-name").setValue("the long gate");
    await next(1);
    await draw([[0.5, 0.5]]);
    await save();
    await waitForNote(
      "The door is marked with ![[the long gate.ink.png]]![[001.ink.png]] which means return.\n",
    );
    expect(await marked("Editor.md")).toEqual([
      "The door is marked with ![[the long gate.ink.png]]![[001.ink.png]]| which means return.\n",
    ]);
  });

  it("takes a saved symbol back in one undo, with the note as it was", async function () {
    await insert(undoGroup);
    await draw(zigzag);
    await save();
    await browser.keys(["Control", "z"]);
    await waitForNote("The door is marked with  which means return.\n");
    expect(await marked("Editor.md")).toEqual([
      "The door is marked with | which means return.\n",
    ]);
  });

  it("lands after a symbol from the ;; list", async function () {
    await createSymbol("gate.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Typing.md", "The door reads HERE today.\n");
    });
    await openAtMarker("Typing.md", "HERE");
    await type(";;gat");
    await browser.$(".suggestion-item").waitForExist();
    await browser.keys(["Enter"]);
    await waitForNote("The door reads ![[gate.ink.png]] today.\n");
    expect(await marked("Typing.md")).toEqual([
      "The door reads ![[gate.ink.png]]| today.\n",
    ]);
    await type("xy");
    await waitForNote("The door reads ![[gate.ink.png]]xy today.\n");
  });

  it("lands after a symbol from Insert existing symbol", async function () {
    await createSymbol("gate.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Chosen.md", "The door reads HERE today.\n");
    });
    await openAtMarker("Chosen.md", "HERE");
    await chooseExisting("gat");
    await waitForNote("The door reads ![[gate.ink.png]] today.\n");
    expect(await marked("Chosen.md")).toEqual([
      "The door reads ![[gate.ink.png]]| today.\n",
    ]);
    await type("xy");
    await waitForNote("The door reads ![[gate.ink.png]]xy today.\n");
    await saveScreenshot("cursor-after-existing-symbol");
  });

  it("puts a symbol from Insert existing symbol past a link, past an embed, and a space after a bare address", async function () {
    await createSymbol("gate.ink.png");
    await createNote("Link.md", "See [[Wel HEREcome]] and on.\n");
    await createNote("Embed.md", "See ![[Wel HEREcome.png]] and on.\n");
    await createNote(
      "Address.md",
      "See https://example.com/HEREpage and on.\n",
    );
    await openAtMarker("Link.md", "HERE");
    await chooseExisting("gat");
    await waitForNote("See [[Wel come]]![[gate.ink.png]] and on.\n");
    expect(await marked("Link.md")).toEqual([
      "See [[Wel come]]![[gate.ink.png]]| and on.\n",
    ]);
    await type("xy");
    await waitForNote("See [[Wel come]]![[gate.ink.png]]xy and on.\n");
    await openAtMarker("Embed.md", "HERE");
    await chooseExisting("gat");
    await waitForNote("See ![[Wel come.png]]![[gate.ink.png]] and on.\n");
    await openAtMarker("Address.md", "HERE");
    await chooseExisting("gat");
    await waitForNote(
      "See https://example.com/page ![[gate.ink.png]] and on.\n",
    );
    expect(await marked("Address.md")).toEqual([
      "See https://example.com/page ![[gate.ink.png]]| and on.\n",
    ]);
  });

  it("keeps a selection's text with Insert existing symbol", async function () {
    await createSymbol("gate.ink.png");
    await createNote("Selected.md", "HEREKeep both words.\n");
    await openAtMarker("Selected.md", "HERE");
    await selectText("Keep both");
    await chooseExisting("gat");
    await waitForNote("Keep both![[gate.ink.png]] words.\n");
    expect(await marked("Selected.md")).toEqual([
      "Keep both![[gate.ink.png]]| words.\n",
    ]);
    // Typed over the selection, this would take "Keep both" with it.
    await type("xy");
    await waitForNote("Keep both![[gate.ink.png]]xy words.\n");
  });

  it("follows the note's changes during Insert existing symbol's search", async function () {
    await createSymbol("gate.ink.png");
    await createNote("Chosen.md", "The door reads HERE today.\n");
    await openAtMarker("Chosen.md", "HERE");
    await searchExisting("gat");
    // Obsidian takes the cursor to the start of the note here.
    await rewrite("Chosen.md", (text) => `A new first line.\n${text}`);
    await browser.keys(["Enter"]);
    await waitForNote(
      "A new first line.\nThe door reads ![[gate.ink.png]] today.\n",
    );
    expect(await marked("Chosen.md")).toEqual([
      "A new first line.\nThe door reads ![[gate.ink.png]]| today.\n",
    ]);
  });

  it("reaches a note gone to Reading view during that search", async function () {
    await createSymbol("gate.ink.png");
    await createNote("Chosen.md", "The door reads HERE today.\n");
    await openAtMarker("Chosen.md", "HERE");
    await searchExisting("gat");
    await showAs("Chosen.md", "preview");
    await browser.keys(["Enter"]);
    await waitForFile("Chosen.md", "The door reads ![[gate.ink.png]] today.\n");
  });
});
