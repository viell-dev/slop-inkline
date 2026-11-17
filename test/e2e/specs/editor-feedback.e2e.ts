import { browser, expect } from "@wdio/globals";
import type { Stroke } from "../../../src/format/record.ts";
import { lineBox } from "../../../src/ink/geometry.ts";
import { loadModules } from "../support/browser.ts";
import { cursorImage, hasBrushCursor } from "../support/cursor.ts";
import { boxOf, pointAt, warmUpPointer } from "../support/hover.ts";
import {
  draw,
  editorGrid,
  markEditor,
  openAtMarker,
  recordOf,
  settledSurface,
  startOver,
  storedDrafts,
  surface,
  symbolFiles,
  waitForEditor,
  waitForNext,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** The texts of the tooltips Obsidian shows now. */
async function tooltips(): Promise<string[]> {
  return browser.execute(() =>
    [...document.querySelectorAll(".tooltip")].map(
      (tooltip) => tooltip.textContent,
    ),
  );
}

async function insert(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
}

/** Whether each of the buttons `ids` is pressed, by its id. */
async function pressed(
  ...ids: readonly string[]
): Promise<Record<string, string | null>> {
  const states: Record<string, string | null> = {};
  for (const id of ids) {
    states[id] = await browser
      .$(`[data-inkline-button="${id}"]`)
      .getAttribute("aria-pressed");
  }
  return states;
}

/** The kinds of the strokes that the symbol file at `path` holds. */
async function savedKinds(path: string): Promise<(string | undefined)[]> {
  const record = JSON.parse(await recordOf(path)) as { strokes: Stroke[] };
  return record.strokes.map((stroke) => stroke.kind);
}

/** Saves the drawing with Next, and waits for the next symbol's editor. */
async function goOn(): Promise<void> {
  await browser.waitUntil(
    async () => (await storedDrafts())[0]?.strokes.length === 1,
    { timeoutMsg: "the drawing was never kept as a draft" },
  );
  await markEditor();
  await browser.keys(["Control", "Shift", "Enter"]);
  await waitForNext(1);
  expect(await symbolFiles()).toEqual(["001.ink.png"]);
}

/** The grid's dots on the drawing area, as {@link gridDots} reads them. */
interface Dots {
  /** The middles of the rows and columns, in document pixels. */
  readonly rows: number[];
  readonly columns: number[];
  /** The font's x-height, from the top of the line box. */
  readonly xHeight: number;
  /** How many device pixels make one document pixel. */
  readonly factor: number;
}

/**
 * The grid shown, read from the drawing area's pixels while the guides are
 * hidden, so that only its dots are there, as grid.e2e.ts reads them: the
 * middles of the runs of inked rows in its right fifth and of inked columns
 * in its bottom fifth, which nothing drawn here reaches, from the surface's
 * edges; and the x-height from an independent `measureText` of the preview
 * line's font.
 */
async function gridDots(): Promise<Dots> {
  return browser.execute(() => {
    const canvas = document.querySelector(".inkline-editor .inkline-surface");
    const line = document.querySelector(".inkline-editor .inkline-preview");
    if (
      !(canvas instanceof HTMLCanvasElement) ||
      !(line instanceof HTMLElement)
    ) {
      throw new Error("no surface");
    }
    const font = getComputedStyle(line);
    const probe = new OffscreenCanvas(1, 1).getContext("2d");
    if (probe === null) throw new Error("no context");
    probe.font = `${font.fontStyle} ${font.fontWeight} 128px ${font.fontFamily}`;
    // The line box is as tall as the surface, in either view.
    const across =
      (canvas.clientWidth * 192) /
      Number.parseFloat(
        canvas.style.getPropertyValue("--inkline-surface-height"),
      );
    const factor = canvas.width / across;
    const { width, height } = canvas;
    const pixels = canvas.getContext("2d")?.getImageData(0, 0, width, height);
    if (pixels === undefined) throw new Error("no pixels");
    const inkedRows = new Array<boolean>(height).fill(false);
    const inkedColumns = new Array<boolean>(width).fill(false);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels.data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
        if (x >= width * 0.8) inkedRows[y] = true;
        if (y >= height * 0.8) inkedColumns[x] = true;
      }
    }
    /** The middle of each run of inked pixels, in document pixels. */
    const middles = (inked: readonly boolean[]): number[] => {
      const found: number[] = [];
      let start = -1;
      for (let index = 0; index <= inked.length; index++) {
        if (inked[index] === true) {
          if (start < 0) start = index;
        } else if (start >= 0) {
          found.push((start + index) / 2 / factor);
          start = -1;
        }
      }
      return found;
    };
    return {
      rows: middles(inkedRows),
      columns: middles(inkedColumns),
      xHeight: 144 - probe.measureText("x").actualBoundingBoxAscent,
      factor,
    };
  });
}

/** The grid shown, once it stops changing. */
async function settledDots(): Promise<Dots> {
  await settledSurface();
  let shown: Dots | undefined;
  await browser.waitUntil(async () => {
    const previous = shown;
    shown = await gridDots();
    return (
      shown.rows.length > 2 &&
      JSON.stringify([shown.rows, shown.columns]) ===
        JSON.stringify([previous?.rows, previous?.columns])
    );
  });
  if (shown === undefined) throw new Error("no dots");
  return shown;
}

describe("Editor feedback", function () {
  let originalTheme: string[] = [];
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    originalTheme = await browser.execute(() =>
      [...document.body.classList].filter(
        (name) => name === "theme-light" || name === "theme-dark",
      ),
    );
  });

  afterEach(async function () {
    await browser.execute((themes) => {
      document.body.removeClass("theme-light", "theme-dark");
      for (const theme of themes) document.body.addClass(theme);
    }, originalTheme);
  });

  it("keeps the close control clear of the name in light and dark themes", async function () {
    await insert();
    for (const theme of ["theme-light", "theme-dark"]) {
      const layout = await browser.execute((wanted) => {
        document.body.removeClass("theme-light", "theme-dark");
        document.body.addClass(wanted);
        const name = document.querySelector(".inkline-name");
        const close = document.querySelector(
          ".inkline-editor .modal-header-button",
        );
        if (name === null || close === null) throw new Error("no controls");
        const a = name.getBoundingClientRect();
        const b = close.getBoundingClientRect();
        return {
          nameWidth: a.width,
          overlap:
            Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
        };
      }, theme);
      await saveScreenshot(`editor-feedback-${theme}`);
      expect([theme, layout.overlap]).toEqual([theme, 0]);
      expect(layout.nameWidth).toBeGreaterThan(300);
    }
  });

  it("names the drawing area without showing a hover tooltip", async function () {
    await insert();
    expect(await surface().getComputedLabel()).toBe("Drawing area");
    // A button's tooltip shows, after Obsidian's delay in this run, which
    // says how long to wait for one that should not.
    await warmUpPointer();
    const pen = await boxOf('[data-inkline-button="pen"]');
    const start = Date.now();
    await pointAt((pen.left + pen.right) / 2, (pen.top + pen.bottom) / 2);
    await browser.waitUntil(
      async () => (await tooltips()).includes("Pen (P)"),
      { timeoutMsg: "the Pen button showed no tooltip" },
    );
    const patience = Math.max(1500, 3 * (Date.now() - start));
    const area = await boxOf(".inkline-editor .inkline-surface");
    expect(
      await pointAt((area.left + area.right) / 2, (area.top + area.bottom) / 2),
    ).toContain("inkline-surface");
    await browser.pause(patience);
    // The Pen button's own can still be going as the pointer leaves.
    expect((await tooltips()).filter((text) => text !== "Pen (P)")).toEqual([]);
  });

  it("shows the brush footprint without adding it to the drawing", async function () {
    await insert();
    await surface().moveTo();
    await browser.waitUntil(hasBrushCursor);
    const small = await cursorImage();
    await browser.keys("4");
    await browser.waitUntil(
      async () => (await cursorImage()).diameter > small.diameter,
    );
    const large = await cursorImage();
    expect(large.diameter / small.diameter).toBeCloseTo(2, 1);
    await browser.keys("e");
    await browser.waitUntil(hasBrushCursor);
    expect((await cursorImage()).bitmap).toBe(small.bitmap);
    await browser.$('[data-inkline-button="pen"]').moveTo();
    await browser.waitUntil(async () => !(await hasBrushCursor()));
    expect(
      await browser.$(".inkline-brush-cursor").getCSSProperty("display"),
    ).toMatchObject({ value: "none" });
    expect(await surface().getCSSProperty("cursor")).toMatchObject({
      value: "crosshair",
    });
    // The footprint drew nothing: a new symbol with nothing drawn is not
    // saved, and no stroke of either tool was kept as a draft.
    await browser.keys(["Control", "Enter"]);
    await waitForStatus("Not saved: nothing drawn yet");
    expect(await symbolFiles()).toEqual([]);
    expect((await storedDrafts()).flatMap(({ strokes }) => strokes)).toEqual(
      [],
    );
  });

  it("restores the fallback cursor on cancellation and Help", async function () {
    await insert();
    await surface().moveTo();
    const cancelled = await browser.execute(() => {
      const canvas = document.querySelector(".inkline-surface");
      const cursor = document.querySelector(".inkline-brush-cursor");
      if (!(canvas instanceof HTMLCanvasElement) || cursor === null)
        throw new Error("no drawing controls");
      const rect = canvas.getBoundingClientRect();
      const sample = {
        pointerType: "mouse",
        pointerId: 52,
        clientX: rect.left + 80.25,
        clientY: rect.top + 80.25,
        bubbles: true,
      };
      canvas.dispatchEvent(new PointerEvent("pointermove", sample));
      canvas.dispatchEvent(new PointerEvent("pointercancel", sample));
      return {
        native: getComputedStyle(canvas).cursor,
        replacement: canvas.classList.contains("has-brush-cursor"),
        display: getComputedStyle(cursor).display,
      };
    });
    expect(cancelled).toEqual({
      native: "crosshair",
      replacement: false,
      display: "none",
    });
    await surface().moveTo({ xOffset: 20 });
    await browser.waitUntil(hasBrushCursor);
    // Keyboard activation opens Help without a pointerleave hiding the ring.
    await browser.execute(() => {
      const help = document.querySelector('[data-inkline-button="help"]');
      if (!(help instanceof HTMLButtonElement)) throw new Error("no Help");
      help.focus();
    });
    await browser.keys("Enter");
    await browser.$(".inkline-help").waitForDisplayed();
    expect(await surface().getCSSProperty("cursor")).toMatchObject({
      value: "crosshair",
    });
    expect(await hasBrushCursor()).toBe(false);
    expect(
      await browser.$(".inkline-brush-cursor").getCSSProperty("display"),
    ).toMatchObject({ value: "none" });
    await browser.keys("Escape");
    await browser.$(".inkline-help").waitForExist({ reverse: true });
    await surface().moveTo({ xOffset: -20 });
    await browser.waitUntil(hasBrushCursor);
  });

  it("scales the brush circle with the surface and keeps it after a stroke", async function () {
    await insert();
    await surface().moveTo();
    await browser.waitUntil(hasBrushCursor);
    // Measure the actual cursor image, excluding its transparent padding.
    const measure = async () => ({
      brush: (await cursorImage()).diameter,
      surface: await browser.execute(() => {
        const canvas = document.querySelector(".inkline-surface");
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error("no drawing controls");
        }
        return canvas.clientWidth;
      }),
    });
    const before = await measure();
    await browser.execute(() => {
      const modal = document.querySelector(".inkline-editor");
      if (modal instanceof HTMLElement) modal.setCssProps({ width: "480px" });
    });
    await browser.waitUntil(
      async () => (await surface().getSize()).width < before.surface,
    );
    await surface().moveTo();
    await browser.waitUntil(
      async () => (await cursorImage()).diameter < before.brush,
    );
    const after = await measure();
    expect(after.brush / before.brush).toBeCloseTo(
      after.surface / before.surface,
      2,
    );
    await draw([
      [0.4, 0.3],
      [0.5, 0.7],
    ]);
    await browser.waitUntil(hasBrushCursor);
    await saveScreenshot("editor-brush-circle");
  });

  it("explains the guides and returns from Help without changing the drawing", async function () {
    await insert();
    await draw([
      [0.4, 0.3],
      [0.5, 0.7],
    ]);
    await browser.$('[data-inkline-button="help"]').click();
    const help = browser.$(".inkline-help");
    await help.waitForDisplayed();
    const text = await help.getText();
    for (const name of [
      "Ascender",
      "Cap height",
      "x-height",
      "Baseline",
      "Descender",
      "Vertical dashed",
      "Grid",
      "Next",
    ]) {
      expect(text).toContain(name);
    }
    await saveScreenshot("editor-quick-start");
    await browser.keys("Escape");
    await help.waitForExist({ reverse: true });
    expect(await surface().isFocused()).toBe(true);
    await browser.keys(["Control", "Enter"]);
    await surface().waitForExist({ reverse: true });
    const saved: unknown = JSON.parse(await recordOf("001.ink.png"));
    expect(saved).toMatchObject({
      strokes: [expect.objectContaining({ tool: "pen" })],
    });
  });

  it("keeps the picture drop outline inside the surface without keyboard focus", async function () {
    await insert();
    await browser.$(".inkline-name").click();
    const outline = await browser.execute(() => {
      const canvas = document.querySelector(".inkline-surface");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
      const data = new DataTransfer();
      data.items.add(
        new File(["synthetic"], "trace.png", { type: "image/png" }),
      );
      canvas.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        }),
      );
      const style = getComputedStyle(canvas);
      return {
        style: style.outlineStyle,
        outside:
          Number.parseFloat(style.outlineOffset) +
          Number.parseFloat(style.outlineWidth),
      };
    });
    expect(outline.style).toBe("dashed");
    expect(outline.outside).toBeLessThanOrEqual(0);
    await saveScreenshot("editor-drop-outline");
  });

  // Next hands the tools on to the next symbol's editor. Ellipse and Polygon
  // are never on together, so the hand-off takes two tests, one for each.
  it("starts the next symbol with an ellipse's tools: Fill, both sizes, the grid, the guides and Zoom", async function () {
    await insert();
    // The pen's S and the eraser's XL, and the pen again.
    await browser.keys("1");
    await browser.keys("e");
    await browser.keys("4");
    await browser.keys("p");
    expect(await pressed("size-0")).toEqual({ "size-0": "true" });
    // The grid shown and the guides hidden, so that only the grid's dots are
    // on the edges that gridDots reads.
    await browser.keys(["Shift", "g"]);
    await browser.keys("g");
    await browser.keys("o");
    await browser.keys("b");
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    const zoomed = await settledSurface();
    const { spacing } = await editorGrid();
    await draw([
      [0.3, 0.3],
      [0.6, 0.7],
    ]);
    await goOn();
    expect(await savedKinds("001.ink.png")).toEqual(["fill"]);
    expect(
      await pressed(
        "pen",
        "eraser",
        "size-0",
        "ellipse",
        "polygon",
        "fill",
        "grid",
        "guides",
        "zoom",
      ),
    ).toEqual({
      pen: "true",
      eraser: "false",
      "size-0": "true",
      ellipse: "true",
      polygon: "false",
      fill: "true",
      grid: "true",
      guides: "false",
      zoom: "true",
    });
    expect(
      Math.abs((await settledSurface()).height - zoomed.height),
    ).toBeLessThan(2);
    // Zoom's finer grid, with twice the cells each way.
    const dots = await settledDots();
    await saveScreenshot("editor-next-ellipse");
    const between = dots.rows.filter(
      (row) => row > dots.xHeight + 1 && row < lineBox.baseline - 1,
    );
    expect(between).toHaveLength(9);
    for (const [index, x] of dots.columns.slice(1).entries()) {
      const step = x - (dots.columns[index] ?? 0);
      expect(Math.abs(step - spacing / 2)).toBeLessThanOrEqual(1 / dots.factor);
    }
    await browser.keys("e");
    expect(await pressed("size-3")).toEqual({ "size-3": "true" });
    await browser.keys("p");
    // It draws a filled ellipse, and saves a second symbol.
    await draw([
      [0.4, 0.6],
      [0.6, 0.4],
    ]);
    await browser.keys(["Control", "Enter"]);
    await browser.waitUntil(async () => (await symbolFiles()).length === 2);
    const [second = ""] = (await symbolFiles()).filter(
      (path) => path !== "001.ink.png",
    );
    expect(await savedKinds(second)).toEqual(["fill"]);
  });

  it("starts the next symbol with a polygon's tools: the eraser, the grid and Flat ends", async function () {
    await insert();
    await browser.keys(["Shift", "g"]);
    await browser.keys("t");
    expect(await pressed("flat-ends")).toEqual({ "flat-ends": "true" });
    await browser.keys("y");
    // A line of the pen, as Next saves no new symbol that has only the
    // eraser's strokes, ended on its last corner; then the eraser.
    for (const point of [
      [0.2, 0.2],
      [0.2, 0.7],
      [0.2, 0.7],
    ] as const) {
      await draw([point]);
    }
    await browser.keys("e");
    await goOn();
    expect(
      await pressed("pen", "eraser", "ellipse", "polygon", "grid", "flat-ends"),
    ).toEqual({
      pen: "false",
      eraser: "true",
      ellipse: "false",
      polygon: "true",
      grid: "true",
      "flat-ends": "false",
    });
    const flatEnds = browser.$('[data-inkline-button="flat-ends"]');
    expect(await flatEnds.isEnabled()).toBe(false);
    // Freehand again, Flat ends is on, as it was.
    await browser.keys("y");
    expect(await pressed("polygon", "flat-ends")).toEqual({
      polygon: "false",
      "flat-ends": "true",
    });
    expect(await flatEnds.isEnabled()).toBe(true);
  });
});
