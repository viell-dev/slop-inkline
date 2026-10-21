import { browser, expect } from "@wdio/globals";
import { encodePng } from "../../support/png.ts";
import { toBase64 } from "../support/browser.ts";
import { draw, openAtMarker, waitForEditor } from "../support/editor.ts";

/** Opens `path` in the active leaf, in Live Preview, source, or Reading view. */
async function open(
  path: string,
  mode: "live" | "source" | "preview",
): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, file, viewMode) => {
      const found = app.vault.getFileByPath(file);
      if (found === null) throw new Error(`no ${file}`);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(found, {
        state: {
          mode: viewMode === "preview" ? "preview" : "source",
          source: viewMode === "source",
        },
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
    },
    path,
    mode,
  );
}

/**
 * Right-clicks the symbol's image in the active leaf's visible view, once it
 * is tagged; `within` narrows it, as to an embedded note.
 */
async function rightClickSymbol(
  view: "source" | "reading",
  within = "",
): Promise<void> {
  const image = browser.$(
    `.workspace-leaf.mod-active .markdown-${view}-view ${within} img.inkline-symbol`,
  );
  await image.waitForExist();
  // Loaded, and settled where the note puts it: an embedded note draws its
  // text a moment after it opens.
  await browser.waitUntil(async () =>
    image.getProperty("complete").then((complete) => complete === true),
  );
  await browser.pause(500);
  await image.click({ button: "right" });
}

/** The titles of the menu that is open, top first. */
async function menuItems(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".menu .menu-item-title")).map(
      (item) => item.textContent,
    ),
  );
}

/** Chooses the open menu's item `title`. */
async function choose(title: string): Promise<void> {
  const chosen = await browser.execute((wanted) => {
    const item = Array.from(
      document.querySelectorAll(".menu .menu-item-title"),
    ).find((found) => found.textContent === wanted);
    const button = item?.closest(".menu-item");
    if (!button?.instanceOf(HTMLElement)) return false;
    button.click();
    return true;
  }, title);
  if (!chosen) throw new Error(`no menu item "${title}"`);
}

/** The name of the symbol the open editor edits, from its title. */
async function editorName(): Promise<string> {
  await waitForEditor();
  return browser.execute(() => {
    const title = document.querySelector(".inkline-editor .modal-title");
    const field = title?.querySelector("input");
    return field?.value ?? title?.textContent ?? "";
  });
}

/** Closes the open editor, which has no changes. */
async function closeEditor(): Promise<void> {
  await browser.keys(["Escape"]);
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

describe("Editing a symbol from a note", function () {
  // A menu or editor a failed test leaves open would take the next one's
  // clicks.
  afterEach(async function () {
    for (let tries = 0; tries < 3; tries++) {
      const open = await browser.execute(
        () => document.querySelector(".menu, .inkline-editor, .modal") !== null,
      );
      if (!open) return;
      await browser.keys(["Escape"]);
      await browser.pause(200);
    }
  });

  before(async function () {
    const data = new Uint8Array(64 * 192 * 4).fill(160);
    await browser.executeObsidian(
      async ({ app }, photo) => {
        const bytes = Uint8Array.from(atob(photo), (c) => c.charCodeAt(0));
        await app.vault.createBinary("photo.png", bytes.buffer);
        await app.vault.create(
          "Entry.md",
          "Top line.\n\nA HERE here, and a ![[photo.png]] too.\n",
        );
        await app.vault.create("Host.md", "Host.\n\n![[Entry]]\n");
      },
      toBase64(encodePng({ width: 64, height: 192, data })),
    );
    // A symbol drawn as anyone would, which the note then embeds.
    await openAtMarker("Entry.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw([
      [0.4, 0.3],
      [0.5, 0.7],
    ]);
    await browser.keys(["Control", "Enter"]);
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
  });

  it("offers Edit symbol in Live Preview's own menu for the image", async function () {
    await open("Entry.md", "live");
    await rightClickSymbol("source");
    await browser.waitUntil(async () =>
      (await menuItems()).includes("Edit symbol"),
    );
    await choose("Edit symbol");
    expect(await editorName()).toBe("001");
    await closeEditor();
  });

  it("shows a symbol's menu in Reading view, where Obsidian shows none", async function () {
    await open("Entry.md", "preview");
    await rightClickSymbol("reading");
    await browser.waitUntil(async () => (await menuItems()).length > 0);
    // Obsidian's items for a file come with it, as in a file's menu.
    const items = await menuItems();
    expect(items).toContain("Edit symbol");
    expect(items).toContain("Reveal file in navigation");
    expect(items.filter((item) => item === "Edit symbol")).toHaveLength(1);
    await choose("Edit symbol");
    expect(await editorName()).toBe("001");
    await closeEditor();
    // A picture that is no symbol gets no menu from Inkline.
    await browser
      .$(
        ".workspace-leaf.mod-active .markdown-reading-view img:not(.inkline-symbol)",
      )
      .click({ button: "right" });
    await browser.pause(500);
    expect(await menuItems()).toEqual([]);
  });

  it("shows the menu in an embedded note and in a popout window", async function () {
    await open("Host.md", "preview");
    await rightClickSymbol("reading", ".markdown-embed");
    await browser.waitUntil(async () =>
      (await menuItems()).includes("Edit symbol"),
    );
    await browser.keys(["Escape"]);
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Entry.md");
      if (file === null) throw new Error("no Entry.md");
      await app.workspace
        .openPopoutLeaf()
        .openFile(file, { state: { mode: "preview" } });
    });
    try {
      // A right-click on the symbol there, as the popout's own document
      // gets it.
      await browser.waitUntil(async () =>
        browser.execute(() => {
          const image = activeDocument.querySelector("img.inkline-symbol");
          if (activeDocument === document || image === null) return false;
          image.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
          );
          return true;
        }),
      );
      let menus: string[] = [];
      try {
        await browser.waitUntil(async () => {
          menus = await browser.execute(() =>
            [activeDocument, document].flatMap((doc) =>
              Array.from(doc.querySelectorAll(".menu .menu-item-title")).map(
                (item) =>
                  `${doc === document ? "main" : "popout"}: ${item.textContent}`,
              ),
            ),
          );
          return menus.includes("popout: Edit symbol");
        });
      } catch (error) {
        throw new Error(`no menu in the popout: ${JSON.stringify(menus)}`, {
          cause: error,
        });
      }
    } finally {
      await browser.executeObsidian(({ app }) => {
        for (const leaf of app.workspace.getLeavesOfType("markdown")) {
          if (leaf.view.containerEl.doc !== document) leaf.detach();
        }
      });
    }
  });

  it("edits the symbol at the cursor with a command, and offers it only there", async function () {
    await open("Entry.md", "live");
    /** Puts the cursor just after the first `text` in the note. */
    const cursorAfter = async (text: string) => {
      await browser.executeObsidian(({ app, obsidian }, wanted) => {
        const editor = app.workspace.getActiveViewOfType(
          obsidian.MarkdownView,
        )?.editor;
        if (editor === undefined) throw new Error("no editor");
        const at = editor.getValue().indexOf(wanted);
        if (at === -1) throw new Error(`no ${wanted}`);
        editor.focus();
        editor.setCursor(editor.offsetToPos(at + wanted.length));
      }, text);
    };
    await cursorAfter("![[001.ink.png]]");
    await browser.executeObsidianCommand("inkline:edit-symbol-at-cursor");
    expect(await editorName()).toBe("001");
    await closeEditor();
    // Elsewhere, and on a picture that is no symbol, the command is not
    // offered, and does nothing.
    for (const text of ["Top line", "![[photo.png]]"]) {
      await cursorAfter(text);
      expect(
        await browser.executeObsidian(({ app, obsidian }) => {
          // Whether the palette would offer it, as Obsidian asks the
          // command; its API does not say.
          const commands: unknown = Reflect.get(app, "commands");
          const find: unknown = Reflect.get(Object(commands), "findCommand");
          if (typeof find !== "function") return "no findCommand";
          const command: unknown = Reflect.apply(find, commands, [
            "inkline:edit-symbol-at-cursor",
          ]);
          const check: unknown = Reflect.get(
            Object(command),
            "editorCheckCallback",
          );
          const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
          if (typeof check !== "function" || view === null) return "none";
          const offered: unknown = Reflect.apply(check, command, [
            true,
            view.editor,
            view,
          ]);
          return offered;
        }),
      ).toBe(false);
      // And run anyway, it opens nothing.
      await browser.executeObsidianCommand("inkline:edit-symbol-at-cursor");
      await browser.pause(300);
      expect(await browser.$(".inkline-editor").isExisting()).toBe(false);
    }
  });

  it("offers Edit symbol in the editor's menu on an embed's text", async function () {
    await open("Entry.md", "source");
    await browser.executeObsidian(({ app, obsidian }) => {
      const editor = app.workspace.getActiveViewOfType(
        obsidian.MarkdownView,
      )?.editor;
      if (editor === undefined) throw new Error("no editor");
      const at = editor.getValue().indexOf("001.ink.png");
      editor.focus();
      editor.setCursor(editor.offsetToPos(at + 3));
    });
    // Right-clicked on the embed's own text, where the cursor goes.
    await browser
      .$(".workspace-leaf.mod-active .markdown-source-view .cm-active.cm-line")
      .$('.//span[contains(text(), "001.ink.png")]')
      .click({ button: "right" });
    await browser.waitUntil(async () => (await menuItems()).length > 0);
    expect(await menuItems()).toContain("Edit symbol");
    await choose("Edit symbol");
    expect(await editorName()).toBe("001");
    await closeEditor();
  });
});
