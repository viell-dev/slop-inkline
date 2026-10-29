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
} from "../../../src/editor/session.ts";
import type { Grid } from "../../../src/editor/guides.ts";
import { emptyDocument } from "../../../src/ink/document.ts";

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
    expect(session.activeStroke).toMatchObject({ tool: "pen", size: 96 });
    session.end();
    session.tool = "eraser";
    expect(session.sizeIndex).toBe(3);
    session.begin({ x: 0, y: 0 });
    expect(session.activeStroke).toMatchObject({ tool: "eraser", size: 384 });
    session.end();
  });

  it("commits a stroke with the current brush, in units", () => {
    const session = new DrawingSession(emptyDocument);
    session.sizeIndex = 2;
    session.begin({ x: 10, y: 20 });
    session.extend([{ x: 10.5, y: 21 }]);
    session.end();
    expect(session.document.strokes).toEqual([
      { tool: "pen", size: 288, pressure: false, points: [160, 320, 168, 336] },
    ]);
  });

  it("records new strokes without pressure, as the pointer gives none", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0 });
    session.extend([{ x: 1, y: 0 }]);
    session.end();
    expect(session.document.strokes[0]).toMatchObject({
      pressure: false,
      points: [0, 0, 16, 0],
    });
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
    expect(session.activeStroke?.points).toEqual([0, 0]);
    expect(session.drawing).toBe(true);
    session.cancel();
    expect(session.activeStroke).toBeUndefined();
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
      strokes: [{ tool: "pen", size: 16, pressure: false, points: [0, 0] }],
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
      base: { x: 0, y: 0, scale: 1, png },
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
    expect(bases[0]).toEqual({ x: -80, y: 0, scale: 1, png });
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
    const points = session.activeStroke?.points ?? [];
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

  it("starts and ends strokes on the grid when it is on", () => {
    expect(plainGrid.spacing).toBe(16);
    expect(plainGrid.rows).toHaveLength(13);
    expect(snapToGrid({ x: 7, y: 9 })).toEqual({ x: 0, y: 16 });
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 20, y: 18 }]);
    session.end();
    const points = session.document.strokes[0]?.points ?? [];
    expect(points.slice(0, 2)).toEqual([0, 256]);
    expect(points.slice(-2)).toEqual([256, 256]);
    // A straight segment's end follows the grid as it is drawn.
    session.begin({ x: 0, y: 0 });
    session.extend([{ x: 25, y: 2 }], true);
    expect(session.activeStroke?.points.slice(-2)).toEqual([512, 0]);
  });

  it("records a tap on the grid as one point, with the pen or the eraser", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 7, y: 9 });
    session.end({ x: 7, y: 9 });
    session.begin({ x: 7, y: 9 });
    session.end({ x: 7.4, y: 9.2 });
    session.tool = "eraser";
    session.begin({ x: 7, y: 9 });
    session.end({ x: 7, y: 9 });
    expect(session.document.strokes.map((stroke) => stroke.points)).toEqual([
      [0, 256],
      [0, 256],
      [0, 256],
    ]);
  });

  it("keeps the grid's place in the drawing when a save moves it", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 7, y: 9 });
    session.end({ x: 7, y: 9 });
    // A save cropped 5 pixels on the left, so everything moves left by 5.
    session.rebase(-5);
    expect(session.gridOrigin).toBe(11);
    // The same place on screen is now 5 pixels further left.
    session.begin({ x: 2, y: 9 });
    session.end({ x: 2, y: 9 });
    const [first, second] = session.document.strokes;
    expect(second?.points).toEqual(first?.points);
    expect(first?.points).toEqual([-80, 256]);
  });

  it("keeps a straight segment on the grid through a save", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 0, y: 0 });
    session.extend([{ x: 20, y: 2 }], true);
    expect(session.activeStroke?.points.slice(-2)).toEqual([256, 0]);
    session.rebase(-5);
    session.extend([{ x: 15, y: 2 }], true);
    expect(session.activeStroke?.points.slice(-2)).toEqual([176, 0]);
  });

  it("lines the grid up with where an opened drawing's strokes end", () => {
    const stroke = (pressure: boolean, ...xs: number[]) => ({
      tool: "pen" as const,
      size: 16,
      pressure,
      points: xs.flatMap((x) => (pressure ? [x, 0, 128] : [x, 0])),
    });
    expect(gridOriginOf(emptyDocument)).toBe(0);
    // With no end shared, where the first stroke starts: 145.5 and -2.5
    // pixels.
    expect(gridOriginOf({ strokes: [stroke(false, 2328, 100)] })).toBe(1.5);
    expect(gridOriginOf({ strokes: [stroke(false, -40)] })).toBe(13.5);
    // A first stroke drawn without the grid, 6.25 and 14.5 pixels into a
    // spacing, then one on the grid, both ends 1.5 pixels into one.
    expect(
      gridOriginOf({
        strokes: [stroke(false, 100, 1000), stroke(true, 280, 300, 536)],
      }),
    ).toBe(1.5);
    const session = new DrawingSession({ strokes: [stroke(false, 2328)] });
    session.snap = true;
    // Nearest to 161.5, one spacing on from the first stroke's start.
    session.begin({ x: 160, y: 0 });
    session.end();
    expect(session.document.strokes[1]?.points).toEqual([2328 + 256, 0]);
  });

  it("picks the most shared place for the grid, the first of a tie", () => {
    const stroke = (...xs: number[]) => ({
      tool: "pen" as const,
      size: 16,
      pressure: false,
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
      ({ tool: "pen", size: 16, pressure: false, points: [x, 0] }) as const;
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
    session.begin({ x: 22, y: 43 });
    session.end({ x: 41, y: 140 });
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
    session.begin({ x: 100, y: 100 });
    session.grid = after;
    expect(session.grid).toBe(before);
    session.end({ x: 100, y: 100 });
    expect(session.document.strokes[0]?.points).toEqual([
      102.5 * 16,
      102.5 * 16,
    ]);
    // Then the grid laid out meanwhile takes over.
    expect(session.grid).toBe(after);
    session.begin({ x: 100, y: 100 });
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
        pressure: false,
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
    session.begin({ x: 100, y: 0 });
    session.end();
    expect(session.document.strokes.at(-1)?.points).toEqual([96 * 16, 0]);
    session.grid = { spacing: 10, rows: [0] };
    expect(session.gridOrigin).toBe(2);
  });

  it("does not record clearing an empty drawing", () => {
    const session = new DrawingSession(emptyDocument);
    session.clear();
    expect(session.canUndo).toBe(false);
  });
});

describe("gridCuts", () => {
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

  it("cuts a shallow end across its column", () => {
    expect(gridCuts([0, 0, 160, 16], reach, both)).toEqual({
      start: "left",
      end: "right",
    });
    expect(gridCuts([160, 16, 0, 0], reach, both)).toEqual({
      start: "right",
      end: "left",
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
    expect(gridCuts([0, 0, 0, 160, 0, 0], 192, both)).toEqual({
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
  it("cuts the ends of a stroke drawn on the grid, and not one drawn off it", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 0, y: 16 });
    session.extend([{ x: 1, y: 80 }]);
    // While it is drawn, only its start is on the grid.
    expect(session.activeStroke?.cut).toEqual({ start: "up" });
    session.end({ x: 0, y: 144 });
    expect(session.document.strokes[0]?.cut).toEqual({
      start: "up",
      end: "down",
    });
    session.snap = false;
    session.begin({ x: 0, y: 16 });
    session.extend([{ x: 1, y: 80 }]);
    session.end({ x: 0, y: 144 });
    expect(session.document.strokes[1]).not.toHaveProperty("cut");
  });

  it("cuts both ends of a short stroke drawn out and back on the grid", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 64, y: 64 });
    session.extend([{ x: 64, y: 74 }]);
    session.end({ x: 64, y: 64 });
    expect(session.document.strokes[0]?.cut).toEqual({
      start: "up",
      end: "up",
    });
  });

  it("cuts only the end of a stroke the grid came on for", () => {
    const session = new DrawingSession(emptyDocument);
    session.tool = "eraser";
    session.begin({ x: 3, y: 16 });
    session.extend([{ x: 60, y: 18 }]);
    session.snap = true;
    session.end({ x: 64, y: 17 });
    expect(session.document.strokes[0]?.cut).toEqual({ end: "right" });
  });

  it("keeps a stroke's cuts through undo and redo", () => {
    const session = new DrawingSession(emptyDocument);
    session.snap = true;
    session.begin({ x: 0, y: 16 });
    session.end({ x: 0, y: 144 });
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

  it("puts the box's corners on the grid, keeps Shift's circle, and draws a dot for a tap", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "ellipse";
    session.snap = true;
    session.tool = "eraser";
    session.begin({ x: 7, y: 9 });
    session.extend([{ x: 40, y: 20 }], true);
    // The release does not say Shift is held; the circle stays a circle.
    session.end({ x: 41, y: 21 });
    const [circle] = session.document.strokes;
    expect(circle?.tool).toBe("eraser");
    const xs = (circle?.points ?? []).filter((_, at) => at % 2 === 0);
    const ys = (circle?.points ?? []).filter((_, at) => at % 2 === 1);
    // From the grid point (0, 16) to (48, 64), 3 columns across.
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 768]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([256, 1024]);
    expect(circle).not.toHaveProperty("cut");
    session.begin({ x: 7, y: 9 });
    session.end({ x: 7, y: 9 });
    expect(session.document.strokes[1]?.points).toEqual([0, 256]);
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
      session.begin(from);
      session.end(to);
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

  it("leaves the grid where it was for a circle taller than the columns it was dragged across", () => {
    const grid = { spacing: 13.8125, rows: [0, 52, 75, 88.8125, 102.625] };
    const session = new DrawingSession(emptyDocument);
    session.grid = grid;
    session.shape = "ellipse";
    session.snap = true;
    // Leftwards one column and down three rows: the circle, as wide as it
    // is tall, reaches past the column it was dragged to.
    session.begin({ x: 41.4375, y: 52 });
    session.extend([{ x: 27.625, y: 102.625 }], true);
    session.end({ x: 27.625, y: 102.625 });
    const points = session.document.strokes[0]?.points ?? [];
    const xs = points.filter((_, at) => at % 2 === 0);
    expect(Math.min(...xs)).toBe(-147);
    expect([points[0], points.at(-2)]).toEqual([663, 663]);
    const reopened = new DrawingSession(session.document);
    reopened.grid = grid;
    expect(reopened.gridOrigin).toBe(0);
  });

  it("keeps a circle on the grid along its longer side, where rows and columns are spaced differently", () => {
    const session = new DrawingSession(emptyDocument);
    session.grid = { spacing: 13.8125, rows: [0, 52, 75, 88.8125, 102.625] };
    session.shape = "ellipse";
    session.snap = true;
    session.begin({ x: 0, y: 52 });
    session.extend([{ x: 41.4375, y: 75 }], true);
    session.end({ x: 41.4375, y: 75 });
    const points = session.document.strokes[0]?.points ?? [];
    const xs = points.filter((_, at) => at % 2 === 0);
    const ys = points.filter((_, at) => at % 2 === 1);
    // Three columns across, from the grid point it started on, and as tall,
    // which ends between rows: the circle stays a circle.
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 663]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([832, 1495]);
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

describe("DrawingSession's polygons", () => {
  /** Clicks at a point: a press and a release there. */
  const click = (session: DrawingSession, x: number, y: number): void => {
    session.begin({ x, y });
    session.end({ x, y });
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
    expect(session.activeStroke).toEqual({
      tool: "pen",
      size: 192,
      pressure: false,
      points: [160, 320, 640, 352],
      kind: "polygon",
    });
    click(session, 40, 20);
    click(session, 25, 50);
    // Near the first corner, the shape shows closed.
    session.extend([{ x: 12, y: 21 }]);
    expect(session.activeStroke?.points).toEqual([
      160, 320, 640, 320, 400, 800, 160, 320,
    ]);
    expect(session.document.strokes).toEqual([]);
    click(session, 12, 21);
    expect(session.placing).toBe(false);
    expect(session.document.strokes).toEqual([
      {
        tool: "pen",
        size: 192,
        pressure: false,
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
    expect(session.activeStroke?.points).toEqual([160, 320, 640, 320]);
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

  it("snaps corners to the grid, and cuts an open polygon's ends there but not a closed one's", () => {
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    session.snap = true;
    click(session, 1, 15);
    click(session, 31, 15);
    click(session, 33, 143);
    // In the last corner's cell, it snaps to that corner and ends there.
    click(session, 30, 140);
    expect(session.document.strokes[0]).toEqual({
      tool: "pen",
      size: 192,
      pressure: false,
      points: [0, 256, 512, 256, 512, 2304],
      kind: "polygon",
      cut: { start: "left", end: "down" },
    });
    click(session, 1, 15);
    click(session, 31, 15);
    click(session, 33, 47);
    click(session, 2, 17);
    expect(session.document.strokes[1]?.points).toEqual([
      0, 256, 512, 256, 512, 768, 0, 256,
    ]);
    expect(session.document.strokes[1]).not.toHaveProperty("cut");
  });

  it("cuts the ends that were put on the grid, whatever the grid is when the shape ends", () => {
    // From the independent review of #121.
    const session = new DrawingSession(emptyDocument);
    session.shape = "polygon";
    click(session, 10, 20);
    click(session, 40, 20);
    session.snap = true;
    session.end();
    expect(session.document.strokes[0]).not.toHaveProperty("cut");
    click(session, 1, 15);
    click(session, 31, 15);
    session.snap = false;
    session.end();
    expect(session.document.strokes[1]?.cut).toEqual({
      start: "left",
      end: "right",
    });
    // Hovering on the last corner, off the grid, shows no side to where the
    // grid would put the pointer, as a click there adds none.
    click(session, 10, 20);
    click(session, 40, 20);
    session.snap = true;
    session.extend([{ x: 40, y: 20 }]);
    expect(session.activeStroke?.points).toEqual([160, 320, 640, 320]);
    click(session, 40, 20);
    expect(session.document.strokes[2]?.points).toEqual([160, 320, 640, 320]);
    session.snap = false;
    // A corner off the grid is still clicked within the brush's radius once
    // the grid is on, so the shape closes on it.
    click(session, 10, 20);
    click(session, 40, 20);
    session.snap = true;
    click(session, 33, 47);
    click(session, 15, 22);
    expect(session.document.strokes[3]?.points).toEqual([
      160, 320, 640, 320, 512, 768, 160, 320,
    ]);
    expect(session.document.strokes[3]).not.toHaveProperty("cut");
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
    expect(session.activeStroke?.points).toEqual([160, 320, 640, 320]);
    click(session, 25, 50);
    expect(session.undoCorner()).toBe(true);
    expect(session.undoCorner()).toBe(true);
    expect(session.placing).toBe(false);
    expect(session.activeStroke).toBeUndefined();
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
    expect(session.activeStroke).toMatchObject({ tool: "pen", size: 192 });
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
    expect(session.activeStroke?.points).toEqual([80, 320, 560, 320]);
    click(session, 35, 20);
    click(session, 35, 20);
    expect(session.document.strokes[0]?.points).toEqual([80, 320, 560, 320]);
  });
});
