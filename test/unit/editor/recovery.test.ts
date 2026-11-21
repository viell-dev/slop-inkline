import { describe, expect, it } from "vitest";
import type { Draft, DraftTarget } from "../../../src/editor/drafts.ts";
import {
  createdFile,
  findOrphans,
  folderOf,
  orphanName,
  orphanPlace,
  recoveredName,
  recoveryQuestion,
  whyListed,
  type Orphan,
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

/** A new symbol's draft started in Notes/Old.md, which is gone. */
function newOrphan(
  target: Partial<Extract<DraftTarget, { kind: "new" }>> = {},
  overrides: Partial<Draft> = {},
): Orphan {
  return {
    draft: draft({
      target: { kind: "new", note: "Notes/Old.md", ...target },
      ...overrides,
    }),
    path: "Notes/Old.md",
    unopened: gone,
  };
}

const made = { path: "Runes/007.ink.png", fingerprint: "ab" };

describe("findOrphans", () => {
  it("finds the drafts of files that are gone or do not open, and of new symbols whose note is gone, in order", async () => {
    const states: Record<string, Unopened | undefined> = {
      "Runes/tower.ink.png": gone,
      "Runes/gate.ink.png": damaged,
      "Runes/door.ink.png": undefined,
    };
    const asked: string[] = [];
    const notes: string[] = [];
    const drafts = [
      draft({ id: "tower" }),
      draft({
        id: "door",
        target: { kind: "file", path: "Runes/door.ink.png" },
      }),
      draft({ id: "new", target: { kind: "new", note: "Notes/a.md" } }),
      draft({ id: "lost note", target: { kind: "new", note: "Gone.md" } }),
      draft({
        id: "gate",
        target: { kind: "file", path: "Runes/gate.ink.png" },
      }),
      draft({ id: "tower again" }),
    ];
    const orphans = await findOrphans(
      drafts,
      (path) => {
        asked.push(path);
        return Promise.resolve(states[path]);
      },
      (path) => {
        notes.push(path);
        return path === "Gone.md";
      },
    );
    expect(
      orphans.map(({ draft: { id }, path, unopened }) => [id, path, unopened]),
    ).toEqual([
      ["tower", "Runes/tower.ink.png", gone],
      ["lost note", "Gone.md", gone],
      ["gate", "Runes/gate.ink.png", damaged],
      ["tower again", "Runes/tower.ink.png", gone],
    ]);
    // Once for each file, and only files; a new symbol's note is asked of
    // the other.
    expect(asked).toEqual([
      "Runes/tower.ink.png",
      "Runes/door.ink.png",
      "Runes/gate.ink.png",
    ]);
    expect(notes).toEqual(["Notes/a.md", "Gone.md"]);
  });

  it("finds none when every file opens and every note is there", async () => {
    expect(
      await findOrphans(
        [draft(), draft({ target: { kind: "new", note: "a.md" } })],
        () => Promise.resolve(undefined),
        () => false,
      ),
    ).toEqual([]);
  });
});

describe("folderOf", () => {
  it("gives a path's folder, or the vault's top", () => {
    expect(folderOf("Runes/Old/tower.ink.png")).toBe("Runes/Old");
    expect(folderOf("tower.ink.png")).toBe("");
  });
});

describe("createdFile", () => {
  it("gives the file a new symbol's draft names as its first save's", () => {
    expect(createdFile(newOrphan({ file: made }))).toEqual(made);
    expect(createdFile(newOrphan())).toBeUndefined();
    expect(
      createdFile({
        draft: draft(),
        path: "Runes/tower.ink.png",
        unopened: gone,
      }),
    ).toBeUndefined();
  });
});

describe("recoveredName", () => {
  const none = (): boolean => false;
  const orphan = (path: string, overrides: Partial<Draft> = {}): Orphan => ({
    draft: draft(overrides),
    path,
    unopened: gone,
  });

  it("starts with the name typed in the draft, as typed", () => {
    expect(
      recoveredName(orphan("a.ink.png", { name: " the gate " }), none),
    ).toBe(" the gate ");
    // Even one the folder has: saving says so, and the name can change.
    expect(
      recoveredName(
        orphan("Runes/tower.ink.png", { name: "gate" }),
        () => true,
      ),
    ).toBe("gate");
    expect(recoveredName(newOrphan({}, { name: "arch" }), none)).toBe("arch");
  });

  it("starts with the file's own name, unless its folder has a symbol of it", () => {
    const asked: string[] = [];
    const taken = (name: string): boolean => {
      asked.push(name);
      return name === "gate";
    };
    expect(recoveredName(orphan("Runes/tower.ink.png"), taken)).toBe("tower");
    expect(recoveredName(orphan("Runes/gate.ink.png"), taken)).toBeUndefined();
    expect(recoveredName(orphan("001.INK.PNG"), taken)).toBe("001");
    expect(asked).toEqual(["tower", "gate", "001"]);
  });

  it("starts with none for a new symbol's draft, which keeps the name of a file its first save made", () => {
    expect(recoveredName(newOrphan(), () => true)).toBeUndefined();
    expect(
      recoveredName(newOrphan({ file: made }), () => true),
    ).toBeUndefined();
  });
});

describe("what the list says", () => {
  it("names a symbol's draft by its file, in its folder", () => {
    const orphan: Orphan = {
      draft: draft(),
      path: "Runes/tower.ink.png",
      unopened: gone,
    };
    expect(orphanName(orphan)).toBe("tower");
    expect(orphanPlace(orphan)).toBe("Runes");
    expect(whyListed(orphan)).toBe("Deleted or moved");
    expect(whyListed({ ...orphan, unopened: damaged })).toBe(
      "Does not open: its strokes cannot be read",
    );
    expect(
      orphanPlace({ draft: draft(), path: "tower.ink.png", unopened: gone }),
    ).toBe("");
  });

  it("names a new symbol's draft by the name typed, or its first save's file, from its note", () => {
    expect(orphanName(newOrphan())).toBe("New symbol");
    expect(orphanName(newOrphan({}, { name: "  " }))).toBe("New symbol");
    expect(orphanName(newOrphan({ file: made }))).toBe("007");
    expect(orphanName(newOrphan({ file: made }, { name: "arch" }))).toBe(
      "arch",
    );
    expect(orphanPlace(newOrphan())).toBe("Started in Notes/Old.md");
    expect(whyListed(newOrphan())).toBe("Its note was deleted or moved");
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

  it("says what happened to a new symbol's note, and where the symbol goes", () => {
    expect(recoveryQuestion(newOrphan(), "today")).toEqual({
      title: "Open the unsaved drawing as a new symbol?",
      content:
        "Old, the note a new symbol was started in, is no longer in the vault, but Inkline kept the symbol's unsaved drawing from today. They can open in a new symbol, saved where new symbols go, and inserted in no note.",
    });
    expect(recoveryQuestion(newOrphan({ file: made }), "today").content).toBe(
      "Old, the note a new symbol was started in, is no longer in the vault, but Inkline kept the symbol's unsaved drawing from today. They can open in a new symbol, saved in Runes and inserted in no note. Its first save made 007.ink.png: saving writes over that file if nothing changed it since, and otherwise makes another beside it.",
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
    expect(
      recoveryQuestion(newOrphan({}, { base: { kind: "lost" } }), "today")
        .content,
    ).toMatch(
      /inserted in no note\. Its base layer cannot be read, so only its strokes would come back\.$/,
    );
  });
});
