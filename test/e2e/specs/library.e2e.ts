import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  createSymbol,
  openAtMarker,
  startOver,
  waitForEditor,
  waitForNotice,
} from "../support/editor.ts";

/** What a row of the library shows. */
interface Row {
  name: string;
  folder: string;
  uses: string;
  painted: boolean;
}

/** Shows the library, with the command, and waits for its list. */
async function showLibrary(): Promise<void> {
  await browser.executeObsidianCommand("inkline:show-library");
  await browser.$(".inkline-library-list").waitForExist();
}

/** The library's rows, top first. */
async function rows(): Promise<Row[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".inkline-library-symbol")).map(
      (row) => ({
        name: row.querySelector(".inkline-library-name")?.textContent ?? "",
        folder:
          row.querySelector(".inkline-library-folder-name")?.textContent ?? "",
        uses: row.querySelector(".inkline-library-uses")?.textContent ?? "",
        painted:
          row
            .querySelector(".inkline-library-picture")
            ?.classList.contains("inkline-symbol") === true,
      }),
    ),
  );
}

/** The names the library lists, top first, once they are `names`. */
async function waitForNames(names: readonly string[]): Promise<void> {
  let shown: string[] = [];
  try {
    await browser.waitUntil(async () => {
      shown = (await rows()).map((row) => row.name);
      return JSON.stringify(shown) === JSON.stringify(names);
    });
  } catch (error) {
    throw new Error(`the library lists ${JSON.stringify(shown)}`, {
      cause: error,
    });
  }
}

/** The row of the symbol named `name`. */
function row(name: string): ChainableRow {
  return browser.$(
    `//div[contains(@class, "inkline-library-symbol")][.//div[contains(@class, "inkline-library-name")][text()="${name}"]]`,
  );
}

type ChainableRow = ReturnType<typeof browser.$>;

/** The text of the note at `path`, as its open editor has it. */
async function editorText(path: string): Promise<string> {
  return browser.executeObsidian(({ app, obsidian }, file) => {
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof obsidian.MarkdownView && view.file?.path === file) {
        return view.editor.getValue();
      }
    }
    throw new Error(`${file} is not open`);
  }, path);
}

/** Waits for Obsidian's metadata cache to know that `note` links to `file`. */
async function waitForLink(note: string, file: string): Promise<void> {
  await browser.waitUntil(async () =>
    browser.executeObsidian(
      ({ app }, from, to) =>
        (app.metadataCache.resolvedLinks[from]?.[to] ?? 0) > 0,
      note,
      file,
    ),
  );
}

/** The titles of the menu that is open, top first. */
async function menuItems(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".menu .menu-item-title")).map(
      (item) => item.textContent,
    ),
  );
}

/** Types `text` into the library's name filter, in place of what it holds. */
async function filterBy(text: string): Promise<void> {
  await browser.$(".inkline-library-search").click();
  await browser.keys(["Control", "a"]);
  await browser.keys(["Backspace"]);
  if (text !== "") await browser.keys(Array.from(text));
}

/** Waits for the note at `path` to read `text` in its open editor. */
async function waitForText(path: string, text: string): Promise<void> {
  let shown = "";
  try {
    await browser.waitUntil(async () => {
      shown = await editorText(path);
      return shown === text;
    });
  } catch (error) {
    throw new Error(`${path} reads ${JSON.stringify(shown)}`, { cause: error });
  }
}

/** Chooses the folder labelled `label` in the library's folder field. */
async function chooseFolder(label: string): Promise<void> {
  await browser.$(".inkline-library-folder").selectByVisibleText(label);
}

describe("The symbol library", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    // Each test opens a library of its own, with no filter left from the last.
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("inkline-library");
    });
  });

  after(async function () {
    await startOver();
  });

  it("lists every symbol, with its folder and the notes that use it", async function () {
    await createSymbol("001.ink.png");
    await createSymbol("Runes/tower.ink.png");
    await createSymbol("Runes/gate.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create(
        "Uses.md",
        "Both ![[001.ink.png]] and ![[Runes/tower.ink.png]].\n",
      );
      await app.vault.create("More.md", "Again ![[001.ink.png]].\n");
    });
    await waitForLink("Uses.md", "Runes/tower.ink.png");
    await waitForLink("More.md", "001.ink.png");
    await showLibrary();
    // In the right sidebar, by folder, the top folder first, then by name.
    expect(
      await browser.$(".mod-right-split .inkline-library").isExisting(),
    ).toBe(true);
    await waitForNames(["001", "gate", "tower"]);
    expect(await rows()).toEqual([
      { name: "001", folder: "", uses: "2 notes", painted: true },
      { name: "gate", folder: "Runes", uses: "Not used", painted: true },
      { name: "tower", folder: "Runes", uses: "1 note", painted: true },
    ]);
    // A symbol no note uses has nothing to list.
    expect(
      await row("gate").$(".inkline-library-uses").getProperty("disabled"),
    ).toBe(true);
    // The notes that use one, listed and opened from there.
    await row("001").$(".inkline-library-uses").click();
    const notes = row("001").$$(".inkline-library-note");
    await browser.waitUntil(async () => (await notes.length) === 2);
    expect(
      await row("001")
        .$$(".inkline-library-note")
        .map((note) => note.getText()),
    ).toEqual(["More", "Uses"]);
    expect(
      await row("001").$(".inkline-library-uses").getAttribute("aria-expanded"),
    ).toBe("true");
    await row("001").$("a=Uses").click();
    await browser.waitUntil(async () =>
      browser.executeObsidian(
        ({ app }) => app.workspace.getActiveFile()?.path === "Uses.md",
      ),
    );
  });

  it("filters by name and folder", async function () {
    await createSymbol("Tower.ink.png");
    await createSymbol("Runes/tower two.ink.png");
    await createSymbol("Runes/gate.ink.png");
    await showLibrary();
    await waitForNames(["Tower", "gate", "tower two"]);
    await filterBy("TOW");
    await waitForNames(["Tower", "tower two"]);
    await chooseFolder("Runes");
    await waitForNames(["tower two"]);
    await filterBy("");
    await waitForNames(["gate", "tower two"]);
    await chooseFolder("Top folder");
    await waitForNames(["Tower"]);
    await filterBy("zz");
    await waitForNames([]);
    expect(await browser.$(".inkline-library-empty").getText()).toBe(
      "No symbol matches.",
    );
    await filterBy("");
    await chooseFolder("All folders");
    await waitForNames(["Tower", "gate", "tower two"]);
  });

  it("inserts a symbol at the cursor, outside a link, and the next after it", async function () {
    await createSymbol("gate.ink.png");
    await createSymbol("tower.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Copy.md", "Read HERE, then [[Welcome]].\n");
    });
    await openAtMarker("Copy.md", "HERE");
    await showLibrary();
    await waitForNames(["gate", "tower"]);
    await row("gate").$(".inkline-library-insert").click();
    await row("tower").$(".inkline-library-insert").click();
    await waitForText(
      "Copy.md",
      "Read ![[gate.ink.png]]![[tower.ink.png]], then [[Welcome]].\n",
    );
    // The library keeps the focus, for the next symbol.
    expect(
      await browser.execute(() =>
        Boolean(document.activeElement?.closest(".inkline-library")),
      ),
    ).toBe(true);
    // With the cursor inside a link, as a click there puts it, the embed
    // goes after the link.
    const inside = await browser.executeObsidian(({ app, obsidian }) => {
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (
          view instanceof obsidian.MarkdownView &&
          view.file?.path === "Copy.md"
        ) {
          app.workspace.setActiveLeaf(leaf, { focus: true });
          const editor = view.editor;
          editor.focus();
          const at = editor.getValue().indexOf("lcome");
          editor.setCursor(editor.offsetToPos(at));
          return at;
        }
      }
      throw new Error("Copy.md is not open");
    });
    await browser.pause(300);
    expect(
      await browser.executeObsidian(({ app, obsidian }) => {
        const editor = app.workspace.getActiveViewOfType(
          obsidian.MarkdownView,
        )?.editor;
        return editor === undefined
          ? -1
          : editor.posToOffset(editor.getCursor());
      }),
    ).toBe(inside);
    await row("gate").$(".inkline-library-insert").click();
    await waitForText(
      "Copy.md",
      "Read ![[gate.ink.png]]![[tower.ink.png]], then [[Welcome]]![[gate.ink.png]].\n",
    );
  });

  it("says why it inserts nothing without a note in editing view", async function () {
    await createSymbol("gate.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Welcome.md");
      if (file === null) throw new Error("no Welcome.md");
      await app.workspace
        .getLeaf(false)
        .openFile(file, { state: { mode: "preview" } });
    });
    const before = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Welcome.md");
      if (file === null) throw new Error("no Welcome.md");
      return app.vault.read(file);
    });
    await showLibrary();
    await waitForNames(["gate"]);
    await row("gate").$(".inkline-library-insert").click();
    await waitForNotice(
      "Open a note in editing view to insert a symbol there.",
    );
    expect(
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("Welcome.md");
        if (file === null) throw new Error("no Welcome.md");
        return app.vault.read(file);
      }),
    ).toBe(before);
  });

  it("offers Edit symbol in a symbol's menu", async function () {
    await createSymbol("gate.ink.png");
    await showLibrary();
    await waitForNames(["gate"]);
    await row("gate").$(".inkline-library-insert").click({ button: "right" });
    await browser.waitUntil(async () =>
      (await menuItems()).includes("Edit symbol"),
    );
    // The menu Obsidian shows for a link to the file.
    expect(await menuItems()).toContain("Open in new tab");
    const chosen = await browser.execute(() => {
      const item = Array.from(
        document.querySelectorAll(".menu .menu-item-title"),
      ).find((found) => found.textContent === "Edit symbol");
      const button = item?.closest(".menu-item");
      if (!button?.instanceOf(HTMLElement)) return false;
      button.click();
      return true;
    });
    expect(chosen).toBe(true);
    await waitForEditor();
    expect(
      await browser.execute(
        () =>
          document.querySelector<HTMLInputElement>(
            ".inkline-editor .inkline-name",
          )?.value,
      ),
    ).toBe("gate");
    await browser.keys(["Escape"]);
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
  });

  it("follows the vault as symbols and notes change", async function () {
    await createSymbol("gate.ink.png");
    await showLibrary();
    await waitForNames(["gate"]);
    await createSymbol("arch.ink.png");
    await waitForNames(["arch", "gate"]);
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("gate.ink.png");
      if (file === null) throw new Error("no gate");
      await app.vault.rename(file, "tower.ink.png");
    });
    await waitForNames(["arch", "tower"]);
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Note.md", "See ![[tower.ink.png]].\n");
    });
    await browser.waitUntil(
      async () =>
        (await rows()).find((found) => found.name === "tower")?.uses ===
        "1 note",
    );
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("arch.ink.png");
      if (file === null) throw new Error("no arch");
      await app.fileManager.trashFile(file);
    });
    await waitForNames(["tower"]);
  });

  it("says when the vault has no symbols yet", async function () {
    await showLibrary();
    await browser.waitUntil(async () =>
      browser.$(".inkline-library-empty").isExisting(),
    );
    expect(await browser.$(".inkline-library-empty").getText()).toBe(
      "No symbols yet. In a note, Insert symbol draws one.",
    );
    // The command shows the one library, however often it runs.
    await showLibrary();
    expect(
      await browser.executeObsidian(
        ({ app }) => app.workspace.getLeavesOfType("inkline-library").length,
      ),
    ).toBe(1);
  });
});
