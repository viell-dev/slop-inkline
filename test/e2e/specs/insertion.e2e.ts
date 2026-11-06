import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  clickTop,
  createSymbol,
  draw,
  markEditor,
  noteText,
  openAtMarker,
  startOver,
  symbolFiles,
  waitForEditor,
  waitForNext,
  waitForNotice,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const zigzag = [
  [0.4, 0.3],
  [0.45, 0.7],
  [0.5, 0.3],
  [0.55, 0.7],
] as const;

async function insert(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
}

async function waitClosed(): Promise<void> {
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

/** Presses Next, and waits for the editor of the symbol after `count`. */
async function next(count: number): Promise<void> {
  await markEditor();
  await browser.keys(["Control", "Shift", "Enter"]);
  await waitForNext(count);
}

/** Saves and closes the open editor. */
async function save(): Promise<void> {
  await browser.keys(["Control", "Enter"]);
  await waitClosed();
}

/**
 * The text of each open editor of the note at `path`, in the workspace's
 * order, with `|` where its cursor is, or `«` and `»` around its selection.
 */
async function marked(path: string): Promise<string[]> {
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
async function type(text: string): Promise<void> {
  for (const key of text) await browser.keys([key]);
}

/** The note's text on disk, once that is `text`. */
async function waitForFile(path: string, text: string): Promise<void> {
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

/** Waits for the active note's editor to read `text`. */
async function waitForNote(text: string): Promise<void> {
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

/**
 * Saves the note at `path`, and waits for Obsidian's metadata cache to know
 * that it links to `file`, as it does some time after an edit.
 */
async function waitForLink(path: string, file: string): Promise<void> {
  await browser.executeObsidian(async ({ app, obsidian }, note) => {
    for (const { view } of app.workspace.getLeavesOfType("markdown")) {
      if (view instanceof obsidian.MarkdownView && view.file?.path === note) {
        await view.save();
      }
    }
  }, path);
  await browser.waitUntil(async () =>
    browser.executeObsidian(
      ({ app }, from, to) =>
        (app.metadataCache.resolvedLinks[from]?.[to] ?? 0) > 0,
      path,
      file,
    ),
  );
}

/** Writes the note at `path` through the vault, as sync would. */
async function rewrite(
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
async function setLinkUpdates(always: boolean): Promise<void> {
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
async function openBeside(path: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, file) => {
    const note = app.vault.getFileByPath(file);
    if (note === null) throw new Error(`no ${file}`);
    await app.workspace.getLeaf("split").openFile(note, { active: false });
  }, path);
  await browser.waitUntil(async () => (await marked(path)).length === 2);
}

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

/** Makes the note at `path`, with `text` exactly as given. */
async function createNote(path: string, text: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, file, written) => {
      await app.vault.create(file, written);
    },
    path,
    text,
  );
}

/** Writes `text` to the note's file as it is, as another program would. */
async function writeFile(path: string, text: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, file, written) => {
      const note = app.vault.getFileByPath(file);
      if (note === null) throw new Error(`no ${file}`);
      await app.vault.modify(note, written);
    },
    path,
    text,
  );
}

/** Closes every tab of the note at `path`. */
async function closeTabs(path: string): Promise<void> {
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
async function chooseExisting(name: string): Promise<void> {
  await searchExisting(name);
  await browser.keys(["Enter"]);
}

/** Opens the search for a symbol, and types `name` in it. */
async function searchExisting(name: string): Promise<void> {
  await browser.executeObsidianCommand("inkline:insert-existing-symbol");
  await browser.$(".prompt-input").waitForDisplayed();
  await type(name);
  await browser.$(".suggestion-item").waitForExist();
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

const table = "| A | B |\n| --- | --- |\n| same | same |\n| same | same |\n";

/**
 * Opens the note `table` holds in Live Preview, clicks the first cell of its
 * last row, and takes the cursor to the end of that cell with a real key.
 */
async function intoCell(path: string): Promise<void> {
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
async function waitForLastRow(row: string): Promise<void> {
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

/** Switches every tab of the note at `path` to Reading view or back. */
async function showAs(path: string, mode: "preview" | "source"): Promise<void> {
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
    await insert();
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

  it("puts a symbol from Insert existing symbol past a link it would split", async function () {
    await createSymbol("gate.ink.png");
    await createNote("Link.md", "See [[Wel HEREcome]] and on.\n");
    await openAtMarker("Link.md", "HERE");
    await chooseExisting("gat");
    await waitForNote("See [[Wel come]]![[gate.ink.png]] and on.\n");
    expect(await marked("Link.md")).toEqual([
      "See [[Wel come]]![[gate.ink.png]]| and on.\n",
    ]);
    await type("xy");
    await waitForNote("See [[Wel come]]![[gate.ink.png]]xy and on.\n");
  });

  it("puts one past an embed, and a space after a bare address", async function () {
    await createSymbol("gate.ink.png");
    await createNote("Embed.md", "See ![[Wel HEREcome.png]] and on.\n");
    await createNote(
      "Address.md",
      "See https://example.com/HEREpage and on.\n",
    );
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

  for (const answer of ["Just once", "Do not update"]) {
    it(`stays after the embed through a rename, with ${answer}`, async function () {
      await intoCell("Table.md");
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await waitForEditor();
      await draw(zigzag);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await waitForLink("Table.md", "001.ink.png");
      await browser
        .$(".inkline-editor .inkline-name")
        .setValue("the long gate");
      await browser.keys(["Control", "Enter"]);
      await clickTop(answer);
      await waitClosed();
      await waitForLastRow("| same![[the long gate.ink.png]] | same |");
      await type("xy");
      await waitForLastRow("| same![[the long gate.ink.png]]xy | same |");
      // Saved like any edit, and written once.
      await browser.waitUntil(async () =>
        (
          await browser.executeObsidian(async ({ app }) => {
            const note = app.vault.getFileByPath("Table.md");
            if (note === null) throw new Error("no note");
            return app.vault.read(note);
          })
        ).includes("| same![[the long gate.ink.png]]xy"),
      );
    });
  }

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
    await type("xy");
    await waitForLastRow("| same![[gate.ink.png]]xy | same |");
  });
});

describe("Line endings a note's file changes to", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
  });

  const lf = "first\nleft  right\nlast\n";
  const crlf = lf.replaceAll("\n", "\r\n");

  /** Opens the editor for a symbol between `left ` and ` right`. */
  async function insertBetween(path: string): Promise<void> {
    await createNote(path, lf.replace("  right", " HERE right"));
    await openAtMarker(path, "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
  }

  // The note's editor takes no symbol in either: the file does.
  const away = {
    "in Reading view": (path: string) => showAs(path, "preview"),
    closed: closeTabs,
  };

  for (const [state, leave] of Object.entries(away)) {
    it(`finds a place taken with \\n in a file ${state} with \\r\\n`, async function () {
      await insertBetween("Ends.md");
      await leave("Ends.md");
      await writeFile("Ends.md", crlf);
      await save();
      await waitForFile(
        "Ends.md",
        "first\r\nleft ![[001.ink.png]] right\r\nlast\r\n",
      );
    });

    it(`finds a place taken with \\r\\n in a file ${state} with \\n`, async function () {
      await insertBetween("Ends.md");
      await leave("Ends.md");
      await writeFile("Ends.md", crlf);
      // Taken from that file's text, just after the first symbol.
      await next(1);
      await waitForFile(
        "Ends.md",
        "first\r\nleft ![[001.ink.png]] right\r\nlast\r\n",
      );
      await writeFile("Ends.md", "first\nleft ![[001.ink.png]] right\nlast\n");
      await draw([[0.5, 0.5]]);
      await save();
      await waitForFile(
        "Ends.md",
        "first\nleft ![[001.ink.png]]![[002.ink.png]] right\nlast\n",
      );
    });

    it(`keeps every line ending of a file ${state} with both kinds`, async function () {
      await insertBetween("Ends.md");
      await leave("Ends.md");
      await writeFile("Ends.md", "first\nleft  right\r\nlast\n\r\nend");
      await save();
      await waitForFile(
        "Ends.md",
        "first\nleft ![[001.ink.png]] right\r\nlast\n\r\nend",
      );
    });

    it(`adds a line in the file's own ending once its place is gone, ${state}`, async function () {
      await insertBetween("Ends.md");
      await leave("Ends.md");
      await writeFile("Ends.md", "Line one.\r\nLine two.");
      await next(1);
      await waitForNotice("it was added at the end of Ends");
      await waitForFile(
        "Ends.md",
        "Line one.\r\nLine two.\r\n![[001.ink.png]]\r\n",
      );
      await draw([[0.5, 0.5]]);
      await save();
      await waitForFile(
        "Ends.md",
        "Line one.\r\nLine two.\r\n![[001.ink.png]]![[002.ink.png]]\r\n",
      );
    });
  }

  it("finds a place taken from a file with \\r\\n in the note's editor", async function () {
    await insertBetween("Ends.md");
    await showAs("Ends.md", "preview");
    await writeFile("Ends.md", crlf);
    await next(1);
    await showAs("Ends.md", "source");
    await waitForNote("first\nleft ![[001.ink.png]] right\nlast\n");
    await draw([[0.5, 0.5]]);
    await save();
    await waitForNote(
      "first\nleft ![[001.ink.png]]![[002.ink.png]] right\nlast\n",
    );
    expect(await marked("Ends.md")).toEqual([
      "first\nleft ![[001.ink.png]]![[002.ink.png]]| right\nlast\n",
    ]);
  });
});
