import { describe, expect, it } from "vitest";
import {
  capturePoint,
  findPoint,
  replacedBefore,
} from "../../../src/notes/insertion.ts";

const note = "The door is marked with  which means return.\n";
const at = note.indexOf("  which") + 1;

describe("findPoint", () => {
  it("keeps the position when the text is unchanged", () => {
    expect(findPoint(note, capturePoint(note, at))).toBe(at);
  });

  it("follows the position when text is added before it", () => {
    const point = capturePoint(note, at);
    const changed = `A new first line.\n${note}`;
    expect(findPoint(changed, point)).toBe(at + "A new first line.\n".length);
  });

  it("finds the position from one side when the other changed", () => {
    const point = capturePoint(note, at);
    expect(findPoint(note.replace("which means", "meaning"), point)).toBe(at);
    expect(findPoint(note.replace("The door", "A gate"), point)).toBe(at - 2);
  });

  it("gives up rather than guess between two equal places", () => {
    const point = capturePoint("ab", 1);
    expect(findPoint("xab ab", point)).toBeUndefined();
    // Text that repeats still matches where the point was after an edit
    // before it moved the point.
    expect(
      findPoint("ab" + "ababab", capturePoint("ababab", 3)),
    ).toBeUndefined();
  });

  it("gives up when the text around it is gone", () => {
    expect(
      findPoint("Something else.", capturePoint(note, at)),
    ).toBeUndefined();
  });

  it("works at the start and the end of a note", () => {
    expect(findPoint(note, capturePoint(note, 0))).toBe(0);
    expect(findPoint(note, capturePoint(note, note.length))).toBe(note.length);
    expect(findPoint("", capturePoint("", 0))).toBe(0);
  });
});

describe("replacedBefore", () => {
  it("finds a point again once the text just before it was replaced", () => {
    const was = "![[001.ink.png]]";
    const now = "![[the gate.ink.png]]";
    // At the end of a note, where nothing after the point tells it apart.
    const note = `Symbols: ${was}`;
    const point = capturePoint(note, note.length);
    const renamed = `Symbols: ${now}`;
    expect(findPoint(renamed, point)).toBeUndefined();
    expect(findPoint(renamed, replacedBefore(point, was, now))).toBe(
      renamed.length,
    );
    // In the middle, and with text before longer than the context.
    const long = `${"x".repeat(100)} ${was} and on.`;
    const middle = capturePoint(long, long.indexOf(" and on."));
    const moved = long.replace(was, now);
    expect(findPoint(moved, replacedBefore(middle, was, now))).toBe(
      moved.indexOf(" and on."),
    );
  });

  it("finds a point after text longer than the context it keeps", () => {
    const was = `![[${"a".repeat(80)}.ink.png]]`;
    const now = `![[${"b".repeat(80)}.ink.png]]`;
    const note = `Start ${was}`;
    const point = capturePoint(note, note.length);
    const renamed = `Start ${now}`;
    expect(findPoint(renamed, replacedBefore(point, was, now))).toBe(
      renamed.length,
    );
  });
});
