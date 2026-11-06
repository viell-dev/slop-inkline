import { browser, expect } from "@wdio/globals";
import { unitsPerPixel } from "../../../src/format/record.ts";
import { lineBox } from "../../../src/ink/geometry.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  drawShifted,
  editorGrid,
  hoverShifted,
  openAtMarker,
  settledSurface,
  startOver,
  storedDrafts,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** How far a new symbol's surface reaches across, in document pixels. */
const across = 576;

/** A stroke as a draft stores it. */
type Drawn = Awaited<
  ReturnType<typeof storedDrafts>
>[number]["strokes"][number];

/** A place on the drawing area, in document pixels. */
interface Place {
  readonly x: number;
  readonly y: number;
}

/** The grid's columns and rows, in document pixels, with the helpers below. */
interface Lattice {
  readonly spacing: number;
  readonly rows: readonly number[];
}

async function pressed(id: string): Promise<string | null> {
  return browser
    .$(`[data-inkline-button="${id}"]`)
    .getAttribute("aria-pressed");
}

/** Opens the editor for a new symbol with the grid on, and returns the grid. */
async function openOnGrid(): Promise<Lattice> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await settledSurface();
  await browser.keys(["Shift", "g"]);
  await browser.waitUntil(async () => (await pressed("grid")) === "true");
  return editorGrid();
}

/** A place as fractions of the surface, for a new symbol's. */
function fractions({ x, y }: Place): readonly [number, number] {
  return [x / across, y / lineBox.height];
}

/**
 * The middle of the cell `column` columns across and just below the row at
 * `row`: as far from the four grid points around it as a place can be.
 */
function cellMiddle({ spacing, rows }: Lattice, column: number, row: number) {
  return {
    x: (column + 0.5) * spacing,
    y: ((rows[row] ?? 0) + (rows[row + 1] ?? 0)) / 2,
  };
}

/** The strokes of the editor's draft, once it holds `count` of them. */
async function draftStrokes(count: number): Promise<readonly Drawn[]> {
  await browser.waitUntil(
    async () => ((await storedDrafts())[0]?.strokes.length ?? 0) >= count,
    { timeoutMsg: `no draft with ${String(count)} strokes` },
  );
  return (await storedDrafts())[0]?.strokes ?? [];
}

/** A stroke's first and last points, in document pixels. */
function endsOf({ points }: Drawn): { start: Place; end: Place } {
  return {
    start: {
      x: (points[0] ?? 0) / unitsPerPixel,
      y: (points[1] ?? 0) / unitsPerPixel,
    },
    end: {
      x: (points.at(-2) ?? 0) / unitsPerPixel,
      y: (points.at(-1) ?? 0) / unitsPerPixel,
    },
  };
}

/** How far a place is from the nearest grid point, along each axis. */
function offGrid({ spacing, rows }: Lattice, { x, y }: Place): Place {
  return {
    x: Math.abs(x - Math.round(x / spacing) * spacing),
    y: Math.min(...rows.map((row) => Math.abs(row - y))),
  };
}

/** Expects a place to lie on a grid point, to the rounding of a stored unit. */
function expectOnGrid(grid: Lattice, place: Place): void {
  const off = offGrid(grid, place);
  expect(off.x).toBeLessThan(0.1);
  expect(off.y).toBeLessThan(0.1);
}

/** Expects a place to lie off the grid, clear of any point of it. */
function expectOffGrid(grid: Lattice, place: Place): void {
  const off = offGrid(grid, place);
  expect(Math.max(off.x, off.y)).toBeGreaterThan(2);
}

/** Expects `place` within a pixel or two of `wanted`, as the mouse rounds. */
function expectNear(place: Place, wanted: Place): void {
  expect(Math.abs(place.x - wanted.x)).toBeLessThan(2);
  expect(Math.abs(place.y - wanted.y)).toBeLessThan(2);
}

describe("The grid snaps only while Shift is held", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
  });
  after(async function () {
    await startOver();
  });

  it("leaves a plain click in the middle of four grid points where it was clicked", async function () {
    const grid = await openOnGrid();
    const middle = cellMiddle(grid, 18, 6);
    await draw([fractions(middle)]);
    const [dot] = await draftStrokes(1);
    if (dot === undefined) throw new Error("no dot");
    await saveScreenshot(
      "shift-grid-plain-click",
      browser.$(".inkline-editor"),
    );
    const { start } = endsOf(dot);
    console.log("Plain click", JSON.stringify({ middle, start, grid }));
    expect(dot.points).toHaveLength(2);
    expectNear(start, middle);
    expectOffGrid(grid, start);
  });

  it("leaves a stroke drawn without Shift where it was drawn, with the eraser too", async function () {
    const grid = await openOnGrid();
    const from = cellMiddle(grid, 12, 5);
    const to = cellMiddle(grid, 24, 8);
    for (const tool of ["p", "e"]) {
      await browser.keys(tool);
      await draw([fractions(from), fractions(to)]);
    }
    const strokes = await draftStrokes(2);
    expect(strokes.map((stroke) => stroke.tool)).toEqual(["pen", "eraser"]);
    for (const stroke of strokes) {
      const { start, end } = endsOf(stroke);
      console.log("Plain stroke", JSON.stringify({ from, to, start, end }));
      expectNear(start, from);
      expectNear(end, to);
    }
  });

  it("keeps a stroke off the grid, and the grid itself, through Undo and Redo", async function () {
    const grid = await openOnGrid();
    await draw([fractions(cellMiddle(grid, 18, 6))]);
    const [drawn] = await draftStrokes(1);
    await browser.keys(["Control", "z"]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 0);
    await browser.keys(["Control", "Shift", "z"]);
    const [redone] = await draftStrokes(1);
    expect(redone?.points).toEqual(drawn?.points);
    await drawShifted([
      {
        at: fractions({ x: 24.3 * grid.spacing, y: (grid.rows[6] ?? 0) + 2 }),
        shift: true,
      },
    ]);
    const [, dot] = await draftStrokes(2);
    if (dot === undefined) throw new Error("no dot");
    expectOnGrid(grid, endsOf(dot).start);
  });

  it("puts a click with Shift on the nearest grid point", async function () {
    const grid = await openOnGrid();
    const near = {
      x: 18.3 * grid.spacing,
      y: (grid.rows[6] ?? 0) + 2,
    };
    await drawShifted([{ at: fractions(near), shift: true }]);
    const [dot] = await draftStrokes(1);
    if (dot === undefined) throw new Error("no dot");
    expect(dot.points).toHaveLength(2);
    const { start } = endsOf(dot);
    console.log("Shift click", JSON.stringify({ near, start }));
    expectOnGrid(grid, start);
    expectNear(start, { x: 18 * grid.spacing, y: grid.rows[6] ?? 0 });
  });

  it("puts both ends on the grid, straight between, with Shift held through the stroke", async function () {
    const grid = await openOnGrid();
    const from = cellMiddle(grid, 12, 5);
    const to = cellMiddle(grid, 24, 8);
    await drawShifted([
      { at: fractions(from), shift: true },
      { at: fractions({ x: to.x, y: from.y }), shift: true },
      { at: fractions(to), shift: true },
    ]);
    const [stroke] = await draftStrokes(1);
    if (stroke === undefined) throw new Error("no stroke");
    const { start, end } = endsOf(stroke);
    console.log("Held through", JSON.stringify({ start, end }));
    expectOnGrid(grid, start);
    expectOnGrid(grid, end);
    // Every point within a pixel of the line from end to end, though the
    // pointer went round a corner.
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const { points } = stroke;
    for (let at = 0; at < points.length; at += 2) {
      const x = (points[at] ?? 0) / unitsPerPixel;
      const y = (points[at + 1] ?? 0) / unitsPerPixel;
      const away =
        Math.abs(
          (end.x - start.x) * (start.y - y) - (start.x - x) * (end.y - start.y),
        ) / length;
      expect(away).toBeLessThan(1);
    }
  });

  it("snaps only the end after a Shift pressed part way", async function () {
    const grid = await openOnGrid();
    const from = cellMiddle(grid, 8, 5);
    const turn = cellMiddle(grid, 16, 5);
    const to = cellMiddle(grid, 24, 8);
    await drawShifted([
      { at: fractions(from), shift: false },
      { at: fractions(turn), shift: false },
      { at: fractions(to), shift: true },
    ]);
    const [stroke] = await draftStrokes(1);
    if (stroke === undefined) throw new Error("no stroke");
    const { start, end } = endsOf(stroke);
    console.log("Pressed part way", JSON.stringify({ from, start, end }));
    // The press had no Shift, and what was drawn before it stays.
    expectNear(start, from);
    expectOffGrid(grid, start);
    expectOnGrid(grid, end);
  });

  it("keeps a straight part on the grid after a Shift let go part way, and ends where the pointer does", async function () {
    const grid = await openOnGrid();
    const from = cellMiddle(grid, 8, 5);
    const turn = cellMiddle(grid, 16, 5);
    const to = cellMiddle(grid, 24, 8);
    await drawShifted([
      { at: fractions(from), shift: true },
      { at: fractions(turn), shift: true },
      { at: fractions(to), shift: false },
    ]);
    const [stroke] = await draftStrokes(1);
    if (stroke === undefined) throw new Error("no stroke");
    const { start, end } = endsOf(stroke);
    console.log("Let go part way", JSON.stringify({ start, end, to }));
    expectOnGrid(grid, start);
    expectNear(end, to);
    expectOffGrid(grid, end);
  });

  it("keeps a line on the grid when Shift goes up just before the button, with no move between", async function () {
    const grid = await openOnGrid();
    const from = cellMiddle(grid, 8, 5);
    const to = cellMiddle(grid, 24, 8);
    await drawShifted(
      [
        { at: fractions(from), shift: true },
        { at: fractions(to), shift: true },
      ],
      false,
    );
    const [stroke] = await draftStrokes(1);
    if (stroke === undefined) throw new Error("no stroke");
    const { start, end } = endsOf(stroke);
    console.log("Up before the button", JSON.stringify({ start, end }));
    expectOnGrid(grid, start);
    expectOnGrid(grid, end);
  });

  it("puts a stroke's end on the grid when Shift goes down just before the button", async function () {
    const grid = await openOnGrid();
    const from = cellMiddle(grid, 8, 5);
    const to = cellMiddle(grid, 24, 8);
    await drawShifted(
      [
        { at: fractions(from), shift: false },
        { at: fractions(to), shift: false },
      ],
      true,
    );
    const [stroke] = await draftStrokes(1);
    if (stroke === undefined) throw new Error("no stroke");
    const { start, end } = endsOf(stroke);
    console.log("Down before the button", JSON.stringify({ start, end }));
    expectOffGrid(grid, start);
    expectOnGrid(grid, end);
  });

  it("decides each corner of a polygon by Shift at that click, and closes on the first either way", async function () {
    const grid = await openOnGrid();
    await browser.keys("y");
    expect(await pressed("polygon")).toBe("true");
    const first = cellMiddle(grid, 10, 4);
    const second = cellMiddle(grid, 22, 4);
    const third = cellMiddle(grid, 22, 9);
    const fourth = cellMiddle(grid, 10, 9);
    await drawShifted([{ at: fractions(first), shift: false }]);
    await drawShifted([{ at: fractions(second), shift: true }]);
    await drawShifted([{ at: fractions(third), shift: false }]);
    await drawShifted([{ at: fractions(fourth), shift: true }]);
    await saveScreenshot("shift-grid-polygon", browser.$(".inkline-editor"));
    // Back on the first corner, without Shift, which lies off the grid.
    await draw([fractions(first)]);
    const [shape] = await draftStrokes(1);
    if (shape === undefined) throw new Error("no shape");
    expect(shape.kind).toBe("polygon");
    const corners = shape.points.reduce<Place[]>(
      (all, value, at, points) =>
        at % 2 === 0
          ? [
              ...all,
              {
                x: value / unitsPerPixel,
                y: (points[at + 1] ?? 0) / unitsPerPixel,
              },
            ]
          : all,
      [],
    );
    console.log("Corners", JSON.stringify(corners));
    const [one, two, three, four, closed] = corners;
    expect(corners).toHaveLength(5);
    expect(closed).toEqual(one);
    if (
      one === undefined ||
      two === undefined ||
      three === undefined ||
      four === undefined
    ) {
      throw new Error("no corners");
    }
    expectNear(one, first);
    expectOffGrid(grid, one);
    expectOnGrid(grid, two);
    expectNear(three, third);
    expectOffGrid(grid, three);
    expectOnGrid(grid, four);
  });

  it("closes a polygon on a corner placed with Shift, with or without it", async function () {
    const grid = await openOnGrid();
    // The S brush, whose reach of 4 pixels is short of the click further off
    // below, which so closes the shape only by snapping to its corner.
    await browser.keys("1");
    await browser.keys("y");
    const first = { x: 10 * grid.spacing, y: grid.rows[4] ?? 0 };
    const near = { x: first.x + 2, y: first.y + 2 };
    const second = cellMiddle(grid, 22, 4);
    const third = cellMiddle(grid, 22, 9);
    await drawShifted([{ at: fractions(first), shift: true }]);
    await draw([fractions(second)]);
    await draw([fractions(third)]);
    // A click beside it counts as it, without Shift, as off the grid.
    await draw([fractions(near)]);
    const [shape] = await draftStrokes(1);
    expect(shape?.points).toHaveLength(8);
    expect(shape?.points.slice(-2)).toEqual(shape?.points.slice(0, 2));
    await drawShifted([{ at: fractions(first), shift: true }]);
    await draw([fractions(second)]);
    await draw([fractions(third)]);
    // And with Shift, a click that snaps to it does, however far off.
    await drawShifted([
      {
        at: fractions({ x: first.x + grid.spacing * 0.4, y: first.y }),
        shift: true,
      },
    ]);
    const [, again] = await draftStrokes(2);
    expect(again?.points).toHaveLength(8);
  });

  it("shows a polygon's next corner where a click would put it, by Shift at the last move", async function () {
    const grid = await openOnGrid();
    await browser.keys("y");
    // The brush's ink reaches 6 pixels each way from a side, so the pixels
    // past the pointer tell whether the side stops at it or at the grid
    // point, 0.4 of a cell further on.
    const first = { x: 10 * grid.spacing, y: grid.rows[6] ?? 0 };
    const pointer = { x: 20.6 * grid.spacing, y: first.y };
    const snapped = { x: 21 * grid.spacing, y: first.y };
    await drawShifted([{ at: fractions(first), shift: true }]);
    /** The ink on the surface just short of the grid point. */
    const inkAtGridPoint = (): Promise<number> =>
      browser.execute(
        ({ x, y }, width) => {
          const canvas = document.querySelector(
            ".inkline-editor .inkline-surface",
          );
          if (!(canvas instanceof HTMLCanvasElement))
            throw new Error("no canvas");
          const factor = canvas.width / width;
          const pixels = canvas
            .getContext("2d")
            ?.getImageData(
              Math.round(x * factor),
              Math.round(y * factor),
              1,
              1,
            );
          return pixels?.data[3] ?? 0;
        },
        { x: snapped.x + 5, y: first.y },
        across,
      );
    await hoverShifted({ at: fractions(pointer), shift: false });
    const plain = await inkAtGridPoint();
    await hoverShifted({
      at: fractions({ x: pointer.x + 1, y: pointer.y }),
      shift: true,
    });
    const shifted = await inkAtGridPoint();
    console.log("Next side's ink", JSON.stringify({ plain, shifted }));
    expect(plain).toBe(0);
    expect(shifted).toBeGreaterThan(0);
  });

  it("decides an ellipse's corners by Shift at each, and never makes a circle", async function () {
    const grid = await openOnGrid();
    await browser.keys("o");
    expect(await pressed("ellipse")).toBe("true");
    const from = cellMiddle(grid, 10, 4);
    const to = cellMiddle(grid, 30, 8);
    /** The box a stroke fills. */
    const box = ({ points }: Drawn) => {
      const xs = points.filter((_, at) => at % 2 === 0);
      const ys = points.filter((_, at) => at % 2 === 1);
      return {
        left: Math.min(...xs) / unitsPerPixel,
        right: Math.max(...xs) / unitsPerPixel,
        top: Math.min(...ys) / unitsPerPixel,
        bottom: Math.max(...ys) / unitsPerPixel,
      };
    };
    // Neither corner.
    await draw([fractions(from), fractions(to)]);
    // Only the first, with Shift let go part way.
    await drawShifted([
      { at: fractions(from), shift: true },
      { at: fractions(to), shift: false },
    ]);
    // Only the second, with Shift pressed part way.
    await drawShifted([
      { at: fractions(from), shift: false },
      { at: fractions(to), shift: true },
    ]);
    // Both, held through the whole drag.
    await drawShifted([
      { at: fractions(from), shift: true },
      { at: fractions(to), shift: true },
    ]);
    const strokes = await draftStrokes(4);
    await saveScreenshot("shift-grid-ellipse", browser.$(".inkline-editor"));
    const [neither, first, second, both] = strokes.map(box);
    console.log("Boxes", JSON.stringify({ neither, first, second, both }));
    if (
      neither === undefined ||
      first === undefined ||
      second === undefined ||
      both === undefined
    ) {
      throw new Error("no ellipses");
    }
    expectNear({ x: neither.left, y: neither.top }, from);
    expectNear({ x: neither.right, y: neither.bottom }, to);
    expectOnGrid(grid, { x: first.left, y: first.top });
    expectNear({ x: first.right, y: first.bottom }, to);
    expectNear({ x: second.left, y: second.top }, from);
    expectOnGrid(grid, { x: second.right, y: second.bottom });
    expectOnGrid(grid, { x: both.left, y: both.top });
    expectOnGrid(grid, { x: both.right, y: both.bottom });
    // Far wider than tall: Shift did not make a circle.
    expect(both.right - both.left).toBeGreaterThan(
      2 * (both.bottom - both.top),
    );
  });
});
