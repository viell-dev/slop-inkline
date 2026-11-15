import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { encodePng } from "../../support/png.ts";
import { loadModules, toBase64 } from "../support/browser.ts";
import {
  cursorInCard,
  leaveCards,
  openCanvas,
  placeInCard,
  placeInCardEditor,
} from "../support/canvas.ts";
import { createSymbol } from "../support/editor.ts";
import { closeEditor, editorName } from "../support/menus.ts";
import {
  click,
  doubleClick,
  placeOf,
  settled,
  type Point,
} from "../support/pointer.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** The note the tests double-click in, with symbols in text and in blocks. */
const note = [
  "Top line.",
  "",
  "Words ![[One.ink.png]] and more words.",
  "",
  "Photo ![[photo.png|120]] here.",
  "",
  "> [!note] Title",
  "> In ![[Two.ink.png]] callout.",
  "",
  "| Left | Right |",
  "| --- | --- |",
  "| x ![[Two.ink.png]] | words |",
  "",
  "Last line.",
  "",
].join("\n");

const live = ".workspace-leaf.mod-active .markdown-source-view";
const reading = ".workspace-leaf.mod-active .markdown-reading-view";
const symbolInText = `${live} .cm-line img.inkline-symbol`;
// By its file, as the symbols are pictures too while Inkline is off.
const photoInText = `${live} .cm-line img[src*="photo.png"]`;

/**
 * Long enough for a second opening of the editor, or Obsidian's image viewer,
 * to have come after a double-click: either follows it at once.
 */
const settleMs = 500;

/**
 * Longer than the system's double-click time, so that the next click is a
 * click of its own.
 */
const apartMs = 1000;

/**
 * Opens `path` in the active leaf, in Live Preview with the cursor at the
 * start, away from every block, or in Reading view.
 */
async function open(path: string, mode: "live" | "preview"): Promise<void> {
  await browser.executeObsidian(
    async ({ app, obsidian }, file, viewMode) => {
      const found = app.vault.getFileByPath(file);
      if (found === null) throw new Error(`no ${file}`);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(found, {
        state: {
          mode: viewMode === "live" ? "source" : "preview",
          source: false,
        },
      });
      app.workspace.setActiveLeaf(leaf, { focus: true });
      if (!(leaf.view instanceof obsidian.MarkdownView)) {
        throw new Error(`${file} is no note`);
      }
      if (viewMode === "live") {
        const { editor } = leaf.view;
        editor.focus();
        editor.setCursor(0, 0);
        editor.scrollTo(0, 0);
      }
    },
    path,
    mode,
  );
}

/** How many symbol editors are open. */
async function editors(): Promise<number> {
  return browser.execute(
    () => document.querySelectorAll(".inkline-editor").length,
  );
}

/** Whether Obsidian's image viewer is open. */
async function viewerOpen(): Promise<boolean> {
  return browser.execute(() => document.querySelector(".lightbox") !== null);
}

/** Closes Obsidian's image viewer, if it is open. */
async function closeViewer(): Promise<void> {
  if (!(await viewerOpen())) return;
  await browser.keys(["Escape"]);
  try {
    await browser.$(".lightbox").waitForExist({ reverse: true, timeout: 2000 });
    return;
  } catch {
    // Escape goes to a canvas card's editor that has the focus. A click on
    // the viewer beside its picture closes it too.
  }
  await click({ x: 10, y: 300 });
  await browser.$(".lightbox").waitForExist({ reverse: true });
}

/**
 * A note's text without the spaces and dashes that line a table's columns
 * up, which Obsidian adds once a cell has been opened for editing.
 */
function withoutPadding(text: string): string {
  return text.replace(/[ -]+\|/g, "|").replace(/\| +/g, "|");
}

/** The active note's text, and its selections as offsets. */
async function noteState(): Promise<{
  text: string;
  selections: { anchor: number; head: number }[];
  selected: string;
}> {
  return browser.executeObsidian(({ app, obsidian }) => {
    const editor = app.workspace.getActiveViewOfType(
      obsidian.MarkdownView,
    )?.editor;
    if (editor === undefined) throw new Error("no editor");
    return {
      text: editor.getValue(),
      selections: editor.listSelections().map((range) => ({
        anchor: editor.posToOffset(range.anchor),
        head: editor.posToOffset(range.head),
      })),
      selected: editor.getSelection(),
    };
  });
}

/** The middle of `text` where Live Preview shows it in the active note. */
async function placeOfText(text: string): Promise<Point> {
  return settled(
    () =>
      browser.execute(
        (wanted, root) => {
          const content = document.querySelector(`${root} .cm-content`);
          const scroller = content?.closest(".cm-scroller");
          if (content === null || scroller === null || scroller === undefined) {
            return null;
          }
          const shown = scroller.getBoundingClientRect();
          const walker = document.createTreeWalker(
            content,
            NodeFilter.SHOW_TEXT,
          );
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const at = (node.nodeValue ?? "").indexOf(wanted);
            if (at === -1) continue;
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + wanted.length);
            const box = range.getBoundingClientRect();
            // Out of sight, it is scrolled into view for the next look.
            if (
              box.width === 0 ||
              box.top < shown.top ||
              box.bottom > shown.bottom
            ) {
              node.parentElement?.scrollIntoView({ block: "center" });
              return null;
            }
            return {
              x: Math.round(box.x + box.width / 2),
              y: Math.round(box.y + box.height / 2),
            };
          }
          return null;
        },
        text,
        live,
      ),
    text,
  );
}

/**
 * Starts counting the clicks the window sees, by how many the browser says
 * were in a row; {@link clickCounts} reads them back.
 */
async function countClicks(): Promise<void> {
  await browser.execute(() => {
    const counts: number[] = [];
    Reflect.set(window, "inklineClickCounts", counts);
    if (Reflect.get(window, "inklineCountingClicks") === true) return;
    Reflect.set(window, "inklineCountingClicks", true);
    window.addEventListener(
      "click",
      (event) => {
        const now: unknown = Reflect.get(window, "inklineClickCounts");
        if (Array.isArray(now)) now.push(event.detail);
      },
      { capture: true },
    );
  });
}

/** The click counts seen since {@link countClicks}. */
async function clickCounts(): Promise<number[]> {
  return browser.execute(() => {
    const counts: unknown = Reflect.get(window, "inklineClickCounts");
    return Array.isArray(counts) ? counts.map(Number) : [];
  });
}

/**
 * What two clicks at `point`, apart, leave: whether the image viewer opened,
 * and how many editors did.
 */
async function twoClicksApart(
  point: Point,
): Promise<{ viewer: boolean; editors: number }> {
  await countClicks();
  await click(point);
  await browser.pause(apartMs);
  await click(point);
  await browser.pause(settleMs);
  expect(await clickCounts()).toEqual([1, 1]);
  return { viewer: await viewerOpen(), editors: await editors() };
}

describe("Double-clicking a symbol", function () {
  // An editor, a menu, or the image viewer a test leaves open would take the
  // next one's clicks.
  afterEach(async function () {
    for (let tries = 0; tries < 3; tries++) {
      const open = await browser.execute(
        () =>
          document.querySelector(
            ".menu, .inkline-editor, .modal, .lightbox, .hover-popover",
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
    const data = new Uint8Array(64 * 64 * 4).fill(160);
    await browser.executeObsidian(
      async ({ app }, photo, text) => {
        const bytes = Uint8Array.from(atob(photo), (c) => c.charCodeAt(0));
        await app.vault.createBinary("photo.png", bytes.buffer);
        await app.vault.create("Double.md", text);
        await app.vault.create("Host.md", "Host.\n\n![[Double]]\n");
        await app.vault.create("Linker.md", "See [[Double]] here.\n");
        await app.vault.create(
          "Noted.md",
          "Noted ![[Two.ink.png]] words.\n\nMore words here.\n",
        );
        const card = { width: 440, height: 260 };
        await app.vault.create(
          "Board.canvas",
          JSON.stringify({
            nodes: [
              {
                ...card,
                id: "text",
                type: "text",
                x: -460,
                y: -280,
                text: "Card ![[One.ink.png]] words.\n\nPlain words.",
              },
              {
                ...card,
                id: "note",
                type: "file",
                file: "Noted.md",
                x: 20,
                y: -280,
              },
            ],
            edges: [],
          }),
        );
      },
      toBase64(encodePng({ width: 64, height: 64, data })),
      note,
    );
  });

  describe("in Live Preview", function () {
    it("opens the symbol in the editor, once, with no image viewer", async function () {
      await open("Double.md", "live");
      const before = await noteState();
      await doubleClick(await placeOf(symbolInText));
      expect(await editorName()).toBe("One");
      await saveScreenshot("double-click-live");
      // Neither a second editor nor the viewer comes after it.
      await browser.pause(settleMs);
      expect(await editors()).toBe(1);
      expect(await viewerOpen()).toBe(false);
      await closeEditor();
      // The note is as it was, with the cursor where the first click put it,
      // at the embed, as a single click does.
      const after = await noteState();
      expect(after.text).toBe(before.text);
      const embed = note.indexOf("![[One.ink.png]]");
      expect(after.selections).toEqual([{ anchor: embed, head: embed }]);
    });

    it("keeps a single click, and a click after it, as on a picture", async function () {
      await open("Double.md", "live");
      await click(await placeOf(symbolInText));
      await browser.pause(settleMs);
      expect(await editors()).toBe(0);
      const embed = note.indexOf("![[One.ink.png]]");
      expect((await noteState()).selections).toEqual([
        { anchor: embed, head: embed },
      ]);
      // A click on the selected picture does what Obsidian does with it, as
      // opening its viewer in later versions, for a symbol as for a photo.
      await open("Double.md", "live");
      const symbol = await twoClicksApart(await placeOf(symbolInText));
      await closeViewer();
      await open("Double.md", "live");
      const photo = await twoClicksApart(await placeOf(photoInText));
      await closeViewer();
      expect(symbol).toEqual(photo);
      expect(symbol.editors).toBe(0);
    });

    it("leaves a double-click on a picture or on words as it was", async function () {
      const onPhoto = async (): Promise<{ viewer: boolean }> => {
        await open("Double.md", "live");
        await doubleClick(await placeOf(photoInText));
        await browser.pause(settleMs);
        const viewer = await viewerOpen();
        await closeViewer();
        return { viewer };
      };
      const withInkline = await onPhoto();
      expect(await editors()).toBe(0);
      await obsidianPage.disablePlugin("inkline");
      let without;
      try {
        without = await onPhoto();
      } finally {
        await obsidianPage.enablePlugin("inkline");
      }
      expect(withInkline).toEqual(without);
      // A double-click on a word beside a symbol selects the word.
      await open("Double.md", "live");
      await doubleClick(await placeOfText("more"));
      await browser.pause(settleMs);
      expect((await noteState()).selected).toBe("more");
      expect(await editors()).toBe(0);
    });

    it("opens a symbol in a table", async function () {
      await open("Double.md", "live");
      const before = await noteState();
      // The first click opens the cell for editing, and the second lands on
      // the symbol in the cell's editor.
      await doubleClick(
        await placeOf(`${live} .cm-table-widget img.inkline-symbol`),
      );
      expect(await editorName()).toBe("Two");
      await browser.pause(settleMs);
      expect(await editors()).toBe(1);
      expect(await viewerOpen()).toBe(false);
      await closeEditor();
      expect(withoutPadding((await noteState()).text)).toBe(
        withoutPadding(before.text),
      );
    });

    it("opens a symbol in a popout window", async function () {
      const main = await browser.getWindowHandle();
      const before = await browser.getWindowHandles();
      await browser.executeObsidian(async ({ app }) => {
        const found = app.vault.getFileByPath("Double.md");
        if (found === null) throw new Error("no note");
        await app.workspace
          .openPopoutLeaf()
          .openFile(found, { state: { mode: "source", source: false } });
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
        await doubleClick(
          await placeOf(".markdown-source-view .cm-line img.inkline-symbol"),
        );
        expect(await editorName()).toBe("One");
        await browser.pause(settleMs);
        expect(await editors()).toBe(1);
        await closeEditor();
      } finally {
        await browser.switchToWindow(main);
        await browser.executeObsidian(({ app }) => {
          for (const leaf of app.workspace.getLeavesOfType("markdown")) {
            if (leaf.view.containerEl.doc !== document) leaf.detach();
          }
        });
      }
    });

    it("stops once Inkline is off", async function () {
      await open("Double.md", "live");
      await obsidianPage.disablePlugin("inkline");
      try {
        // Marked as a symbol still, for a listener left behind to answer.
        await browser.execute((selector) => {
          document.querySelector(selector)?.classList.add("inkline-symbol");
        }, `${live} .cm-line img[alt="One.ink.png"]`);
        await doubleClick(await placeOf(symbolInText));
        await browser.pause(settleMs);
        expect(await editors()).toBe(0);
        await closeViewer();
      } finally {
        await obsidianPage.enablePlugin("inkline");
      }
    });
  });

  describe("on a canvas", function () {
    it("opens a symbol in a card that is not focused, instead of the card's text", async function () {
      await openCanvas("Board.canvas");
      // The first click focuses the card, and the second lands on the symbol.
      await doubleClick(await placeInCard("Plain words", "img.inkline-symbol"));
      expect(await editorName()).toBe("One");
      await saveScreenshot("double-click-card");
      await browser.pause(settleMs);
      expect(await editors()).toBe(1);
      expect(await viewerOpen()).toBe(false);
      expect(await browser.$(".canvas-node.is-editing").isExisting()).toBe(
        false,
      );
      await closeEditor();
      // A double-click beside it opens the card's text, as before.
      await leaveCards();
      await doubleClick(await placeInCard("Plain words", "p"));
      await browser.$(".canvas-node.is-editing").waitForExist();
      expect(await editors()).toBe(0);
    });

    it("opens a symbol in a note on the canvas", async function () {
      await openCanvas("Board.canvas");
      await doubleClick(await placeInCard("Noted", "img.inkline-symbol"));
      expect(await editorName()).toBe("Two");
      await browser.pause(settleMs);
      expect(await editors()).toBe(1);
      expect(await browser.$(".canvas-node.is-editing").isExisting()).toBe(
        false,
      );
      await closeEditor();
    });

    it("opens a symbol in a card's own editor", async function () {
      await openCanvas("Board.canvas");
      await doubleClick(await placeInCard("Plain words", "p"));
      await browser.$(".canvas-node.is-editing iframe").waitForExist();
      await cursorInCard("Plain words");
      await doubleClick(await placeInCardEditor("img.inkline-symbol"));
      expect(await editorName()).toBe("One");
      await browser.pause(settleMs);
      expect(await editors()).toBe(1);
      expect(await viewerOpen()).toBe(false);
      await closeEditor();
    });
  });

  describe("where Obsidian answers the first click", function () {
    /** Double-clicks `selector`, and checks that no editor opened. */
    async function leftAlone(selector: string): Promise<void> {
      await doubleClick(await placeOf(selector));
      await browser.pause(settleMs);
      expect(await editors()).toBe(0);
      await closeViewer();
    }

    it("leaves Reading view and embedded notes to Obsidian's image viewer", async function () {
      // A click opens the viewer there, on a symbol as on any picture, so the
      // second click lands in the viewer.
      await open("Double.md", "preview");
      await click(await placeOf(`${reading} p img.inkline-symbol`));
      await browser.$(".lightbox").waitForExist();
      await closeViewer();
      await leftAlone(`${reading} p img.inkline-symbol`);
      await leftAlone(`${reading} table img.inkline-symbol`);
      await open("Host.md", "preview");
      await leftAlone(`${reading} .markdown-embed p img.inkline-symbol`);
      await open("Host.md", "live");
      await leftAlone(`${live} .markdown-embed p img.inkline-symbol`);
    });

    it("leaves a hover preview to Obsidian's image viewer", async function () {
      await open("Linker.md", "preview");
      const link = await placeOf(`${reading} a.internal-link`);
      await browser
        .action("pointer", { parameters: { pointerType: "mouse" } })
        .move({ x: link.x - 200, y: link.y })
        .move(link)
        .perform();
      await browser.$(".hover-popover img.inkline-symbol").waitForExist();
      try {
        await leftAlone(".hover-popover p img.inkline-symbol");
      } finally {
        // The preview goes once the pointer leaves it.
        await browser
          .action("pointer", { parameters: { pointerType: "mouse" } })
          .move({ x: 5, y: 500 })
          .perform();
        await browser.$(".hover-popover").waitForExist({ reverse: true });
      }
    });

    it("leaves a callout in Live Preview, which shows its text on a click", async function () {
      await open("Double.md", "live");
      await leftAlone(`${live} .cm-callout img.inkline-symbol`);
    });

    it("leaves a focused card on a canvas to Obsidian's image viewer", async function () {
      await openCanvas("Board.canvas");
      await click(await placeInCard("Plain words", "p"));
      await browser.$(".canvas-node.is-focused").waitForExist();
      await leftAlone(".canvas-node.is-focused img.inkline-symbol");
    });
  });
});
