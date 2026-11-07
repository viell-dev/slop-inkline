import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { saveScreenshot } from "../support/screenshots.ts";
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

/**
 * The mouse. A press and its release need this one id: an action under another
 * is another pointer, at the corner of the window.
 */
const mouse = () =>
  browser.action("pointer", {
    id: "mouse",
    parameters: { pointerType: "mouse" },
  });

/**
 * Holds the main button down on what `selector` finds, and moves a little, as a
 * hand does. It goes by position, which a redraw leaves as it is, where an
 * element found first could be replaced before the press.
 */
async function pressOn(selector: string): Promise<void> {
  const at = await browser.execute((wanted) => {
    const target = document.querySelector(wanted);
    if (target === null) throw new Error(`no ${wanted}`);
    target.scrollIntoView({ block: "center" });
    const box = target.getBoundingClientRect();
    return {
      x: Math.round(box.left + box.width / 2),
      y: Math.round(box.top + box.height / 2),
    };
  }, selector);
  await mouse()
    .move({ origin: "viewport", ...at })
    .down()
    .move({ origin: "pointer", x: 2, y: 1 })
    .perform(true);
}

/** A button in the row of `file`. */
function inRow(file: string, button: "insert" | "rename"): string {
  return `[data-inkline-path="${file}"] .inkline-library-${button}`;
}

/**
 * Waits past when a redraw the library was just told of would come, as it waits
 * 100 ms for a burst to end. Nothing else says that it did not.
 */
async function pastRedraw(): Promise<void> {
  await browser.pause(400);
}

/** Has `file` say `reading`, changed on disk, for the index to read. */
async function changeReading(file: string, reading: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, path, value) => {
      const found = app.vault.getFileByPath(path);
      if (found === null) throw new Error(`no ${path}`);
      const bytes = new Uint8Array(await app.vault.readBinary(found));
      const said = await window.inklineTest.text.writeText(bytes, "reading", [
        value,
      ]);
      await app.vault.modifyBinary(found, said.slice().buffer);
    },
    file,
    reading,
  );
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
    await saveScreenshot("symbol-library");
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

  it("opens the exact referring note when its name contains a hash", async function () {
    await createSymbol("gate.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Read#this.md", "See ![[gate.ink.png]].\n");
    });
    await waitForLink("Read#this.md", "gate.ink.png");
    await showLibrary();
    await waitForNames(["gate"]);
    await row("gate").$(".inkline-library-uses").click();
    await row("gate").$("a=Read#this").click();
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(
          ({ app }) => app.workspace.getActiveFile()?.path === "Read#this.md",
        ),
      { timeout: 3000, timeoutMsg: "the exact referring note did not open" },
    );
    expect(
      await browser.executeObsidian(
        ({ app }) => app.vault.getFileByPath("Read.md") === null,
      ),
    ).toBe(true);
  });

  it("keeps focus on a referring note when its row refreshes", async function () {
    await createSymbol("gate.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Uses.md", "See ![[gate.ink.png]].\n");
    });
    await waitForLink("Uses.md", "gate.ink.png");
    await showLibrary();
    await waitForNames(["gate"]);
    await row("gate").$(".inkline-library-uses").click();
    await browser.execute(() => {
      document
        .querySelector<HTMLAnchorElement>(".inkline-library-note")
        ?.focus();
    });
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("More.md", "See ![[gate.ink.png]].\n");
    });
    await browser.waitUntil(async () => (await rows())[0]?.uses === "2 notes");
    expect(
      await browser.execute(() => ({
        note: document.activeElement?.classList.contains(
          "inkline-library-note",
        ),
        text: document.activeElement?.textContent,
      })),
    ).toEqual({ note: true, text: "Uses" });
  });

  it("keeps focus in the row when its last referring note is removed", async function () {
    await createSymbol("gate.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Uses.md", "See ![[gate.ink.png]].\n");
    });
    await waitForLink("Uses.md", "gate.ink.png");
    await showLibrary();
    await waitForNames(["gate"]);
    await row("gate").$(".inkline-library-uses").click();
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Uses.md");
      if (file === null) throw new Error("no Uses.md");
      await app.fileManager.trashFile(file);
    });
    await browser.waitUntil(async () => (await rows())[0]?.uses === "Not used");
    expect(
      await browser.execute(() =>
        document.activeElement?.classList.contains("inkline-library-insert"),
      ),
    ).toBe(true);
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

  it("inserts with the keyboard without replacing selected text", async function () {
    await createSymbol("gate.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Selection.md", "Keep HEREboth words.\n");
    });
    await openAtMarker("Selection.md", "HERE");
    await browser.executeObsidian(({ app, obsidian }) => {
      const editor = app.workspace.getActiveViewOfType(
        obsidian.MarkdownView,
      )?.editor;
      if (editor === undefined) throw new Error("no note editor");
      const start = editor.getValue().indexOf("both");
      editor.setSelection(
        editor.offsetToPos(start),
        editor.offsetToPos(start + "both".length),
      );
    });
    await showLibrary();
    await waitForNames(["gate"]);
    await filterBy("gate");
    await browser.keys(["Tab"]);
    expect(
      await browser.execute(() => document.activeElement?.className),
    ).toContain("inkline-library-folder");
    await browser.keys(["Tab"]);
    expect(
      await browser.execute(() => document.activeElement?.className),
    ).toContain("inkline-library-insert");
    await browser.keys(["Enter"]);
    await waitForText("Selection.md", "Keep both![[gate.ink.png]] words.\n");
    // The metadata-cache refresh replaces the row after the note saves.
    await browser.waitUntil(async () => (await rows())[0]?.uses === "1 note");
    expect(
      await browser.execute(() => document.activeElement?.className),
    ).toContain("inkline-library-insert");
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
    // Use pointer input on the displayed item. A programmatic DOM click can
    // run before the host's menu activation task.
    const edit = browser.$(".menu-item-title=Edit symbol");
    await edit.waitForDisplayed();
    await edit.click();
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
    // A note that uses no symbol changes nothing the library shows, so it
    // is not drawn again, which would lose a click under way.
    await browser.execute(() => {
      document
        .querySelector(".inkline-library-symbol")
        ?.setAttribute("data-test-mark", "kept");
    });
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Plain.md", "Nothing here but [[Welcome]].\n");
    });
    await waitForLink("Plain.md", "Welcome.md");
    await browser.pause(500);
    expect(
      await browser.$(".inkline-library-symbol[data-test-mark]").isExisting(),
    ).toBe(true);
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

  // A click needs its press and its release on one element, and a redraw
  // replaces every row, so a redraw waits for the release.
  describe("with a press under way", function () {
    const names = async (): Promise<string[]> =>
      (await rows()).map((shown) => shown.name);
    const form = () => browser.$(".inkline-library-rename-form");

    /** A note to insert into, open with the cursor where it was `HERE`. */
    async function openNote(): Promise<void> {
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.create("Copy.md", "Read HERE.\n");
      });
      await openAtMarker("Copy.md", "HERE");
    }

    afterEach(async function () {
      await browser.releaseActions();
    });

    it("holds a new symbol's row until the click has landed", async function () {
      await createSymbol("gate.ink.png");
      await showLibrary();
      await waitForNames(["gate"]);
      await pressOn(inRow("gate.ink.png", "rename"));
      await createSymbol("tower.ink.png");
      await pastRedraw();
      expect(await names()).toEqual(["gate"]);
      await mouse().up().perform(true);
      await form().waitForExist();
      await browser.keys(["Escape"]);
      await waitForNames(["gate", "tower"]);
    });

    it("holds a row while Space is down on one of its buttons", async function () {
      await createSymbol("gate.ink.png");
      await showLibrary();
      await waitForNames(["gate"]);
      await browser.$(inRow("gate.ink.png", "rename")).execute((button) => {
        if (button.instanceOf(HTMLElement)) button.focus();
      });
      const key = browser.action("key");
      await key.down(" ").perform(true);
      await createSymbol("tower.ink.png");
      await pastRedraw();
      expect(await names()).toEqual(["gate"]);
      await key.up(" ").perform(true);
      await form().waitForExist();
      await browser.keys(["Escape"]);
      await waitForNames(["gate", "tower"]);
    });

    it("holds the values the index reads for the row pressed", async function () {
      await createSymbol("gate.ink.png");
      await openNote();
      await showLibrary();
      await waitForNames(["gate"]);
      await pressOn(inRow("gate.ink.png", "insert"));
      await changeReading("gate.ink.png", "KA");
      await pastRedraw();
      const values = browser.$(".inkline-library-values");
      expect(await values.isExisting()).toBe(false);
      await mouse().up().perform(true);
      await waitForText("Copy.md", "Read ![[gate.ink.png]].\n");
      await values.waitForExist();
      expect(await values.getText()).toContain("KA");
    });

    it("holds a row a filter finds above the one pressed", async function () {
      await createSymbol("gate.ink.png");
      await createSymbol("zone.ink.png");
      await openNote();
      await showLibrary();
      await filterBy("zone");
      await waitForNames(["zone"]);
      await pressOn(inRow("zone.ink.png", "insert"));
      await changeReading("gate.ink.png", "zone");
      await pastRedraw();
      expect(await names()).toEqual(["zone"]);
      await mouse().up().perform(true);
      await waitForText("Copy.md", "Read ![[zone.ink.png]].\n");
      await waitForNames(["gate", "zone"]);
    });

    it("shows more when a redraw came during the press", async function () {
      await browser.executeObsidian(async ({ app }) => {
        const { canvas } = window.inklineTest;
        const { bytes } = await canvas.saveInk({ strokes: [] }, undefined, []);
        for (let at = 0; at < 101; at++) {
          await app.vault.createBinary(
            `Row ${String(at).padStart(3, "0")}.ink.png`,
            bytes.slice().buffer,
          );
        }
      });
      await showLibrary();
      const more = browser.$(".inkline-library-more");
      await more.waitForExist();
      await pressOn(".inkline-library-more");
      await createSymbol("Row 101.ink.png");
      await pastRedraw();
      expect(await more.getText()).toBe("Show more: 1 left");
      await mouse().up().perform(true);
      await browser.waitUntil(
        async () =>
          (await browser.$$(".inkline-library-symbol").length) === 102,
      );
      expect(await more.isExisting()).toBe(false);
    });

    it("keeps a click when a form closes during the press", async function () {
      await createSymbol("gate.ink.png");
      await createSymbol("tower.ink.png");
      await openNote();
      await showLibrary();
      await waitForNames(["gate", "tower"]);
      await row("gate").$(".inkline-library-rename").click();
      await form().waitForExist();
      await pressOn(inRow("tower.ink.png", "insert"));
      await browser.execute(() => {
        const cancel = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".inkline-library-rename-form button",
          ),
        ).find((button) => button.textContent === "Cancel");
        if (cancel === undefined) throw new Error("no Cancel");
        cancel.click();
      });
      await mouse().up().perform(true);
      await waitForText("Copy.md", "Read ![[tower.ink.png]].\n");
      await waitForNames(["gate", "tower"]);
    });

    it("redraws once a press ends outside the list, with no click", async function () {
      await createSymbol("gate.ink.png");
      await showLibrary();
      await waitForNames(["gate"]);
      await pressOn(inRow("gate.ink.png", "rename"));
      await createSymbol("tower.ink.png");
      await pastRedraw();
      expect(await names()).toEqual(["gate"]);
      await mouse()
        .move({ origin: "viewport", x: 400, y: 300 })
        .up()
        .perform(true);
      await waitForNames(["gate", "tower"]);
      expect(await form().isExisting()).toBe(false);
    });

    it("stops waiting at a move with the button up, if no release came", async function () {
      await createSymbol("gate.ink.png");
      await showLibrary();
      await waitForNames(["gate"]);
      // As when a menu of the system's takes the release.
      await browser.execute(() => {
        document
          .querySelector(".inkline-library-list")
          ?.dispatchEvent(
            new PointerEvent("pointerdown", { button: 0, bubbles: true }),
          );
      });
      await createSymbol("tower.ink.png");
      await pastRedraw();
      expect(await names()).toEqual(["gate"]);
      await mouse().move({ origin: "viewport", x: 420, y: 320 }).perform(true);
      await waitForNames(["gate", "tower"]);
    });

    it("follows the library's tab to another window", async function () {
      await createSymbol("gate.ink.png");
      await showLibrary();
      await waitForNames(["gate"]);
      const listed = () =>
        browser.executeObsidian(({ app }) => {
          const [leaf] = app.workspace.getLeavesOfType("inkline-library");
          return (
            leaf?.view.containerEl.querySelectorAll(".inkline-library-symbol")
              .length ?? 0
          );
        });
      await browser.executeObsidian(({ app }) => {
        const [leaf] = app.workspace.getLeavesOfType("inkline-library");
        if (leaf === undefined) throw new Error("no library");
        app.workspace.moveLeafToPopout(leaf);
      });
      await browser.waitUntil(async () => (await listed()) === 1);
      await browser.executeObsidian(({ app }) => {
        const [leaf] = app.workspace.getLeavesOfType("inkline-library");
        const list = leaf?.view.containerEl.querySelector(
          ".inkline-library-list",
        );
        if (list === undefined || list === null) throw new Error("no list");
        if (list.win === window) throw new Error("not in another window");
        list.dispatchEvent(
          new PointerEvent("pointerdown", { button: 0, bubbles: true }),
        );
      });
      await createSymbol("tower.ink.png");
      await pastRedraw();
      expect(await listed()).toBe(1);
      await browser.executeObsidian(({ app }) => {
        const [leaf] = app.workspace.getLeavesOfType("inkline-library");
        leaf?.view.containerEl.win.dispatchEvent(new PointerEvent("pointerup"));
      });
      await browser.waitUntil(async () => (await listed()) === 2);
    });
  });
});
