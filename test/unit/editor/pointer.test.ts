import { describe, expect, it } from "vitest";
import {
  PointerGate,
  type PointerSample,
} from "../../../src/editor/pointer.ts";

const first = (overrides: Partial<PointerSample> = {}): PointerSample => ({
  pointerId: 1,
  button: 0,
  buttons: 1,
  ...overrides,
});
const second = (overrides: Partial<PointerSample> = {}): PointerSample =>
  first({ pointerId: 2, ...overrides });

describe("PointerGate", () => {
  it("draws with the primary button and ignores the others", () => {
    const gate = new PointerGate();
    expect(gate.down(first({ button: 2, buttons: 2 }))).toBe(false);
    expect(gate.down(first({ button: 1, buttons: 4 }))).toBe(false);
    // A pen's eraser end draws nothing now that pens are not supported.
    expect(gate.down(first({ button: 5, buttons: 32 }))).toBe(false);
    expect(gate.down(first())).toBe(true);
  });

  it("lets one pointer draw at a time, whatever kind each is", () => {
    const gate = new PointerGate();
    expect(gate.down(first())).toBe(true);
    expect(gate.down(second())).toBe(false);
    expect(gate.owns(second())).toBe(false);
    expect(gate.owns(first())).toBe(true);
    expect(gate.release(second())).toBe(false);
    expect(gate.release(first())).toBe(true);
    expect(gate.active).toBeUndefined();
    expect(gate.down(second())).toBe(true);
    expect(gate.owns(second())).toBe(true);
  });

  it("stops drawing when its own button is released, even in a chord", () => {
    const gate = new PointerGate();
    gate.down(first());
    // Right button pressed as well, then the left released.
    expect(gate.holds(first({ buttons: 3 }))).toBe(true);
    expect(gate.holds(first({ buttons: 2 }))).toBe(false);
    expect(gate.holds(second({ buttons: 1 }))).toBe(false);
  });
});
