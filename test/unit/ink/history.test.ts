import { describe, expect, it } from "vitest";
import { History } from "../../../src/ink/history.ts";

describe("History", () => {
  it("undoes and redoes in order", () => {
    const history = new History("a");
    history.push("b");
    history.push("c");
    expect(history.undo()).toBe("b");
    expect(history.undo()).toBe("a");
    expect(history.undo()).toBeUndefined();
    expect(history.present).toBe("a");
    expect(history.redo()).toBe("b");
    expect(history.redo()).toBe("c");
    expect(history.redo()).toBeUndefined();
    expect(history.present).toBe("c");
  });

  it("forgets what could be redone after a new change", () => {
    const history = new History(0);
    history.push(1);
    history.undo();
    history.push(2);
    expect(history.canRedo).toBe(false);
    expect(history.undo()).toBe(0);
  });

  it("keeps at most the limit of states to undo to", () => {
    const history = new History(0, 2);
    for (const state of [1, 2, 3]) history.push(state);
    expect(history.undo()).toBe(2);
    expect(history.undo()).toBe(1);
    expect(history.canUndo).toBe(false);
  });

  it("reports what it can do", () => {
    const history = new History("start");
    expect([history.canUndo, history.canRedo]).toEqual([false, false]);
    history.push("next");
    expect([history.canUndo, history.canRedo]).toEqual([true, false]);
    history.undo();
    expect([history.canUndo, history.canRedo]).toEqual([false, true]);
  });

  it("refuses a limit below 1", () => {
    expect(() => new History(0, 0)).toThrow();
    expect(() => new History(0, 1.5)).toThrow();
  });
});
