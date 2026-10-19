import { describe, expect, it } from "vitest";
import {
  decodeDraft,
  draftKey,
  encodeDraft,
  restoreDraft,
} from "../../../src/editor/drafts.ts";
import type { InkDocument } from "../../../src/ink/document.ts";

const png = Uint8Array.of(137, 80, 78, 71);
const stroke = {
  tool: "pen",
  size: 256,
  pressure: false,
  points: [16, 32],
} as const;

describe("draftKey", () => {
  it("tells files apart from new symbols", () => {
    expect(draftKey({ file: "a.ink.png" })).toBe(
      "inkline-draft:file:a.ink.png",
    );
    expect(draftKey({ newIn: "a.md" })).toBe("inkline-draft:new:a.md");
  });
});

describe("drafts", () => {
  it("round-trip strokes, and whether the base layer was cleared", () => {
    const withBase: InkDocument = {
      strokes: [stroke],
      base: { x: 0, y: 0, scale: 1, png },
    };
    const stored: unknown = JSON.parse(
      JSON.stringify(encodeDraft(withBase, 5)),
    );
    expect(decodeDraft(stored)).toEqual({
      strokes: [stroke],
      baseCleared: false,
      savedAt: 5,
    });
    expect(JSON.stringify(stored)).not.toContain("png");
  });

  it("restore onto the file's own base layer unless it was cleared", () => {
    const original: InkDocument = {
      strokes: [],
      base: { x: 0, y: 0, scale: 1, png },
    };
    expect(
      restoreDraft(original, {
        strokes: [stroke],
        baseCleared: false,
        savedAt: 0,
      }),
    ).toEqual({
      strokes: [stroke],
      base: original.base,
    });
    expect(
      restoreDraft(original, {
        strokes: [stroke],
        baseCleared: true,
        savedAt: 0,
      }),
    ).toEqual({
      strokes: [stroke],
    });
  });

  it("refuse stored values that are not drafts", () => {
    expect(decodeDraft(null)).toBeUndefined();
    expect(decodeDraft("text")).toBeUndefined();
    expect(
      decodeDraft({ strokes: [], baseCleared: "no", savedAt: 0 }),
    ).toBeUndefined();
    expect(
      decodeDraft({
        strokes: [{ tool: "brush" }],
        baseCleared: false,
        savedAt: 0,
      }),
    ).toBeUndefined();
  });
});
