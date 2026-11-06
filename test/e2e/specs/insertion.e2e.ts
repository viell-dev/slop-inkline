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
  topButton,
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

/**
 * Adds `text` at the start or end of the note at `path`, through its editor in
 * `pane`, in the workspace's order, and leaves it unsaved. Waits for every
 * editor of the note to have it, as Obsidian passes it on a moment later.
 */
async function addUnsaved(
  path: string,
  text: string,
  place: "start" | "end",
  pane = 0,
): Promise<void> {
  const wanted = await browser.executeObsidian(
    ({ app, obsidian }, file, added, end, index) => {
      const editors = [];
      for (const { view } of app.workspace.getLeavesOfType("markdown")) {
        if (view instanceof obsidian.MarkdownView && view.file?.path === file) {
          editors.push(view.editor);
        }
      }
      const editor = editors[index];
      if (editor === undefined)
        throw new Error(`no pane ${String(index)} of ${file}`);
      const at = end ? editor.getValue().length : 0;
      editor.replaceRange(added, editor.offsetToPos(at));
      return editor.getValue();
    },
    path,
    text,
    place === "end",
    pane,
  );
  await waitForPanes(path, wanted);
}

/** Waits for every editor of the note at `path` to read `text`. */
async function waitForPanes(path: string, text: string): Promise<void> {
  let read: string[] = [];
  try {
    await browser.waitUntil(async () => {
      read = await browser.executeObsidian(({ app, obsidian }, file) => {
        const shown: string[] = [];
        for (const { view } of app.workspace.getLeavesOfType("markdown")) {
          if (
            view instanceof obsidian.MarkdownView &&
            view.file?.path === file
          ) {
            shown.push(view.editor.getValue());
          }
        }
        return shown;
      }, path);
      return read.length > 0 && read.every((shown) => shown === text);
    });
  } catch (error) {
    throw new Error(
      `waited for ${JSON.stringify(text)}, but ${path} read ${JSON.stringify(read)}`,
      { cause: error },
    );
  }
}

/**
 * Holds back how the note's editors take a change on disk by `delay`
 * milliseconds, as a slow disk would. Obsidian keeps that step in the view's
 * private `loadFileInternal`, and the view goes with the test.
 */
async function slowReload(path: string, delay: number): Promise<void> {
  await browser.executeObsidian(
    ({ app, obsidian }, file, wait) => {
      for (const { view } of app.workspace.getLeavesOfType("markdown")) {
        if (!(view instanceof obsidian.MarkdownView)) continue;
        if (view.file?.path !== file) continue;
        const load: unknown = Reflect.get(view, "loadFileInternal");
        if (typeof load !== "function") throw new Error("no reload to hold");
        const held = async (...args: unknown[]): Promise<unknown> => {
          await new Promise((resolve) => {
            window.setTimeout(resolve, wait);
          });
          return Reflect.apply(load, view, args) as unknown;
        };
        Reflect.set(view, "loadFileInternal", held);
      }
    },
    path,
    delay,
  );
}

/**
 * Holds what reads a note through `vault.cachedRead` by `delay` milliseconds
 * after the read, with the text it read, as Obsidian's reload does while it
 * writes the file. Returns what takes that back.
 */
async function slowCachedRead(delay: number): Promise<() => Promise<void>> {
  await browser.executeObsidian(({ app }, wait) => {
    const { vault } = app;
    const read = vault.cachedRead.bind(vault);
    vault.cachedRead = async (file) => {
      const text = await read(file);
      await new Promise((resolve) => {
        window.setTimeout(resolve, wait);
      });
      return text;
    };
  }, delay);
  return async () => {
    await browser.executeObsidian(({ app }) => {
      Reflect.deleteProperty(app.vault, "cachedRead");
    });
  };
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

describe("A rename while the note holds unsaved text", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await setLinkUpdates(false);
  });

  const opening = "Opening unsaved line.\n";
  const closing = "Other unsaved text.";
  const renamed = "![[the long gate.ink.png]]";

  /** The note with the unsaved text, with `sign` as the door's sign. */
  function withText(sign: string): string {
    return `${opening}The door is marked with ${sign} which means return.\n${closing}`;
  }

  /** Inserts a symbol with Mod+S, and waits for Obsidian's cache to know it. */
  async function insertAndIndex(): Promise<void> {
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await waitForLink("Editor.md", "001.ink.png");
  }

  /**
   * {@link insertAndIndex}, and waits past the save that set off, which comes
   * two seconds after the first edit since the last one. Text that arrives
   * during Obsidian's question is out of Inkline's reach, so a test of it keeps
   * that save from landing in the question or in the reload after it.
   */
  async function insertAndWait(): Promise<void> {
    await insertAndIndex();
    await browser.pause(2100);
  }

  /** Adds unsaved text on both sides of the symbol. */
  async function addBoth(path: string, pane = 0): Promise<void> {
    await addUnsaved(path, opening, "start", pane);
    await addUnsaved(path, closing, "end", pane);
  }

  async function nameIt(): Promise<void> {
    await browser.$(".inkline-editor .inkline-name").setValue("the long gate");
  }

  /** Saves the editor under the new name, answering Obsidian if it asks. */
  async function saveRenamed(answer: string | undefined): Promise<void> {
    await nameIt();
    await browser.keys(["Control", "Enter"]);
    if (answer !== undefined) await clickTop(answer);
    await waitClosed();
  }

  // How the links are to update: by the setting, or by the answer to Obsidian's
  // question. With Do not update, Inkline's embed follows on its own.
  const ways: readonly (readonly [string, string | undefined])[] = [
    ["automatic link updates", undefined],
    ["Just once", "Just once"],
    ["Do not update", "Do not update"],
  ];

  for (const [how, answer] of ways) {
    describe(`with ${how}`, function () {
      beforeEach(async function () {
        await setLinkUpdates(answer === undefined);
      });

      it("writes the new name once and keeps the text, in a plain note", async function () {
        await insertAndIndex();
        await addBoth("Editor.md");
        await saveRenamed(answer);
        await waitForPanes("Editor.md", withText(renamed));
        await waitForFile("Editor.md", withText(renamed));
        expect(await marked("Editor.md")).toEqual([withText(`${renamed}|`)]);
        await type("xy");
        await waitForNote(withText(`${renamed}xy`));
        await waitForFile("Editor.md", withText(`${renamed}xy`));
      });

      for (const [pane, which] of [
        [0, "the pane that took the symbol"],
        [1, "another pane"],
      ] as const) {
        it(`does so in two panes, with the text from ${which}`, async function () {
          await insertAndIndex();
          await openBeside("Editor.md");
          await addBoth("Editor.md", pane);
          await saveRenamed(answer);
          await waitForPanes("Editor.md", withText(renamed));
          await waitForFile("Editor.md", withText(renamed));
          expect((await marked("Editor.md"))[0]).toBe(withText(`${renamed}|`));
          // Past the other pane's own save. Falling due during typing here, it
          // has Obsidian merge a character twice, with no symbol involved.
          await browser.pause(2100);
          await type("xy");
          await waitForPanes("Editor.md", withText(`${renamed}xy`));
          await waitForFile("Editor.md", withText(`${renamed}xy`));
        });
      }

      it("does so once the note is closed", async function () {
        await insertAndIndex();
        await addBoth("Editor.md");
        await closeTabs("Editor.md");
        await saveRenamed(answer);
        await waitForFile("Editor.md", withText(renamed));
      });

      it("does so in Reading view", async function () {
        await insertAndIndex();
        await addBoth("Editor.md");
        await showAs("Editor.md", "preview");
        await saveRenamed(answer);
        await waitForFile("Editor.md", withText(renamed));
        await showAs("Editor.md", "source");
        await waitForNote(withText(renamed));
      });

      it("does so in a table cell", async function () {
        await intoCell("Table.md");
        await browser.executeObsidianCommand("inkline:insert-symbol");
        await waitForEditor();
        await draw(zigzag);
        await browser.keys(["Control", "s"]);
        await waitForStatus("Saved");
        await waitForLink("Table.md", "001.ink.png");
        await addUnsaved("Table.md", opening, "start");
        await saveRenamed(answer);
        await waitForLastRow(`| same${renamed} | same |`);
        await type("xy");
        await waitForLastRow(`| same${renamed}xy | same |`);
        const note = await noteText();
        expect(note.startsWith(opening)).toBe(true);
        expect(note.split("![[")).toHaveLength(2);
      });

      it("keeps the next symbol's place, through a reload", async function () {
        await insertAndIndex();
        await addBoth("Editor.md");
        await nameIt();
        await markEditor();
        await browser.keys(["Control", "Shift", "Enter"]);
        if (answer !== undefined) await clickTop(answer);
        await waitForNext(1);
        await waitForPanes("Editor.md", withText(renamed));
        // Obsidian takes the cursor away from the embed here.
        await rewrite("Editor.md", (text) => `A new first line.\n${text}`);
        await draw([[0.5, 0.5]]);
        await save();
        const both = `${renamed}![[001.ink.png]]`;
        await waitForNote(`A new first line.\n${withText(both)}`);
        expect(await marked("Editor.md")).toEqual([
          `A new first line.\n${withText(`${both}|`)}`,
        ]);
        await type("xy");
        await waitForNote(`A new first line.\n${withText(`${both}xy`)}`);
      });
    });
  }

  // The modal over the note stops typing, but not another window or a plugin,
  // so text can arrive once the note was saved, with Obsidian's question open.
  for (const answer of ["Just once", "Do not update"]) {
    describe(`when text arrives during the question, with ${answer}`, function () {
      async function askAndAdd(keys: string[]): Promise<void> {
        await nameIt();
        await browser.keys(keys);
        await browser.waitUntil(
          async () => (await topButton(answer)) !== undefined,
        );
        await addBoth("Editor.md");
        await clickTop(answer);
      }

      it("writes the new name once and keeps the text", async function () {
        await insertAndWait();
        await askAndAdd(["Control", "Enter"]);
        await waitClosed();
        await waitForNote(withText(renamed));
        await waitForFile("Editor.md", withText(renamed));
        expect(await marked("Editor.md")).toEqual([withText(`${renamed}|`)]);
        await type("xy");
        await waitForNote(withText(`${renamed}xy`));
      });

      it("keeps the next symbol's place", async function () {
        await insertAndWait();
        await markEditor();
        await askAndAdd(["Control", "Shift", "Enter"]);
        await waitForNext(1);
        await waitForNote(withText(renamed));
        await draw([[0.5, 0.5]]);
        await save();
        const both = `${renamed}![[001.ink.png]]`;
        await waitForNote(withText(both));
        expect(await marked("Editor.md")).toEqual([withText(`${both}|`)]);
      });
    });
  }

  // Until the reload lands, an editor holding other text still shows the old
  // embed, and writing it there too would double it. The editor's blur as a
  // modal closes saves the note, which a reload under way would then undo.
  describe("when Obsidian is slow to reload the note", function () {
    async function askAndHold(keys: string[]): Promise<void> {
      await insertAndWait();
      await markEditor();
      await slowReload("Editor.md", 300);
      await nameIt();
      await browser.keys(keys);
      await browser.waitUntil(
        async () => (await topButton("Just once")) !== undefined,
      );
      await addBoth("Editor.md");
      await clickTop("Just once");
    }

    it("leaves the embed to it, and keeps the text", async function () {
      await askAndHold(["Control", "Enter"]);
      await waitClosed();
      await waitForNote(withText(renamed));
      await waitForFile("Editor.md", withText(renamed));
      expect(await marked("Editor.md")).toEqual([withText(`${renamed}|`)]);
      await type("xy");
      await waitForNote(withText(`${renamed}xy`));
    });

    it("writes the embed itself once a save undid Obsidian's", async function () {
      await browser.executeObsidian(({ app, obsidian }) => {
        const saves = app.vault.on("modify", (file) => {
          if (file.path !== "Editor.md") return;
          app.vault.offref(saves);
          for (const { view } of app.workspace.getLeavesOfType("markdown")) {
            if (view instanceof obsidian.MarkdownView) void view.save();
          }
        });
      });
      await askAndHold(["Control", "Enter"]);
      await waitClosed();
      await waitForNote(withText(renamed));
      await waitForFile("Editor.md", withText(renamed));
      expect(await marked("Editor.md")).toEqual([withText(`${renamed}|`)]);
    });

    // A save that starts once the reload has read the file has it take that
    // file as it is, and the editor's blur makes one as the next editor opens.
    it("keeps the text when the next editor takes the focus", async function () {
      const restore = await slowCachedRead(300);
      try {
        await insertAndWait();
        await markEditor();
        await nameIt();
        await browser.keys(["Control", "Shift", "Enter"]);
        await browser.waitUntil(
          async () => (await topButton("Just once")) !== undefined,
        );
        await addBoth("Editor.md");
        await clickTop("Just once");
        await waitForNext(1);
        await waitForNote(withText(renamed));
        await waitForFile("Editor.md", withText(renamed));
      } finally {
        await restore();
      }
    });

    it("keeps the text and the next symbol's place through Next", async function () {
      await askAndHold(["Control", "Shift", "Enter"]);
      await waitForNext(1);
      await waitForNote(withText(renamed));
      await waitForFile("Editor.md", withText(renamed));
      await draw([[0.5, 0.5]]);
      await save();
      const both = `${renamed}![[001.ink.png]]`;
      await waitForNote(withText(both));
      expect(await marked("Editor.md")).toEqual([withText(`${both}|`)]);
    });
  });

  it("writes the new name once with text only after it, in two panes", async function () {
    await setLinkUpdates(true);
    await insertAndIndex();
    await openBeside("Editor.md");
    await addUnsaved("Editor.md", `\n${closing}`, "end");
    await saveRenamed(undefined);
    const text = `The door is marked with ${renamed} which means return.\n\n${closing}`;
    await waitForPanes("Editor.md", text);
    await waitForFile("Editor.md", text);
  });

  // Obsidian holds the offsets of the note's links from before the question,
  // and writes at them after it, whatever an editor's own save did meanwhile.
  it("keeps the text when the note would have saved itself during the question", async function () {
    await insertAndIndex();
    await addUnsaved("Editor.md", opening, "start");
    await nameIt();
    await browser.keys(["Control", "Enter"]);
    await browser.waitUntil(
      async () => (await topButton("Just once")) !== undefined,
    );
    // An editor saves itself two seconds after an edit.
    await browser.pause(2500);
    await clickTop("Just once");
    await waitClosed();
    const text = `${opening}The door is marked with ${renamed} which means return.\n`;
    await waitForFile("Editor.md", text);
    await waitForNote(text);
    expect(await marked("Editor.md")).toEqual([
      `${opening}The door is marked with ${renamed}| which means return.\n`,
    ]);
  });

  it("takes the rename and the text back one undo at a time", async function () {
    await setLinkUpdates(true);
    await insertAndIndex();
    await addBoth("Editor.md");
    await saveRenamed(undefined);
    await waitForNote(withText(renamed));
    const steps = [
      withText("![[001.ink.png]]"),
      `${opening}The door is marked with ![[001.ink.png]] which means return.\n`,
      "The door is marked with ![[001.ink.png]] which means return.\n",
      "The door is marked with  which means return.\n",
    ];
    for (const step of steps) {
      await browser.keys(["Control", "z"]);
      await waitForNote(step);
    }
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

  it("keeps a file's line endings through a rename with nothing unsaved", async function () {
    await setLinkUpdates(true);
    await insertBetween("Ends.md");
    // Past the save that taking the marker away set off, which writes \n.
    await browser.pause(2100);
    await showAs("Ends.md", "preview");
    await writeFile("Ends.md", crlf);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await waitForFile(
      "Ends.md",
      "first\r\nleft ![[001.ink.png]] right\r\nlast\r\n",
    );
    await showAs("Ends.md", "source");
    await waitForNote("first\nleft ![[001.ink.png]] right\nlast\n");
    await browser.waitUntil(async () =>
      browser.executeObsidian(
        ({ app }) =>
          (app.metadataCache.resolvedLinks["Ends.md"]?.["001.ink.png"] ?? 0) >
          0,
      ),
    );
    await browser.$(".inkline-editor .inkline-name").setValue("the long gate");
    await save();
    await waitForNote("first\nleft ![[the long gate.ink.png]] right\nlast\n");
    await waitForFile(
      "Ends.md",
      "first\r\nleft ![[the long gate.ink.png]] right\r\nlast\r\n",
    );
  });

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
