// Inkline's screens in a right-to-left interface, with Obsidian's interface in
// Hebrew, and the same checks in English, whose layout must stay as it was.
// A symbol is painted through a CSS mask, so where its ink shows in a list is
// read from a screenshot of its picture; where text falls is read from the
// boxes of its characters.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  createSymbol,
  openAtMarker,
  startOver,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** The note the lists insert into. */
const note = "List.md";

/** A symbol narrower than a list's column, so that it shows where it sits. */
const narrow = "dot";

/** A list of symbols, and how to show it. */
interface List {
  readonly name: string;
  readonly rows: string;
  readonly open: () => Promise<void>;
}

const lists: readonly List[] = [
  {
    name: "the ;; list",
    rows: ".suggestion-container .suggestion-item",
    open: async () => {
      await openAtMarker(note, "HERE");
      await browser.keys([";", ";"]);
    },
  },
  {
    name: "Insert existing symbol",
    rows: ".prompt .suggestion-item",
    open: async () => {
      await openAtMarker(note, "HERE");
      await browser.executeObsidianCommand("inkline:insert-existing-symbol");
    },
  },
  {
    name: "Copy from",
    rows: ".prompt .suggestion-item",
    open: async () => {
      await openAtMarker(note, "HERE");
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await waitForEditor();
      await browser.keys(["v"]);
    },
  },
  {
    name: "the library",
    rows: ".inkline-library-symbol",
    open: async () => {
      await browser.executeObsidianCommand("inkline:show-library");
    },
  },
];

/** Where a list's row puts the picture of `narrow`, and its ink in it. */
interface Placed {
  /** The picture's box and the name's, in the window's pixels. */
  pictureLeft: number;
  pictureRight: number;
  nameLeft: number;
  nameRight: number;
  /** Where the ink shows across the picture, from 0 at its left to 1. */
  inkLeft: number;
  inkRight: number;
}

/** A box on the screen, in the window's pixels. */
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Switches Obsidian's interface to `language`, which takes a restart, as
 * choosing it in Obsidian's settings does.
 */
async function useLanguage(language: "en" | "he"): Promise<void> {
  await browser.execute((wanted) => {
    // Obsidian keeps the interface's language for the whole app, under this
    // key of its own in the window's storage: a vault's storage, which
    // plugins use for their own data, holds its keys apart from it.
    const stored = window.localStorage;
    if (wanted === "en") stored.removeItem("language");
    else stored.setItem("language", wanted);
  }, language);
  await browser.reloadObsidian();
  await loadModules();
  const rtl = await browser.execute(() =>
    document.body.classList.contains("mod-rtl"),
  );
  expect(rtl).toBe(language === "he");
}

/** Waits until the rows of `selector` show every symbol's picture. */
async function waitForRows(selector: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((rows) => {
        const pictures = Array.from(
          document.querySelectorAll<HTMLImageElement>(`${rows} img`),
        );
        return (
          pictures.length === 2 &&
          pictures.every(
            (picture) =>
              picture.complete && picture.classList.contains("inkline-symbol"),
          )
        );
      }, selector),
    { timeoutMsg: `no rows in ${selector}` },
  );
}

/** Where the row of `narrow` in `rows` puts its picture and its ink. */
async function placed(rows: string): Promise<Placed> {
  let picture: WebdriverIO.Element | undefined;
  for (const row of await browser.$$(rows).getElements()) {
    const label = row.$(".inkline-suggestion-name, .inkline-library-name");
    if ((await label.getText()) === narrow) {
      picture = await row.$("img").getElement();
    }
  }
  if (picture === undefined) throw new Error(`no ${narrow} in ${rows}`);
  await picture.scrollIntoView({ block: "nearest" });
  const boxes = await browser.execute(
    (selector, name) => {
      for (const row of Array.from(document.querySelectorAll(selector))) {
        const label = row.querySelector(
          ".inkline-suggestion-name, .inkline-library-name",
        );
        const image = row.querySelector("img");
        if (label?.textContent !== name || image === null) continue;
        const shown = image.getBoundingClientRect();
        const named = label.getBoundingClientRect();
        return {
          pictureLeft: shown.left,
          pictureRight: shown.right,
          nameLeft: named.left,
          nameRight: named.right,
        };
      }
      throw new Error(`no ${name}`);
    },
    rows,
    narrow,
  );
  const shot = await browser.takeElementScreenshot(picture.elementId);
  const ink = await browser.execute(async (png) => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const { data, width, height } =
      window.inklineTest.canvas.readPixels(bitmap);
    bitmap.close();
    // Each corner shows the row: the symbol's side bearings keep ink off
    // both, and it is narrower than the column.
    const background = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
    let left = width;
    let right = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        const inked = background.some(
          (level, channel) => Math.abs((data[at + channel] ?? 0) - level) > 40,
        );
        if (!inked) continue;
        left = Math.min(left, x);
        right = Math.max(right, x + 1);
      }
    }
    return { left: left / width, right: right / width };
  }, shot);
  return { ...boxes, inkLeft: ink.left, inkRight: ink.right };
}

/**
 * The boxes of the characters at `at` in the first text in `scope` that holds
 * `text`, counted from the start of `text`, or from its end when negative.
 */
async function charBoxes(
  scope: string,
  text: string,
  at: readonly number[],
): Promise<Box[]> {
  return browser.execute(
    (selector, wanted, offsets) => {
      for (const root of Array.from(document.querySelectorAll(selector))) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const start = (node.nodeValue ?? "").indexOf(wanted);
          if (start === -1) continue;
          return offsets.map((offset) => {
            const range = document.createRange();
            const from = start + (offset < 0 ? wanted.length + offset : offset);
            range.setStart(node, from);
            range.setEnd(node, from + 1);
            const box = range.getBoundingClientRect();
            return {
              left: box.left,
              right: box.right,
              top: box.top,
              bottom: box.bottom,
            };
          });
        }
      }
      throw new Error(`no "${wanted}" in ${selector}`);
    },
    scope,
    text,
    at,
  );
}

/**
 * Checks that `text` in `scope` ends with its last character just after the
 * one before it, on its line, as English puts a full stop or an ellipsis, and
 * starts with its first character before its second.
 */
async function expectInOrder(scope: string, text: string): Promise<void> {
  const [first, second, before, last] = await charBoxes(
    scope,
    text,
    [0, 1, -2, -1],
  );
  if (
    first === undefined ||
    second === undefined ||
    before === undefined ||
    last === undefined
  ) {
    throw new Error(`no boxes for "${text}"`);
  }
  expect(Math.abs(last.top - before.top)).toBeLessThan(1);
  expect(Math.abs(last.left - before.right)).toBeLessThan(1.5);
  expect(Math.abs(second.left - first.right)).toBeLessThan(1.5);
}

/** The box of each line of the first text in `scope`, top first. */
async function lineBoxes(scope: string): Promise<Box[]> {
  return browser.execute((selector) => {
    const root = document.querySelector(selector);
    const text = root?.firstChild;
    if (text === null || text === undefined) throw new Error(`no ${selector}`);
    const range = document.createRange();
    range.selectNodeContents(text);
    return Array.from(range.getClientRects()).map((box) => ({
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
    }));
  }, scope);
}

/** The box of the first element `selector` finds in the window. */
async function boxOf(selector: string): Promise<Box> {
  return browser.execute((wanted) => {
    const found = document.querySelector(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const box = found.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
    };
  }, selector);
}

/** Opens Inkline's settings, in their own window or in the main one. */
async function openSettings(): Promise<string> {
  const main = await browser.getWindowHandle();
  await browser.executeObsidianCommand("app:open-settings");
  await browser.waitUntil(
    async () => {
      for (const handle of await browser.getWindowHandles()) {
        await browser.switchToWindow(handle);
        if (await browser.$(".vertical-tab-nav-item=Inkline").isExisting()) {
          return true;
        }
      }
      return false;
    },
    { timeoutMsg: "Inkline's settings did not open" },
  );
  await browser.$(".vertical-tab-nav-item=Inkline").click();
  await browser.$(".setting-item-name=Insert trigger").waitForDisplayed();
  return main;
}

/** Closes the settings opened by {@link openSettings} from `main`. */
async function closeSettings(main: string): Promise<void> {
  if ((await browser.getWindowHandle()) !== main) {
    await browser.closeWindow();
    await browser.switchToWindow(main);
  } else {
    await browser.keys(["Escape"]);
  }
  await browser.$(".vertical-tab-content").waitForExist({ reverse: true });
}

for (const language of ["en", "he"] as const) {
  const rtl = language === "he";
  const interfaceName = rtl ? "a right-to-left interface" : "English";

  describe(`Inkline's screens in ${interfaceName}`, function () {
    before(async function () {
      await useLanguage(language);
    });

    beforeEach(async function () {
      await startOver();
      await browser.executeObsidian(({ app }) => {
        app.workspace.detachLeavesOfType("inkline-library");
      });
      await createSymbol(`${narrow}.ink.png`, [400]);
      await createSymbol("wide one.ink.png", [400, 3000]);
      await browser.executeObsidian(async ({ app }, path) => {
        await app.vault.create(path, "The door reads HERE today.\n");
      }, note);
    });

    afterEach(async function () {
      await browser.execute(() => {
        document.documentElement.removeClass("inkline-stored-color");
      });
    });

    after(async function () {
      if (rtl) await useLanguage("en");
    });

    for (const list of lists) {
      it(`starts a picture at its column's start in ${list.name}, in the text colour and its stored colour`, async function () {
        await list.open();
        await waitForRows(list.rows);
        // The stored colour is a class on the window's root, which only the
        // style answers to, so the list open in the text colour shows it too.
        for (const stored of [false, true]) {
          if (stored) {
            await browser.execute(async () => {
              document.documentElement.addClass("inkline-stored-color");
              // Drawn so, for the screenshot of the picture.
              await new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
              });
            });
          }
          const row = await placed(list.rows);
          await saveScreenshot(
            `${language}-${list.name.replace(/\W+/g, "-")}-${stored ? "stored" : "text"}`,
          );
          // The column is before the name, which is the right in a mirrored
          // row, and the picture starts at the column's start: its ink lies
          // in the start's half of the column.
          if (rtl) {
            expect(row.pictureLeft).toBeGreaterThan(row.nameRight);
            expect(row.inkLeft).toBeGreaterThan(0.5);
          } else {
            expect(row.pictureRight).toBeLessThan(row.nameLeft);
            expect(row.inkRight).toBeLessThan(0.5);
          }
        }
      });
    }

    it("keeps the editor's English in order, where its layout puts it", async function () {
      await openAtMarker(note, "HERE");
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await waitForEditor();
      await saveScreenshot(`${language}-editor`);
      await expectInOrder(
        ".inkline-picture-hint",
        "Paste, drop, or choose a picture to trace over it.",
      );
      await expectInOrder(".inkline-picture", "Choose picture…");
      await expectInOrder(".inkline-preview", "in it.");
      // The preview's symbol is between the words around it.
      const [withEnd] = await charBoxes(".inkline-preview", "with ", [-2]);
      const [inStart] = await charBoxes(".inkline-preview", " in it.", [1]);
      const ink = await boxOf(".inkline-preview-ink");
      if (withEnd === undefined || inStart === undefined) {
        throw new Error("no preview text");
      }
      expect(ink.left).toBeGreaterThanOrEqual(withEnd.right - 0.5);
      expect(ink.right).toBeLessThanOrEqual(inStart.left + 0.5);
      // The layout is still mirrored: the pen is the first tool, at the
      // start, and the preview line stays at the start of its space.
      const pen = await boxOf('[data-inkline-button="pen"]');
      const eraser = await boxOf('[data-inkline-button="eraser"]');
      const line = await boxOf(".inkline-preview");
      const [lineStart] = await charBoxes(".inkline-preview", "A line", [0]);
      const [lineEnd] = await charBoxes(".inkline-preview", " in it.", [-1]);
      if (lineStart === undefined || lineEnd === undefined) {
        throw new Error("no preview text");
      }
      if (rtl) {
        expect(pen.left).toBeGreaterThan(eraser.right);
        expect(Math.abs(line.right - lineEnd.right)).toBeLessThan(1.5);
      } else {
        expect(pen.right).toBeLessThan(eraser.left);
        expect(Math.abs(lineStart.left - line.left)).toBeLessThan(1.5);
      }
      // And in the editor's Help.
      await browser.$('[data-inkline-button="help"]').click();
      await browser.$(".inkline-help").waitForDisplayed();
      await saveScreenshot(`${language}-help`);
      await expectInOrder(".inkline-help", "shows its size beside text.");
      await expectInOrder(".inkline-help", "the font's upper extent.");
      // A paragraph's lines start at its start: the right, in a mirrored
      // layout, though each runs left to right.
      const paragraph = await boxOf(".inkline-help p");
      const [opening] = await charBoxes(".inkline-help p", "Draw a", [0]);
      const [firstLine] = await lineBoxes(".inkline-help p");
      if (opening === undefined || firstLine === undefined) {
        throw new Error("no Help text");
      }
      if (rtl) {
        expect(Math.abs(paragraph.right - firstLine.right)).toBeLessThan(1.5);
        expect(opening.left - firstLine.left).toBeLessThan(1.5);
      } else {
        expect(Math.abs(opening.left - paragraph.left)).toBeLessThan(1.5);
      }
    });

    it("keeps the library's English in order", async function () {
      await browser.executeObsidianCommand("inkline:show-library");
      const filter = browser.$(".inkline-library-search");
      await filter.waitForDisplayed();
      await filter.setValue("nothing is called this");
      const empty = "No symbol matches.";
      await browser.$(`div=${empty}`).waitForDisplayed();
      await saveScreenshot(`${language}-library-empty`);
      await expectInOrder(".inkline-library", empty);
    });

    // Obsidian lays the settings out, and keeps their order itself.
    it("keeps the settings' English in order", async function () {
      const main = await openSettings();
      try {
        await saveScreenshot(`${language}-settings`);
        await expectInOrder(
          ".vertical-tab-content",
          "they keep their stored grey pixels.",
        );
        await expectInOrder(
          ".vertical-tab-content",
          "list the symbols to insert.",
        );
      } finally {
        await closeSettings(main);
      }
    });
  });
}
