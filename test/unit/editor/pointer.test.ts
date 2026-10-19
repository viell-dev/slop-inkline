import { describe, expect, it } from "vitest";
import {
  PointerGate,
  reportsPressure,
  type PointerSample,
} from "../../../src/editor/pointer.ts";

const mouse = (overrides: Partial<PointerSample> = {}): PointerSample => ({
  pointerId: 1,
  pointerType: "mouse",
  button: 0,
  buttons: 1,
  ...overrides,
});
const pen = (overrides: Partial<PointerSample> = {}): PointerSample =>
  mouse({ pointerId: 2, pointerType: "pen", ...overrides });
const touch = (overrides: Partial<PointerSample> = {}): PointerSample =>
  mouse({ pointerId: 3, pointerType: "touch", ...overrides });

describe("PointerGate", () => {
  it("draws with the primary button and ignores the others", () => {
    const gate = new PointerGate();
    expect(gate.down(mouse({ button: 2, buttons: 2 }))).toBeUndefined();
    expect(gate.down(mouse({ button: 1, buttons: 4 }))).toBeUndefined();
    expect(gate.down(mouse())).toBe("brush");
  });

  it("lets one pointer draw at a time", () => {
    const gate = new PointerGate();
    expect(gate.down(mouse())).toBe("brush");
    expect(gate.down(touch())).toBeUndefined();
    expect(gate.owns(touch())).toBe(false);
    expect(gate.owns(mouse())).toBe(true);
    expect(gate.release(touch())).toBe(false);
    expect(gate.release(mouse())).toBe(true);
    expect(gate.active).toBeUndefined();
    expect(gate.down(touch())).toBe("brush");
  });

  it("erases with a pen's eraser end", () => {
    const gate = new PointerGate();
    expect(gate.down(pen({ button: 5, buttons: 32 }))).toBe("eraser");
    gate.release(pen());
    expect(gate.down(pen({ button: 0, buttons: 32 }))).toBe("eraser");
  });

  it("ignores touch once a pen has been seen, as from a resting palm", () => {
    const gate = new PointerGate();
    expect(gate.down(pen())).toBe("brush");
    gate.release(pen());
    expect(gate.down(touch())).toBeUndefined();
  });

  it("stops drawing when its own button is released, even in a chord", () => {
    const gate = new PointerGate();
    gate.down(mouse());
    // Right button pressed as well, then the left released.
    expect(gate.holds(mouse({ buttons: 3 }))).toBe(true);
    expect(gate.holds(mouse({ buttons: 2 }))).toBe(false);
    gate.release(mouse());
    gate.down(pen({ button: 5, buttons: 32 }));
    expect(gate.holds(pen({ buttons: 32 }))).toBe(true);
    expect(gate.holds(pen({ buttons: 1 }))).toBe(false);
    expect(gate.holds(mouse({ buttons: 32 }))).toBe(false);
  });

  it("does not take the eraser bit from a mouse", () => {
    const gate = new PointerGate();
    expect(gate.down(mouse({ button: 5, buttons: 32 }))).toBeUndefined();
  });
});

describe("reportsPressure", () => {
  it("is true only for pens", () => {
    expect(reportsPressure("pen")).toBe(true);
    expect(reportsPressure("mouse")).toBe(false);
    expect(reportsPressure("touch")).toBe(false);
  });
});
