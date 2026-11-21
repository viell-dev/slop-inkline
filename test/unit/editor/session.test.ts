import { describe, expect, it } from "vitest";
import {
  DrawingSession,
  brushSizes,
  ellipsePoints,
  gridCuts,
  maxGap,
  gridOriginOf,
  plainGrid,
  snapToGrid,
  type InputPoint,
} from "../../../src/editor/session.ts";
import { finerGrid, type Grid } from "../../../src/editor/guides.ts";
import { sweptStroke } from "../../../src/editor/sweep.ts";
import type { Stroke } from "../../../src/format/record.ts";
import { emptyDocument } from "../../../src/ink/document.ts";
import { smoothShape } from "../../../src/ink/outline.ts";

/**
 * The stroke a session is drawing, which is the only one: only a filled
 * shape draws two.
 */
function drawn(session: DrawingSession): Stroke | undefined {
  const strokes = session.activeStrokes;
  expect(strokes.length).toBeLessThanOrEqual(1);
  return strokes[0];
}

/** Whether a fill's `x, y` points, in units, cover the point (x, y). */
function covers(points: readonly number[], x: number, y: number): boolean {
  let turns = 0;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x0 = points[index] ?? 0;
    const y0 = points[index + 1] ?? 0;
    const next = (index + 2) % points.length;
    const x1 = points[next] ?? 0;
    const y1 = points[next + 1] ?? 0;
    const side = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
    if (y0 <= y) {
      if (y1 > y && side > 0) turns++;
    } else if (y1 <= y && side < 0) {
      turns--;
    }
  }
  return turns !== 0;
}

describe("brushSizes", () => {
  it("run from 0.75 to 3 px at a 16 px font, in whole document pixels", () => {
    expect(brushSizes.map((size) => size.em * 16)).toEqual([
      0.75, 1.5, 2.25, 3,
    ]);
    expect(brushSizes.map((size) => size.em * 128)).toEqual([6, 12, 18, 24]);
  });
});

describe("DrawingSession", () => {
  it("remembers each tool's size, and draws with the chosen tool's", () => {
    const session = new DrawingSession(emptyDocument);
    session.sizeIndex = 0;
    session.tool = "eraser";
    expect(session.sizeIndex).toBe(1);
    session.sizeIndex = 3;
    session.tool = "pen";
    expect(session.sizeIndex).toBe(0);
    session.begin({ x: 0, y: 0 });
    expect(drawn(session)).toMatchObject({ tool: "pen", size: 96 });
    session.end();
    session.tool = "eraser";
    expect(session.sizeIndex).toBe(3);
    session.begin({ x: 0, y: 0 });
    expect(drawn(session)).toMatchObject({ tool: "eraser", kind: "fill" });
    expect(session.activeSize).toBe(384);
    session.end();
  });

  it("commits a stroke with the current brush, in units", () => {
    const session = new DrawingSession(emptyDocument);
    session.sizeIndex = 2;
    session.begin({ x: 10, y: 20 });
    session.extend([{ x: 10.5, y: 21 }]);
    session.end();
    expect(session.document.strokes).toEqual([
      { tool: "pen", size: 288, points: [160, 320, 168, 336] },
    ]);
  });

  it("skips repeated points", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 1, y: 1 });
    session.extend([
      { x: 1, y: 1 },
      { x: 1.01, y: 1 },
      { x: 2, y: 1 },
    ]);
    session.end();
    expect(session.document.strokes[0]?.points).toEqual([16, 16, 32, 16]);
  });

  it("fills gaps longer than 2 px along the straight line", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0 });
    session.extend([{ x: 10, y: 0 }]);
    session.end();
    expect(session.document.strokes[0]?.points).toEqual([
      0, 0, 32, 0, 64, 0, 96, 0, 128, 0, 160, 0,
    ]);
  });

  it("does not fill a gap between strokes", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0 });
    session.end();
    session.begin({ x: 100, y: 0 });
    session.end();
    expect(session.document.strokes[1]?.points).toEqual([1600, 0]);
  });

  it("shows the stroke being drawn and drops a cancelled one", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0 });
    expect(drawn(session)?.points).toEqual([0, 0]);
    expect(session.drawing).toBe(true);
    session.cancel();
    expect(drawn(session)).toBeUndefined();
    expect(session.document.strokes).toEqual([]);
  });

  it("undoes, redoes, and clears as single steps", () => {
    const session = new DrawingSession(emptyDocument);
    for (const x of [1, 2]) {
      session.begin({ x, y: 0 });
      session.end();
    }
    expect(session.undo()).toBe(true);
    expect(session.document.strokes).toHaveLength(1);
    expect(session.redo()).toBe(true);
    session.clear();
    expect(session.document.strokes).toEqual([]);
    expect(session.undo()).toBe(true);
    expect(session.document.strokes).toHaveLength(2);
  });

  it("does not undo while a stroke is being drawn", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0 });
    session.end();
    session.begin({ x: 1, y: 0 });
    expect(session.canUndo).toBe(false);
    expect(session.undo()).toBe(false);
  });

  it("is dirty until saved, and again after a change, even one made during a save", () => {
    const session = new DrawingSession(emptyDocument);
    expect(session.dirty).toBe(false);
    session.begin({ x: 0, y: 0 });
    session.end();
    expect(session.dirty).toBe(true);
    const saving = session.document;
    session.begin({ x: 1, y: 1 });
    session.end();
    session.markSaved(saving);
    expect(session.dirty).toBe(true);
    session.markSaved(session.document);
    expect(session.dirty).toBe(false);
    session.undo();
    expect(session.dirty).toBe(true);
  });

  it("counts a stroke being drawn as unsaved", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0 });
    expect(session.dirty).toBe(true);
  });

  it("replaces the document as one undoable change", () => {
    const session = new DrawingSession(emptyDocument);
    const restored = {
      strokes: [{ tool: "pen", size: 16, points: [0, 0] }],
    } as const;
    session.replace(restored);
    expect(session.document).toBe(restored);
    expect(session.dirty).toBe(true);
    expect(session.undo()).toBe(true);
    expect(session.document).toBe(emptyDocument);
  });

  it("moves every state, the saved one, and the stroke being drawn", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 10, y: 0 });
    session.end();
    const saved = session.document;
    session.markSaved(saved);
    session.begin({ x: 20, y: 0 });
    session.rebase(-5);
    session.extend([{ x: 16, y: 0 }]);
    session.end();
    expect(session.document.strokes.map((stroke) => stroke.points)).toEqual([
      [80, 0],
      [240, 0, 256, 0],
    ]);
    session.undo();
    expect(session.dirty).toBe(false);
    expect(session.document.strokes[0]?.points).toEqual([80, 0]);
    session.undo();
    expect(session.document).toEqual(emptyDocument);
  });

  it("keeps the states' shared strokes and base layer shared when moving them", () => {
    const png = Uint8Array.of(1);
    const session = new DrawingSession({
      strokes: [],
      base: { x: 0, y: 0, width: 16, height: 16, png },
    });
    for (let index = 0; index < 50; index++) {
      session.begin({ x: index, y: 0 });
      session.extend([{ x: index, y: 40 }]);
      session.end();
    }
    session.rebase(-5);
    const states = [session.document];
    while (session.undo()) states.push(session.document);
    const first = states.map((state) => state.strokes[0]);
    const bases = states.map((state) => state.base);
    // Each state but the first shares the first stroke, moved once.
    expect(new Set(first.slice(0, -1)).size).toBe(1);
    expect(first[0]?.points.slice(0, 2)).toEqual([-80, 0]);
    expect(new Set(bases).size).toBe(1);
    expect(bases[0]).toEqual({ x: -80, y: 0, width: 16, height: 16, png });
    expect(session.saved).toBe(states.at(-1));
  });

  it("ends a stroke where the pointer was let go", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0 });
    session.extend([{ x: 1, y: 0 }]);
    session.end({ x: 4, y: 0 });
    expect(session.document.strokes[0]?.points).toEqual([
      0, 0, 16, 0, 40, 0, 64, 0,
    ]);
    session.begin({ x: 0, y: 32 });
    session.end({ x: 0, y: 32 });
    expect(session.document.strokes[1]?.points).toEqual([0, 512]);
  });

  it("draws a straight segment while straight, from where it began", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0 });
    session.extend([{ x: 4, y: 0 }]);
    // Straight from (4, 0), wherever the pointer wanders on the way.
    session.extend(
      [
        { x: 9, y: 7 },
        { x: 4, y: 12 },
        { x: 4, y: 8 },
      ],
      true,
    );
    const points = drawn(session)?.points ?? [];
    const xs = points.filter((_, index) => index % 2 === 0);
    const ys = points.filter((_, index) => index % 2 === 1);
    // Freehand to (4, 0), then straight down to (4, 8) only.
    expect(xs.slice(0, 3)).toEqual([0, 32, 64]);
    expect(xs.slice(2).every((x) => x === 64)).toBe(true);
    expect(ys.at(-1)).toBe(128);
    expect(Math.max(...ys)).toBe(128);
    // Freehand again once it stops, from where the segment ended.
    session.extend([{ x: 6, y: 8 }]);
    session.end();
    expect(session.document.strokes[0]?.points.slice(-2)).toEqual([96, 128]);
  });

  it("ends a stroke that is straight at its release, straight", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0 });
    session.extend([{ x: 3, y: 5 }], true);
    session.end({ x: 0, y: 6 });
    const points = session.document.strokes[0]?.points ?? [];
    expect(points.filter((_, index) => index % 2 === 0)).toEqual([0, 0, 0, 0]);
    expect(points.slice(-2)).toEqual([0, 96]);
  });

  it("starts and ends strokes on the grid with Shift held, while it is on", () => {
    expect(plainGrid.spacing).toBe(16);
    expect(plainGrid.rows).toHaveLength(13);
    expect(snapToGrid({ x: 7, y: 9 })).toEqual({ x: 0, y: 16 });
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 7, y: 9 }, true);
    session.extend([{ x: 20, y: 18 }], true);
    session.end(undefined, true);
    const points = session.document.strokes[0]?.points ?? [];
    expect(points.slice(0, 2)).toEqual([0, 256]);
    expect(points.slice(-2)).toEqual([256, 256]);
    // A straight segment's end follows the grid as it is drawn.
    session.begin({ x: 0, y: 0 }, true);
    session.extend([{ x: 25, y: 2 }], true);
    expect(drawn(session)?.points.slice(-2)).toEqual([512, 0]);
  });

  it("records a tap on the grid as one point with the pen, and the eraser's circle about it", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 7, y: 9 }, true);
    session.end({ x: 7, y: 9 }, true);
    session.begin({ x: 7, y: 9 }, true);
    session.end({ x: 7.4, y: 9.2 }, true);
    session.tool = "eraser";
    session.begin({ x: 7, y: 9 }, true);
    session.end({ x: 7, y: 9 }, true);
    const [first, second, eraser] = session.document.strokes;
    expect([first?.points, second?.points]).toEqual([
      [0, 256],
      [0, 256],
    ]);
    // Marked at the grid point, where it starts and ends.
    expect(eraser?.kind).toBe("fill");
    expect(eraser?.points.slice(0, 2)).toEqual([0, 256]);
    expect(eraser?.points.slice(-2)).toEqual([0, 256]);
  });

  it("keeps the grid's place in the drawing when a save moves it", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 7, y: 9 }, true);
    session.end({ x: 7, y: 9 }, true);
    // A save cropped 5 pixels on the left, so everything moves left by 5.
    session.rebase(-5);
    expect(session.gridOrigin).toBe(11);
    // The same place on screen is now 5 pixels further left.
    session.begin({ x: 2, y: 9 }, true);
    session.end({ x: 2, y: 9 }, true);
    const [first, second] = session.document.strokes;
    expect(second?.points).toEqual(first?.points);
    expect(first?.points).toEqual([-80, 256]);
  });

  it("keeps a straight segment on the grid through a save", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 0, y: 0 });
    session.extend([{ x: 20, y: 2 }], true);
    expect(drawn(session)?.points.slice(-2)).toEqual([256, 0]);
    session.rebase(-5);
    session.extend([{ x: 15, y: 2 }], true);
    expect(drawn(session)?.points.slice(-2)).toEqual([176, 0]);
  });

  it("lines the grid up with where an opened drawing's strokes end", () => {
    const stroke = (...xs: number[]) => ({
      tool: "pen" as const,
      size: 16,
      points: xs.flatMap((x) => [x, 0]),
    });
    expect(gridOriginOf(emptyDocument)).toBe(0);
    // With no end shared, where the first stroke starts: 145.5 and -2.5
    // pixels.
    expect(gridOriginOf({ strokes: [stroke(2328, 100)] })).toBe(1.5);
    expect(gridOriginOf({ strokes: [stroke(-40)] })).toBe(13.5);
    // A first stroke drawn without the grid, 6.25 and 14.5 pixels into a
    // spacing, then one on the grid, both ends 1.5 pixels into one.
    expect(
      gridOriginOf({
        strokes: [stroke(100, 1000), stroke(280, 300, 536)],
      }),
    ).toBe(1.5);
    const session = new DrawingSession({ strokes: [stroke(2328)] });
    session.snap = true;
    // Nearest to 161.5, one spacing on from the first stroke's start.
    session.begin({ x: 160, y: 0 }, true);
    session.end();
    expect(session.document.strokes[1]?.points).toEqual([2328 + 256, 0]);
  });

  it("goes by the ends on the grid's rows, however many others share a place", () => {
    const line = (...points: number[]) => ({
      tool: "pen" as const,
      size: 24,
      points,
    });
    // Three freehand ends share a place 5 px into a cell, off every row, and
    // a line put on the grid has both ends 3 px into one, on rows.
    const row = (plainGrid.rows[3] ?? 0) * 16;
    const other = (plainGrid.rows[5] ?? 0) * 16;
    const freehand = line(80, 101, 80 + 256, 133, 80, 171);
    const onGrid = line(48, row, 48 + 512, other);
    expect(gridOriginOf({ strokes: [freehand, freehand, onGrid] })).toBe(3);
    // Halfway between two rows, as Zoom's finer grid puts an end, counts too.
    const halfway =
      (((plainGrid.rows[3] ?? 0) + (plainGrid.rows[4] ?? 0)) / 2) * 16;
    const half = line(48, halfway, 48 + 512, halfway);
    expect(gridOriginOf({ strokes: [freehand, freehand, half] })).toBe(3);
    // With no end on a row, the most shared place, as ever.
    expect(gridOriginOf({ strokes: [freehand, freehand] })).toBe(5);
  });

  it("keeps a stroke where it was shown when Shift lifts just before the button", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 16, y: 64 }, true);
    session.extend([{ x: 47, y: 66 }], true);
    const shown = drawn(session)?.points.slice(-2);
    // Let go 9 px further on, past the middle of a cell, with no move between.
    session.end({ x: 41, y: 73 }, false);
    expect(session.document.strokes[0]?.points.slice(-2)).toEqual(shown);
  });

  it("keeps a polygon's corner where it was shown, too", () => {
    const polygon = new DrawingSession(emptyDocument);
    polygon.snap = true;
    polygon.shape = "polygon";
    polygon.begin({ x: 7, y: 9 }, true);
    polygon.end({ x: 7, y: 9 }, true);
    polygon.begin({ x: 47, y: 66 }, true);
    // Let go past the middle of a cell, Shift up, with no move between.
    polygon.end({ x: 41, y: 73 }, false);
    expect(drawn(polygon)?.points.slice(-2)).toEqual([48 * 16, 64 * 16]);
  });

  it("picks the most shared place for the grid, the first of a tie", () => {
    const stroke = (...xs: number[]) => ({
      tool: "pen" as const,
      size: 16,
      points: xs.flatMap((x) => [x, 0]),
    });
    // A tap on the grid at 16 pixels, and a freehand stroke that starts and
    // ends at 7: the freehand ends outnumber it.
    expect(gridOriginOf({ strokes: [stroke(256), stroke(112, 112)] })).toBe(7);
    // 6.25 and 1.5 pixels into a spacing, twice each: 6.25 got there first.
    expect(
      gridOriginOf({
        strokes: [stroke(100), stroke(24), stroke(356), stroke(280)],
      }),
    ).toBe(6.25);
    // A one-point stroke marks its place once.
    expect(gridOriginOf({ strokes: [stroke(100), stroke(24, 280)] })).toBe(1.5);
    // An eraser's ends mark theirs, as a pen's do.
    expect(
      gridOriginOf({
        strokes: [stroke(24), { ...stroke(100, 356), tool: "eraser" }],
      }),
    ).toBe(6.25);
    expect(gridOriginOf(emptyDocument, 3)).toBe(3);
  });

  it("puts the grid where a restored drawing has it, and back on undo", () => {
    const stroke = (x: number) =>
      ({ tool: "pen", size: 16, points: [x, 0] }) as const;
    // 145.5 pixels, so 1.5 into a spacing.
    const session = new DrawingSession({ strokes: [stroke(2328)] });
    session.replace({ strokes: [stroke(0)] }, 11);
    expect(session.gridOrigin).toBe(11);
    session.undo();
    expect(session.gridOrigin).toBe(1.5);
    // A save's move shifts both, so that each stays where it was.
    session.rebase(-5);
    expect(session.gridOrigin).toBe(12.5);
    session.redo();
    expect(session.gridOrigin).toBe(6);
    // Without one given, from the strokes' ends; with none, as it was.
    session.replace({ strokes: [stroke(40)] });
    expect(session.gridOrigin).toBe(2.5);
    session.replace({ strokes: [] });
    expect(session.gridOrigin).toBe(2.5);
    session.replace({ strokes: [] }, -3);
    expect(session.gridOrigin).toBe(13);
    // Strokes and clearing keep the grid, and so does undoing them.
    session.begin({ x: 0, y: 0 });
    session.end();
    session.clear();
    session.undo();
    session.undo();
    expect(session.gridOrigin).toBe(13);
  });

  it("snaps to the nearest of a grid's rows, and the edge rows beyond it", () => {
    const grid: Grid = { spacing: 14, rows: [6, 20, 35.5, 50.875, 144, 189] };
    expect(snapToGrid({ x: 22, y: 43 }, grid)).toEqual({ x: 28, y: 35.5 });
    expect(snapToGrid({ x: 22, y: 44 }, grid, 3)).toEqual({ x: 17, y: 50.875 });
    expect(snapToGrid({ x: 0, y: -40 }, grid)).toEqual({ x: 0, y: 6 });
    expect(snapToGrid({ x: 0, y: 400 }, grid)).toEqual({ x: 0, y: 189 });
    const session = new DrawingSession(emptyDocument);
    session.grid = grid;
    session.snap = true;
    session.begin({ x: 22, y: 43 }, true);
    session.end({ x: 41, y: 140 }, true);
    const points = session.document.strokes[0]?.points ?? [];
    expect(points.slice(0, 2)).toEqual([28 * 16, 35.5 * 16]);
    expect(points.slice(-2)).toEqual([42 * 16, 144 * 16]);
  });

  it("keeps a stroke on the grid it started on when another is laid out", () => {
    // As when the font loads while the pointer is down: a tap stays a dot.
    const before: Grid = { spacing: 12.8125, rows: [96, 102.5, 108] };
    const after: Grid = { spacing: 14, rows: [95, 101, 109] };
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.grid = before;
    session.begin({ x: 100, y: 100 }, true);
    session.grid = after;
    expect(session.grid).toBe(before);
    session.end({ x: 100, y: 100 }, true);
    expect(session.document.strokes[0]?.points).toEqual([
      102.5 * 16,
      102.5 * 16,
    ]);
    // Then the grid laid out meanwhile takes over.
    expect(session.grid).toBe(after);
    session.begin({ x: 100, y: 100 }, true);
    session.grid = before;
    session.cancel();
    expect(session.grid).toBe(before);
  });

  it("lines an opened drawing up with the grid the editor lays out", () => {
    // Taps on columns 14 pixels apart, through 3 pixels: 45 and 59.
    const tap = (x: number) =>
      ({
        tool: "pen",
        size: 16,
        points: [x * 16, 0],
      }) as const;
    const session = new DrawingSession({ strokes: [tap(45), tap(59), tap(8)] });
    // On the plain grid, 45 and 59 lie at 13 and 11 within a spacing.
    expect(session.gridOrigin).toBe(13);
    session.grid = { spacing: 14, rows: [0] };
    expect(session.gridOrigin).toBe(3);
    // A save's move takes the guess with the strokes.
    session.rebase(-5);
    expect(session.gridOrigin).toBe(12);
    // A stroke keeps the grid it was drawn on, whatever the strokes say.
    session.snap = true;
    session.begin({ x: 100, y: 0 }, true);
    session.end();
    expect(session.document.strokes.at(-1)?.points).toEqual([96 * 16, 0]);
    session.grid = { spacing: 10, rows: [0] };
    expect(session.gridOrigin).toBe(2);
  });

  describe("on a grid finer than the usual one, as in Zoom", () => {
    const usual: Grid = { spacing: 14, rows: [0, 14, 28, 42, 56] };
    const fine = finerGrid(usual);
    /** A session on the usual grid, with its columns through 9 pixels. */
    const onGrid = (): DrawingSession => {
      const session = new DrawingSession(emptyDocument);
      session.snap = true;
      session.grid = usual;
      session.replace(emptyDocument, 9);
      return session;
    };
    const stroke = (session: DrawingSession, x: number): void => {
      session.begin({ x, y: 7 }, true);
      session.end({ x: x + 30, y: 7 }, true);
    };

    it("snaps to points of the finer grid, among those of the usual one", () => {
      const session = onGrid();
      session.grid = fine;
      // Columns through 9, 7 pixels apart: 30 is one of the finer grid's
      // alone, and 23 is one of the usual grid's as well.
      session.begin({ x: 31, y: 8 }, true);
      session.end({ x: 24, y: 20 }, true);
      const points = session.document.strokes[0]?.points ?? [];
      expect(points.slice(0, 2)).toEqual([30 * 16, 7 * 16]);
      expect(points.slice(-2)).toEqual([23 * 16, 21 * 16]);
      // A point drawn on the usual grid stays one.
      const point = snapToGrid({ x: 23, y: 14 }, usual, session.gridOrigin);
      expect(snapToGrid(point, fine, session.gridOrigin)).toEqual(point);
    });

    it("leaves the usual grid's columns where they were, however many strokes it draws", () => {
      const session = onGrid();
      session.grid = fine;
      // 9 is past the finer spacing: kept within that, the usual grid's
      // columns would come back half a cell away.
      expect(session.gridOrigin).toBe(9);
      for (const x of [20, 30, 40]) stroke(session, x);
      expect(session.gridOrigin).toBe(9);
      session.grid = usual;
      expect(session.gridOrigin).toBe(9);
      session.begin({ x: 8, y: 0 }, true);
      session.end({ x: 8, y: 0 }, true);
      expect(session.document.strokes.at(-1)?.points).toEqual([9 * 16, 0]);
    });

    it("keeps them through undo and redo across the views", () => {
      const session = onGrid();
      stroke(session, 20);
      session.grid = fine;
      stroke(session, 30);
      stroke(session, 40);
      session.grid = usual;
      for (const step of ["undo", "undo", "undo", "redo", "redo"] as const) {
        session[step]();
        expect(session.gridOrigin).toBe(9);
      }
      session.grid = fine;
      session.undo();
      expect(session.gridOrigin).toBe(9);
      session.grid = usual;
      session.redo();
      expect(session.gridOrigin).toBe(9);
    });

    it("keeps them through a save's move", () => {
      const session = onGrid();
      stroke(session, 20);
      session.grid = fine;
      stroke(session, 30);
      // A save cropped 11 pixels on the left, while zoomed.
      session.rebase(-11);
      expect(session.gridOrigin).toBe(12);
      session.grid = usual;
      expect(session.gridOrigin).toBe(12);
      session.undo();
      expect(session.gridOrigin).toBe(12);
      session.grid = fine;
      session.undo();
      expect(session.gridOrigin).toBe(12);
    });

    it("guesses an opened drawing's columns by the usual grid's spacing", () => {
      const tap = (x: number) =>
        ({
          tool: "pen",
          size: 16,
          points: [x * 16, 0],
        }) as const;
      // Taps on columns 14 pixels apart, through 11 pixels, which is more
      // than the finer grid's spacing: 39 and 53, with one at 8.
      const opened = { strokes: [tap(39), tap(53), tap(8)] };
      const session = new DrawingSession(opened);
      session.grid = usual;
      expect(session.gridOrigin).toBe(11);
      session.grid = fine;
      expect(session.gridOrigin).toBe(11);
      // A save's move while zoomed takes the guess with the strokes.
      session.rebase(-5);
      expect(session.gridOrigin).toBe(6);
      session.grid = usual;
      expect(session.gridOrigin).toBe(6);
      // And so does a drawing put in place while zoomed.
      session.grid = fine;
      session.replace(opened);
      session.grid = usual;
      expect(session.gridOrigin).toBe(11);
    });

    it("waits until a stroke ends, whichever way the view changes", () => {
      const session = onGrid();
      session.begin({ x: 31, y: 8 }, true);
      session.grid = fine;
      expect(session.grid).toBe(usual);
      session.end({ x: 31, y: 8 }, true);
      expect(session.document.strokes[0]?.points).toEqual([37 * 16, 14 * 16]);
      expect(session.grid).toBe(fine);
      session.begin({ x: 31, y: 8 }, true);
      session.grid = usual;
      expect(session.grid).toBe(fine);
      session.end({ x: 31, y: 8 }, true);
      expect(session.document.strokes[1]?.points).toEqual([30 * 16, 7 * 16]);
      expect(session.grid).toBe(usual);
    });

    it("keeps a polygon on the grid it started on until it ends", () => {
      const session = onGrid();
      session.shape = "polygon";
      session.begin({ x: 9, y: 0 }, true);
      session.end({ x: 9, y: 0 }, true);
      // Zoom goes on with a corner placed: the view changes, the grid waits.
      session.grid = fine;
      expect(session.grid).toBe(usual);
      expect(session.placing).toBe(true);
      session.begin({ x: 31, y: 8 }, true);
      session.end({ x: 31, y: 8 }, true);
      const corners = [9 * 16, 0, 37 * 16, 14 * 16];
      expect(drawn(session)?.points).toEqual(corners);
      // A click on that last corner ends it, on the same grid.
      session.begin({ x: 31, y: 8 }, true);
      session.end({ x: 31, y: 8 }, true);
      expect(session.placing).toBe(false);
      expect(session.grid).toBe(fine);
      expect(session.document.strokes[0]?.points).toEqual(corners);
      expect(session.gridOrigin).toBe(9);
      // And one started zoomed keeps its finer grid when zoomed out.
      session.begin({ x: 31, y: 8 }, true);
      session.end({ x: 31, y: 8 }, true);
      expect(drawn(session)?.points).toEqual([30 * 16, 7 * 16]);
      session.grid = usual;
      expect(session.grid).toBe(fine);
      session.undoCorner();
      expect(session.placing).toBe(false);
      expect(session.grid).toBe(usual);
    });
  });

  it("does not record clearing an empty drawing", () => {
    const session = new DrawingSession(emptyDocument);
    session.clear();
    expect(session.canUndo).toBe(false);
  });
});

describe("DrawingSession's moveDrawing", () => {
  const withStroke = (): DrawingSession => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 10, y: 20 });
    session.end({ x: 30, y: 40 });
    return session;
  };

  it("moves the drawing, taking moves in a row as one step", () => {
    const session = withStroke();
    const before = session.document;
    expect(session.moveDrawing(-16)).toBe(true);
    session.moveDrawing(-16);
    session.moveDrawing(16 * 3);
    const ys = session.document.strokes[0]?.points.filter(
      (_, index) => index % 2 === 1,
    );
    expect(ys?.[0]).toBe(20 * 16 + 16);
    expect(session.dirty).toBe(true);
    session.undo();
    expect(session.document).toBe(before);
    session.redo();
    expect(session.document.strokes[0]?.points[1]).toBe(20 * 16 + 16);
  });

  it("makes a new step after anything else", () => {
    const session = withStroke();
    session.moveDrawing(16);
    session.begin({ x: 50, y: 20 });
    session.end({ x: 60, y: 40 });
    const drawn = session.document;
    session.moveDrawing(16);
    session.undo();
    expect(session.document).toBe(drawn);
  });

  it("starts a new step after a save, so that Undo stops at what was saved", () => {
    // From the independent review of #139.
    const session = withStroke();
    session.moveDrawing(16);
    session.moveDrawing(16);
    const saved = session.document;
    session.markSaved(saved);
    session.moveDrawing(16);
    expect(session.dirty).toBe(true);
    session.undo();
    expect(session.document).toBe(saved);
    expect(session.dirty).toBe(false);
    session.redo();
    expect(session.document).not.toBe(saved);
  });

  it("starts a new step after Undo and Redo, or a save that moves the drawing", () => {
    const session = withStroke();
    session.moveDrawing(16);
    session.begin({ x: 50, y: 20 });
    session.end({ x: 60, y: 40 });
    session.undo();
    const moved = session.document;
    session.moveDrawing(16);
    session.undo();
    expect(session.document).toBe(moved);
    session.redo();
    const again = session.document;
    session.moveDrawing(16);
    session.undo();
    expect(session.document).toBe(again);
    session.rebase(0);
    session.moveDrawing(16);
    session.undo();
    expect(session.document).toBe(again);
  });

  it("keeps the grid where it was", () => {
    const session = withStroke();
    session.snap = true;
    const origin = session.gridOrigin;
    session.moveDrawing(32);
    expect(session.gridOrigin).toBe(origin);
    session.undo();
    expect(session.gridOrigin).toBe(origin);
  });

  it("moves nothing while drawing, or with nothing drawn", () => {
    const empty = new DrawingSession(emptyDocument);
    expect(empty.moveDrawing(16)).toBe(false);
    expect(empty.canUndo).toBe(false);
    const session = withStroke();
    session.begin({ x: 50, y: 20 });
    expect(session.moveDrawing(16)).toBe(false);
  });
});

describe("DrawingSession with the grid on", () => {
  /** A session with the plain grid on, 16 pixels between its points. */
  const onGrid = (): DrawingSession => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    return session;
  };
  /** The first and last point of the session's latest stroke, in pixels. */
  const ends = (session: DrawingSession): number[] => {
    const points = session.document.strokes.at(-1)?.points ?? [];
    return [points[0], points[1], points.at(-2), points.at(-1)].map(
      (value) => (value ?? 0) / 16,
    );
  };

  it("snaps nothing without Shift, with the pen or the eraser: the grid is a guide", () => {
    const session = onGrid();
    // A click in the middle of four grid points, as in #150.
    session.begin({ x: 8, y: 8 });
    session.end({ x: 8, y: 8 });
    expect(session.document.strokes[0]?.points).toEqual([128, 128]);
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 20, y: 25 }]);
    session.end({ x: 41, y: 71 });
    expect(ends(session)).toEqual([7, 9, 41, 71]);
    // Without a release to go by, it stops at its last point.
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 41, y: 71 }]);
    session.end();
    expect(ends(session)).toEqual([7, 9, 41, 71]);
    // An eraser's area ends at its last point, and reaches the brush's radius,
    // 6 pixels, past where it was pressed, not past a grid point.
    session.tool = "eraser";
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 20, y: 25 }]);
    session.end({ x: 41, y: 71 });
    const points = session.document.strokes.at(-1)?.points ?? [];
    expect(ends(session).slice(2)).toEqual([41, 71]);
    const xs = points.filter((_, at) => at % 2 === 0);
    expect(Math.min(...xs) / 16).toBeCloseTo(1, 1);
  });

  it("puts the press on the grid by Shift at the press alone", () => {
    const session = onGrid();
    session.begin({ x: 7, y: 9 }, true);
    session.extend([{ x: 41, y: 71 }]);
    session.end({ x: 41, y: 71 });
    expect(ends(session)).toEqual([0, 16, 41, 71]);
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 20, y: 25 }], true);
    // It stays where it was pressed, as Shift came after.
    expect(drawn(session)?.points.slice(0, 2)).toEqual([7 * 16, 9 * 16]);
    session.end({ x: 20, y: 25 }, true);
    expect(ends(session)).toEqual([7, 9, 16, 32]);
  });

  it("keeps what was drawn when Shift comes part way, and snaps from there on", () => {
    const session = onGrid();
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 21, y: 9 }]);
    session.extend([{ x: 41, y: 71 }], true);
    const points = drawn(session)?.points ?? [];
    // Freehand to where Shift came, then straight from there to a grid point.
    expect(points.slice(0, 2)).toEqual([7 * 16, 9 * 16]);
    expect(points).toContain(21 * 16);
    expect(points.slice(-2)).toEqual([48 * 16, 64 * 16]);
    session.end({ x: 41, y: 71 }, true);
    expect(ends(session)).toEqual([7, 9, 48, 64]);
  });

  it("keeps a straight part on the grid when Shift goes part way, and goes on freehand", () => {
    const session = onGrid();
    session.begin({ x: 7, y: 9 }, true);
    session.extend([{ x: 41, y: 9 }], true);
    session.extend([{ x: 45, y: 13 }]);
    const points = drawn(session)?.points ?? [];
    // Along the row to the grid point, then on to the pointer.
    expect(points.slice(0, 2)).toEqual([0, 16 * 16]);
    expect(points).toContain(48 * 16);
    expect(points.slice(-2)).toEqual([45 * 16, 13 * 16]);
    session.end({ x: 45, y: 13 });
    expect(ends(session)).toEqual([0, 16, 45, 13]);
  });

  it("counts a Shift let go just before the button as held, with no move since", () => {
    const session = onGrid();
    // Up with no move between: the line stays on the grid it was drawn on.
    session.begin({ x: 7, y: 9 }, true);
    session.extend([{ x: 41, y: 71 }], true);
    session.end({ x: 41, y: 71 });
    expect(ends(session)).toEqual([0, 16, 48, 64]);
    // A tap stays a dot on its grid point.
    session.begin({ x: 7, y: 9 }, true);
    session.end({ x: 7, y: 9 });
    expect(session.document.strokes.at(-1)?.points).toEqual([0, 256]);
    // Up with a move since, however small: the stroke goes where the pointer
    // does, and it is not held.
    session.begin({ x: 7, y: 9 }, true);
    session.extend([{ x: 41, y: 71 }], true);
    session.extend([{ x: 41.5, y: 71 }]);
    session.end({ x: 41.5, y: 71 });
    expect(ends(session)).toEqual([0, 16, 41.5, 71]);
  });

  it("puts a freehand stroke's end on the grid by a Shift that comes just before the button", () => {
    const session = onGrid();
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 41, y: 71 }]);
    session.end({ x: 41, y: 71 }, true);
    expect(ends(session)).toEqual([7, 9, 48, 64]);
  });

  it("starts each stroke afresh, whatever Shift did at the last", () => {
    const session = onGrid();
    session.begin({ x: 7, y: 9 }, true);
    session.end({ x: 7, y: 9 }, true);
    session.begin({ x: 7, y: 9 });
    session.end({ x: 7, y: 9 });
    expect(session.document.strokes.at(-1)?.points).toEqual([7 * 16, 9 * 16]);
  });

  it("does nothing different with the grid off, wherever Shift comes", () => {
    const session = new DrawingSession(emptyDocument);
    session.flatEnds = true;
    session.begin({ x: 7, y: 9 }, true);
    session.end({ x: 7, y: 9 }, true);
    expect(session.document.strokes[0]?.points).toEqual([7 * 16, 9 * 16]);
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 41, y: 71 }]);
    session.end({ x: 41, y: 71 }, true);
    expect(ends(session)).toEqual([7, 9, 41, 71]);
    expect(session.document.strokes[1]).not.toHaveProperty("cut");
    session.begin({ x: 7, y: 9 }, true);
    session.extend([{ x: 41, y: 71 }], true);
    session.end({ x: 41, y: 71 }, true);
    expect(ends(session)).toEqual([7, 9, 41, 71]);
    expect(session.document.strokes[2]).not.toHaveProperty("cut");
  });

  it("keeps the grid's place through strokes off it, undo, and a save's move", () => {
    const session = onGrid();
    session.replace(emptyDocument, 5);
    // Strokes off the grid say nothing of where it lies, while it is open.
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 41, y: 71 }]);
    session.end({ x: 41, y: 71 });
    expect(session.gridOrigin).toBe(5);
    session.undo();
    expect(session.gridOrigin).toBe(5);
    session.redo();
    expect(session.gridOrigin).toBe(5);
    session.rebase(-3);
    expect(session.gridOrigin).toBe(2);
    session.begin({ x: 3, y: 9 }, true);
    session.end({ x: 3, y: 9 }, true);
    expect(session.document.strokes.at(-1)?.points).toEqual([2 * 16, 16 * 16]);
  });
});

describe("gridCuts", () => {
  it("measures the last end along the pointer's path, if it got anywhere", () => {
    // Steep up to where the pointer was let go, then a jump sideways.
    const points = [0, 0, 0, 160, 96, 160];
    const end = { start: false, end: true };
    expect(gridCuts(points, 64, end, { end: [0, 0, 0, 160] })).toEqual({
      end: "down",
    });
    // By default, along the stroke, whose jump runs along the row.
    expect(gridCuts(points, 64, end)).toBeUndefined();
    // A path that never left its start has only the jump to go by.
    expect(gridCuts([0, 0, 16, 96], 64, end, { end: [0, 0, 0, 0] })).toEqual({
      end: "down",
    });
  });

  it("leaves an end the pointer ran along the row uncut, however its points run", () => {
    // A way that says "not cut" is an answer: the points don't get a say.
    const both = { start: true, end: true };
    expect(
      gridCuts([0, 0, 16, 96], 64, both, {
        start: [0, 0, 160, 16],
        end: [0, 0, 160, 16],
      }),
    ).toBeUndefined();
  });

  const reach = 32;
  const both = { start: true, end: true };

  it("cuts a steep end across its row, away from the stroke", () => {
    expect(gridCuts([0, 0, 16, 160], reach, both)).toEqual({
      start: "up",
      end: "down",
    });
    expect(gridCuts([16, 160, 0, 0], reach, both)).toEqual({
      start: "down",
      end: "up",
    });
    // At 45°, as steep as it is wide, the row still crosses it.
    expect(gridCuts([0, 0, 64, 64], reach, both)).toEqual({
      start: "up",
      end: "down",
    });
  });

  it("never cuts along a column: an end running along its row keeps its round end", () => {
    expect(gridCuts([0, 0, 160, 16], reach, both)).toBeUndefined();
    expect(gridCuts([160, 16, 0, 0], reach, both)).toBeUndefined();
    // Level, as along the baseline, either way.
    expect(gridCuts([0, 2304, 640, 2304], reach, both)).toBeUndefined();
    expect(gridCuts([640, 2304, 0, 2304], reach, both)).toBeUndefined();
    // Just short of 45°, and the same stroke's other end if it is steep.
    expect(gridCuts([0, 0, 65, 64], reach, both)).toBeUndefined();
    expect(gridCuts([0, 0, 0, 160, 160, 170], reach, both)).toEqual({
      start: "up",
    });
    expect(gridCuts([160, 170, 0, 160, 0, 0], reach, both)).toEqual({
      end: "up",
    });
  });

  it("takes the way an end runs from the brush's reach back", () => {
    // Straight down, then a step right shorter than the reach.
    expect(gridCuts([0, 0, 0, 160, 16, 160], reach, both)).toEqual({
      start: "up",
      end: "down",
    });
  });

  it("measures a short stroke that comes back from its farthest point", () => {
    // Down and back up, shorter than the reach: both ends are at the top.
    expect(gridCuts([0, 0, 0, 160, 16, 0], 192, both)).toEqual({
      start: "up",
      end: "up",
    });
  });

  it("cuts only the ends named, and no end of a dot", () => {
    expect(
      gridCuts([0, 0, 0, 160], reach, { start: false, end: true }),
    ).toEqual({ end: "down" });
    expect(
      gridCuts([0, 0, 0, 160], reach, { start: false, end: false }),
    ).toBeUndefined();
    expect(gridCuts([0, 0], reach, both)).toBeUndefined();
  });
});

describe("DrawingSession's cuts", () => {
  it("leaves every end round until Flat ends is turned on", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 0, y: 16 }, true);
    session.extend([{ x: 1, y: 80 }]);
    expect(drawn(session)).not.toHaveProperty("cut");
    session.end({ x: 0, y: 144 }, true);
    expect(session.document.strokes[0]).not.toHaveProperty("cut");
  });

  it("takes Flat ends as it was when the stroke began", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    session.begin({ x: 0, y: 16 }, true);
    session.flatEnds = false;
    session.end({ x: 0, y: 144 }, true);
    expect(session.document.strokes[0]?.cut).toEqual({
      start: "up",
      end: "down",
    });
    session.begin({ x: 0, y: 16 }, true);
    session.flatEnds = true;
    session.end({ x: 0, y: 144 }, true);
    expect(session.document.strokes[1]).not.toHaveProperty("cut");
  });

  it("cuts a steep leg across its row, whatever the jump to the grid point it ends on", () => {
    // The owner's §3: a leg down to the baseline, released left of a grid
    // point, so that the stroke jumps sideways to it at the end.
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    session.begin({ x: 0, y: 16 }, true);
    session.extend([
      { x: 2, y: 60 },
      { x: 4, y: 100 },
      { x: 6, y: 140 },
    ]);
    session.end({ x: 7, y: 142 }, true);
    const [stroke] = session.document.strokes;
    expect(stroke?.points.slice(-2)).toEqual([0, 144 * 16]);
    expect(stroke?.cut?.end).toBe("down");
    // From the same path, the grid point to its right, and a hook there the
    // hand made, which a brush's width alone would take for the way it ran.
    session.begin({ x: 0, y: 16 }, true);
    session.extend([
      { x: 2, y: 60 },
      { x: 4, y: 100 },
      { x: 6, y: 138 },
      { x: 12, y: 140 },
    ]);
    session.end({ x: 15, y: 143 }, true);
    const hooked = session.document.strokes[1];
    expect(hooked?.points.slice(-2)).toEqual([16 * 16, 144 * 16]);
    expect(hooked?.cut?.end).toBe("down");
  });

  it("cuts the ends Shift put on the grid, and not one drawn off it", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    session.begin({ x: 0, y: 16 }, true);
    session.extend([{ x: 1, y: 80 }]);
    // While it is drawn, only its start is on the grid.
    expect(drawn(session)?.cut).toEqual({ start: "up" });
    session.end({ x: 0, y: 144 }, true);
    expect(session.document.strokes[0]?.cut).toEqual({
      start: "up",
      end: "down",
    });
    session.snap = false;
    session.begin({ x: 0, y: 16 }, true);
    session.extend([{ x: 1, y: 80 }]);
    session.end({ x: 0, y: 144 }, true);
    expect(session.document.strokes[1]).not.toHaveProperty("cut");
  });

  it("leaves a freehand end round, as Shift did not put it on a grid line", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    // On a grid point both, as it happens, but not put there by Shift.
    session.begin({ x: 0, y: 16 });
    session.extend([{ x: 1, y: 80 }]);
    expect(drawn(session)).not.toHaveProperty("cut");
    session.end({ x: 0, y: 144 });
    expect(session.document.strokes[0]).not.toHaveProperty("cut");
    // Shift at the press alone cuts the start, and at the release the end.
    session.begin({ x: 3, y: 18 }, true);
    session.extend([{ x: 1, y: 80 }]);
    session.end({ x: 3, y: 141 });
    session.begin({ x: 3, y: 18 });
    session.extend([{ x: 1, y: 80 }]);
    session.end({ x: 3, y: 141 }, true);
    expect(session.document.strokes[1]?.cut).toEqual({ start: "up" });
    expect(session.document.strokes[2]?.cut).toEqual({ end: "down" });
  });

  it("leaves a line along a row uncut, with Shift or without", () => {
    // The owner's simplest case in #150: along the baseline, left to right.
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    session.begin({ x: 34, y: 142 });
    session.extend([{ x: 80, y: 144 }]);
    session.end({ x: 126, y: 143 });
    session.begin({ x: 34, y: 142 }, true);
    session.extend([{ x: 126, y: 143 }], true);
    session.end({ x: 126, y: 143 }, true);
    const [plain, shifted] = session.document.strokes;
    expect(plain).not.toHaveProperty("cut");
    expect(shifted).not.toHaveProperty("cut");
    expect(shifted?.points.slice(0, 2)).toEqual([32 * 16, 144 * 16]);
    expect(shifted?.points.slice(-2)).toEqual([128 * 16, 144 * 16]);
  });

  it("cuts a leg's steep end and leaves its foot, flaring along the row, round", () => {
    // As an A's foot: down to the row, then a stretch along it.
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    session.begin({ x: 0, y: 16 }, true);
    session.extend([{ x: 0, y: 144 }], true);
    session.extend([{ x: 48, y: 145 }]);
    session.end({ x: 64, y: 144 }, true);
    expect(session.document.strokes[0]?.cut).toEqual({ start: "up" });
  });

  it("leaves a stroke that ends on the grid point it started on uncut", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    session.begin({ x: 64, y: 64 }, true);
    session.extend([{ x: 64, y: 74 }]);
    session.end({ x: 64, y: 64 }, true);
    expect(session.document.strokes[0]).not.toHaveProperty("cut");
    // From the independent review of #137: a short mark that snaps back to
    // its start would have been cut away whole, from both sides of the row.
    session.begin({ x: 71, y: 71 }, true);
    session.extend([{ x: 71, y: 66 }]);
    session.end({ x: 71, y: 66 }, true);
    const mark = session.document.strokes[1];
    expect(mark?.points.slice(0, 2)).toEqual(mark?.points.slice(-2));
    expect(mark).not.toHaveProperty("cut");
  });

  it("judges a stroke's start by the pointer, whatever the jump to its grid point", () => {
    // From the independent review of #137: pressed 7.8 pixels right of and
    // below a grid point, up and to the right at 50°, which is steep, though
    // from the grid point it runs flatter than 45°.
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    const press = { x: 71.8, y: 71.8 };
    session.begin(press, true);
    const steps = Array.from({ length: 30 }, (_, step) => ({
      x: press.x + (step + 1) * 2 * Math.cos((50 * Math.PI) / 180),
      y: press.y - (step + 1) * 2 * Math.sin((50 * Math.PI) / 180),
    }));
    session.extend(steps);
    // While drawn, as when saved.
    expect(drawn(session)?.cut?.start).toBe("down");
    session.end(steps.at(-1), true);
    expect(session.document.strokes[0]?.cut?.start).toBe("down");
  });

  it("judges the start by the pointer when the stroke ends straight", () => {
    // From the follow-up review of #137: freehand at 50° for 40 pixels from a
    // press off the grid point, then straight with Shift to 60.
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    const press = { x: 71.8, y: 71.8 };
    const along = (distance: number): InputPoint => ({
      x: press.x + distance * Math.cos((50 * Math.PI) / 180),
      y: press.y - distance * Math.sin((50 * Math.PI) / 180),
    });
    session.begin(press, true);
    session.extend(
      Array.from({ length: 20 }, (_, step) => along(step * 2 + 2)),
    );
    session.extend([along(50), along(60)], true);
    expect(drawn(session)?.cut?.start).toBe("down");
    session.end(along(60), true);
    expect(session.document.strokes[0]?.cut?.start).toBe("down");
  });

  it("judges a short stroke's end by the pointer, not by the jump from the grid point", () => {
    // From the follow-up review of #137: pressed off a grid point, which the
    // stroke jumps from, and 20 pixels up and to the right at 35°, shorter
    // than the M brush's reach.
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    const press = { x: 56.1, y: 56.1 };
    const along = (distance: number): InputPoint => ({
      x: press.x + distance * Math.cos((35 * Math.PI) / 180),
      y: press.y - distance * Math.sin((35 * Math.PI) / 180),
    });
    session.begin(press, true);
    session.extend(
      Array.from({ length: 10 }, (_, step) => along(step * 2 + 2)),
    );
    session.end(along(20), true);
    // From grid point to grid point it runs at 45°, which would be cut.
    const [stroke] = session.document.strokes;
    expect(stroke?.points.slice(0, 2)).toEqual([64 * 16, 64 * 16]);
    expect(stroke?.points.slice(-2)).toEqual([80 * 16, 48 * 16]);
    expect(stroke).not.toHaveProperty("cut");
  });

  it("goes by its points for a tap released elsewhere, with no move between", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    // The pointer went more across than down, and the grid points straight
    // down, which is what there is to go by.
    session.begin({ x: 71.8, y: 71.8 }, true);
    session.end({ x: 64, y: 79 }, true);
    expect(session.document.strokes[0]?.cut).toEqual({
      start: "up",
      end: "down",
    });
  });

  it("judges both ends of a line straight from its first move by its ink", () => {
    // From the third review of #137: the pointer runs at 35°, but the line,
    // from the grid point the press snapped to, at 56°.
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    session.begin({ x: 41.9, y: 72.1 }, true);
    session.extend([{ x: 87.9, y: 39.9 }], true);
    expect(drawn(session)?.cut?.start).toBe("down");
    session.end({ x: 87.9, y: 39.9 }, true);
    expect(session.document.strokes[0]?.cut).toEqual({
      start: "down",
      end: "up",
    });
  });

  it("measures a stroke that is straight from its start along its segment", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    session.begin({ x: 71, y: 71 }, true);
    session.extend([{ x: 128, y: 144 }], true);
    expect(drawn(session)?.cut?.start).toBe("up");
    session.end({ x: 128, y: 144 }, true);
    expect(session.document.strokes[0]?.cut).toEqual({
      start: "up",
      end: "down",
    });
  });

  it("cuts only the end of a stroke the grid came on for", () => {
    const session = new DrawingSession(emptyDocument);
    session.flatEnds = true;
    session.begin({ x: 3, y: 16 }, true);
    session.extend([{ x: 4, y: 60 }]);
    session.snap = true;
    session.end({ x: 3, y: 64 }, true);
    expect(session.document.strokes[0]?.cut).toEqual({ end: "down" });
  });

  it("keeps an eraser stroke started with Flat ends and the grid on 1.0.1's smooth stroke, as the pen's", () => {
    // Its kind is the one its press chose: shown and saved as the pen's
    // stroke through the same drag, which 1.0.1's eraser's was, cuts and a
    // tap's dot included, whatever the grid does later. The first review's
    // drag on #381 among them: pressed with Shift on the grid, then freehand
    // back across the row it started on.
    const drags: {
      begin: InputPoint;
      shift: boolean;
      way: readonly InputPoint[];
      off?: boolean;
      release?: InputPoint;
    }[] = [
      {
        begin: { x: 80, y: 80 },
        shift: true,
        way: [
          { x: 80, y: 160 },
          { x: 160, y: 160 },
          { x: 160, y: 60 },
        ],
        release: { x: 160, y: 60 },
      },
      {
        begin: { x: 0, y: 16 },
        shift: true,
        way: [],
        release: { x: 0, y: 144 },
      },
      { begin: { x: 7, y: 9 }, shift: true, way: [] },
      {
        begin: { x: 3, y: 16 },
        shift: true,
        way: [{ x: 4, y: 60 }],
        off: true,
        release: { x: 3, y: 64 },
      },
    ];
    for (const [index, drag] of drags.entries()) {
      const run = (tool: "pen" | "eraser") => {
        const session = new DrawingSession(emptyDocument);
        session.tool = tool;
        session.sizeIndex = 1;
        session.snap = true;
        session.flatEnds = true;
        session.begin(drag.begin, drag.shift);
        const shown = [session.activeStrokes];
        for (const point of drag.way) {
          session.extend([point]);
          shown.push(session.activeStrokes);
        }
        if (drag.off === true) session.snap = false;
        session.end(drag.release, drag.shift);
        return { shown, saved: session.document.strokes };
      };
      const asEraser = (strokes: readonly Stroke[]) =>
        strokes.map((stroke) => ({ ...stroke, tool: "eraser" }));
      const pen = run("pen");
      const eraser = run("eraser");
      const name = `drag ${String(index)}`;
      expect(eraser.saved, name).toEqual(asEraser(pen.saved));
      expect(eraser.shown, name).toEqual(pen.shown.map(asEraser));
      expect(
        eraser.saved.every((stroke) => stroke.kind === undefined),
        name,
      ).toBe(true);
    }
  });

  it("keeps an eraser stroke started otherwise a fill, never cut, whatever the grid and Flat ends do later", () => {
    // Flat ends on and the grid off at the press, then Shift to near the row
    // at 64 pixels, and the grid on, which puts the end on its grid point:
    // still the area swept, its end round.
    const session = new DrawingSession(emptyDocument);
    session.flatEnds = true;
    session.tool = "eraser";
    session.sizeIndex = 3;
    session.begin({ x: 3, y: 16 });
    session.extend([{ x: 4, y: 40 }]);
    session.extend([{ x: 3, y: 64 }], true);
    session.snap = true;
    const shown = session.activeStrokes;
    session.end({ x: 3, y: 64 }, true);
    const [stroke] = session.document.strokes;
    expect(stroke?.kind).toBe("fill");
    expect(session.document.strokes).toEqual(shown);
    // It ends on the grid point on the row at 64 pixels, and reaches 12
    // pixels below it there.
    expect(stroke?.points.slice(-2)).toEqual([0, 1024]);
    expect(covers(stroke?.points ?? [], 0, 1024 + 180)).toBe(true);
  });

  it("saves an eraser's stroke as the area its brush swept, as it was shown", () => {
    const session = new DrawingSession(emptyDocument);
    session.tool = "eraser";
    session.sizeIndex = 3;
    session.begin({ x: 10, y: 50 });
    // A tap so far is the brush's circle, marked at its centre.
    const [dot] = session.activeStrokes;
    expect(dot?.kind).toBe("fill");
    expect(dot?.points.slice(0, 2)).toEqual([160, 800]);
    expect(covers(dot?.points ?? [], 160, 800 + 188)).toBe(true);
    expect(covers(dot?.points ?? [], 160, 800 + 196)).toBe(false);
    session.extend([
      { x: 20, y: 52 },
      { x: 30, y: 60 },
      { x: 35, y: 80 },
    ]);
    const shown = session.activeStrokes;
    expect(shown).toHaveLength(1);
    expect(shown[0]?.kind).toBe("fill");
    // To the stroke's last point, for the grid's guess.
    expect(shown[0]?.points.slice(-2)).toEqual([560, 1280]);
    session.end({ x: 35, y: 80 });
    expect(session.document.strokes).toEqual(shown);
    // One step to undo, as any stroke.
    session.undo();
    expect(session.document.strokes).toEqual([]);
    session.redo();
    expect(session.document.strokes).toEqual(shown);
  });

  it("keeps a pen's stroke, and an eraser's shapes, as they were", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 10, y: 50 });
    session.extend([{ x: 30, y: 60 }]);
    session.end();
    expect(session.document.strokes[0]).not.toHaveProperty("kind");
    session.tool = "eraser";
    session.shape = "ellipse";
    session.begin({ x: 10, y: 50 });
    session.extend([{ x: 40, y: 90 }]);
    session.end();
    expect(session.document.strokes[1]).toMatchObject({
      tool: "eraser",
      size: 192,
    });
    expect(session.document.strokes[1]).not.toHaveProperty("kind");
  });

  it("draws an eraser's straight line with Shift as the area along it", () => {
    const session = new DrawingSession(emptyDocument);
    session.tool = "eraser";
    session.begin({ x: 10, y: 50 });
    session.extend([{ x: 60, y: 51 }], true);
    session.extend([{ x: 80, y: 50 }], true);
    session.end({ x: 80, y: 50 }, true);
    const [stroke] = session.document.strokes;
    expect(stroke?.kind).toBe("fill");
    expect(stroke?.points.slice(-2)).toEqual([1280, 800]);
    const ys = (stroke?.points ?? []).filter((_, at) => at % 2 === 1);
    // A straight line 12 pixels wide, along y = 50, and nothing more.
    expect(Math.min(...ys)).toBe(800 - 96);
    expect(Math.max(...ys)).toBe(800 + 96);
  });

  // This checks the areas, not how fast: its strokes took 0.4 seconds alone
  // and past 6.2 under load, Vitest's default being five (#362).
  it("saves an eraser's area in whole units, however it is drawn", () => {
    // Seeded strokes of every brush, on the grid and off, freehand and
    // straight, cut and not, as the long drawing's end-to-end run draws them.
    let state = 115;
    const random = (): number => {
      state = (state * 16807) % 2147483647;
      return state / 2147483647;
    };
    const between = (from: number, to: number): number =>
      from + (to - from) * random();
    for (let trial = 0; trial < 400; trial++) {
      const session = new DrawingSession(emptyDocument);
      session.tool = "eraser";
      session.sizeIndex = Math.floor(between(0, 4));
      session.flatEnds = random() < 0.5;
      session.snap = random() < 0.5;
      const straight = random() < 0.2;
      let at = { x: between(0, 500), y: between(-30, 222) };
      session.begin(at, session.snap);
      const moves = Math.floor(between(0, 25));
      for (let move = 0; move < moves; move++) {
        at = { x: at.x + between(-16, 24), y: at.y + between(-12, 12) };
        session.extend([at], straight);
        for (const stroke of session.activeStrokes) {
          expect(stroke.points.every(Number.isInteger)).toBe(true);
        }
      }
      session.end(at, session.snap);
      for (const stroke of session.document.strokes) {
        expect(stroke.points.every(Number.isInteger)).toBe(true);
      }
    }
  }, 30_000);

  it("guesses the grid of a drawing 1.0.0 saved as 1.0.1 does", () => {
    // The fifth review of #381: a pen tap Shift put on the grid at (16, 16),
    // and an eraser ellipse filled from (21, 16) to (53, 48), which 1.0.0
    // saved as its fill alone, a closed area. 1.0.1 guesses 5 pixels from
    // the two ends of that area, which start and end on a row.
    const document = {
      strokes: [
        { tool: "pen" as const, size: 192, points: [256, 256] },
        {
          tool: "eraser" as const,
          kind: "fill" as const,
          points: [
            336, 512, 336, 497, 338, 481, 340, 466, 343, 451, 348, 436, 353,
            421, 359, 407, 365, 393, 373, 380, 381, 367, 390, 354, 400, 342,
            411, 331, 422, 320, 434, 310, 447, 301, 460, 293, 473, 285, 487,
            279, 501, 273, 516, 268, 531, 263, 546, 260, 561, 258, 577, 256,
            592, 256, 607, 256, 623, 258, 638, 260, 653, 263, 668, 268, 683,
            273, 697, 279, 711, 285, 724, 293, 737, 301, 750, 310, 762, 320,
            773, 331, 784, 342, 794, 354, 803, 367, 811, 380, 819, 393, 825,
            407, 831, 421, 836, 436, 841, 451, 844, 466, 846, 481, 848, 497,
            848, 512, 848, 527, 846, 543, 844, 558, 841, 573, 836, 588, 831,
            603, 825, 617, 819, 631, 811, 644, 803, 657, 794, 670, 784, 682,
            773, 693, 762, 704, 750, 714, 737, 723, 724, 731, 711, 739, 697,
            745, 683, 751, 668, 756, 653, 761, 638, 764, 623, 766, 607, 768,
            592, 768, 577, 768, 561, 766, 546, 764, 531, 761, 516, 756, 501,
            751, 487, 745, 473, 739, 460, 731, 447, 723, 434, 714, 422, 704,
            411, 693, 400, 682, 390, 670, 381, 657, 373, 644, 365, 631, 359,
            617, 353, 603, 348, 588, 343, 573, 340, 558, 338, 543, 336, 527,
            336, 512,
          ],
        },
      ],
    };
    expect(gridOriginOf(document)).toBe(5);
  });

  it("guesses the grid from an eraser's area by its end, twice", () => {
    // The first review's case on #381: a pen dot Shift put on the grid, and
    // an eraser drawn freehand that happens to end on a row, 5 pixels into a
    // column. Its area starts and ends there, as a stroke started and ended
    // there would, and marks it twice, so the end wins where 1.0.1's smooth
    // stroke, whose start was off the rows, tied with the dot at 0.
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 16, y: 16 }, true);
    session.end({ x: 16, y: 16 }, true);
    session.tool = "eraser";
    session.begin({ x: 20, y: 20 });
    session.extend([{ x: 21, y: 32 }]);
    session.end({ x: 21, y: 32 });
    const [, eraser] = session.document.strokes;
    expect(eraser?.kind).toBe("fill");
    expect(gridOriginOf(session.document)).toBe(5);
  });

  it("ends the pen's strokes and ellipses by Next as 1.0.1 did, whatever Shift does with the pointer still", () => {
    // The fourth review of #381: with the grid on throughout, a drag ended
    // by Mod+Shift+Enter, whose Shift the editor hears, saves what it
    // showed, as in 1.0.1, which never heard it.
    for (const shape of ["free", "ellipse"] as const) {
      const session = new DrawingSession(emptyDocument);
      session.shape = shape;
      session.snap = true;
      session.flatEnds = true;
      session.begin({ x: 32, y: 176 });
      for (let step = 1; step <= 20; step++) {
        session.extend([
          { x: 32 + (117 * step) / 20, y: 176 - (107 * step) / 20 },
        ]);
      }
      const shown = session.activeStrokes;
      expect(session.holdShift(true), shape).toBe(false);
      session.end();
      expect(session.document.strokes, shape).toEqual(shown);
    }
  });

  it("saves just the area it shows, however its drag ends, and whatever the release says of Shift", () => {
    // XL with the grid on and Flat ends off: freehand down and across, then
    // with Shift to near the grid point (144, 64), which it goes to. The
    // release where the pointer is with Shift as it is, let go, or saying
    // the opposite of what the editor knew, as of a key it missed, Next, and
    // a lost capture all save what was shown.
    const drag = (known: boolean) => {
      const session = new DrawingSession(emptyDocument);
      session.tool = "eraser";
      session.sizeIndex = 3;
      session.snap = true;
      session.begin({ x: 32, y: 32 });
      session.extend([{ x: 32, y: 144 }]);
      session.extend([{ x: 144, y: 144 }]);
      session.extend([{ x: 149, y: 69 }], true);
      session.holdShift(known);
      return { session, shown: session.activeStrokes };
    };
    const last = { x: 149, y: 69 };
    const ends = {
      "release with Shift": (session: DrawingSession) => {
        session.end(last, true);
      },
      "release with Shift let go": (session: DrawingSession) => {
        session.end(last, false);
      },
      "Next, or a lost capture": (session: DrawingSession) => {
        session.end();
      },
    };
    for (const known of [true, false]) {
      for (const [name, end] of Object.entries(ends)) {
        const label = `${name}, Shift known ${known ? "down" : "up"}`;
        const { session, shown } = drag(known);
        expect(
          shown.map((stroke) => stroke.kind),
          label,
        ).toEqual(["fill"]);
        expect(shown[0]?.points.slice(-2), label).toEqual([144 * 16, 64 * 16]);
        end(session);
        expect(session.document.strokes, label).toEqual(shown);
      }
    }
    // A Shift the editor never heard of, pressed at the release after a
    // freehand move to a point off the grid, puts nothing on the grid.
    const session = new DrawingSession(emptyDocument);
    session.tool = "eraser";
    session.snap = true;
    session.begin({ x: 32, y: 32 });
    session.extend([{ x: 69, y: 75 }]);
    const shown = session.activeStrokes;
    session.end({ x: 69, y: 75 }, true);
    expect(session.document.strokes).toEqual(shown);
    expect(shown[0]?.points.slice(-2)).toEqual([69 * 16, 75 * 16]);
  });

  it("takes a release where the pointer moved as its last move", () => {
    // Moved by whole pixels, and by a fiftieth of one that the grid puts on
    // another column though the file would round both to one unit, as in
    // the sixth review of #381: with Shift, from (39.99, 64) to (40.01, 64).
    const cases: {
      way: readonly { at: InputPoint; shift: boolean }[];
      release: InputPoint;
      end?: readonly number[];
    }[] = [
      {
        way: [{ at: { x: 60, y: 40 }, shift: false }],
        release: { x: 75, y: 50 },
      },
      {
        way: [{ at: { x: 39.99, y: 64 }, shift: true }],
        release: { x: 40.01, y: 64 },
        end: [48 * 16, 64 * 16],
      },
    ];
    for (const [index, { way, release, end }] of cases.entries()) {
      const drawn = (session: DrawingSession) => {
        session.tool = "eraser";
        session.snap = true;
        session.begin({ x: 16, y: 16 });
        for (const { at, shift } of way) session.extend([at], shift);
      };
      const last = way.at(-1)?.shift ?? false;
      const moved = new DrawingSession(emptyDocument);
      drawn(moved);
      moved.extend([release], last);
      const shown = moved.activeStrokes;
      const released = new DrawingSession(emptyDocument);
      drawn(released);
      // The release's own Shift, as of a key the editor missed, is not
      // taken: the move keeps Shift as last known.
      released.end(release, !last);
      const name = `case ${String(index)}`;
      expect(released.document.strokes, name).toEqual(shown);
      if (end !== undefined) {
        expect(shown[0]?.points.slice(-2), name).toEqual(end);
      }
    }
  });

  it("keeps a tap the brush's circle where the press put it, until the pointer moves", () => {
    // The sixth review of #381: the S eraser with the grid on and Flat ends
    // off, pressed at (39, 39) and let go there. Shift pressed with the
    // pointer still, or the grid turned off after a press with Shift, which
    // put the press on (32, 32), leaves the circle where the press put it.
    const tap = (
      press: boolean,
      change: (session: DrawingSession) => void,
      release: boolean,
      way: readonly InputPoint[] = [],
      wayShift = false,
    ) => {
      const session = new DrawingSession(emptyDocument);
      session.tool = "eraser";
      session.sizeIndex = 0;
      session.snap = true;
      session.begin({ x: 39, y: 39 }, press);
      for (const at of way) session.extend([at], wayShift);
      change(session);
      const shown = session.activeStrokes;
      session.end({ x: 39, y: 39 }, release);
      expect(session.document.strokes).toEqual(shown);
      return shown;
    };
    const circle = (x: number, y: number) => [
      sweptStroke("eraser", 96, [x * 16, y * 16]),
    ];
    expect(tap(false, (session) => session.holdShift(true), true)).toEqual(
      circle(39, 39),
    );
    expect(
      tap(
        true,
        (session) => {
          session.snap = false;
        },
        true,
      ),
    ).toEqual(circle(32, 32));
    // The final check of #381: a report at the press's own place, as a
    // browser can send with no move, is still no move, with Shift up or held.
    expect(
      tap(false, (session) => session.holdShift(true), true, [
        { x: 39, y: 39 },
      ]),
    ).toEqual(circle(39, 39));
    expect(
      tap(
        true,
        (session) => {
          session.snap = false;
        },
        true,
        [{ x: 39, y: 39 }],
        true,
      ),
    ).toEqual(circle(32, 32));
    // Moved away and back, the pointer has left the press: Shift then puts
    // the end on the grid point, and the area runs there.
    const back = tap(false, (session) => session.holdShift(true), true, [
      { x: 45, y: 45 },
      { x: 39, y: 39 },
    ]);
    expect(back[0]?.points.slice(-2)).toEqual([32 * 16, 32 * 16]);
    expect(covers(back[0]?.points ?? [], 35 * 16, 35 * 16)).toBe(true);
  });

  it("saves the eraser's stroke it showed last, across seeded drags", () => {
    // Freehand and with Shift by turns, on the grid and off, with Flat ends
    // and without, often coming back near where they started, with Shift
    // pressed or let go and the grid turned on or off while the pointer is
    // still, ended by a release where the pointer was last with Shift as it
    // is, let go, or the other way to what the editor knew, or by Next. A
    // fill, started without Flat ends and the grid both on, always saves the
    // stroke it showed last; one started with both on is the pen's stroke
    // through the same drag, shown and saved, as 1.0.1's eraser's was.
    let state = 341;
    const random = (): number => {
      state = (state * 16807) % 2147483647;
      return state / 2147483647;
    };
    const between = (from: number, to: number): number =>
      from + (to - from) * random();
    const seen = {
      fills: 0,
      smooth: 0,
      disagreeing: 0,
      stillShift: 0,
      stillGrid: 0,
    };
    type Step =
      | { kind: "move"; at: InputPoint; shift: boolean }
      | { kind: "key"; down: boolean }
      | { kind: "grid" }
      | { kind: "end"; at?: InputPoint; shift?: boolean };
    for (let trial = 0; trial < 600; trial++) {
      const size = Math.floor(between(0, 4));
      const flat = random() < 0.6;
      const snap = random() < 0.6;
      let shift = random() < 0.4;
      const pressShift = shift;
      const start = { x: between(0, 200), y: between(0, 120) };
      let at = start;
      const steps: Step[] = [];
      /** Shift pressed or let go, or the grid switched, with the pointer still. */
      const still = (): void => {
        if (random() < 0.2) {
          shift = !shift;
          steps.push({ kind: "key", down: shift });
          seen.stillShift++;
        }
        if (random() < 0.1) {
          steps.push({ kind: "grid" });
          seen.stillGrid++;
        }
      };
      const moves = Math.floor(between(0, 30));
      for (let move = 0; move < moves; move++) {
        still();
        if (random() < 0.15) shift = !shift;
        at =
          random() < 0.1
            ? { x: start.x + between(-8, 8), y: start.y + between(-8, 8) }
            : { x: at.x + between(-24, 24), y: at.y + between(-24, 24) };
        steps.push({ kind: "move", at, shift });
      }
      still();
      const how = random();
      if (how < 0.3) steps.push({ kind: "end", at, shift });
      else if (how < 0.45) {
        // Shift let go just before the button, as the key comes up first.
        steps.push({ kind: "key", down: false });
        steps.push({ kind: "end", at, shift: false });
      } else if (how < 0.7) {
        // A Shift the editor missed, or one only the release reports.
        steps.push({ kind: "end", at, shift: !shift });
        seen.disagreeing++;
      } else steps.push({ kind: "end" });
      const run = (tool: "pen" | "eraser") => {
        const session = new DrawingSession(emptyDocument);
        session.tool = tool;
        session.sizeIndex = size;
        session.flatEnds = flat;
        session.snap = snap;
        session.begin(start, pressShift);
        let shown = session.activeStrokes;
        for (const step of steps) {
          if (step.kind === "move") session.extend([step.at], step.shift);
          else if (step.kind === "key") session.holdShift(step.down);
          else if (step.kind === "grid") session.snap = !session.snap;
          else if (step.at === undefined) session.end();
          else session.end(step.at, step.shift);
          if (step.kind !== "end") shown = session.activeStrokes;
        }
        return { shown, saved: session.document.strokes };
      };
      const label = `trial ${String(trial)}`;
      const eraser = run("eraser");
      if (flat && snap) {
        seen.smooth++;
        const pen = run("pen");
        const asEraser = (strokes: readonly Stroke[]) =>
          strokes.map((stroke) => ({ ...stroke, tool: "eraser" }));
        expect(eraser.saved, label).toEqual(asEraser(pen.saved));
        expect(eraser.shown, label).toEqual(asEraser(pen.shown));
      } else {
        seen.fills++;
        expect(
          eraser.saved.map((stroke) => stroke.kind),
          label,
        ).toEqual(["fill"]);
        expect(eraser.saved, label).toEqual(eraser.shown);
      }
    }
    // The drags cover both kinds, releases that disagree with what the editor
    // knew, and changes made with the pointer still.
    expect(seen.fills).toBeGreaterThan(300);
    expect(seen.smooth).toBeGreaterThan(150);
    expect(seen.disagreeing).toBeGreaterThan(100);
    expect(seen.stillShift).toBeGreaterThan(500);
    expect(seen.stillGrid).toBeGreaterThan(250);
    // About a second alone, and several under a full run on a busy machine.
  }, 30_000);

  describe("shows what letting go or Next saves, as what it depends on changes with the pointer still", () => {
    /**
     * An XL eraser, with the grid on unless `grid` says not, and Flat ends
     * off, drawn freehand from (32, 176) across to (144, 176), then with
     * Shift, or without as `shift` says, up to `last`, near the grid point
     * (144, 64).
     */
    const drawn = (
      last: InputPoint,
      shift: boolean,
      grid = true,
    ): DrawingSession => {
      const session = new DrawingSession(emptyDocument);
      session.tool = "eraser";
      session.sizeIndex = 3;
      session.snap = grid;
      session.begin({ x: 32, y: 176 });
      session.extend([{ x: 144, y: 176 }]);
      session.extend([last], shift);
      return session;
    };
    /**
     * The strokes shown once `change` is made to a drag as `drawn` makes it,
     * after checking that letting go where the pointer is, with Shift as it
     * then is, and Next each save just them, a fill.
     */
    const shownAfter = (
      make: () => DrawingSession,
      change: (session: DrawingSession) => void,
      last: InputPoint,
      shift: boolean,
    ): readonly Stroke[] => {
      const ends = {
        release: (session: DrawingSession) => {
          session.end(last, shift);
        },
        next: (session: DrawingSession) => {
          session.end();
        },
      };
      let shown: readonly Stroke[] = [];
      for (const [name, end] of Object.entries(ends)) {
        const session = make();
        change(session);
        shown = session.activeStrokes;
        end(session);
        expect(session.document.strokes, name).toEqual(shown);
      }
      expect(shown.map((stroke) => stroke.kind)).toEqual(["fill"]);
      return shown;
    };
    /** The stroke's last point, in document pixels. */
    const endOf = (shown: readonly Stroke[]): number[] =>
      (shown[0]?.points.slice(-2) ?? []).map((value) => value / 16);
    /** Whether the stroke's area reaches above the row at y = 64. */
    const round = (shown: readonly Stroke[]): boolean =>
      covers(shown[0]?.points ?? [], 144 * 16, 60 * 16);

    it("Shift pressed", () => {
      // The end goes to the grid point, round.
      const last = { x: 149, y: 69 };
      expect(endOf(drawn(last, false).activeStrokes)).toEqual([149, 69]);
      const shown = shownAfter(
        () => drawn(last, false),
        (session) => {
          expect(session.holdShift(true)).toBe(true);
        },
        last,
        true,
      );
      expect(endOf(shown)).toEqual([144, 64]);
      expect(round(shown)).toBe(true);
    });

    it("Shift let go", () => {
      // Shift still counts as held until the pointer moves.
      const last = { x: 149, y: 69 };
      const before = drawn(last, true).activeStrokes;
      const shown = shownAfter(
        () => drawn(last, true),
        (session) => {
          session.holdShift(false);
        },
        last,
        false,
      );
      expect(shown).toEqual(before);
      expect(endOf(shown)).toEqual([144, 64]);
    });

    it("the grid turned on", () => {
      // Shift drew the last move with the grid off, and the end goes to the
      // grid once it is on.
      const last = { x: 149, y: 69 };
      expect(endOf(drawn(last, true, false).activeStrokes)).toEqual([149, 69]);
      const shown = shownAfter(
        () => drawn(last, true, false),
        (session) => {
          session.snap = true;
        },
        last,
        true,
      );
      expect(endOf(shown)).toEqual([144, 64]);
    });

    it("the grid turned off", () => {
      // The end Shift put on the grid goes back to where the pointer is.
      const last = { x: 149, y: 69 };
      expect(endOf(drawn(last, true).activeStrokes)).toEqual([144, 64]);
      const shown = shownAfter(
        () => drawn(last, true),
        (session) => {
          session.snap = false;
        },
        last,
        true,
      );
      expect(endOf(shown)).toEqual([149, 69]);
    });

    it("a grid laid out anew", () => {
      // As when the font is measured again: it waits for the stroke's end.
      const last = { x: 149, y: 69 };
      const before = drawn(last, true).activeStrokes;
      const coarse: Grid = {
        spacing: 48,
        rows: [0, 48, 96, 144, 192],
      };
      const shown = shownAfter(
        () => drawn(last, true),
        (session) => {
          session.grid = coarse;
        },
        last,
        true,
      );
      expect(shown).toEqual(before);
    });

    it("Flat ends switched on", () => {
      // A stroke keeps the kind it began as, and its end stays round.
      const last = { x: 144, y: 64 };
      const before = drawn(last, true).activeStrokes;
      const shown = shownAfter(
        () => drawn(last, true),
        (session) => {
          session.flatEnds = true;
        },
        last,
        true,
      );
      expect(shown).toEqual(before);
      expect(round(shown)).toBe(true);
    });
  });

  it("moves an eraser's area with the drawing", () => {
    const session = new DrawingSession(emptyDocument);
    session.tool = "eraser";
    session.begin({ x: 10, y: 50 });
    session.extend([{ x: 30, y: 60 }]);
    session.end();
    const [before] = session.document.strokes;
    session.moveDrawing(32);
    const [after] = session.document.strokes;
    expect(after?.points).toEqual(
      before?.points.map((value, at) => (at % 2 === 1 ? value + 32 : value)),
    );
  });

  it("keeps a stroke's cuts through undo and redo", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.flatEnds = true;
    session.begin({ x: 0, y: 16 }, true);
    session.end({ x: 0, y: 144 }, true);
    const [stroke] = session.document.strokes;
    session.undo();
    expect(session.document.strokes).toEqual([]);
    session.redo();
    expect(session.document.strokes).toEqual([stroke]);
    expect(stroke?.cut).toEqual({ start: "up", end: "down" });
  });
});

describe("ellipsePoints", () => {
  it("goes round the box once from the side it starts on, no more than maxGap apart", () => {
    const points = ellipsePoints({ x: 10, y: 20 }, { x: 70, y: 40 }, false);
    expect(points[0]?.x).toBeCloseTo(10);
    expect(points[0]?.y).toBeCloseTo(30);
    const last = points.at(-1);
    expect(last?.x).toBeCloseTo(10);
    expect(last?.y).toBeCloseTo(30);
    // Clockwise on screen: up from the left side.
    expect(points[1]?.y).toBeLessThan(30);
    // Dragged leftwards, it starts on the right side, where the drag began.
    const leftwards = ellipsePoints({ x: 70, y: 20 }, { x: 10, y: 40 }, false);
    expect(leftwards[0]?.x).toBeCloseTo(70);
    expect(leftwards.at(-1)?.x).toBeCloseTo(70);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    expect(Math.min(...xs)).toBeCloseTo(10);
    expect(Math.max(...xs)).toBeCloseTo(70);
    expect(Math.min(...ys)).toBeCloseTo(20);
    expect(Math.max(...ys)).toBeCloseTo(40);
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1];
      const b = points[index];
      if (a === undefined || b === undefined) throw new Error("no point");
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(maxGap);
    }
  });

  it("keeps a long, thin ellipse's points within maxGap", () => {
    const points = ellipsePoints({ x: 0, y: 0 }, { x: 400, y: 4 }, false);
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1];
      const b = points[index];
      if (a === undefined || b === undefined) throw new Error("no point");
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(maxGap);
    }
  });

  it("makes a circle as wide as the box's longer side, towards the pointer", () => {
    const points = ellipsePoints({ x: 50, y: 50 }, { x: 20, y: 90 }, true);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    expect(Math.min(...xs)).toBeCloseTo(10);
    expect(Math.max(...xs)).toBeCloseTo(50);
    expect(Math.min(...ys)).toBeCloseTo(50);
    expect(Math.max(...ys)).toBeCloseTo(90);
  });

  it("gives a point or a line for a box without area", () => {
    expect(ellipsePoints({ x: 5, y: 5 }, { x: 5, y: 5 }, false)).toEqual([
      { x: 5, y: 5 },
    ]);
    expect(ellipsePoints({ x: 5, y: 5 }, { x: 25, y: 5 }, false)).toEqual([
      { x: 5, y: 5 },
      { x: 25, y: 5 },
    ]);
  });
});

describe("DrawingSession's ellipses", () => {
  it("draws an ellipse across the box dragged, as one undoable stroke", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "ellipse";
    session.begin({ x: 10, y: 20 });
    session.extend([{ x: 40, y: 30 }]);
    session.extend([{ x: 70, y: 40 }]);
    session.end({ x: 70, y: 40 });
    const [stroke] = session.document.strokes;
    expect(session.document.strokes).toHaveLength(1);
    const xs = (stroke?.points ?? []).filter((_, at) => at % 2 === 0);
    const ys = (stroke?.points ?? []).filter((_, at) => at % 2 === 1);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([160, 1120]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([320, 640]);
    // A closed loop, with no ends to cut.
    expect(stroke?.points.slice(0, 2)).toEqual(stroke?.points.slice(-2));
    expect(stroke).not.toHaveProperty("cut");
    session.undo();
    expect(session.document.strokes).toEqual([]);
  });

  it("puts the box's corners on the grid with Shift, makes no circle, and draws a dot for a tap", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "ellipse";
    session.snap = true;
    session.tool = "eraser";
    session.begin({ x: 7, y: 9 }, true);
    session.extend([{ x: 40, y: 70 }], true);
    // The release does not say Shift is held, but no move has come since.
    session.end({ x: 41, y: 75 });
    const [shape] = session.document.strokes;
    expect(shape?.tool).toBe("eraser");
    const xs = (shape?.points ?? []).filter((_, at) => at % 2 === 0);
    const ys = (shape?.points ?? []).filter((_, at) => at % 2 === 1);
    // From the grid point (0, 16) to (48, 64), as the last move showed it.
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 768]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([256, 1024]);
    expect(shape).not.toHaveProperty("cut");
    session.begin({ x: 7, y: 9 }, true);
    session.end({ x: 7, y: 9 }, true);
    expect(session.document.strokes[1]?.points).toEqual([0, 256]);
  });

  it("takes each of the box's corners by Shift at it, on the grid", () => {
    const box = (session: DrawingSession, at: number): number[] => {
      const points = session.document.strokes[at]?.points ?? [];
      const xs = points.filter((_, index) => index % 2 === 0);
      const ys = points.filter((_, index) => index % 2 === 1);
      return [
        Math.min(...xs) / 16,
        Math.min(...ys) / 16,
        Math.max(...xs) / 16,
        Math.max(...ys) / 16,
      ];
    };
    const session = new DrawingSession(emptyDocument);
    session.shape = "ellipse";
    session.snap = true;
    // Neither: a guide alone.
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 41, y: 71 }]);
    session.end({ x: 41, y: 71 });
    expect(box(session, 0)).toEqual([7, 9, 41, 71]);
    // The first, with Shift let go part way, which the second then follows.
    session.begin({ x: 7, y: 9 }, true);
    session.extend([{ x: 30, y: 40 }], true);
    session.extend([{ x: 41, y: 71 }]);
    session.end({ x: 41, y: 71 });
    expect(box(session, 1)).toEqual([0, 16, 41, 71]);
    // The second, with Shift pressed part way: the first stays where it is.
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 30, y: 40 }]);
    session.extend([{ x: 41, y: 71 }], true);
    session.end({ x: 41, y: 71 }, true);
    expect(box(session, 2)).toEqual([7, 9, 48, 64]);
    // The corner goes back to the pointer as soon as Shift is up, until the
    // release, as an ellipse is drawn again at every move.
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 41, y: 71 }], true);
    session.extend([{ x: 42, y: 72 }]);
    session.end({ x: 42, y: 72 });
    expect(box(session, 3)).toEqual([7, 9, 42, 72]);
  });

  it("makes a circle with Shift only with the grid off, as it goes", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "ellipse";
    const circle = (): { across: number; down: number } => {
      const points = drawn(session)?.points ?? [];
      const xs = points.filter((_, at) => at % 2 === 0);
      const ys = points.filter((_, at) => at % 2 === 1);
      return {
        across: Math.max(...xs) - Math.min(...xs),
        down: Math.max(...ys) - Math.min(...ys),
      };
    };
    session.begin({ x: 10, y: 10 });
    session.extend([{ x: 70, y: 30 }], true);
    expect(circle()).toEqual({ across: 960, down: 960 });
    session.extend([{ x: 70, y: 30 }]);
    expect(circle()).toEqual({ across: 960, down: 320 });
    session.extend([{ x: 70, y: 30 }], true);
    // The release keeps it, whatever it says of Shift.
    session.end({ x: 70, y: 30 });
    expect(session.document.strokes[0]?.points.length).toBeGreaterThan(8);
    const points = session.document.strokes[0]?.points ?? [];
    const ys = points.filter((_, at) => at % 2 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(960);
  });

  it("leaves the grid where it was for a drawing opened again, however many columns an ellipse spans", () => {
    for (const [from, to] of [
      [
        { x: 0, y: 32 },
        { x: 48, y: 96 },
      ],
      [
        { x: 48, y: 32 },
        { x: 0, y: 96 },
      ],
    ] as const) {
      const session = new DrawingSession(emptyDocument);
      session.shape = "ellipse";
      session.snap = true;
      session.begin(from, true);
      session.end(to, true);
      // Three columns across: its top is between two of them.
      expect(new DrawingSession(session.document).gridOrigin).toBe(0);
      session.rebase(5);
      expect(new DrawingSession(session.document).gridOrigin).toBe(5);
      // Copy from puts a copy in another editor, whose grid is elsewhere.
      const copying = new DrawingSession(emptyDocument);
      copying.replace(session.document);
      expect(copying.gridOrigin).toBe(5);
    }
  });

  it("keeps an ellipse's corner where it was when a save moves the drawing", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "ellipse";
    session.begin({ x: 10, y: 20 });
    session.rebase(-5);
    session.end({ x: 65, y: 40 });
    const xs = (session.document.strokes[0]?.points ?? []).filter(
      (_, at) => at % 2 === 0,
    );
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([80, 1040]);
  });
});

describe("DrawingSession's fill", () => {
  /** Clicks at each corner of a polygon: a press and a release there. */
  const clicks = (
    session: DrawingSession,
    ...corners: readonly (readonly [number, number])[]
  ): void => {
    for (const [x, y] of corners) {
      session.begin({ x, y });
      session.end({ x, y });
    }
  };

  /** A triangle's corners, and its first again, which closes it. */
  const triangle = [
    [10, 20],
    [40, 20],
    [25, 50],
    [10, 20],
  ] as const;

  it("fills an ellipse, and a polygon closed on its first corner, but no other stroke", () => {
    const session = new DrawingSession(emptyDocument);
    session.fill = true;
    session.begin({ x: 0, y: 0 });
    session.end({ x: 20, y: 20 });
    expect(session.document.strokes.map(({ kind }) => kind)).toEqual([
      undefined,
    ]);
    session.shape = "ellipse";
    session.begin({ x: 10, y: 20 });
    session.extend([{ x: 70, y: 40 }]);
    expect(session.activeStrokes.map(({ kind }) => kind)).toEqual([
      "fill",
      undefined,
    ]);
    session.end({ x: 70, y: 40 });
    expect(session.document.strokes.map(({ kind }) => kind)).toEqual([
      undefined,
      "fill",
      undefined,
    ]);
    // A tap draws a dot, with nothing inside to fill.
    session.begin({ x: 5, y: 5 });
    session.end({ x: 5, y: 5 });
    expect(session.document.strokes).toHaveLength(4);
    expect(session.document.strokes[3]?.kind).toBeUndefined();
    session.shape = "polygon";
    clicks(session, ...triangle.slice(0, 3));
    session.end();
    expect(session.document.strokes).toHaveLength(5);
    expect(session.document.strokes[4]?.kind).toBe("polygon");
    // Nor when it is ended on its last corner.
    clicks(session, ...triangle.slice(0, 3), [25, 50]);
    expect(session.document.strokes).toHaveLength(6);
    expect(session.document.strokes[5]?.points).toHaveLength(6);
    expect(session.document.strokes[5]?.kind).toBe("polygon");
  });

  it("fills a closed polygon as Fill is when it closes, and shows it so", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    clicks(session, ...triangle.slice(0, 3));
    session.extend([{ x: 10, y: 20 }]);
    expect(drawn(session)?.kind).toBe("polygon");
    session.fill = true;
    expect(session.activeStrokes.map(({ kind }) => kind)).toEqual([
      "fill",
      "polygon",
    ]);
    // A side to a new corner is not closed, and shows no fill.
    session.extend([{ x: 60, y: 60 }]);
    expect(drawn(session)?.kind).toBe("polygon");
    clicks(session, [10, 20]);
    const points = [160, 320, 640, 320, 400, 800, 160, 320];
    expect(session.document.strokes).toEqual([
      { tool: "pen", points, kind: "fill" },
      { tool: "pen", size: 192, points, kind: "polygon" },
    ]);
  });

  it("keeps the brush's width round a filled polygon: the polygon unfilled, with its inside, as one step", () => {
    const unfilled = new DrawingSession(emptyDocument);
    unfilled.shape = "polygon";
    clicks(unfilled, ...triangle);
    const [sides] = unfilled.document.strokes;
    expect(sides).toMatchObject({ size: 192, kind: "polygon" });
    if (sides === undefined) throw new Error("no polygon");

    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    session.fill = true;
    // Hovering the first corner shows what the click there leaves.
    clicks(session, ...triangle.slice(0, 3));
    session.extend([{ x: 11, y: 21 }]);
    const shown = session.activeStrokes;
    clicks(session, [11, 21]);
    expect(session.document.strokes).toEqual([
      { tool: "pen", points: sides.points, kind: "fill" },
      sides,
    ]);
    expect(shown).toEqual(session.document.strokes);
    // One step of Undo, and of Redo.
    expect(session.undo()).toBe(true);
    expect(session.document.strokes).toEqual([]);
    expect(session.canUndo).toBe(false);
    expect(session.redo()).toBe(true);
    expect(session.document.strokes).toHaveLength(2);
  });

  it("closes a filled polygon on the grid where Shift snaps to its first corner, and shows it so", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.shape = "polygon";
    session.fill = true;
    for (const [x, y] of [
      [17, 15],
      [47, 17],
      [33, 63],
    ] as const) {
      session.begin({ x, y }, true);
      session.end({ x, y }, true);
    }
    // Two pixels from the first corner, which Shift snaps to.
    session.extend([{ x: 18, y: 18 }], true);
    const shown = session.activeStrokes;
    session.begin({ x: 18, y: 18 }, true);
    session.end({ x: 18, y: 18 }, true);
    expect(session.placing).toBe(false);
    const points = [256, 256, 768, 256, 512, 1024, 256, 256];
    expect(session.document.strokes).toEqual([
      { tool: "pen", points, kind: "fill" },
      { tool: "pen", size: 192, points, kind: "polygon" },
    ]);
    expect(shown).toEqual(session.document.strokes);
  });

  it("keeps the brush's width round a filled ellipse: the ring of the ellipse unfilled, with its inside, as one step", () => {
    const unfilled = new DrawingSession(emptyDocument);
    unfilled.shape = "ellipse";
    unfilled.begin({ x: 10, y: 20 });
    unfilled.extend([{ x: 70, y: 40 }]);
    unfilled.end({ x: 70, y: 40 });
    const [ring] = unfilled.document.strokes;
    expect(ring).toMatchObject({ size: 192 });
    if (ring === undefined) throw new Error("no ellipse");

    const session = new DrawingSession(emptyDocument);
    session.shape = "ellipse";
    session.fill = true;
    session.begin({ x: 10, y: 20 });
    session.extend([
      { x: 40, y: 60 },
      { x: 70, y: 40 },
    ]);
    // While dragging, it shows what letting go leaves.
    const shown = session.activeStrokes;
    session.end({ x: 70, y: 40 });
    expect(session.document.strokes).toEqual([
      { tool: "pen", points: ring.points, kind: "fill" },
      ring,
    ]);
    expect(shown).toEqual(session.document.strokes);
    expect(session.undo()).toBe(true);
    expect(session.document.strokes).toEqual([]);
    expect(session.canUndo).toBe(false);
    // Ended without a release, as a save ends it, it is filled the same.
    session.begin({ x: 10, y: 20 });
    session.extend([{ x: 70, y: 40 }]);
    session.end();
    expect(session.document.strokes).toEqual([
      { tool: "pen", points: ring.points, kind: "fill" },
      ring,
    ]);
  });

  it("erases a filled shape's line at the eraser's width, as well as its inside", () => {
    const session = new DrawingSession(emptyDocument);
    session.tool = "eraser";
    session.sizeIndex = 3;
    session.fill = true;
    session.shape = "ellipse";
    session.begin({ x: 10, y: 20 });
    session.end({ x: 70, y: 40 });
    session.shape = "polygon";
    clicks(session, ...triangle);
    expect(
      session.document.strokes.map(({ tool, size, kind }) => ({
        tool,
        size,
        kind,
      })),
    ).toEqual([
      { tool: "eraser", size: undefined, kind: "fill" },
      { tool: "eraser", size: 384, kind: undefined },
      { tool: "eraser", size: undefined, kind: "fill" },
      { tool: "eraser", size: 384, kind: "polygon" },
    ]);
  });

  it("gives a polygon the tool and size chosen while it is placed, its fill too", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    session.fill = true;
    clicks(session, ...triangle.slice(0, 3));
    session.tool = "eraser";
    session.sizeIndex = 0;
    session.rebrush();
    clicks(session, [10, 20]);
    expect(session.document.strokes).toMatchObject([
      { tool: "eraser", kind: "fill" },
      { tool: "eraser", size: 96, kind: "polygon" },
    ]);
  });

  it("puts the grid of a reopened drawing where the same drawing unfilled would", () => {
    // A line on a row, 3 px into a cell at both ends; then a triangle closed
    // on a corner 5 px into one, filled or not. Each shape's ends mark their
    // place twice, so the line, first, wins the tie.
    const y = (plainGrid.rows[2] ?? 0) * 16;
    const line: Stroke = {
      tool: "pen",
      size: 192,
      points: [48, y, 48 + 1024, y],
    };
    const points = [80, y, 592, y, 336, y + 256, 80, y];
    const sides: Stroke = { tool: "pen", size: 192, points, kind: "polygon" };
    const fill: Stroke = { tool: "pen", points, kind: "fill" };
    expect(gridOriginOf({ strokes: [line, sides] })).toBe(3);
    expect(gridOriginOf({ strokes: [line, fill, sides] })).toBe(3);
    // A fill with no sides after it, as Inkline 1.0.0 drew a filled shape,
    // marks its place itself, as does one before a stroke elsewhere, 2 px on,
    // or of the other tool.
    expect(gridOriginOf({ strokes: [fill, line] })).toBe(5);
    const elsewhere: Stroke = {
      ...sides,
      points: points.map((value, index) =>
        index % 2 === 0 ? value + 32 : value,
      ),
    };
    expect(gridOriginOf({ strokes: [fill, elsewhere, line] })).toBe(5);
    const erased: Stroke = { ...sides, tool: "eraser" };
    expect(gridOriginOf({ strokes: [line, fill, erased] })).toBe(5);
  });
});

describe("DrawingSession's polygons", () => {
  /** Clicks at a point: a press and a release there, with Shift or not. */
  const click = (
    session: DrawingSession,
    x: number,
    y: number,
    shift = false,
  ): void => {
    session.begin({ x, y }, shift);
    session.end({ x, y }, shift);
  };

  it("places a corner at each click, and closes on the first corner as one undoable stroke", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    click(session, 10, 20);
    expect(session.placing).toBe(true);
    expect(session.drawing).toBe(true);
    expect(session.canUndo).toBe(false);
    // Between clicks, the next side follows the pointer.
    session.extend([{ x: 40, y: 22 }]);
    expect(drawn(session)).toEqual({
      tool: "pen",
      size: 192,
      points: [160, 320, 640, 352],
      kind: "polygon",
    });
    click(session, 40, 20);
    click(session, 25, 50);
    // Near the first corner, the shape shows closed.
    session.extend([{ x: 12, y: 21 }]);
    expect(drawn(session)?.points).toEqual([
      160, 320, 640, 320, 400, 800, 160, 320,
    ]);
    expect(session.document.strokes).toEqual([]);
    click(session, 12, 21);
    expect(session.placing).toBe(false);
    expect(session.document.strokes).toEqual([
      {
        tool: "pen",
        size: 192,
        points: [160, 320, 640, 320, 400, 800, 160, 320],
        kind: "polygon",
      },
    ]);
    session.undo();
    expect(session.document.strokes).toEqual([]);
  });

  it("ends a polygon open on its last corner, and a dot on a corner clicked twice", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    click(session, 10, 20);
    click(session, 40, 20);
    // A double-click: the second click lands on the last corner.
    click(session, 40, 20);
    expect(session.placing).toBe(false);
    expect(session.document.strokes[0]?.points).toEqual([160, 320, 640, 320]);
    click(session, 70, 70);
    click(session, 70, 70);
    expect(session.document.strokes[1]?.points).toEqual([1120, 1120]);
  });

  it("closes only with three corners, and adds a corner at the first otherwise", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    click(session, 10, 20);
    click(session, 40, 20);
    click(session, 10, 20);
    expect(session.placing).toBe(true);
    session.end();
    expect(session.document.strokes[0]?.points).toEqual([
      160, 320, 640, 320, 160, 320,
    ]);
  });

  it("draws the first side when the first press is dragged", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    session.begin({ x: 10, y: 20 });
    session.extend([{ x: 30, y: 20 }]);
    session.end({ x: 40, y: 20 });
    expect(session.placing).toBe(true);
    expect(drawn(session)?.points).toEqual([160, 320, 640, 320]);
  });

  it("ends with the corners it has when ended without a release, as on saving", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    click(session, 10, 20);
    click(session, 40, 20);
    session.extend([{ x: 60, y: 60 }]);
    session.end();
    expect(session.placing).toBe(false);
    expect(session.document.strokes[0]?.points).toEqual([160, 320, 640, 320]);
  });

  it("reaches the brush's radius off the grid to close or end, and no farther", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    // M is 12 px wide, so 6 px reaches; a corner 7 px away is a new one.
    click(session, 10, 20);
    click(session, 40, 20);
    click(session, 47, 20);
    expect(session.placing).toBe(true);
    click(session, 47, 26);
    expect(session.placing).toBe(false);
    expect(session.document.strokes[0]?.points).toEqual([
      160, 320, 640, 320, 752, 320,
    ]);
  });

  it("snaps corners to the grid and is never cut, even with Flat ends on", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    session.snap = true;
    session.flatEnds = true;
    click(session, 1, 15, true);
    click(session, 31, 15, true);
    click(session, 33, 143, true);
    // In the last corner's cell, it snaps to that corner and ends there.
    // Hovering where a click ends it shows it as the click would leave it.
    session.extend([{ x: 30, y: 140 }], true);
    const preview = drawn(session);
    click(session, 30, 140, true);
    expect(preview).toEqual(session.document.strokes[0]);
    expect(session.document.strokes[0]).toEqual({
      tool: "pen",
      size: 192,
      points: [0, 256, 512, 256, 512, 2304],
      kind: "polygon",
    });
    click(session, 1, 15, true);
    click(session, 31, 15, true);
    click(session, 33, 47, true);
    click(session, 2, 17, true);
    expect(session.document.strokes[1]?.points).toEqual([
      0, 256, 512, 256, 512, 768, 0, 256,
    ]);
    expect(session.document.strokes[1]).not.toHaveProperty("cut");
  });

  it("treats its corners as they were put, whatever the grid is when the shape ends", () => {
    // From the independent review of #121.
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    click(session, 10, 20);
    click(session, 40, 20);
    session.snap = true;
    session.end();
    click(session, 1, 15, true);
    click(session, 31, 15, true);
    session.snap = false;
    session.end();
    expect(session.document.strokes).toHaveLength(2);
    // Hovering on the last corner, off the grid, shows no side to where the
    // grid would put the pointer, as a click there adds none.
    click(session, 10, 20);
    click(session, 40, 20);
    session.snap = true;
    session.extend([{ x: 40, y: 20 }], true);
    expect(drawn(session)?.points).toEqual([160, 320, 640, 320]);
    click(session, 40, 20, true);
    expect(session.document.strokes[2]?.points).toEqual([160, 320, 640, 320]);
    session.snap = false;
    // A corner off the grid is still clicked within the brush's radius once
    // the grid is on, so the shape closes on it.
    click(session, 10, 20);
    click(session, 40, 20);
    session.snap = true;
    click(session, 33, 47, true);
    click(session, 15, 22, true);
    expect(session.document.strokes[3]?.points).toEqual([
      160, 320, 640, 320, 512, 768, 160, 320,
    ]);
  });

  it("takes each corner by Shift at its click, one by one, on the grid", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    session.snap = true;
    click(session, 7, 9);
    click(session, 41, 9, true);
    click(session, 41, 71);
    click(session, 7, 71, true);
    session.end();
    expect(session.document.strokes[0]?.points).toEqual([
      7 * 16,
      9 * 16,
      48 * 16,
      16 * 16,
      41 * 16,
      71 * 16,
      0,
      64 * 16,
    ]);
  });

  it("shows the next corner as a click there would put it, by Shift at the last move", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    session.snap = true;
    click(session, 7, 9);
    session.extend([{ x: 41, y: 71 }]);
    expect(drawn(session)?.points.slice(-2)).toEqual([41 * 16, 71 * 16]);
    session.extend([{ x: 41, y: 71 }], true);
    expect(drawn(session)?.points.slice(-2)).toEqual([48 * 16, 64 * 16]);
    // A press says Shift for itself, ahead of its release.
    session.begin({ x: 41, y: 71 });
    expect(drawn(session)?.points.slice(-2)).toEqual([41 * 16, 71 * 16]);
    session.end({ x: 41, y: 71 });
  });

  it("puts a corner by its release, or by a Shift let go in its click", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    session.snap = true;
    click(session, 7, 9);
    // Pressed with Shift, and let go an instant before the button.
    session.begin({ x: 41, y: 9 }, true);
    session.end({ x: 41, y: 9 });
    // Pressed without it, and with it by the release.
    session.begin({ x: 41, y: 71 });
    session.end({ x: 41, y: 71 }, true);
    // A press dragged on without Shift puts it where it is let go.
    session.begin({ x: 90, y: 9 }, true);
    session.extend([{ x: 100, y: 71 }]);
    session.end({ x: 100, y: 71 });
    session.end();
    expect(session.document.strokes[0]?.points).toEqual([
      7 * 16,
      9 * 16,
      48 * 16,
      16 * 16,
      48 * 16,
      64 * 16,
      100 * 16,
      71 * 16,
    ]);
  });

  it("closes on a corner by the brush's reach without Shift, and by its grid point with it", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    session.snap = true;
    // M is 12 px wide, so 6 px reaches. Without Shift, a click 7 px off the
    // corner on the grid is a new corner, though it would snap to it.
    click(session, 16, 16, true);
    click(session, 64, 16, true);
    click(session, 64, 64, true);
    click(session, 23, 16);
    expect(session.placing).toBe(true);
    expect(drawn(session)?.points).toHaveLength(8);
    // With Shift, the same click snaps to it and closes.
    session.undoCorner();
    click(session, 23, 16, true);
    expect(session.placing).toBe(false);
    expect(session.document.strokes[0]?.points).toEqual([
      256, 256, 1024, 256, 1024, 1024, 256, 256,
    ]);
    // Without Shift, a click within reach of it closes.
    click(session, 16, 16, true);
    click(session, 64, 16, true);
    click(session, 64, 64, true);
    click(session, 20, 18);
    expect(session.placing).toBe(false);
    expect(session.document.strokes[1]?.points).toEqual([
      256, 256, 1024, 256, 1024, 1024, 256, 256,
    ]);
    // And hovering there shows what the click would do.
    click(session, 16, 16, true);
    click(session, 64, 16, true);
    click(session, 64, 64, true);
    session.extend([{ x: 23, y: 16 }]);
    expect(drawn(session)?.points).toHaveLength(8);
    expect(drawn(session)?.points.slice(-2)).toEqual([23 * 16, 256]);
    session.extend([{ x: 23, y: 16 }], true);
    expect(drawn(session)?.points.slice(-2)).toEqual([256, 256]);
  });

  it("reaches a corner placed without Shift by the brush's radius, Shift held or not", () => {
    // Off the grid, no click snaps to such a corner, so only reach can.
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    session.snap = true;
    click(session, 10, 20);
    click(session, 40, 20);
    click(session, 25, 50);
    click(session, 12, 21, true);
    expect(session.placing).toBe(false);
    expect(session.document.strokes[0]?.points).toEqual([
      160, 320, 640, 320, 400, 800, 160, 320,
    ]);
    // And the last corner the same way, which ends it there.
    click(session, 10, 20);
    click(session, 40, 20);
    click(session, 42, 21, true);
    expect(session.placing).toBe(false);
    expect(session.document.strokes[1]?.points).toEqual([160, 320, 640, 320]);
  });

  it("drops a polygon being placed when the drawing is cleared", () => {
    // From the independent review of #121.
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0 });
    session.end({ x: 10, y: 0 });
    session.shape = "polygon";
    click(session, 10, 20);
    click(session, 40, 20);
    session.clear();
    expect(session.placing).toBe(false);
    expect(session.document.strokes).toEqual([]);
    session.undo();
    expect(session.document.strokes).toHaveLength(1);
    // A stroke being dragged keeps everything.
    session.shape = "free";
    session.begin({ x: 0, y: 0 });
    session.clear();
    expect(session.drawing).toBe(true);
    session.end({ x: 5, y: 5 });
    expect(session.document.strokes).toHaveLength(2);
  });

  it("takes back corners one at a time with undoCorner, and the polygon with its first", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    expect(session.undoCorner()).toBe(false);
    click(session, 10, 20);
    click(session, 40, 20);
    expect(session.undoCorner()).toBe(true);
    // The next side still follows the pointer, from the corner before.
    expect(drawn(session)?.points).toEqual([160, 320, 640, 320]);
    click(session, 25, 50);
    expect(session.undoCorner()).toBe(true);
    expect(session.undoCorner()).toBe(true);
    expect(session.placing).toBe(false);
    expect(drawn(session)).toBeUndefined();
    expect(session.document.strokes).toEqual([]);
    click(session, 10, 20);
    click(session, 40, 20);
    session.undoCorner();
    click(session, 25, 50);
    click(session, 25, 50);
    expect(session.document.strokes[0]?.points).toEqual([160, 320, 400, 800]);
  });

  it("drops a polygon on cancel, and takes a brush chosen while it is placed", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    click(session, 10, 20);
    session.cancel();
    expect(session.placing).toBe(false);
    click(session, 10, 20);
    session.tool = "eraser";
    session.sizeIndex = 3;
    // Until it is given the brush, it keeps the one it started with.
    expect(drawn(session)).toMatchObject({ tool: "pen", size: 192 });
    session.rebrush();
    expect(session.activeSize).toBe(384);
    click(session, 40, 20);
    click(session, 40, 20);
    expect(session.document.strokes[0]).toMatchObject({
      tool: "eraser",
      size: 384,
      kind: "polygon",
    });
    // A stroke being dragged keeps its own.
    session.shape = "free";
    session.tool = "pen";
    session.begin({ x: 10, y: 20 });
    session.tool = "eraser";
    session.rebrush();
    session.end({ x: 30, y: 20 });
    expect(session.document.strokes[1]?.tool).toBe("pen");
  });

  it("keeps its corners and the next where they were when a save moves the drawing", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    click(session, 10, 20);
    session.extend([{ x: 40, y: 20 }]);
    session.rebase(-5);
    expect(drawn(session)?.points).toEqual([80, 320, 560, 320]);
    click(session, 35, 20);
    click(session, 35, 20);
    expect(session.document.strokes[0]?.points).toEqual([80, 320, 560, 320]);
  });
});

describe("DrawingSession's paths", () => {
  /** Clicks at a point: a press and a release there, with Shift or not. */
  const click = (
    session: DrawingSession,
    x: number,
    y: number,
    shift = false,
  ): void => {
    session.begin({ x, y }, shift);
    session.end({ x, y }, shift);
  };

  /** A press at `from`, dragged to `to`, and let go there. */
  const drag = (
    session: DrawingSession,
    from: InputPoint,
    to: InputPoint,
    shift = false,
  ): void => {
    session.begin(from, shift);
    session.extend(
      [{ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to],
      shift,
    );
    session.end(to, shift);
  };

  /** A stroke's points, in pixels. */
  const pixels = (stroke: Stroke | undefined): InputPoint[] => {
    const points = stroke?.points ?? [];
    const out: InputPoint[] = [];
    for (let index = 0; index + 1 < points.length; index += 2) {
      out.push({
        x: (points[index] ?? 0) / 16,
        y: (points[index + 1] ?? 0) / 16,
      });
    }
    return out;
  };

  /**
   * A quarter circle of radius 50 about (100, 100), from (50, 100) up and
   * round to (100, 50): its start dragged upwards, its end to the right,
   * each by 0.5523 times the radius, and ended on its last point.
   */
  const quarter = (session: DrawingSession): void => {
    const k = 0.5523 * 50;
    drag(session, { x: 50, y: 100 }, { x: 50, y: 100 - k });
    drag(session, { x: 100, y: 50 }, { x: 100 + k, y: 50 });
    click(session, 100, 50);
  };

  it("saves a curve as one smooth stroke through points along it, as one undoable step", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "path";
    const k = 0.5523 * 50;
    drag(session, { x: 50, y: 100 }, { x: 50, y: 100 - k });
    expect(session.placing).toBe(true);
    expect(session.placingPath).toBe(true);
    expect(session.drawing).toBe(true);
    expect(session.canUndo).toBe(false);
    drag(session, { x: 100, y: 50 }, { x: 100 + k, y: 50 });
    expect(session.document.strokes).toEqual([]);
    click(session, 100, 50);
    expect(session.placing).toBe(false);
    const [stroke] = session.document.strokes;
    expect(stroke).toMatchObject({ tool: "pen", size: 192 });
    expect(stroke).not.toHaveProperty("kind");
    expect(stroke).not.toHaveProperty("cut");
    const points = pixels(stroke);
    expect(points[0]).toEqual({ x: 50, y: 100 });
    expect(points.at(-1)).toEqual({ x: 100, y: 50 });
    // About a quarter of 2π × 50 long, with a point at least every pixel,
    // each on the circle to within the rounding to units.
    expect(points.length).toBeGreaterThanOrEqual(79);
    expect(points.length).toBeLessThanOrEqual(81);
    for (const [index, { x, y }] of points.entries()) {
      expect(Math.abs(Math.hypot(x - 100, y - 100) - 50)).toBeLessThan(0.06);
      const next = points[index + 1];
      if (next !== undefined) {
        expect(Math.hypot(next.x - x, next.y - y)).toBeLessThanOrEqual(1.1);
      }
    }
    session.undo();
    expect(session.document.strokes).toEqual([]);
  });

  it("draws the curve at the brush's width at every size, its sides along it", () => {
    for (const [index, brush] of brushSizes.entries()) {
      const session = new DrawingSession(emptyDocument);
      session.shape = "path";
      session.sizeIndex = index;
      quarter(session);
      const [stroke] = session.document.strokes;
      if (stroke === undefined || stroke.kind !== undefined) {
        throw new Error("no smooth stroke");
      }
      const shape = smoothShape(stroke);
      if (shape.kind !== "smooth") throw new Error("a dot");
      const half = (brush.em * 128) / 2;
      // Every corner of the outline away from the round ends lies the brush's
      // half width inside or outside the circle, to within a quarter of a
      // pixel: as near as a freehand stroke's outline keeps to its points,
      // which it smooths, at 0.21 pixels for the largest brush.
      let sides = 0;
      for (const [x, y] of shape.outline) {
        const fromEnds = Math.min(
          Math.hypot(x - 50, y - 100),
          Math.hypot(x - 100, y - 50),
        );
        if (fromEnds <= half + 1) continue;
        const off = Math.abs(Math.hypot(x - 100, y - 100) - 50);
        expect(Math.abs(off - half), brush.label).toBeLessThan(0.25);
        sides++;
      }
      expect(sides, brush.label).toBeGreaterThan(4);
    }
  });

  it("shows the next curve to the pointer, closed on the first point, and ended on the last", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "path";
    click(session, 10, 20);
    session.extend([{ x: 40, y: 20 }]);
    const shown = pixels(drawn(session));
    expect(shown[0]).toEqual({ x: 10, y: 20 });
    expect(shown.at(-1)).toEqual({ x: 40, y: 20 });
    expect(session.pathMarks?.nodes).toEqual([{ x: 10, y: 20, onGrid: false }]);
    click(session, 40, 20);
    session.extend([{ x: 11, y: 21 }]);
    expect(pixels(drawn(session)).at(-1)).toEqual({ x: 10, y: 20 });
    expect(session.pathMarks?.target).toEqual({ kind: "point", index: 0 });
    session.extend([{ x: 41, y: 20 }]);
    expect(pixels(drawn(session)).at(-1)).toEqual({ x: 40, y: 20 });
    // A click there ends it: no curve to the pointer is left.
    click(session, 41, 20);
    expect(session.placing).toBe(false);
    expect(session.pathMarks).toBeUndefined();
    expect(pixels(session.document.strokes[0])).toHaveLength(31);
  });

  it("closes on its first point, filled with Fill on, as the polygon's fill and line", () => {
    for (const fill of [false, true]) {
      const session = new DrawingSession(emptyDocument);
      session.shape = "path";
      session.fill = fill;
      click(session, 10, 50);
      drag(session, { x: 60, y: 50 }, { x: 60, y: 80 });
      click(session, 10, 50);
      const { strokes } = session.document;
      const line = strokes.at(-1);
      expect(line).not.toHaveProperty("kind");
      const points = pixels(line);
      expect(points[0]).toEqual({ x: 10, y: 50 });
      expect(points.at(-1)).toEqual({ x: 10, y: 50 });
      if (!fill) {
        expect(strokes).toHaveLength(1);
        continue;
      }
      expect(strokes).toHaveLength(2);
      expect(strokes[0]).toEqual({
        tool: "pen",
        points: line?.points,
        kind: "fill",
      });
      // The pointed oval it closes holds its middle.
      expect(covers(strokes[0]?.points ?? [], 50 * 16, 50 * 16)).toBe(true);
      session.undo();
      expect(session.document.strokes).toEqual([]);
    }
  });

  it("fills nothing open, and leaves a dot for a point clicked twice", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "path";
    session.fill = true;
    click(session, 10, 50);
    drag(session, { x: 60, y: 50 }, { x: 60, y: 80 });
    session.end();
    expect(session.document.strokes).toHaveLength(1);
    expect(session.document.strokes[0]?.kind).toBeUndefined();
    click(session, 30, 30);
    click(session, 30, 30);
    expect(session.document.strokes[1]).toEqual({
      tool: "pen",
      size: 192,
      points: [480, 480],
    });
  });

  it("puts points and handles on the grid with Shift, and cuts its ends there with Flat ends", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.shape = "path";
    // From a row, out to the right and down to the baseline, coming in
    // straight down: an end cut down there, with Flat ends on.
    const ends = (flat: boolean) => {
      session.flatEnds = flat;
      drag(session, { x: 33, y: 63 }, { x: 62, y: 66 }, true);
      drag(session, { x: 95, y: 143 }, { x: 97, y: 170 }, true);
      click(session, 95, 143, true);
      return session.document.strokes.at(-1);
    };
    const round = ends(false);
    expect(round).not.toHaveProperty("cut");
    const points = pixels(round);
    expect(points[0]).toEqual({ x: 32, y: 64 });
    expect(points.at(-1)).toEqual({ x: 96, y: 144 });
    const cut = ends(true);
    expect(cut?.points).toEqual(round?.points);
    expect(cut).toMatchObject({ cut: { end: "down" } });
    expect(cut?.cut).not.toHaveProperty("start");
    // With the grid off, Flat ends cuts nothing.
    session.snap = false;
    drag(session, { x: 32, y: 64 }, { x: 64, y: 64 });
    drag(session, { x: 96, y: 144 }, { x: 96, y: 176 });
    click(session, 96, 144);
    expect(session.document.strokes.at(-1)).not.toHaveProperty("cut");
  });

  it("shows its ends cut as Flat ends is while it is placed", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.shape = "path";
    click(session, 96, 64, true);
    click(session, 96, 144, true);
    session.extend([{ x: 96, y: 144 }], true);
    expect(drawn(session)).not.toHaveProperty("cut");
    session.flatEnds = true;
    expect(drawn(session)?.cut).toEqual({ start: "up", end: "down" });
    session.end();
    expect(session.document.strokes[0]?.cut).toEqual({
      start: "up",
      end: "down",
    });
  });

  it("keeps a handle's end where Shift last put it when Shift is let go just before the button", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.shape = "path";
    click(session, 32, 64, true);
    session.begin({ x: 96, y: 64 }, true);
    session.extend([{ x: 113, y: 70 }], true);
    session.end({ x: 113, y: 70 }, false);
    expect(session.pathMarks?.nodes.at(-1)).toEqual({
      x: 96,
      y: 64,
      handle: { x: 16, y: 0 },
      onGrid: true,
    });
  });

  it("takes back a point or a move with undoCorner, and the path with its first point", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "path";
    click(session, 10, 20);
    drag(session, { x: 40, y: 20 }, { x: 50, y: 20 });
    // The smooth point moved down, and that move taken back.
    drag(session, { x: 40, y: 20 }, { x: 40, y: 40 });
    expect(session.pathMarks?.nodes.at(-1)).toMatchObject({ x: 40, y: 40 });
    expect(session.undoCorner()).toBe(true);
    expect(session.pathMarks?.nodes.at(-1)).toMatchObject({ x: 40, y: 20 });
    expect(session.undoCorner()).toBe(true);
    expect(session.undoCorner()).toBe(true);
    expect(session.placing).toBe(false);
    expect(session.undoCorner()).toBe(false);
    expect(session.document.strokes).toEqual([]);
    // Undo after it ends takes back the whole path.
    click(session, 10, 20);
    click(session, 40, 20);
    click(session, 40, 20);
    expect(session.document.strokes).toHaveLength(1);
    expect(session.undoCorner()).toBe(false);
    expect(session.undo()).toBe(true);
    expect(session.document.strokes).toEqual([]);
  });

  it("drops a path on cancel and on clear, and takes a brush chosen while it is placed", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "path";
    click(session, 10, 20);
    session.cancel();
    expect(session.placing).toBe(false);
    click(session, 10, 20);
    click(session, 30, 20);
    session.clear();
    expect(session.placing).toBe(false);
    expect(session.document.strokes).toEqual([]);
    click(session, 10, 20);
    session.tool = "eraser";
    session.sizeIndex = 3;
    expect(drawn(session)).toMatchObject({ tool: "pen", size: 192 });
    session.rebrush();
    expect(drawn(session)).toMatchObject({ tool: "eraser", size: 384 });
    click(session, 40, 20);
    click(session, 40, 20);
    expect(session.document.strokes[0]).toMatchObject({
      tool: "eraser",
      size: 384,
    });
    expect(session.document.strokes[0]).not.toHaveProperty("kind");
  });

  it("commits with the points it has when it ends without a release, as on saving", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "path";
    click(session, 10, 20);
    // A handle being dragged out from the second point, when Save comes.
    session.begin({ x: 40, y: 20 });
    session.extend([{ x: 40, y: 40 }]);
    session.end();
    expect(session.placing).toBe(false);
    const points = pixels(session.document.strokes[0]);
    expect(points.at(-1)).toEqual({ x: 40, y: 20 });
    // Its handle bowed the curve up from the straight line.
    expect(Math.min(...points.map(({ y }) => y))).toBeLessThan(19);
  });

  it("keeps its points where they were when a save moves the drawing", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "path";
    click(session, 10, 20);
    session.extend([{ x: 40, y: 20 }]);
    session.rebase(-5);
    expect(session.pathMarks?.nodes).toEqual([{ x: 5, y: 20, onGrid: false }]);
    expect(pixels(drawn(session)).at(-1)).toEqual({ x: 35, y: 20 });
    click(session, 35, 20);
    click(session, 35, 20);
    const points = pixels(session.document.strokes[0]);
    expect(points[0]).toEqual({ x: 5, y: 20 });
    expect(points.at(-1)).toEqual({ x: 35, y: 20 });
  });

  it("keeps the grid it started on until it ends", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.shape = "path";
    click(session, 33, 63, true);
    session.grid = finerGrid(plainGrid);
    click(session, 41, 63, true);
    expect(session.pathMarks?.nodes.at(-1)).toMatchObject({ x: 48, y: 64 });
    session.end();
    click(session, 41, 63, true);
    expect(session.pathMarks?.nodes.at(-1)).toMatchObject({ x: 40, y: 64 });
  });
});
