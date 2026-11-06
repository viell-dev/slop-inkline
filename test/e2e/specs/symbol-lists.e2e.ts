// How the lists of symbols lay out a row: each picture in a column of its own,
// so that names line up whatever each symbol's width. A symbol is painted
// through a CSS mask, so what shows of one is read from a screenshot of it.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  createSymbol,
  openAtMarker,
  startOver,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** A symbol: its path, and the x of each of its strokes, in file units. */
type Sample = readonly [string, readonly number[]];

/** Narrower than the column, and so shown at the size of the text. */
const narrow: readonly Sample[] = [
  ["dot.ink.png", [400]],
  ["one em.ink.png", [400, 1600]],
  ["two em.ink.png", [400, 3000]],
];

/** As wide as a stroke across the editor's whole surface. */
const surface: Sample = ["whole surface.ink.png", [400, 4000, 8600]];

/** Wider than the surface, as saving and widening a symbol can make one. */
const wider: Sample = ["wider still.ink.png", [400, 8000, 16000]];

/** Each with a folder under its name. */
const inFolders: readonly Sample[] = [
  ["Glyphs/nested dot.ink.png", [400]],
  ["Glyphs/Deep/nested wide.ink.png", [400, 4000, 8600]],
];

const symbols = [...narrow, surface, wider, ...inFolders];

/** A list of symbols, and how to show it. */
interface List {
  readonly name: string;
  /** The list's rows. */
  readonly rows: string;
  readonly open: () => Promise<void>;
}

const insertExisting: List = {
  name: "Insert existing symbol",
  rows: ".prompt .suggestion-item",
  open: async () => {
    await openAtMarker("List.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-existing-symbol");
  },
};

const library: List = {
  name: "the library",
  rows: ".inkline-library-symbol",
  open: async () => {
    await browser.executeObsidianCommand("inkline:show-library");
  },
};

const lists: readonly List[] = [
  {
    name: "the ;; list",
    rows: ".suggestion-container .suggestion-item",
    open: async () => {
      await openAtMarker("List.md", "HERE");
      await browser.keys([";"]);
      await browser.keys([";"]);
    },
  },
  insertExisting,
  {
    name: "Copy from",
    rows: ".prompt .suggestion-item",
    open: async () => {
      await openAtMarker("List.md", "HERE");
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await waitForEditor();
      await browser.keys(["v"]);
    },
  },
  library,
];

const themes = ["moonstone", "obsidian"] as const;

/** Where a row puts its parts, in pixels from the window's left. */
interface Row {
  name: string;
  nameLeft: number;
  folderLeft: number | null;
  pictureLeft: number;
  pictureRight: number;
  pictureHeight: number;
  fontSize: number;
}

/** Shows `theme`, one of Obsidian's own. */
async function useTheme(theme: string): Promise<void> {
  await browser.executeObsidian(({ app }, chosen) => {
    const change: unknown = Reflect.get(app, "changeTheme");
    if (typeof change !== "function") throw new Error("no themes");
    Reflect.apply(change, app, [chosen]);
  }, theme);
}

/**
 * Waits for `count` rows in `selector`, with each picture tagged as a symbol
 * and finished loading, as far as it will load.
 */
async function waitForRows(selector: string, count: number): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (rows, wanted) => {
          const pictures = Array.from(
            activeDocument.querySelectorAll<HTMLImageElement>(`${rows} img`),
          );
          return (
            pictures.length === wanted &&
            pictures.every(
              (picture) =>
                picture.complete &&
                picture.classList.contains("inkline-symbol"),
            )
          );
        },
        selector,
        count,
      ),
    { timeoutMsg: `no ${String(count)} rows in ${selector}` },
  );
}

/** Where each row in `selector` puts its parts, top first. */
async function rowsOf(selector: string): Promise<Row[]> {
  return browser.execute(
    (rows) =>
      Array.from(activeDocument.querySelectorAll(rows)).map((row) => {
        const name = row.querySelector(
          ".inkline-suggestion-name, .inkline-library-name",
        );
        const folder = row.querySelector(
          ".inkline-suggestion-folder, .inkline-library-folder-name",
        );
        const picture = row.querySelector("img");
        if (name === null || picture === null) throw new Error("no name");
        const box = picture.getBoundingClientRect();
        return {
          name: name.textContent,
          nameLeft: name.getBoundingClientRect().left,
          folderLeft: folder?.getBoundingClientRect().left ?? null,
          pictureLeft: box.left,
          pictureRight: box.right,
          pictureHeight: box.height,
          fontSize: Number.parseFloat(getComputedStyle(picture).fontSize),
        };
      }),
    selector,
  );
}

/** How far apart the lowest and highest of `values` are. */
function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/**
 * Checks that every row of `rows` has its picture in the same column, and its
 * name, and any folder, starting at the same x, to within half a pixel.
 */
function expectLinedUp(rows: readonly Row[], count: number): void {
  expect(rows).toHaveLength(count);
  expect(spread(rows.map((row) => row.nameLeft))).toBeLessThan(0.5);
  expect(spread(rows.map((row) => row.pictureLeft))).toBeLessThan(0.5);
  expect(spread(rows.map((row) => row.pictureRight))).toBeLessThan(0.5);
  for (const row of rows) {
    expect(row.pictureRight).toBeLessThan(row.nameLeft);
    if (row.folderLeft !== null) {
      expect(Math.abs(row.folderLeft - row.nameLeft)).toBeLessThan(0.5);
    }
  }
}

/** What shows of a symbol, in pixels, read from a screenshot of its image. */
interface Ink {
  /** The image's size, and the box of what is drawn in it. */
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** How many runs of columns hold ink, one for each stroke apart. */
  runs: number;
}

/** What shows of the picture of the row named `name` in `rows`. */
async function inkOf(rows: string, name: string): Promise<Ink> {
  let picture: WebdriverIO.Element | undefined;
  for (const row of await browser.$$(rows).getElements()) {
    const label = row.$(".inkline-suggestion-name, .inkline-library-name");
    if ((await label.getText()) === name) {
      picture = await row.$("img").getElement();
    }
  }
  if (picture === undefined) throw new Error(`no ${name} in ${rows}`);
  await picture.scrollIntoView({ block: "nearest" });
  const shot = await browser.takeElementScreenshot(picture.elementId);
  return browser.execute(async (png) => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const { data, width, height } =
      window.inklineTest.canvas.readPixels(bitmap);
    bitmap.close();
    // The top left corner shows the row: a side bearing keeps ink off it.
    const background = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
    const inked = (x: number, y: number): boolean => {
      const at = (y * width + x) * 4;
      return background.some(
        (level, channel) => Math.abs((data[at + channel] ?? 0) - level) > 40,
      );
    };
    const ink = {
      width,
      height,
      left: width,
      right: 0,
      top: height,
      bottom: 0,
      runs: 0,
    };
    let previous = false;
    for (let x = 0; x < width; x++) {
      let column = false;
      for (let y = 0; y < height; y++) {
        if (!inked(x, y)) continue;
        column = true;
        ink.left = Math.min(ink.left, x);
        ink.right = Math.max(ink.right, x + 1);
        ink.top = Math.min(ink.top, y);
        ink.bottom = Math.max(ink.bottom, y + 1);
      }
      if (column && !previous) ink.runs++;
      previous = column;
    }
    return ink;
  }, shot);
}

/** The size of the symbol file at `path`, and of what is drawn in it. */
async function sizesInFile(path: string): Promise<{
  width: number;
  height: number;
  inkWidth: number;
  inkHeight: number;
}> {
  return browser.executeObsidian(async ({ app }, file) => {
    const symbol = app.vault.getFileByPath(file);
    if (symbol === null) throw new Error(`no ${file}`);
    const bitmap = await createImageBitmap(
      new Blob([await app.vault.readBinary(symbol)]),
    );
    const { data, width, height } =
      window.inklineTest.canvas.readPixels(bitmap);
    bitmap.close();
    let left = width;
    let right = 0;
    let top = height;
    let bottom = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
        left = Math.min(left, x);
        right = Math.max(right, x + 1);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y + 1);
      }
    }
    return {
      width,
      height,
      inkWidth: right - left,
      inkHeight: bottom - top,
    };
  }, path);
}

/**
 * Checks that the symbol shows whole and in proportion in its box: at the
 * largest size that fits, with every stroke there and apart. A picture cut
 * at the box's end would be too tall for its width, and one stretched to the
 * box too tall as well; the tolerance is what rounding to whole pixels takes.
 */
async function expectWhole(
  rows: string,
  [path, strokes]: Sample,
): Promise<void> {
  const shown = await inkOf(
    rows,
    path.replace(/^.*\//, "").replace(".ink.png", ""),
  );
  const file = await sizesInFile(path);
  const scale = Math.min(shown.width / file.width, shown.height / file.height);
  expect(shown.runs).toBe(strokes.length);
  expect(
    Math.abs(shown.right - shown.left - file.inkWidth * scale),
  ).toBeLessThan(2.5);
  expect(
    Math.abs(shown.bottom - shown.top - file.inkHeight * scale),
  ).toBeLessThan(2.5);
}

describe("Lists of symbols", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("inkline-library");
    });
    for (const [path, xs] of symbols) await createSymbol(path, xs);
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("List.md", "The door reads HERE today.\n");
    });
  });

  afterEach(async function () {
    await useTheme("moonstone");
    await browser.execute(() => {
      const root = document.documentElement;
      root.removeClass("inkline-stored-color");
      root.setCssProps({ "--inkline-scale": "1" });
    });
  });

  for (const list of lists) {
    for (const theme of themes) {
      it(`line names up in ${list.name}, in the ${theme} theme`, async function () {
        await useTheme(theme);
        await list.open();
        await waitForRows(list.rows, symbols.length);
        expectLinedUp(await rowsOf(list.rows), symbols.length);
        await expectWhole(list.rows, surface);
        await expectWhole(list.rows, wider);
        await saveScreenshot(`symbol-list-${list.name}-${theme}`);
      });
    }
  }

  it("show a symbol that fits at the size of the text", async function () {
    const { rows, open } = insertExisting;
    await open();
    await waitForRows(rows, symbols.length);
    for (const row of await rowsOf(rows)) {
      expect(Math.abs(row.pictureHeight - 1.5 * row.fontSize)).toBeLessThan(
        0.5,
      );
    }
    // Each is as tall as the line box, so it fits at the scale of the text.
    for (const symbol of narrow) await expectWhole(rows, symbol);
  });

  it("keep a symbol in its stored colour whole and in the column", async function () {
    await browser.execute(() => {
      document.documentElement.addClass("inkline-stored-color");
    });
    for (const list of [insertExisting, library]) {
      await list.open();
      await waitForRows(list.rows, symbols.length);
      expectLinedUp(await rowsOf(list.rows), symbols.length);
      await expectWhole(list.rows, surface);
      // Each picture starts at the column's left, as one in the text colour.
      const dot = await inkOf(list.rows, "dot");
      expect(dot.left).toBeLessThan(0.3 * dot.width);
      await saveScreenshot(`symbol-list-stored-${list.name}`);
      await browser.keys(["Escape"]);
      await browser.$(".prompt").waitForExist({ reverse: true });
    }
  });

  for (const scale of [0.5, 2]) {
    it(`line names up at a symbol size of ${String(scale * 100)}%`, async function () {
      await browser.execute((size) => {
        document.documentElement.setCssProps({
          "--inkline-scale": String(size),
        });
      }, scale);
      const { rows, open } = insertExisting;
      await open();
      await waitForRows(rows, symbols.length);
      const shown = await rowsOf(rows);
      expectLinedUp(shown, symbols.length);
      for (const row of shown) {
        expect(
          Math.abs(row.pictureHeight - 1.5 * scale * row.fontSize),
        ).toBeLessThan(0.5);
        expect(
          Math.abs(
            row.pictureRight - row.pictureLeft - 3 * scale * row.fontSize,
          ),
        ).toBeLessThan(0.5);
      }
      await saveScreenshot(`symbol-list-size-${String(scale * 100)}`);
    });
  }

  it("keep names in line beside a picture that will not load", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.createBinary(
        "broken.ink.png",
        new TextEncoder().encode("not a PNG").buffer,
      );
    });
    for (const list of [insertExisting, library]) {
      await list.open();
      await waitForRows(list.rows, symbols.length + 1);
      expectLinedUp(await rowsOf(list.rows), symbols.length + 1);
      await browser.keys(["Escape"]);
      await browser.$(".prompt").waitForExist({ reverse: true });
    }
  });

  it("keep names in line beside a very long one", async function () {
    const long =
      "a name long enough to go on past the end of the list and wrap onto a line of its own there";
    await createSymbol(`${long}.ink.png`, [400, 4000, 8600]);
    for (const list of [insertExisting, library]) {
      await list.open();
      await waitForRows(list.rows, symbols.length + 1);
      expectLinedUp(await rowsOf(list.rows), symbols.length + 1);
      await saveScreenshot(`symbol-list-long-name-${list.name}`);
      await browser.keys(["Escape"]);
      await browser.$(".prompt").waitForExist({ reverse: true });
    }
  });
});
