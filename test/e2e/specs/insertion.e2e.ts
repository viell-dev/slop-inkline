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

  it("leaves a selection's text, and lands past the symbol beside it", async function () {
    await openAtMarker("Editor.md", "HERE");
    await browser.executeObsidian(({ app, obsidian }) => {
      const editor = app.workspace.getActiveViewOfType(
        obsidian.MarkdownView,
      )?.editor;
      if (editor === undefined) throw new Error("no note editor");
      const start = editor.getValue().indexOf("door");
      editor.setSelection(
        editor.offsetToPos(start),
        editor.offsetToPos(start + "door".length),
      );
    });
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
    await browser.executeObsidianCommand("inkline:insert-existing-symbol");
    await browser.$(".prompt-input").waitForDisplayed();
    await type("gat");
    await browser.$(".suggestion-item").waitForExist();
    await browser.keys(["Enter"]);
    await waitForNote("The door reads ![[gate.ink.png]] today.\n");
    expect(await marked("Chosen.md")).toEqual([
      "The door reads ![[gate.ink.png]]| today.\n",
    ]);
    await type("xy");
    await waitForNote("The door reads ![[gate.ink.png]]xy today.\n");
    await saveScreenshot("cursor-after-existing-symbol");
  });
});
