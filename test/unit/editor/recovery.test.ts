import { describe, expect, it } from "vitest";
import type { Draft } from "../../../src/editor/drafts.ts";
import {
  findOrphans,
  folderOf,
  recoveredName,
  recoveryQuestion,
  unopenedText,
  type Unopened,
} from "../../../src/editor/recovery.ts";

const stroke = { tool: "pen", size: 256, points: [16, 32] } as const;

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: "a",
    target: { kind: "file", path: "Runes/tower.ink.png" },
    strokes: [stroke],
    base: { kind: "none" },
    savedAt: 1000,
    ...overrides,
  };
}

const gone: Unopened = { kind: "gone" };
const damaged: Unopened = {
  kind: "unreadable",
  reason: "its strokes cannot be read",
};

describe("findOrphans", () => {
  it("finds the drafts of files that are gone or do not open, in order", async () => {
    const states: Record<string, Unopened | undefined> = {
      "Runes/tower.ink.png": gone,
      "Runes/gate.ink.png": damaged,
      "Runes/door.ink.png": undefined,
    };
    const asked: string[] = [];
    const drafts = [
      draft({ id: "tower" }),
      draft({
        id: "door",
        target: { kind: "file", path: "Runes/door.ink.png" },
      }),
      draft({ id: "new", target: { kind: "new", note: "Notes/a.md" } }),
      draft({
        id: "gate",
        target: { kind: "file", path: "Runes/gate.ink.png" },
      }),
      draft({ id: "tower again" }),
    ];
    const orphans = await findOrphans(drafts, (path) => {
      asked.push(path);
      return Promise.resolve(states[path]);
    });
    expect(
      orphans.map(({ draft: { id }, path, unopened }) => [id, path, unopened]),
    ).toEqual([
      ["tower", "Runes/tower.ink.png", gone],
      ["gate", "Runes/gate.ink.png", damaged],
      ["tower again", "Runes/tower.ink.png", gone],
    ]);
    // Once for each file, and never for a new symbol's note.
    expect(asked).toEqual([
      "Runes/tower.ink.png",
      "Runes/door.ink.png",
      "Runes/gate.ink.png",
    ]);
  });

  it("finds none when every file opens", async () => {
    expect(
      await findOrphans([draft()], () => Promise.resolve(undefined)),
    ).toEqual([]);
  });
});

describe("folderOf", () => {
  it("gives a path's folder, or the vault's top", () => {
    expect(folderOf("Runes/Old/tower.ink.png")).toBe("Runes/Old");
    expect(folderOf("tower.ink.png")).toBe("");
  });
});

describe("recoveredName", () => {
  const none = (): boolean => false;

  it("starts with the name typed in the draft, as typed", () => {
    expect(
      recoveredName(draft({ name: " the gate " }), "a.ink.png", none),
    ).toBe(" the gate ");
    // Even one the folder has: saving says so, and the name can change.
    expect(
      recoveredName(draft({ name: "gate" }), "Runes/tower.ink.png", () => true),
    ).toBe("gate");
  });

  it("starts with the file's own name, unless its folder has a symbol of it", () => {
    const asked: string[] = [];
    const taken = (name: string): boolean => {
      asked.push(name);
      return name === "gate";
    };
    expect(recoveredName(draft(), "Runes/tower.ink.png", taken)).toBe("tower");
    expect(recoveredName(draft(), "Runes/gate.ink.png", taken)).toBeUndefined();
    expect(recoveredName(draft(), "001.INK.PNG", taken)).toBe("001");
    expect(asked).toEqual(["tower", "gate", "001"]);
  });
});

describe("unopenedText", () => {
  it("says why a draft is listed", () => {
    expect(unopenedText(gone)).toBe("Deleted or moved");
    expect(unopenedText(damaged)).toBe(
      "Does not open: its strokes cannot be read",
    );
  });
});

describe("recoveryQuestion", () => {
  it("says what happened to the file, and where the new symbol goes", () => {
    expect(
      recoveryQuestion(
        { draft: draft(), path: "Runes/tower.ink.png", unopened: gone },
        "today",
      ),
    ).toEqual({
      title: "Open the unsaved drawing as a new symbol?",
      content:
        "tower.ink.png is no longer in the vault, but Inkline kept unsaved changes to it from today. They can open in a new symbol, saved in Runes.",
    });
    expect(
      recoveryQuestion(
        { draft: draft(), path: "tower.ink.png", unopened: damaged },
        "today",
      ).content,
    ).toBe(
      "tower.ink.png does not open: its strokes cannot be read. Inkline kept unsaved changes to it from today. They can open in a new symbol, saved in the vault's top folder, and tower.ink.png stays as it is.",
    );
  });

  it("ends the reason with one full stop", () => {
    const { content } = recoveryQuestion(
      {
        draft: draft(),
        path: "tower.ink.png",
        unopened: { kind: "unreadable", reason: "the file ends early." },
      },
      "today",
    );
    expect(content).toMatch(
      /^tower\.ink\.png does not open: the file ends early\. Inkline/,
    );
  });

  it("says when the drawing's base layer does not come back", () => {
    const question = (base: Draft["base"]): string =>
      recoveryQuestion(
        { draft: draft({ base }), path: "tower.ink.png", unopened: gone },
        "today",
      ).content;
    expect(question({ kind: "file" })).toMatch(
      / Its base layer was in that file, so only its strokes would come back\.$/,
    );
    expect(question({ kind: "lost" })).toMatch(
      / Its base layer cannot be read, so only its strokes would come back\.$/,
    );
    const png = new Uint8Array([1]);
    expect(
      question({
        kind: "kept",
        layer: { x: 0, y: 0, width: 32, height: 32, png },
      }),
    ).toMatch(/saved in the vault's top folder\.$/);
  });
});
