import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { encodePng } from "../../support/png.ts";
import { loadModules, toBase64 } from "../support/browser.ts";
import { createSymbol } from "../support/editor.ts";
import {
  choose,
  closeEditor,
  editorName,
  escapeState,
  menuItems,
  menuLoaded,
} from "../support/menus.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** A place in the window, in its own pixels. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/** What a card's text holds, to tell cards apart. */
const textCard = "Plain words";
const noteCard = "Noted";

/** A table with a symbol in each row, which tests sort. */
const tableNote = [
  "| Left | Right |",
  "| --- | --- |",
  "| b ![[Two.ink.png]] | ![[photo.png\\|20]] |",
  "| a ![[One.ink.png]] | words |",
  "",
  "Last line.",
  "",
].join("\n");

/**
 * Opens `path` in the active leaf, a note in Live Preview, with the cursor at
 * its end, away from any block, which shows as text with the cursor in it.
 */
async function open(path: string): Promise<void> {
  await browser.executeObsidian(async ({ app, obsidian }, file) => {
    const found = app.vault.getFileByPath(file);
    if (found === null) throw new Error(`no ${file}`);
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(found, { state: { mode: "source", source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    if (!(leaf.view instanceof obsidian.MarkdownView)) {
      throw new Error(`${file} is no note`);
    }
    const { editor } = leaf.view;
    editor.focus();
    editor.setCursor(editor.lastLine(), 0);
  }, path);
}

/** The middle of the first element `selector` finds that has a size. */
async function middleOf(selector: string): Promise<Point | null> {
  return browser.execute((wanted) => {
    for (const found of Array.from(document.querySelectorAll(wanted))) {
      const box = found.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      return {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
      };
    }
    return null;
  }, selector);
}

/** Waits until `read` gives a place that stays there, and gives it. */
async function settled(
  read: () => Promise<Point | null>,
  what: string,
): Promise<Point> {
  let last: Point | null = null;
  let held = 0;
  return browser.waitUntil(
    async () => {
      const now = await read();
      held =
        now !== null && now.x === last?.x && now.y === last.y ? held + 1 : 0;
      last = now;
      return held >= 2 ? now : false;
    },
    { interval: 150, timeoutMsg: `${what} did not settle` },
  );
}

/** The settled middle of the first of `selector` with a size. */
async function placeOf(selector: string): Promise<Point> {
  return settled(() => middleOf(selector), selector);
}

/** Presses the right button at `point`. */
async function rightClick(point: Point): Promise<void> {
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move(point)
    .down({ button: 2 })
    .up({ button: 2 })
    .perform();
}

/** Presses the left button at `point`. */
async function click(point: Point): Promise<void> {
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move(point)
    .down({ button: 0 })
    .up({ button: 0 })
    .perform();
}

/**
 * The titles of the menu a right-click at `point` opens, which must be the only
 * one: a menu of Inkline's beside the block's would read as one list.
 */
async function menuAt(point: Point): Promise<string[]> {
  await rightClick(point);
  await browser.waitUntil(async () => (await menuItems()).length > 0);
  // Inkline's own would show once the event is over.
  await browser.pause(100);
  expect(await browser.$$(".menu").length).toBe(1);
  return menuItems();
}

/** How many times the menu holds Edit symbol. */
function editItems(items: readonly string[]): number {
  return items.filter((item) => item === "Edit symbol").length;
}

/**
 * Closes the open menu, once it has the keyboard: CI once saw a table's menu
 * stay open after an Escape pressed before it did (#78).
 */
async function closeMenu(): Promise<void> {
  await menuLoaded();
  const before = await escapeState();
  await browser.keys(["Escape"]);
  try {
    await browser.$(".menu").waitForExist({ reverse: true });
  } catch (error) {
    throw new Error(
      `a menu stayed open after Escape (#78): before ${before}, after ${await escapeState()}`,
      { cause: error },
    );
  }
}

/** Chooses Edit symbol in the open menu, and closes the editor it opens. */
async function editsSymbol(name: string): Promise<void> {
  await choose("Edit symbol");
  expect(await editorName()).toBe(name);
  await closeEditor();
}

/** Whether Obsidian's image viewer is open. */
async function viewerOpen(): Promise<boolean> {
  return browser.execute(() => document.querySelector(".lightbox") !== null);
}

/**
 * Fits the active canvas's cards to its window, once they have drawn their
 * symbols: a canvas opens where it was last left, and a smaller window can
 * leave them out of sight.
 */
async function fitCards(): Promise<void> {
  await browser.$(".canvas-node img.inkline-symbol").waitForExist();
  await browser.waitUntil(async () =>
    browser.execute(() =>
      Array.from(
        document.querySelectorAll<HTMLImageElement>(".canvas-node img"),
      ).every((image) => image.complete),
    ),
  );
  const fit = browser.$(
    '.workspace-leaf.mod-active .canvas-controls [aria-label*="fit" i]',
  );
  try {
    await fit.waitForExist({ timeout: 3000 });
  } catch (error) {
    const labels = await browser.execute(() =>
      Array.from(document.querySelectorAll(".canvas-controls *"))
        .map((item) => item.getAttribute("aria-label"))
        .filter((label) => label !== null),
    );
    throw new Error(`no fit control in ${labels.join(", ")}`, { cause: error });
  }
  await fit.click();
  await placeOf(".canvas-node img.inkline-symbol");
}

/** Opens the canvas at `path`, with its cards in sight and none focused. */
async function openCanvas(path: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, file) => {
    const found = app.vault.getFileByPath(file);
    if (found === null) throw new Error(`no ${file}`);
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(found);
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, path);
  await fitCards();
  await leaveCards();
}

/** Clicks the canvas beside its cards, which ends any selection or editing. */
async function leaveCards(): Promise<void> {
  const blank = await browser.execute(() => {
    const wrapper = document.querySelector(
      ".workspace-leaf.mod-active .canvas-wrapper",
    );
    if (wrapper === null) throw new Error("no canvas");
    const box = wrapper.getBoundingClientRect();
    return { x: Math.round(box.x + 30), y: Math.round(box.y + 30) };
  });
  await click(blank);
  await browser.waitUntil(async () =>
    browser.execute(
      () =>
        document.querySelector(
          ".canvas-node.is-focused, .canvas-node.is-selected",
        ) === null,
    ),
  );
}

/** The middle of the last `selector` in the card whose text holds `card`. */
async function placeInCard(card: string, selector: string): Promise<Point> {
  return settled(
    () =>
      browser.execute(
        (text, wanted) => {
          const card = Array.from(
            document.querySelectorAll(".canvas-node"),
          ).find((node) => node.textContent.includes(text));
          const found = Array.from(card?.querySelectorAll(wanted) ?? []).at(-1);
          if (found === undefined) return null;
          const box = found.getBoundingClientRect();
          return {
            x: Math.round(box.x + box.width / 2),
            y: Math.round(box.y + box.height / 2),
          };
        },
        card,
        selector,
      ),
    `${selector} in the card with ${card}`,
  );
}

/** Clicks the text card's last paragraph, which focuses the card. */
async function focusTextCard(): Promise<void> {
  await click(await placeInCard(textCard, "p"));
  await browser.$(".canvas-node.is-focused").waitForExist();
}

/**
 * Opens the text card's own editor, from its menu, as the canvas's Edit does,
 * and puts the cursor at `text` in it.
 */
async function editCard(text: string): Promise<void> {
  await menuAt(await placeInCard(textCard, "p"));
  await choose("Edit");
  await browser.$(".canvas-node.is-editing iframe").waitForExist();
  await cursorInCard(text);
}

/** Puts the cursor at `text` in the card's editor. */
async function cursorInCard(text: string): Promise<void> {
  await browser.waitUntil(async () =>
    browser.executeObsidian(({ app }, wanted) => {
      const editor = app.workspace.activeEditor?.editor;
      if (editor === undefined) return false;
      const at = editor.getValue().indexOf(wanted);
      if (at === -1) return false;
      editor.focus();
      editor.setCursor(editor.offsetToPos(at));
      return true;
    }, text),
  );
}

/**
 * The middle of `selector` in the card's editor, in the window's pixels: the
 * editor is a document of its own, in a frame the canvas can scale.
 */
async function placeInCardEditor(selector: string): Promise<Point> {
  return settled(
    () =>
      browser.execute((wanted) => {
        const frame = document.querySelector<HTMLIFrameElement>(
          ".canvas-node.is-editing iframe",
        );
        const found = frame?.contentDocument?.querySelector(wanted);
        if (frame === null || found === undefined || found === null) {
          return null;
        }
        const outer = frame.getBoundingClientRect();
        const box = found.getBoundingClientRect();
        const scale = outer.width / frame.offsetWidth;
        return {
          x: Math.round(outer.x + (box.x + box.width / 2) * scale),
          y: Math.round(outer.y + (box.y + box.height / 2) * scale),
        };
      }, selector),
    `${selector} in the card's editor`,
  );
}

/** The commands the command palette lists for `query`. */
async function paletteOffers(query: string): Promise<string[]> {
  await browser.executeObsidianCommand("command-palette:open");
  const input = browser.$(".prompt-input");
  await input.waitForDisplayed();
  await browser.keys(query);
  await browser.waitUntil(async () =>
    input.getValue().then((value) => value === query),
  );
  // The list follows the typing a moment later.
  await browser.pause(300);
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".prompt .suggestion-title")).map(
      (title) => title.textContent,
    ),
  );
}

describe("Edit symbol in Obsidian's own menus", function () {
  // A menu, editor, or image viewer a test leaves open would take the next
  // one's clicks.
  afterEach(async function () {
    for (let tries = 0; tries < 3; tries++) {
      const open = await browser.execute(
        () =>
          document.querySelector(
            ".menu, .inkline-editor, .modal, .lightbox, .prompt",
          ) !== null,
      );
      if (!open) return;
      await browser.keys(["Escape"]);
      await browser.pause(200);
    }
  });

  before(async function () {
    await loadModules();
    await createSymbol("One.ink.png", [400]);
    await createSymbol("Two.ink.png", [200, 800]);
    await createSymbol("Folder/Three.ink.png", [600]);
    const data = new Uint8Array(32 * 32 * 4).fill(160);
    await browser.executeObsidian(
      async ({ app }, photo, table) => {
        const bytes = Uint8Array.from(atob(photo), (c) => c.charCodeAt(0));
        await app.vault.createBinary("photo.png", bytes.buffer);
        await app.vault.create(
          "Callout.md",
          [
            "First ![[One.ink.png]] line.",
            "",
            "> [!note] Title",
            "> Then ![[Two.ink.png]] and ![[photo.png|20]] words.",
            "",
            "Last line.",
            "",
          ].join("\n"),
        );
        await app.vault.create("Table.md", table);
        await app.vault.create(
          "Note.md",
          "Noted ![[Two.ink.png]] words.\n\nMore words here.\n",
        );
        const card = {
          type: "text",
          width: 440,
          height: 260,
        };
        await app.vault.create(
          "Board.canvas",
          JSON.stringify({
            nodes: [
              {
                ...card,
                id: "text",
                x: -460,
                y: -280,
                text: [
                  "First ![[One.ink.png]] then ![[Two.ink.png]] and ![[photo.png|20]].",
                  "",
                  "Plain words.",
                ].join("\n"),
              },
              {
                id: "note",
                type: "file",
                file: "Note.md",
                x: 20,
                y: -280,
                width: 440,
                height: 260,
              },
              {
                id: "symbol",
                type: "file",
                file: "One.ink.png",
                x: -460,
                y: 20,
                width: 200,
                height: 200,
              },
            ],
            edges: [],
          }),
        );
        // A card with a symbol, under one that shows only words.
        await app.vault.create(
          "Overlap.canvas",
          JSON.stringify({
            nodes: [
              {
                ...card,
                id: "under",
                x: 0,
                y: 0,
                text: "![[One.ink.png]] ![[One.ink.png]] ![[One.ink.png]]",
              },
              {
                ...card,
                id: "over",
                x: 0,
                y: 0,
                text: "Over the symbols.",
              },
            ],
            edges: [],
          }),
        );
        // A link that leads to its symbol only from the canvas's own folder.
        await app.vault.create(
          "Folder/Near.canvas",
          JSON.stringify({
            nodes: [
              {
                ...card,
                id: "near",
                x: 0,
                y: 0,
                text: "Near ![[./Three.ink.png]] end.\n\nPlain words.",
              },
            ],
            edges: [],
          }),
        );
        // A card to add a symbol to, in its editor.
        await app.vault.create(
          "Typed.canvas",
          JSON.stringify({
            nodes: [
              {
                ...card,
                id: "typed",
                x: 0,
                y: 0,
                text: "Start ![[One.ink.png]] here.\n\nPlain words.",
              },
            ],
            edges: [],
          }),
        );
        // Blocks in a card, for the card's editor.
        await app.vault.create(
          "Blocks.canvas",
          JSON.stringify({
            nodes: [
              {
                id: "blocks",
                type: "text",
                x: 0,
                y: 0,
                width: 560,
                height: 460,
                text: [
                  "> [!note] Title",
                  "> Then ![[Two.ink.png]] words.",
                  "",
                  "| Left | Right |",
                  "| --- | --- |",
                  "| ![[One.ink.png]] | words |",
                  "",
                  "Plain words.",
                ].join("\n"),
              },
            ],
            edges: [],
          }),
        );
      },
      toBase64(encodePng({ width: 32, height: 32, data })),
      tableNote,
    );
  });

  describe("in a callout in Live Preview", function () {
    const callout = ".workspace-leaf.mod-active .cm-callout";

    /** Opens the note with the cursor away from the callout. */
    async function openCallout(): Promise<void> {
      await open("Callout.md");
      await browser.$(`${callout} img.inkline-symbol`).waitForExist();
    }

    it("adds Edit symbol to the callout's menu on the symbol", async function () {
      await openCallout();
      const items = await menuAt(
        await placeOf(`${callout} img.inkline-symbol`),
      );
      await saveScreenshot("menu-callout");
      expect(items).toContain("Callout type");
      expect(items).toContain("Edit");
      expect(editItems(items)).toBe(1);
      await editsSymbol("Two");
    });

    it("keeps the callout's own items working on the symbol", async function () {
      await openCallout();
      await menuAt(await placeOf(`${callout} img.inkline-symbol`));
      await choose("Edit");
      // Edit puts the cursor in the callout, which shows as its text.
      await browser.$(callout).waitForExist({ reverse: true });
    });

    it("leaves the callout's menu alone off the symbol", async function () {
      await openCallout();
      for (const elsewhere of [
        `${callout} .callout-title-inner`,
        `${callout} img:not(.inkline-symbol)`,
      ]) {
        const items = await menuAt(await placeOf(elsewhere));
        expect(items).toContain("Callout type");
        expect(editItems(items)).toBe(0);
        await closeMenu();
      }
      await menuAt(await placeOf(`${callout} .callout-title-inner`));
      await choose("Edit");
      await browser.$(callout).waitForExist({ reverse: true });
    });

    it("stops answering once Inkline is off", async function () {
      await openCallout();
      await obsidianPage.disablePlugin("inkline");
      try {
        // Marked as a symbol still, for a listener left behind to answer.
        await browser.execute((selector) => {
          document.querySelector(selector)?.classList.add("inkline-symbol");
        }, `${callout} img`);
        const items = await menuAt(await placeOf(`${callout} img`));
        expect(items).toContain("Callout type");
        expect(editItems(items)).toBe(0);
        await closeMenu();
      } finally {
        await obsidianPage.enablePlugin("inkline");
      }
    });
  });

  describe("in a table in Live Preview", function () {
    const table = ".workspace-leaf.mod-active .cm-table-widget";
    const rows = `${table} tbody tr`;

    /** Puts the note's text back, and opens it with no cell being edited. */
    async function openTable(): Promise<void> {
      await open("Table.md");
      // Through the editor, whose own save would overwrite a change to the
      // file made just after a sort.
      await browser.executeObsidian(({ app, obsidian }, note) => {
        const editor = app.workspace.getActiveViewOfType(
          obsidian.MarkdownView,
        )?.editor;
        if (editor === undefined) throw new Error("no editor");
        editor.setValue(note);
        editor.setCursor(editor.lastLine(), 0);
      }, tableNote);
      await browser.$(`${table} img.inkline-symbol`).waitForExist();
    }

    /** The first column's rows, top first, by what the note holds. */
    async function firstColumn(): Promise<string[]> {
      return browser.executeObsidian(({ app, obsidian }) => {
        const editor = app.workspace.getActiveViewOfType(
          obsidian.MarkdownView,
        )?.editor;
        if (editor === undefined) throw new Error("no editor");
        return editor
          .getValue()
          .split("\n")
          .filter((line) => line.includes("ink.png"))
          .map((line) => line.split("|")[1]?.trim() ?? "");
      });
    }

    it("adds Edit symbol to the table's menu on the symbol", async function () {
      await openTable();
      const items = await menuAt(
        await placeOf(`${rows}:nth-child(2) img.inkline-symbol`),
      );
      await saveScreenshot("menu-table");
      expect(items).toContain("Row");
      expect(items).toContain("Column");
      expect(editItems(items)).toBe(1);
      await editsSymbol("One");
      await menuAt(await placeOf(`${rows}:nth-child(1) img.inkline-symbol`));
      await editsSymbol("Two");
    });

    it("leaves the table's menu alone off the symbol", async function () {
      await openTable();
      for (const elsewhere of [
        `${rows}:nth-child(2) td:nth-child(2)`,
        `${rows}:nth-child(1) img:not(.inkline-symbol)`,
      ]) {
        const items = await menuAt(await placeOf(elsewhere));
        expect(items).toContain("Row");
        expect(editItems(items)).toBe(0);
        await closeMenu();
      }
    });

    it("keeps the table's own items working, on and off the symbol", async function () {
      await openTable();
      await menuAt(await placeOf(`${rows}:nth-child(1) img.inkline-symbol`));
      await choose("Sort by column (A to Z)");
      await browser.waitUntil(async () =>
        firstColumn().then(([top]) => top === "a ![[One.ink.png]]"),
      );
      await openTable();
      await menuAt(await placeOf(`${rows}:nth-child(2) td:nth-child(2)`));
      await choose("Sort by column (Z to A)");
      await browser.waitUntil(async () =>
        firstColumn().then(([top]) => top === "a ![[One.ink.png]]"),
      );
    });

    it("offers it once in the image's menu in a cell being edited", async function () {
      await openTable();
      // A click on the cell's text starts editing it, which shows the cell
      // in an editor of its own.
      const cell = await placeOf(`${rows}:nth-child(1) td:nth-child(1)`);
      await click({ x: cell.x - 40, y: cell.y });
      await browser.$(`${table} td .cm-editor`).waitForExist();
      const items = await menuAt(
        await placeOf(`${table} td .cm-editor img.inkline-symbol`),
      );
      expect(items).toContain("Copy image");
      expect(editItems(items)).toBe(1);
      await editsSymbol("Two");
    });
  });

  describe("on a canvas", function () {
    const symbolOne = 'img.inkline-symbol[alt="One.ink.png"]';
    const symbolTwo = 'img.inkline-symbol[alt="Two.ink.png"]';

    it("adds Edit symbol to the menu of a card that is not focused", async function () {
      await openCanvas("Board.canvas");
      const items = await menuAt(await placeInCard(textCard, symbolTwo));
      await saveScreenshot("menu-card");
      expect(items).toContain("Zoom to selection");
      expect(items).toContain("Convert to file...");
      expect(editItems(items)).toBe(1);
      expect(await viewerOpen()).toBe(false);
      await editsSymbol("Two");
      await leaveCards();
      await menuAt(await placeInCard(textCard, symbolOne));
      await editsSymbol("One");
    });

    it("keeps a card's own items working on the symbol", async function () {
      await openCanvas("Board.canvas");
      await menuAt(await placeInCard(textCard, symbolTwo));
      await choose("Edit");
      await browser.$(".canvas-node.is-editing").waitForExist();
    });

    it("leaves a card's menu alone off the symbol", async function () {
      await openCanvas("Board.canvas");
      for (const elsewhere of ["p", "img:not(.inkline-symbol)"]) {
        await leaveCards();
        const items = await menuAt(await placeInCard(textCard, elsewhere));
        expect(items).toContain("Convert to file...");
        expect(editItems(items)).toBe(0);
        await closeMenu();
      }
      await leaveCards();
      await menuAt(await placeInCard(textCard, "p"));
      await choose("Edit");
      await browser.$(".canvas-node.is-editing").waitForExist();
    });

    it("shows the symbol's menu in a focused card, and the card's beside it", async function () {
      await openCanvas("Board.canvas");
      await focusTextCard();
      const items = await menuAt(await placeInCard(textCard, symbolTwo));
      await saveScreenshot("menu-focused-card");
      expect(items).toContain("Open in new tab");
      expect(items).not.toContain("Convert to file...");
      expect(editItems(items)).toBe(1);
      await browser.pause(300);
      expect(await viewerOpen()).toBe(false);
      await editsSymbol("Two");
      // Still focused, the card's own menu is on the rest of it.
      await leaveCards();
      await focusTextCard();
      const beside = await menuAt(await placeInCard(textCard, "p"));
      expect(beside).toContain("Convert to file...");
      expect(editItems(beside)).toBe(0);
      await choose("Edit");
      await browser.$(".canvas-node.is-editing").waitForExist();
    });

    it("adds Edit symbol to the menu of a note on the canvas", async function () {
      await openCanvas("Board.canvas");
      const items = await menuAt(await placeInCard(noteCard, symbolTwo));
      expect(items).toContain("Swap file...");
      expect(editItems(items)).toBe(1);
      await editsSymbol("Two");
      await leaveCards();
      const beside = await menuAt(await placeInCard(noteCard, "p"));
      expect(beside).toContain("Swap file...");
      expect(editItems(beside)).toBe(0);
    });

    it("adds Edit symbol on a callout or a table in a card", async function () {
      await openCanvas("Blocks.canvas");
      const inCallout = await menuAt(
        await placeInCard(textCard, ".callout img.inkline-symbol"),
      );
      expect(inCallout).toContain("Convert to file...");
      expect(editItems(inCallout)).toBe(1);
      await editsSymbol("Two");
      await leaveCards();
      const inTable = await menuAt(
        await placeInCard(textCard, "table img.inkline-symbol"),
      );
      expect(inTable).toContain("Convert to file...");
      expect(editItems(inTable)).toBe(1);
      await editsSymbol("One");
    });

    it("offers it once on a symbol file on the canvas", async function () {
      await openCanvas("Board.canvas");
      const items = await menuAt(
        await placeOf(".canvas-node-content.media-embed img"),
      );
      expect(items).toContain("Swap file...");
      expect(editItems(items)).toBe(1);
      await editsSymbol("One");
    });

    it("adds Edit symbol to the menu of several selected cards", async function () {
      await openCanvas("Board.canvas");
      await browser.keys(["Control", "a"]);
      await browser.$(".canvas-node.is-selected").waitForExist();
      const items = await menuAt(await placeInCard(textCard, symbolOne));
      expect(items).toContain("Create group");
      expect(editItems(items)).toBe(1);
      await editsSymbol("One");
    });

    it("leaves the menu alone over a symbol in a card underneath", async function () {
      await openCanvas("Overlap.canvas");
      const point = await browser.execute(() => {
        const image = document.querySelector(".canvas-node img.inkline-symbol");
        if (image === null) throw new Error("no symbol");
        const box = image.getBoundingClientRect();
        return {
          x: Math.round(box.x + box.width / 2),
          y: Math.round(box.y + box.height / 2),
        };
      });
      const items = await menuAt(point);
      expect(items).toContain("Convert to file...");
      expect(editItems(items)).toBe(0);
    });

    it("keeps the card's menu if the canvas's sheet has another name", async function () {
      await openCanvas("Board.canvas");
      // As if Obsidian renamed the class, with the sheet still over the card.
      await browser.execute(() => {
        for (const sheet of Array.from(
          document.querySelectorAll<HTMLElement>(
            ".canvas-node-content-blocker",
          ),
        )) {
          sheet.className = "renamed-blocker";
          sheet.setCssStyles({ position: "absolute", inset: "0", zIndex: "9" });
        }
      });
      try {
        const items = await menuAt(await placeInCard(textCard, symbolTwo));
        expect(items).toContain("Convert to file...");
        expect(editItems(items)).toBe(0);
      } finally {
        await browser.execute(() => {
          for (const sheet of Array.from(
            document.querySelectorAll<HTMLElement>(".renamed-blocker"),
          )) {
            sheet.className = "canvas-node-content-blocker";
            sheet.removeAttribute("style");
          }
        });
      }
    });

    it("adds Edit symbol to a card's menu in a popout window", async function () {
      const main = await browser.getWindowHandle();
      const before = await browser.getWindowHandles();
      await browser.executeObsidian(async ({ app }) => {
        const found = app.vault.getFileByPath("Board.canvas");
        if (found === null) throw new Error("no canvas");
        await app.workspace.openPopoutLeaf().openFile(found);
      });
      let popout: string | undefined;
      await browser.waitUntil(async () => {
        const handles = await browser.getWindowHandles();
        popout = handles.find((handle) => !before.includes(handle));
        return popout !== undefined;
      });
      if (popout === undefined) throw new Error("no popout window");
      try {
        await browser.switchToWindow(popout);
        await fitCards();
        const items = await menuAt(await placeInCard(textCard, symbolTwo));
        expect(items).toContain("Convert to file...");
        expect(editItems(items)).toBe(1);
        await editsSymbol("Two");
      } finally {
        await browser.switchToWindow(main);
        await browser.executeObsidian(({ app }) => {
          for (const leaf of app.workspace.getLeavesOfType("canvas")) {
            if (leaf.view.containerEl.doc !== document) leaf.detach();
          }
        });
      }
    });
  });

  describe("in a canvas card's own editor", function () {
    /** The palette's entries for Edit symbol, then closes it. */
    const offered = async (): Promise<string[]> => {
      const commands = await paletteOffers("Inkline: Edit symbol");
      await browser.keys(["Escape"]);
      await browser.$(".prompt").waitForExist({ reverse: true });
      // Obsidian draws the colon after the plugin's name itself.
      return commands.filter((command) => command.endsWith("Edit symbol"));
    };

    it("offers the command on an embed, and only there", async function () {
      await openCanvas("Board.canvas");
      await editCard("Two.ink.png");
      await saveScreenshot("card-editor");
      expect(await offered()).toHaveLength(1);
      await browser.executeObsidianCommand("inkline:edit-symbol-at-cursor");
      expect(await editorName()).toBe("Two");
      await closeEditor();
      await cursorInCard("One.ink.png");
      await browser.executeObsidianCommand("inkline:edit-symbol-at-cursor");
      expect(await editorName()).toBe("One");
      await closeEditor();
      for (const elsewhere of ["Plain words", "photo.png"]) {
        await cursorInCard(elsewhere);
        expect(await offered()).toHaveLength(0);
      }
    });

    it("runs the command from the palette", async function () {
      await openCanvas("Board.canvas");
      await editCard("One.ink.png");
      await paletteOffers("Inkline: Edit symbol");
      await browser.keys(["Enter"]);
      expect(await editorName()).toBe("One");
      await closeEditor();
    });

    it("resolves an embed from the canvas's own folder", async function () {
      await openCanvas("Folder/Near.canvas");
      await editCard("Three.ink.png");
      expect(await offered()).toHaveLength(1);
      await browser.executeObsidianCommand("inkline:edit-symbol-at-cursor");
      expect(await editorName()).toBe("Three");
      await closeEditor();
    });

    it("offers Edit symbol in the image's menu there", async function () {
      await openCanvas("Board.canvas");
      await editCard("Plain words");
      const items = await menuAt(
        await placeInCardEditor('img.inkline-symbol[alt="Two.ink.png"]'),
      );
      expect(items).toContain("Copy image");
      expect(editItems(items)).toBe(1);
      await editsSymbol("Two");
    });

    it("adds Edit symbol to a callout's and a table's menus there", async function () {
      await openCanvas("Blocks.canvas");
      await menuAt(await placeInCard("Plain words", "p"));
      await choose("Edit");
      await browser.$(".canvas-node.is-editing iframe").waitForExist();
      await cursorInCard("Plain words");
      const inCallout = await menuAt(
        await placeInCardEditor(".cm-callout img.inkline-symbol"),
      );
      await saveScreenshot("menu-card-editor-callout");
      expect(inCallout).toContain("Callout type");
      expect(editItems(inCallout)).toBe(1);
      await editsSymbol("Two");
      const inTable = await menuAt(
        await placeInCardEditor(".cm-table-widget img.inkline-symbol"),
      );
      expect(inTable).toContain("Row");
      expect(editItems(inTable)).toBe(1);
      await editsSymbol("One");
      const beside = await menuAt(
        await placeInCardEditor(".cm-table-widget tbody td:nth-child(2)"),
      );
      expect(beside).toContain("Row");
      expect(editItems(beside)).toBe(0);
      await closeMenu();
      // The frame goes with the editor, and Inkline's listeners with it, which
      // end on its window's unload.
      await browser.execute(() => {
        document
          .querySelector<HTMLIFrameElement>(".canvas-node.is-editing iframe")
          ?.contentWindow?.addEventListener("unload", () => {
            Reflect.set(window, "cardEditorUnloaded", true);
          });
      });
      await leaveCards();
      await browser
        .$(".canvas-node.is-editing")
        .waitForExist({ reverse: true });
      await browser.waitUntil(async () =>
        browser.execute(
          () => Reflect.get(window, "cardEditorUnloaded") === true,
        ),
      );
      // Opened again, the card's editor is a new document.
      await editCard("Plain words");
      const again = await menuAt(
        await placeInCardEditor(".cm-callout img.inkline-symbol"),
      );
      expect(editItems(again)).toBe(1);
      await editsSymbol("Two");
      // The callout's own menu works off the symbol there.
      await menuAt(await placeInCardEditor(".cm-callout .callout-title-inner"));
      await choose("Edit");
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            document
              .querySelector<HTMLIFrameElement>(
                ".canvas-node.is-editing iframe",
              )
              ?.contentDocument?.querySelector(".cm-callout") === null,
        ),
      );
    });

    it("shows a symbol added there as text, and offers it", async function () {
      await openCanvas("Typed.canvas");
      await editCard("Plain words");
      await browser.executeObsidian(({ app }) => {
        const editor = app.workspace.activeEditor?.editor;
        if (editor === undefined) throw new Error("no editor");
        editor.replaceRange(
          "Added ![[Two.ink.png]] now.\n\n",
          editor.offsetToPos(editor.getValue().indexOf("Plain words")),
        );
      });
      await cursorInCard("Plain words");
      const added = 'img.inkline-symbol[alt="Two.ink.png"]';
      const point = await placeInCardEditor(added);
      await saveScreenshot("card-editor-added");
      const shown = await browser.execute((selector) => {
        const frame = document.querySelector<HTMLIFrameElement>(
          ".canvas-node.is-editing iframe",
        );
        const inner = frame?.contentDocument;
        return {
          height: inner?.querySelector(selector)?.getBoundingClientRect()
            .height,
          scale:
            inner?.documentElement.style.getPropertyValue("--inkline-scale"),
        };
      }, added);
      // As tall as a line, where the picture is 192 pixels tall.
      expect(shown.height).toBeLessThan(40);
      expect(shown.scale).toBe("1");
      const items = await menuAt(point);
      expect(editItems(items)).toBe(1);
      await editsSymbol("Two");
    });
  });
});
