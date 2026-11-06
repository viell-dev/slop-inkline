import { describe, expect, it } from "vitest";
import {
  capturePoint,
  findPoint,
  lineAtEnd,
  positionAfter,
  replacedBefore,
  sameText,
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

describe("findPoint across line endings", () => {
  const lf = "first\nleft  right\nlast\n";
  const crlf = lf.replaceAll("\n", "\r\n");
  const at = (text: string) => text.indexOf("  right") + 1;

  it("finds a position taken with \\n in text with \\r\\n, and the reverse", () => {
    expect(findPoint(crlf, capturePoint(lf, at(lf)))).toBe(at(crlf));
    expect(findPoint(lf, capturePoint(crlf, at(crlf)))).toBe(at(lf));
  });

  it("still follows the text when the note also changed", () => {
    const moved = `A new first line.\r\n${crlf}`;
    expect(findPoint(moved, capturePoint(lf, at(lf)))).toBe(at(moved));
    const back = `A new first line.\n${lf}`;
    expect(findPoint(back, capturePoint(crlf, at(crlf)))).toBe(at(back));
    // From one side, where only the other side's text changed.
    const left = crlf.replace("right\r\nlast", "other");
    expect(findPoint(left, capturePoint(lf, at(lf)))).toBe(at(crlf));
  });

  it("reads the same place in text that repeats", () => {
    const repeats = "ab\nab\nab\n";
    const windows = repeats.replaceAll("\n", "\r\n");
    expect(findPoint(windows, capturePoint(repeats, 4))).toBe(5);
    expect(findPoint(repeats, capturePoint(windows, 5))).toBe(4);
  });

  it("keeps a position at a line's end before all of its line break", () => {
    const end = "first".length;
    expect(findPoint(crlf, capturePoint(lf, end))).toBe(end);
    expect(findPoint(crlf, capturePoint(crlf, end))).toBe(end);
    // And one at a line's start after all of it.
    const start = end + 1;
    expect(findPoint(crlf, capturePoint(lf, start))).toBe(end + 2);
    expect(findPoint(lf, capturePoint(crlf, end + 2))).toBe(start);
  });

  it("works at the start and the end of the text", () => {
    expect(findPoint(crlf, capturePoint(lf, 0))).toBe(0);
    expect(findPoint(crlf, capturePoint(lf, lf.length))).toBe(crlf.length);
    expect(findPoint(lf, capturePoint(crlf, crlf.length))).toBe(lf.length);
  });

  it("reads a file with both kinds of line break, or a bare \\r", () => {
    const mixed = "first\r\nleft  right\nlast\r\n";
    expect(findPoint(mixed, capturePoint(lf, at(lf)))).toBe(at(mixed));
    const bare = "first\rleft  right\rlast\r";
    expect(findPoint(bare, capturePoint(lf, at(lf)))).toBe(at(bare));
    expect(findPoint(lf, capturePoint(bare, at(bare)))).toBe(at(lf));
  });

  it("gives a place that leaves the rest of the text as it was", () => {
    const place = findPoint(crlf, capturePoint(lf, at(lf)));
    if (place === undefined) throw new Error("not found");
    expect(crlf.slice(0, place) + "X" + crlf.slice(place)).toBe(
      "first\r\nleft X right\r\nlast\r\n",
    );
  });

  it("follows a rename whatever the line breaks", () => {
    const was = "![[001.ink.png]]";
    const now = "![[the gate.ink.png]]";
    const before = `first\r\n${was} and on.\r\n`;
    const point = capturePoint(before, before.indexOf(" and on."));
    const after = before.replace(was, now).replaceAll("\r\n", "\n");
    expect(findPoint(after, replacedBefore(point, was, now))).toBe(
      after.indexOf(" and on."),
    );
  });
});

describe("sameText", () => {
  it("reads text the same whichever line breaks it has", () => {
    expect(sameText("one\ntwo\n", "one\r\ntwo\r\n")).toBe(true);
    expect(sameText("one\rtwo", "one\ntwo")).toBe(true);
  });

  it("tells apart text that differs in anything else", () => {
    expect(sameText("one\ntwo", "one\ntwo\n")).toBe(false);
    expect(sameText("one two", "one\ntwo")).toBe(false);
  });
});

describe("lineAtEnd", () => {
  it("adds what a line of its own needs, in the text's own line break", () => {
    expect(lineAtEnd("")).toEqual({ before: "", after: "\n" });
    expect(lineAtEnd("one")).toEqual({ before: "\n", after: "\n" });
    expect(lineAtEnd("one\ntwo\n")).toEqual({ before: "", after: "\n" });
    expect(lineAtEnd("one\ntwo")).toEqual({ before: "\n", after: "\n" });
    expect(lineAtEnd("one\r\ntwo\r\n")).toEqual({
      before: "",
      after: "\r\n",
    });
    expect(lineAtEnd("one\r\ntwo")).toEqual({
      before: "\r\n",
      after: "\r\n",
    });
    expect(lineAtEnd("one\rtwo\r")).toEqual({ before: "", after: "\r" });
  });

  it("follows the last line break of a file with both kinds", () => {
    expect(lineAtEnd("one\r\ntwo\nthree").after).toBe("\n");
    expect(lineAtEnd("one\ntwo\r\nthree").after).toBe("\r\n");
  });
});

describe("positionAfter", () => {
  it("moves along the line for text on one line", () => {
    expect(positionAfter({ line: 3, ch: 5 }, "abc")).toEqual({
      line: 3,
      ch: 8,
    });
    expect(positionAfter({ line: 3, ch: 5 }, "")).toEqual({ line: 3, ch: 5 });
  });

  it("goes to the last line of text with line breaks", () => {
    expect(positionAfter({ line: 3, ch: 5 }, "\nabc")).toEqual({
      line: 4,
      ch: 3,
    });
    expect(positionAfter({ line: 3, ch: 5 }, "ab\n\nc")).toEqual({
      line: 5,
      ch: 1,
    });
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
