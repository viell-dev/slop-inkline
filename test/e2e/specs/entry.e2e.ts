import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
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

/**
 * The sources of the file menus built since the last call, as `file-menu`
 * names them: Inkline's own menu is `inkline-symbol`.
 */
async function menuSources(): Promise<string[]> {
  return browser.execute(() => {
    const sources: unknown = Reflect.get(window, "fileMenuSources");
    return Array.isArray(sources) ? sources.splice(0).map(String) : [];
  });
}

/**
 * Opens `path` in Reading view in a new popout window and switches to it,
 * once the symbol there is drawn; returns the main window's handle.
 */
async function openPopout(path: string): Promise<string> {
  const main = await browser.getWindowHandle();
  const before = await browser.getWindowHandles();
  await browser.executeObsidian(async ({ app }, file) => {
    const found = app.vault.getFileByPath(file);
    if (found === null) throw new Error(`no ${file}`);
    await app.workspace
      .openPopoutLeaf()
      .openFile(found, { state: { mode: "preview" } });
  }, path);
  let popout: string | undefined;
  await browser.waitUntil(async () => {
    const handles = await browser.getWindowHandles();
    popout = handles.find((handle) => !before.includes(handle));
    return popout !== undefined;
  });
  if (popout === undefined) throw new Error("no popout window");
  await browser.switchToWindow(popout);
  return main;
}

/** Right-clicks the symbol in the popout window switched to. */
async function rightClickInPopout(): Promise<void> {
  const image = browser.$(".markdown-reading-view img.inkline-symbol");
  await image.waitForExist();
  await browser.waitUntil(async () =>
    image.getProperty("complete").then((complete) => complete === true),
  );
  await browser.pause(500);
  await image.click({ button: "right" });
}

/** Switches back to the main window, `main`, and closes every popout. */
async function closePopouts(main: string): Promise<void> {
  await browser.switchToWindow(main);
  await browser.executeObsidian(({ app }) => {
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view.containerEl.doc !== document) leaf.detach();
    }
  });
}

/**
 * Whether the command palette would offer Edit symbol in the active note,
 * as Obsidian asks the command; its API does not say.
 */
async function offered(): Promise<unknown> {
  return browser.executeObsidian(({ app, obsidian }) => {
    const commands: unknown = Reflect.get(app, "commands");
    const find: unknown = Reflect.get(Object(commands), "findCommand");
    if (typeof find !== "function") return "no findCommand";
    const command: unknown = Reflect.apply(find, commands, [
      "inkline:edit-symbol-at-cursor",
    ]);
    const check: unknown = Reflect.get(Object(command), "editorCheckCallback");
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (typeof check !== "function" || view === null) return "none";
    const answer: unknown = Reflect.apply(check, command, [
      true,
      view.editor,
      view,
    ]);
    return answer;
  });
}

/** Puts the cursor just after the `nth` `text` in the active note, from 0. */
async function cursorAfter(text: string, nth = 0): Promise<void> {
  await browser.executeObsidian(
    ({ app, obsidian }, wanted, count) => {
      const editor = app.workspace.getActiveViewOfType(
        obsidian.MarkdownView,
      )?.editor;
      if (editor === undefined) throw new Error("no editor");
      const value = editor.getValue();
      let at = -1;
      for (let index = 0; index <= count; index++) {
        at = value.indexOf(wanted, at + 1);
        if (at === -1) throw new Error(`no ${wanted}`);
      }
      editor.focus();
      editor.setCursor(editor.offsetToPos(at + wanted.length));
    },
    text,
    nth,
  );
}

/** Whether Obsidian's image viewer is open. */
async function viewerOpen(): Promise<boolean> {
  return browser.execute(() => document.querySelector(".lightbox") !== null);
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

/**
 * Where the focus is, what menus and modals are open, and where the last
 * Escape key went and whether anything handled it, as JSON. Watching for
 * Escape starts with the first call. #78 asks for this if the editor ever
 * stays open after Escape again.
 */
async function escapeState(): Promise<string> {
  return browser.execute(() => {
    const root = document.documentElement;
    const describe = (target: EventTarget | null): string => {
      if (!(target instanceof Element)) {
        return target === null ? "none" : target.constructor.name;
      }
      const classes = Array.from(target.classList).join(".");
      return `${target.tagName.toLowerCase()}${classes === "" ? "" : `.${classes}`}`;
    };
    if (!root.hasAttribute("data-inkline-escape-watch")) {
      root.setAttribute("data-inkline-escape-watch", "");
      window.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Escape") return;
          const target = describe(event.target);
          // After every handler has had the event.
          window.setTimeout(() => {
            root.setAttribute(
              "data-inkline-last-escape",
              JSON.stringify({ target, handled: event.defaultPrevented }),
            );
          }, 0);
        },
        { capture: true },
      );
    }
    return JSON.stringify({
      focus: describe(document.activeElement),
      windowFocused: document.hasFocus(),
      menus: document.querySelectorAll(".menu").length,
      modals: Array.from(document.querySelectorAll(".modal-container")).map(
        (container) => describe(container.querySelector(".modal")),
      ),
      lastEscape: root.getAttribute("data-inkline-last-escape"),
    });
  });
}

/** Closes the open editor, which has no changes. */
async function closeEditor(): Promise<void> {
  const before = await escapeState();
  await browser.keys(["Escape"]);
  try {
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
  } catch (error) {
    throw new Error(
      `the editor stayed open after Escape (#78): before ${before}, after ${await escapeState()}`,
      { cause: error },
    );
  }
}

describe("Editing a symbol from a note", function () {
  // A menu, editor, or image viewer a test leaves open would take the next
  // one's clicks.
  afterEach(async function () {
    for (let tries = 0; tries < 3; tries++) {
      const open = await browser.execute(
        () =>
          document.querySelector(
            ".menu, .inkline-editor, .modal, .lightbox",
          ) !== null,
      );
      if (!open) return;
      await browser.keys(["Escape"]);
      await browser.pause(200);
    }
  });

  before(async function () {
    await browser.executeObsidian(({ app }) => {
      const sources: string[] = [];
      Reflect.set(window, "fileMenuSources", sources);
      app.workspace.on("file-menu", (_menu, _file, source) => {
        sources.push(source);
      });
    });
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
    await menuSources();
    await rightClickSymbol("source");
    await browser.waitUntil(async () =>
      (await menuItems()).includes("Edit symbol"),
    );
    // Obsidian's menu, which Inkline neither replaces nor builds one under.
    expect(await menuItems()).toContain("Copy image");
    expect(await menuSources()).toEqual(["link-context-menu"]);
    await choose("Edit symbol");
    expect(await editorName()).toBe("001");
    await closeEditor();
  });

  it("shows a symbol's menu in Reading view, instead of the image viewer", async function () {
    await open("Entry.md", "preview");
    await menuSources();
    await rightClickSymbol("reading");
    await browser.waitUntil(async () => (await menuItems()).length > 0);
    // The menu Obsidian builds for a link to the file, as Live Preview's
    // image menu holds it.
    expect(await menuSources()).toEqual(["link-context-menu"]);
    const items = await menuItems();
    expect(items).toContain("Edit symbol");
    expect(items).toContain("Open in new tab");
    expect(items.some((item) => item.startsWith("Rename"))).toBe(true);
    expect(items).toContain("Reveal file in navigation");
    expect(items.filter((item) => item === "Edit symbol")).toHaveLength(1);
    // Obsidian opens its image viewer on a right-click there, as the picture
    // below shows, but not on a symbol's.
    await browser.pause(300);
    expect(await viewerOpen()).toBe(false);
    await choose("Edit symbol");
    expect(await editorName()).toBe("001");
    await closeEditor();
    // A picture that is no symbol gets no menu from Inkline, and Obsidian's
    // viewer opens as for any picture.
    await browser
      .$(
        ".workspace-leaf.mod-active .markdown-reading-view img:not(.inkline-symbol)",
      )
      .click({ button: "right" });
    await browser.waitUntil(viewerOpen);
    expect(await menuItems()).toEqual([]);
  });

  it("shows the menu in an embedded note and in a popout window", async function () {
    await open("Host.md", "preview");
    await rightClickSymbol("reading", ".markdown-embed");
    await browser.waitUntil(async () =>
      (await menuItems()).includes("Edit symbol"),
    );
    await browser.pause(300);
    expect(await viewerOpen()).toBe(false);
    await browser.keys(["Escape"]);
    const main = await openPopout("Entry.md");
    try {
      // A right-click in the popout's own window, where its menu shows, and
      // the editor opens.
      await rightClickInPopout();
      await browser.waitUntil(async () =>
        (await menuItems()).includes("Edit symbol"),
      );
      expect(await viewerOpen()).toBe(false);
      await choose("Edit symbol");
      expect(await editorName()).toBe("001");
      await closeEditor();
    } finally {
      await closePopouts(main);
    }
  });

  it("shows the menu in a popout window opened before Inkline was", async function () {
    let main: string | undefined;
    await obsidianPage.disablePlugin("inkline");
    try {
      main = await openPopout("Entry.md");
      await browser.switchToWindow(main);
    } finally {
      await obsidianPage.enablePlugin("inkline");
    }
    try {
      await browser.switchToWindow(
        (await browser.getWindowHandles()).find((handle) => handle !== main) ??
          main,
      );
      await rightClickInPopout();
      await browser.waitUntil(async () =>
        (await menuItems()).includes("Edit symbol"),
      );
      expect(await viewerOpen()).toBe(false);
      await browser.keys(["Escape"]);
    } finally {
      await closePopouts(main);
    }
  });

  it("shows no menu for a symbol's picture in the list of symbols", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("List.md", "Type HERE.\n");
    });
    await openAtMarker("List.md", "HERE");
    await browser.keys([";", ";", "0"]);
    const picture = browser.$(".inkline-suggestion-picture");
    await picture.waitForDisplayed();
    await picture.click({ button: "right" });
    await browser.pause(500);
    expect(await menuItems()).toEqual([]);
  });

  it("edits the symbol at the cursor with a command, and offers it only there", async function () {
    await open("Entry.md", "live");
    await cursorAfter("![[001.ink.png]]");
    await browser.executeObsidianCommand("inkline:edit-symbol-at-cursor");
    expect(await editorName()).toBe("001");
    await closeEditor();
    // Elsewhere, and on a picture that is no symbol, the command is not
    // offered, and does nothing.
    for (const text of ["Top line", "![[photo.png]]"]) {
      await cursorAfter(text);
      expect(await offered()).toBe(false);
      // And run anyway, it opens nothing.
      await browser.executeObsidianCommand("inkline:edit-symbol-at-cursor");
      await browser.pause(300);
      expect(await browser.$(".inkline-editor").isExisting()).toBe(false);
    }
    // In front matter and code, an opening fence's info string included,
    // an embed is text, and shows nothing.
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create(
        "Code.md",
        [
          "---",
          "pic: ![[001.ink.png]]",
          "---",
          "",
          "```![[001.ink.png]]",
          "![[001.ink.png]]",
          "",
          "![[001.ink.png]]",
          "```",
          "",
          "Shown: ![[001.ink.png]]",
          "",
        ].join("\n"),
      );
    });
    await open("Code.md", "source");
    for (const [nth, shown] of [
      [0, false],
      [1, false],
      [2, false],
      [3, false],
      [4, true],
    ] as const) {
      await cursorAfter("![[001.ink.png]]", nth);
      expect(await offered()).toBe(shown);
    }
  });

  it("offers Edit symbol once in the editor's menu on an embed's text", async function () {
    await open("Entry.md", "source");
    // Obsidian's menu is for where the click is, wherever the cursor was.
    for (const cursor of ["Top line", "001.ink.png"]) {
      await browser.executeObsidian(({ app, obsidian }, wanted) => {
        const editor = app.workspace.getActiveViewOfType(
          obsidian.MarkdownView,
        )?.editor;
        if (editor === undefined) throw new Error("no editor");
        const at = editor.getValue().indexOf(wanted);
        editor.focus();
        editor.setCursor(editor.offsetToPos(at + 3));
      }, cursor);
      await browser
        .$(".workspace-leaf.mod-active .markdown-source-view .cm-content")
        .$('.//span[contains(text(), "001.ink.png")]')
        .click({ button: "right" });
      await browser.waitUntil(async () => (await menuItems()).length > 0);
      const items = await menuItems();
      expect(items.filter((item) => item === "Edit symbol")).toHaveLength(1);
      await choose("Edit symbol");
      expect(await editorName()).toBe("001");
      await closeEditor();
    }
  });
});
