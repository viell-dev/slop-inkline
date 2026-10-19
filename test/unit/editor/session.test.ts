import { describe, expect, it } from "vitest";
import { DrawingSession, brushSizes } from "../../../src/editor/session.ts";
import { emptyDocument } from "../../../src/ink/document.ts";

describe("brushSizes", () => {
  it("run from 1 to 4 px at a 16 px font", () => {
    expect(brushSizes.map((size) => size.em * 16)).toEqual([1, 2, 3, 4]);
  });
});

describe("DrawingSession", () => {
  it("commits a stroke with the current brush, in units", () => {
    const session = new DrawingSession(emptyDocument);
    session.sizeIndex = 2;
    session.begin({ x: 10, y: 20 });
    session.extend([{ x: 10.5, y: 21 }]);
    session.end();
    expect(session.document.strokes).toEqual([
      { tool: "pen", size: 384, pressure: false, points: [160, 320, 168, 336] },
    ]);
  });

  it("records pressure from devices that report it", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0, pressure: 0.25 });
    session.extend([{ x: 1, y: 0, pressure: 1 }]);
    session.end();
    expect(session.document.strokes[0]).toMatchObject({
      pressure: true,
      points: [0, 0, 64, 16, 0, 255],
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

  it("fills gaps longer than 2 px along the straight line, pressure included", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0, pressure: 0 });
    session.extend([{ x: 10, y: 0, pressure: 1 }]);
    session.end();
    expect(session.document.strokes[0]?.points).toEqual([
      0, 0, 0, 32, 0, 51, 64, 0, 102, 96, 0, 153, 128, 0, 204, 160, 0, 255,
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

  it("uses the tool a device asks for", () => {
    const session = new DrawingSession(emptyDocument);
    session.begin({ x: 0, y: 0 }, "eraser");
    session.end();
    expect(session.document.strokes[0]?.tool).toBe("eraser");
    expect(session.tool).toBe("pen");
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

  it("does not record clearing an empty drawing", () => {
    const session = new DrawingSession(emptyDocument);
    session.clear();
    expect(session.canUndo).toBe(false);
  });
});
