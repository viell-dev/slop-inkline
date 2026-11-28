import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
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
const photoInReading = `${reading} p img[src*="photo.png"]`;
const embed = note.indexOf("![[One.ink.png]]");

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

/**
 * Whether Obsidian's image viewer opens in Live Preview here. It calls
 * `URL.parse` there, which Chromium has from 126 on: on the oldest installer
 * the suite runs, with Chromium 120, it throws instead, for any picture, and
 * Space on a selected picture then also types a space into the note.
 */
async function viewerOpensInEditor(): Promise<boolean> {
  return browser.execute(() => typeof Reflect.get(URL, "parse") === "function");
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

/**
 * Whether Live Preview has selected the picture `selector` finds, as a click
 * on it leaves it: the mark Obsidian puts on the selected picture's embed,
 * which Inkline reads to tell a click that would open the image viewer.
 */
async function selected(selector: string): Promise<boolean> {
  return browser.execute(
    (wanted) =>
      document
        .querySelector(wanted)
        ?.parentElement?.closest(".image-embed")
        ?.classList.contains("is-selected") === true,
    selector,
  );
}

/** Clicks at `point` with `key` held. */
async function clickHolding(point: Point, key: string): Promise<void> {
  const keyboard = browser
    .action("key")
    .down(key)
    .pause(0)
    .pause(0)
    .pause(0)
    .up(key);
  const pointer = browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .pause(0)
    .move(point)
    .down({ button: 0 })
    .up({ button: 0 })
    .pause(0);
  await browser.actions([keyboard, pointer]);
}

/**
 * The active note's selections as offsets from the start of `embed`, the
 * embed a click went to, to compare a symbol's with a picture's.
 */
async function selectionsFrom(
  embed: string,
): Promise<{ anchor: number; head: number }[]> {
  const { text, selections } = await noteState();
  const from = text.indexOf(embed);
  return selections.map(({ anchor, head }) => ({
    anchor: anchor - from,
    head: head - from,
  }));
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
      expect(after.selections).toEqual([{ anchor: embed, head: embed }]);
    });

    it("opens a symbol already selected, once, with no image viewer", async function () {
      // A click on a selected picture opens Obsidian's image viewer, and so
      // took a double-click's first click on a selected symbol (#446).
      await open("Double.md", "live");
      const before = await noteState();
      const symbol = await placeOf(symbolInText);
      await click(symbol);
      await browser.pause(apartMs);
      expect(await selected(symbolInText)).toBe(true);
      await doubleClick(symbol);
      expect(await editorName()).toBe("One");
      await saveScreenshot("double-click-selected");
      await browser.pause(settleMs);
      expect(await editors()).toBe(1);
      expect(await viewerOpen()).toBe(false);
      await closeEditor();
      const after = await noteState();
      expect(after.text).toBe(before.text);
      expect(after.selections).toEqual([{ anchor: embed, head: embed }]);
    });

    it("keeps a single click, and opens no image viewer on a selected symbol", async function () {
      await open("Double.md", "live");
      await click(await placeOf(symbolInText));
      await browser.pause(settleMs);
      expect(await editors()).toBe(0);
      expect((await noteState()).selections).toEqual([
        { anchor: embed, head: embed },
      ]);
      expect(await selected(symbolInText)).toBe(true);
      // A click on the selected symbol does nothing, and leaves it selected,
      // while one on a selected photo opens the viewer, as Obsidian does.
      const viewer = await viewerOpensInEditor();
      await open("Double.md", "live");
      expect(await twoClicksApart(await placeOf(symbolInText))).toEqual({
        viewer: false,
        editors: 0,
      });
      expect((await noteState()).selections).toEqual([
        { anchor: embed, head: embed },
      ]);
      expect(await selected(symbolInText)).toBe(true);
      await open("Double.md", "live");
      expect(await twoClicksApart(await placeOf(photoInText))).toEqual({
        viewer,
        editors: 0,
      });
      await closeViewer();
    });

    it("keeps Space from opening the image viewer on a selected symbol, and the other keys", async function () {
      await open("Double.md", "live");
      const before = await noteState();
      await click(await placeOf(symbolInText));
      await browser.pause(settleMs);
      expect(await selected(symbolInText)).toBe(true);
      await browser.keys([Key.Space]);
      await browser.pause(settleMs);
      expect(await viewerOpen()).toBe(false);
      const after = await noteState();
      expect(after.text).toBe(before.text);
      expect(after.selections).toEqual([{ anchor: embed, head: embed }]);
      expect(await selected(symbolInText)).toBe(true);
      // Enter still shows the link's file name, selected, to change it.
      await browser.keys([Key.Enter]);
      await browser.waitUntil(
        async () => (await noteState()).selected === "One.ink.png",
      );
      expect((await noteState()).text).toBe(before.text);
      // Space on a selected photo opens the viewer, as Obsidian does where
      // its viewer opens, and would type a space into the note elsewhere.
      if (!(await viewerOpensInEditor())) return;
      await open("Double.md", "live");
      await click(await placeOf(photoInText));
      await browser.pause(settleMs);
      expect(await selected(photoInText)).toBe(true);
      await browser.keys([Key.Space]);
      await browser.$(".lightbox").waitForExist();
      await closeViewer();
      expect((await noteState()).text).toBe(before.text);
    });

    it("keeps a click with Shift or Ctrl as on a picture, but for the image viewer", async function () {
      const viewer = await viewerOpensInEditor();
      for (const key of [Key.Shift, Key.Ctrl]) {
        /**
         * What a click with `key` on `selector` does, and then another on
         * it selected, apart.
         */
        const outcome = async (
          selector: string,
          embedText: string,
        ): Promise<{
          selections: { anchor: number; head: number }[];
          selected: boolean;
          editors: number;
          viewers: boolean[];
        }> => {
          await open("Double.md", "live");
          const place = await placeOf(selector);
          await clickHolding(place, key);
          await browser.pause(settleMs);
          const first = await viewerOpen();
          const found = {
            selections: await selectionsFrom(embedText),
            selected: await selected(selector),
            editors: await editors(),
          };
          await browser.pause(apartMs);
          await clickHolding(place, key);
          await browser.pause(settleMs);
          const second = await viewerOpen();
          await closeViewer();
          return { ...found, viewers: [first, second] };
        };
        const symbol = await outcome(symbolInText, "![[One.ink.png]]");
        const photo = await outcome(photoInText, "![[photo.png|120]]");
        expect(symbol).toEqual({ ...photo, viewers: [false, false] });
        expect(photo.viewers).toEqual([false, viewer]);
        expect(symbol.editors).toBe(0);
      }
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
      /**
       * Marks the picture of One as a symbol still, for a listener left. The
       * view may still be drawing the note as it opens, so this waits for the
       * picture rather than marking nothing, which left the click below
       * waiting for a symbol that never came (#494).
       */
      const markAsSymbol = async (root: string): Promise<void> => {
        await browser.waitUntil(
          async () =>
            browser.execute((selector) => {
              const image = document.querySelector(selector);
              image?.classList.add("inkline-symbol");
              return image !== null;
            }, `${root} img[alt="One.ink.png"]`),
          { timeoutMsg: `no picture of One in ${root}` },
        );
      };
      const viewer = await viewerOpensInEditor();
      await obsidianPage.disablePlugin("inkline");
      try {
        // An ordinary picture again: the second click opens the viewer.
        await open("Double.md", "live");
        await markAsSymbol(`${live} .cm-line`);
        await doubleClick(await placeOf(symbolInText));
        await browser.pause(settleMs);
        expect(await editors()).toBe(0);
        expect(await viewerOpen()).toBe(viewer);
        await closeViewer();
        await open("Double.md", "preview");
        // Where the picture settles, then marked just before the click, so
        // that a redraw of the note meanwhile cannot take the mark away.
        const picture = await placeOf(`${reading} p img[alt="One.ink.png"]`);
        await markAsSymbol(`${reading} p`);
        await click(picture);
        await browser.$(".lightbox").waitForExist();
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

  describe("where a click opens Obsidian's image viewer on a picture", function () {
    /**
     * Clicks `selector`, a symbol, and checks that nothing opened, then
     * double-clicks it, and checks that it opened in the editor, once, as
     * `name`, with no image viewer, saving a screenshot as `shot` if given.
     */
    async function opensOnce(
      selector: string,
      name: string,
      shot?: string,
    ): Promise<void> {
      const symbol = await placeOf(selector);
      await click(symbol);
      await browser.pause(settleMs);
      expect(await viewerOpen()).toBe(false);
      expect(await editors()).toBe(0);
      await browser.pause(apartMs);
      await doubleClick(symbol);
      expect(await editorName()).toBe(name);
      if (shot !== undefined) await saveScreenshot(shot);
      await browser.pause(settleMs);
      expect(await editors()).toBe(1);
      expect(await viewerOpen()).toBe(false);
      await closeEditor();
    }

    it("opens a symbol in Reading view and in embedded notes", async function () {
      // A click on any other picture opens the viewer there, as before.
      await open("Double.md", "preview");
      await click(await placeOf(photoInReading));
      await browser.$(".lightbox").waitForExist();
      await closeViewer();
      await opensOnce(
        `${reading} p img.inkline-symbol`,
        "One",
        "double-click-reading",
      );
      await opensOnce(`${reading} table img.inkline-symbol`, "Two");
      await open("Host.md", "preview");
      await opensOnce(`${reading} .markdown-embed p img.inkline-symbol`, "One");
      await open("Host.md", "live");
      await opensOnce(`${live} .markdown-embed p img.inkline-symbol`, "One");
    });

    it("opens no image viewer on a click with a key held in Reading view", async function () {
      await open("Double.md", "preview");
      for (const key of [Key.Shift, Key.Ctrl]) {
        await clickHolding(
          await placeOf(`${reading} p img.inkline-symbol`),
          key,
        );
        await browser.pause(settleMs);
        expect(await viewerOpen()).toBe(false);
        expect(await editors()).toBe(0);
      }
    });

    it("opens a symbol in a hover preview", async function () {
      await open("Linker.md", "preview");
      const link = await placeOf(`${reading} a.internal-link`);
      await browser
        .action("pointer", { parameters: { pointerType: "mouse" } })
        .move({ x: link.x - 200, y: link.y })
        .move(link)
        .perform();
      await browser
        .$(".hover-popover img.inkline-symbol", { strict: false })
        .waitForExist();
      try {
        await opensOnce(
          ".hover-popover p img.inkline-symbol",
          "One",
          "double-click-hover",
        );
      } finally {
        // The preview goes once the pointer leaves it.
        await browser
          .action("pointer", { parameters: { pointerType: "mouse" } })
          .move({ x: 5, y: 500 })
          .perform();
        await browser.$(".hover-popover").waitForExist({ reverse: true });
      }
    });

    it("opens a symbol in a focused card on a canvas, instead of the card's text", async function () {
      await openCanvas("Board.canvas");
      await click(await placeInCard("Plain words", "p"));
      await browser.$(".canvas-node.is-focused").waitForExist();
      await opensOnce(".canvas-node.is-focused img.inkline-symbol", "One");
      expect(await browser.$(".canvas-node.is-editing").isExisting()).toBe(
        false,
      );
      expect(await browser.$(".canvas-node.is-focused").isExisting()).toBe(
        true,
      );
    });
  });

  describe("where Obsidian answers the first click otherwise", function () {
    it("leaves a callout in Live Preview, which shows its text on a click", async function () {
      await open("Double.md", "live");
      await doubleClick(
        await placeOf(`${live} .cm-callout img.inkline-symbol`),
      );
      await browser.pause(settleMs);
      expect(await editors()).toBe(0);
      expect(await viewerOpen()).toBe(false);
    });
  });
});
