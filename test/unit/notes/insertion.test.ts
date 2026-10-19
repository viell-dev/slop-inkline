import { describe, expect, it } from "vitest";
import { capturePoint, findPoint } from "../../../src/notes/insertion.ts";

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
