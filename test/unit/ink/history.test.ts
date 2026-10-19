import { describe, expect, it } from "vitest";
import { History } from "../../../src/ink/history.ts";

describe("History", () => {
  it("undoes and redoes in order", () => {
    const history = new History("a");
    history.push("b");
    history.push("c");
    expect([history.undo(), history.present]).toEqual([true, "b"]);
    expect([history.undo(), history.present]).toEqual([true, "a"]);
    expect([history.undo(), history.present]).toEqual([false, "a"]);
    expect([history.redo(), history.present]).toEqual([true, "b"]);
    expect([history.redo(), history.present]).toEqual([true, "c"]);
    expect([history.redo(), history.present]).toEqual([false, "c"]);
  });

  it("forgets what could be redone after a new change", () => {
    const history = new History(0);
    history.push(1);
    history.undo();
    history.push(2);
    expect(history.canRedo).toBe(false);
    history.undo();
    expect(history.present).toBe(0);
  });

  it("keeps at most the limit of states to undo to", () => {
    const history = new History(0, 2);
    for (const state of [1, 2, 3]) history.push(state);
    history.undo();
    history.undo();
    expect(history.present).toBe(1);
    expect(history.canUndo).toBe(false);
  });

  it("keeps undefined as a state like any other", () => {
    const history = new History<string | undefined>(undefined);
    history.push("drawn");
    expect(history.undo()).toBe(true);
    expect(history.present).toBeUndefined();
    expect(history.canRedo).toBe(true);
    expect(history.redo()).toBe(true);
    expect(history.present).toBe("drawn");
  });

  it("reports what it can do", () => {
    const history = new History("start");
    expect([history.canUndo, history.canRedo]).toEqual([false, false]);
    history.push("next");
    expect([history.canUndo, history.canRedo]).toEqual([true, false]);
    history.undo();
    expect([history.canUndo, history.canRedo]).toEqual([false, true]);
  });

  it("maps every state, keeping repeated states one state", () => {
    const shared = { n: 1 };
    const history = new History(shared);
    history.push({ n: 2 });
    history.push(shared);
    history.undo();
    history.map((state) => ({ n: state.n * 10 }));
    expect(history.present).toEqual({ n: 20 });
    history.redo();
    const last = history.present;
    history.undo();
    history.undo();
    expect(history.present).toBe(last);
    expect(last).toEqual({ n: 10 });
  });

  it("refuses a limit below 1", () => {
    expect(() => new History(0, 0)).toThrow();
    expect(() => new History(0, 1.5)).toThrow();
  });
});
