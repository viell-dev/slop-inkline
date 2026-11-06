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

/** A name that shares the line with a row's buttons in the default sidebar. */
const midLength = "past tense";

const long =
  "a name long enough to go on past the end of the list and wrap onto a line of its own there";

/** As long, with nowhere to wrap but inside the word. */
const unbroken = "x".repeat(90);

/** A folder too long for the row, and the name of the symbol in it. */
const deepFolder = "Glyphs/Deep/Deeper/Deepest/Deeper still/Deepest of all";
const deepName = "deep down";

/** Rows that ask the most of the library's, beside those of `symbols`. */
const demanding: readonly Sample[] = [
  [`${midLength}.ink.png`, [400, 1600]],
  [`${long}.ink.png`, [400, 4000, 8600]],
  [`${unbroken}.ink.png`, [400]],
  [`${deepFolder}/${deepName}.ink.png`, [400, 4000, 8600]],
];

/** Obsidian's default for a sidebar, and the narrowest it can be dragged to. */
const defaultSidebar = 300;
const narrowestSidebar = 200;

/** How much narrower the library's list is than its sidebar. */
const sidebarPadding = 24;

/** A list of symbols, and how to show it. */
interface List {
  readonly name: string;
  /** The list's rows. */
  readonly rows: string;
  /** What holds them, which must not scroll sideways. */
  readonly holder: string;
  readonly open: () => Promise<void>;
}

const insertExisting: List = {
  name: "Insert existing symbol",
  rows: ".prompt .suggestion-item",
  holder: ".prompt-results",
  open: async () => {
    await openAtMarker("List.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-existing-symbol");
  },
};

const library: List = {
  name: "the library",
  rows: ".inkline-library-symbol",
  holder: ".inkline-library-list",
  open: async () => {
    await browser.executeObsidianCommand("inkline:show-library");
  },
};

const lists: readonly List[] = [
  {
    name: "the ;; list",
    rows: ".suggestion-container .suggestion-item",
    holder: ".suggestion-container",
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
    holder: ".prompt-results",
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

/** Sets the right sidebar's width, as dragging its edge does. */
async function useSidebar(width: number): Promise<void> {
  await browser.executeObsidian(({ app }, size) => {
    const sidebar = app.workspace.rightSplit;
    const setSize: unknown = Reflect.get(sidebar, "setSize");
    if (typeof setSize !== "function") throw new Error("no sidebar size");
    Reflect.apply(setSize, sidebar, [size]);
  }, width);
}

/** How wide `selector` is, and how far what it holds reaches. */
async function widthsOf(
  selector: string,
): Promise<{ client: number; scroll: number }> {
  return browser.execute((holder) => {
    const found = activeDocument.querySelector(holder);
    if (found === null) throw new Error(`no ${holder}`);
    return { client: found.clientWidth, scroll: found.scrollWidth };
  }, selector);
}

/** Sets the sidebar's width, and waits for the library's list to take it. */
async function resizeLibrary(width: number): Promise<void> {
  await useSidebar(width);
  await browser.waitUntil(
    async () =>
      (await widthsOf(library.holder)).client === width - sidebarPadding,
  );
}

/** An element's edges, in pixels. */
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Where a row of the library puts its parts. */
interface LibraryRow {
  name: string;
  /** Whether part of its name or folder is out of sight. */
  shortened: boolean;
  insert: Box;
  label: Box;
  uses: Box;
  rename: Box;
}

/** The library as it sits in its sidebar. */
interface Library {
  list: Box;
  /** The widths of the list and the view around it, and what they hold. */
  listWidth: { client: number; scroll: number };
  viewWidth: { client: number; scroll: number };
  /** Whether the view scrolls down, and so shows a scroll bar. */
  scrolls: boolean;
  rows: LibraryRow[];
}

/** Measures the library as it shows now. */
async function measureLibrary(): Promise<Library> {
  return browser.execute(() => {
    const required = (element: Element | null, what: string): Element => {
      if (element === null) throw new Error(`no ${what}`);
      return element;
    };
    const edges = (element: Element): Box => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const list = required(
      activeDocument.querySelector(".inkline-library-list"),
      "list",
    );
    const view = required(
      activeDocument.querySelector(".inkline-library"),
      "view",
    );
    return {
      list: edges(list),
      listWidth: { client: list.clientWidth, scroll: list.scrollWidth },
      viewWidth: { client: view.clientWidth, scroll: view.scrollWidth },
      scrolls: view.scrollHeight > view.clientHeight,
      rows: Array.from(list.querySelectorAll(".inkline-library-symbol")).map(
        (row) => {
          const part = (selector: string) =>
            required(row.querySelector(selector), selector);
          const label = part(".inkline-library-name");
          const folder = row.querySelector(".inkline-library-folder-name");
          return {
            name: label.textContent,
            shortened: [label, folder].some(
              (text) =>
                text !== null &&
                (text.scrollHeight > text.clientHeight ||
                  text.scrollWidth > text.clientWidth),
            ),
            insert: edges(part(".inkline-library-insert")),
            label: edges(label),
            uses: edges(part(".inkline-library-uses")),
            rename: edges(part(".inkline-library-rename")),
          };
        },
      ),
    };
  });
}

/** Checks that nothing in the library runs off it or scrolls it sideways. */
function expectInsideSidebar(shown: Library): void {
  expect(shown.listWidth.scroll).toBeLessThanOrEqual(shown.listWidth.client);
  expect(shown.viewWidth.scroll).toBeLessThanOrEqual(shown.viewWidth.client);
  for (const row of shown.rows) {
    expect(row.label.right).toBeLessThanOrEqual(row.insert.right + 0.5);
    expect(row.insert.right).toBeLessThanOrEqual(shown.list.right + 0.5);
    expect(row.rename.right).toBeLessThanOrEqual(shown.list.right + 0.5);
  }
}

/** Checks that both of a row's buttons follow its name, on the name's line. */
function expectOneLine(row: LibraryRow): void {
  for (const button of [row.uses, row.rename]) {
    expect(button.left).toBeGreaterThanOrEqual(row.insert.right);
    expect(button.top).toBeLessThan(row.label.bottom);
    expect(button.bottom).toBeGreaterThan(row.label.top);
  }
}

/** The library's row for the symbol at `path`. */
function libraryRow(path: string): ReturnType<typeof browser.$> {
  return browser.$(`.inkline-library-symbol[data-inkline-path="${path}"]`);
}

/** Holds the pointer over a row's symbol until `wanted` shows as a tooltip. */
async function tooltipOver(path: string, wanted: string): Promise<Box> {
  await libraryRow(path).$(".inkline-library-insert").moveTo();
  let shown = "";
  try {
    await browser.waitUntil(async () => {
      shown = await browser.execute(
        () => activeDocument.querySelector(".tooltip")?.textContent ?? "",
      );
      return shown === wanted;
    });
  } catch (error) {
    throw new Error(`the tooltip reads ${shown}`, { cause: error });
  }
  return browser.execute(() => {
    const tooltip = activeDocument.querySelector(".tooltip");
    if (tooltip === null) throw new Error("no tooltip");
    const { left, right, top, bottom } = tooltip.getBoundingClientRect();
    return { left, right, top, bottom };
  });
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
    await useSidebar(defaultSidebar);
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

  for (const list of lists) {
    it(`keep names in line beside a very long one in ${list.name}`, async function () {
      await createSymbol(`${long}.ink.png`, [400, 4000, 8600]);
      await createSymbol(`${unbroken}.ink.png`, [400, 4000, 8600]);
      await list.open();
      await waitForRows(list.rows, symbols.length + 2);
      expectLinedUp(await rowsOf(list.rows), symbols.length + 2);
      const { client, scroll } = await widthsOf(list.holder);
      expect(scroll).toBeLessThanOrEqual(client);
      await saveScreenshot(`symbol-list-long-name-${list.name}`);
    });
  }

  describe("in the library's sidebar", function () {
    const count = symbols.length + demanding.length;

    beforeEach(async function () {
      for (const [path, xs] of demanding) await createSymbol(path, xs);
    });

    for (const theme of themes) {
      it(`keep each row on one line by default, in the ${theme} theme`, async function () {
        await useTheme(theme);
        await library.open();
        await waitForRows(library.rows, count);
        const shown = await measureLibrary();
        expectInsideSidebar(shown);
        expectLinedUp(await rowsOf(library.rows), count);
        for (const row of shown.rows) expectOneLine(row);
        await expectWhole(library.rows, surface);
        await expectWhole(library.rows, wider);
        await saveScreenshot(`symbol-library-rows-${theme}`);
      });
    }

    it("show a mid-length name whole, on its buttons' line", async function () {
      await library.open();
      await waitForRows(library.rows, count);
      const { rows } = await measureLibrary();
      const row = rows.find(({ name }) => name === midLength);
      const dot = rows.find(({ name }) => name === "dot");
      if (row === undefined || dot === undefined) throw new Error("no row");
      expectOneLine(row);
      expect(row.shortened).toBe(false);
      // One line of text, as tall as the shortest name's.
      expect(row.label.bottom - row.label.top).toBe(
        dot.label.bottom - dot.label.top,
      );
    });

    it("line up the rows' buttons, whatever their text", async function () {
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.create("Uses.md", "![[dot.ink.png]]\n");
      });
      await library.open();
      await waitForRows(library.rows, count);
      await browser.waitUntil(
        async () =>
          (await libraryRow("dot.ink.png")
            .$(".inkline-library-uses")
            .getText()) === "1 note",
      );
      const { rows } = await measureLibrary();
      expect(spread(rows.map(({ uses }) => uses.left))).toBeLessThan(0.5);
      expect(spread(rows.map(({ rename }) => rename.left))).toBeLessThan(0.5);
      expect(spread(rows.map(({ insert }) => insert.right))).toBeLessThan(0.5);
    });

    it("keep rows on one line beside a scroll bar", async function () {
      await browser.executeObsidian(async ({ app }) => {
        const dot = app.vault.getFileByPath("dot.ink.png");
        if (dot === null) throw new Error("no dot");
        const bytes = await app.vault.readBinary(dot);
        for (let copy = 0; copy < 30; copy++) {
          await app.vault.createBinary(`copy ${String(copy)}.ink.png`, bytes);
        }
      });
      await library.open();
      await waitForRows(library.rows, count + 30);
      const shown = await measureLibrary();
      expect(shown.scrolls).toBe(true);
      expect(shown.listWidth.client).toBeLessThan(
        defaultSidebar - sidebarPadding,
      );
      expectInsideSidebar(shown);
      for (const row of shown.rows) expectOneLine(row);
      await saveScreenshot("symbol-library-rows-scroll-bar");
    });

    for (const width of [narrowestSidebar, 260]) {
      it(`drop a row's buttons together in a sidebar ${String(width)} pixels wide`, async function () {
        await library.open();
        await waitForRows(library.rows, count);
        await resizeLibrary(width);
        const shown = await measureLibrary();
        expectInsideSidebar(shown);
        expectLinedUp(await rowsOf(library.rows), count);
        for (const row of shown.rows) {
          // Side by side on the row's next line, at the row's end.
          expect(row.uses.top).toBeGreaterThanOrEqual(row.insert.bottom);
          expect(row.rename.top).toBe(row.uses.top);
          expect(row.rename.left).toBeGreaterThanOrEqual(row.uses.right);
          expect(Math.abs(row.rename.right - shown.list.right)).toBeLessThan(
            0.5,
          );
        }
        await saveScreenshot(`symbol-library-rows-${String(width)}`);
      });
    }

    it("give a wide sidebar's room to the names", async function () {
      await library.open();
      await waitForRows(library.rows, count);
      const widest = ({ rows }: Library) =>
        Math.max(...rows.map(({ label }) => label.right - label.left));
      const before = widest(await measureLibrary());
      await resizeLibrary(450);
      const shown = await measureLibrary();
      expectInsideSidebar(shown);
      expectLinedUp(await rowsOf(library.rows), count);
      for (const row of shown.rows) expectOneLine(row);
      expect(widest(shown)).toBeGreaterThan(before + 100);
      await saveScreenshot("symbol-library-rows-wide");
    });

    it("keep the whole of a shortened name and folder in a tooltip", async function () {
      await library.open();
      await waitForRows(library.rows, count);
      const { rows } = await measureLibrary();
      expect(
        rows
          .filter(({ shortened }) => shortened)
          .map(({ name }) => name)
          .sort(),
      ).toEqual([deepName, long, unbroken].sort());
      // A long name wraps onto a second line before it shortens.
      const height = (wanted: string): number => {
        const row = rows.find(({ name }) => name === wanted);
        if (row === undefined) throw new Error(`no ${wanted}`);
        return row.label.bottom - row.label.top;
      };
      expect(height(long)).toBe(2 * height("dot"));
      expect(height(unbroken)).toBe(2 * height("dot"));
      const width = await browser.execute(() => activeWindow.innerWidth);
      for (const [path, tooltip] of [
        [`${long}.ink.png`, long],
        [`${unbroken}.ink.png`, unbroken],
        [`${deepFolder}/${deepName}.ink.png`, `${deepFolder}/${deepName}`],
      ] as const) {
        const box = await tooltipOver(path, tooltip);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
      await saveScreenshot("symbol-library-rows-tooltip");
      // A screen reader has the whole of it too.
      expect(
        await libraryRow(`${long}.ink.png`)
          .$(".inkline-library-insert")
          .getAttribute("aria-label"),
      ).toBe(long);
    });

    it("keep a long-named row's buttons, the filter and renaming working", async function () {
      const path = `${long}.ink.png`;
      const noteName = "y".repeat(90);
      await browser.executeObsidian(
        async ({ app }, symbol, note) => {
          await app.vault.create(`${note}.md`, `![[${symbol}]]\n`);
        },
        path,
        noteName,
      );
      await openAtMarker("List.md", "HERE");
      await library.open();
      await waitForRows(library.rows, count);
      const row = libraryRow(path);
      const uses = row.$(".inkline-library-uses");
      await browser.waitUntil(async () => (await uses.getText()) === "1 note");

      // The row's symbol inserts it, under its whole name.
      await row.$(".inkline-library-insert").click();
      await browser.waitUntil(async () =>
        browser.executeObsidian(
          ({ app, obsidian }, name) =>
            app.workspace
              .getLeavesOfType("markdown")
              .some(
                ({ view }) =>
                  view instanceof obsidian.MarkdownView &&
                  view.editor.getValue().includes(name),
              ),
          long,
        ),
      );

      // Its count lists its note, whose unbroken name stays in the sidebar.
      await uses.click();
      const note = libraryRow(path).$(".inkline-library-note");
      await note.waitForExist();
      expect(await note.getProperty("textContent")).toBe(noteName);
      expectInsideSidebar(await measureLibrary());
      await saveScreenshot("symbol-library-rows-notes");

      // The filter finds it by words that the row has shortened away.
      const search = browser.$(".inkline-library-search");
      await search.setValue("of its own there");
      await browser.waitUntil(
        async () => (await measureLibrary()).rows.length === 1,
      );

      // Rename shows the whole name, and renames it.
      await libraryRow(path).$(".inkline-library-rename").click();
      const field = browser.$(".inkline-library-rename-form input");
      await field.waitForDisplayed();
      expect(await field.getValue()).toBe(long);
      await field.setValue("shorter now");
      await browser.keys(["Enter"]);
      await browser.$("button=Just once").click();
      await browser.waitUntil(async () => search.isEnabled());
      await search.setValue("shorter");
      await libraryRow("shorter now.ink.png").waitForExist();
      expect(await libraryRow(path).isExisting()).toBe(false);
    });
  });
});
