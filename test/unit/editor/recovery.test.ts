import { describe, expect, it } from "vitest";
import {
  DraftStore,
  type Draft,
  type DraftTarget,
  type VaultStorage,
} from "../../../src/editor/drafts.ts";
import {
  createdFile,
  folderOf,
  listDrafts,
  listedDetail,
  listedName,
  listedSearchTexts,
  listedPlace,
  recoveredName,
  recoveredTarget,
  recoveryQuestion,
  type AsNewSymbol,
  type FileState,
  type Listed,
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

/** A new symbol's draft started in Notes/Old.md, which is gone, or `there`. */
function newSymbol(
  target: Partial<Extract<DraftTarget, { kind: "new" }>> = {},
  overrides: Partial<Draft> = {},
  there = false,
): AsNewSymbol & { readonly opens: "new" } {
  return {
    opens: "new",
    draft: draft({
      target: { kind: "new", note: "Notes/Old.md", ...target },
      ...overrides,
    }),
    path: "Notes/Old.md",
    unopened: there ? undefined : gone,
  };
}

/** A symbol's draft of `path` that opens as a new symbol, as `unopened` says. */
function asNew(
  path: string,
  unopened: Unopened,
  overrides: Partial<Draft> = {},
): AsNewSymbol & { readonly opens: "new" } {
  return {
    opens: "new",
    draft: draft({ target: { kind: "file", path }, ...overrides }),
    path,
    unopened,
  };
}

/** A symbol's draft of `path`, whose file opens, or a newer Inkline saved. */
function onSymbol(path: string, newer = false): Listed {
  return {
    opens: "symbol",
    draft: draft({ target: { kind: "file", path } }),
    path,
    newer,
  };
}

const made = { path: "Runes/007.ink.png", fingerprint: "ab" };

describe("listDrafts", () => {
  /** A file that opens with one stroke, `stroke`, as its own. */
  const opens: FileState = {
    kind: "opens",
    document: { strokes: [stroke] },
    name: "door",
  };

  it("lists every draft, in order, by what choosing it does", async () => {
    const states: Record<string, FileState> = {
      "Runes/tower.ink.png": gone,
      "Runes/gate.ink.png": damaged,
      "Runes/door.ink.png": opens,
      "Runes/later.ink.png": { kind: "newer" },
    };
    const asked: string[] = [];
    const notes: string[] = [];
    const two = [stroke, stroke];
    const drafts = [
      draft({ id: "tower" }),
      draft({
        id: "door",
        target: { kind: "file", path: "Runes/door.ink.png" },
        strokes: two,
      }),
      draft({ id: "new", target: { kind: "new", note: "Notes/a.md" } }),
      draft({ id: "lost note", target: { kind: "new", note: "Gone.md" } }),
      draft({
        id: "gate",
        target: { kind: "file", path: "Runes/gate.ink.png" },
      }),
      draft({
        id: "later",
        target: { kind: "file", path: "Runes/later.ink.png" },
      }),
      draft({ id: "tower again" }),
    ];
    const listed = await listDrafts(
      drafts,
      (path) => {
        asked.push(path);
        const state = states[path];
        if (state === undefined) throw new Error(`no ${path}`);
        return Promise.resolve(state);
      },
      (path) => {
        notes.push(path);
        return path === "Gone.md";
      },
    );
    expect(
      listed.map((found) => [
        found.draft.id,
        found.opens,
        found.path,
        found.opens === "symbol" ? found.newer : found.unopened,
      ]),
    ).toEqual([
      ["tower", "new", "Runes/tower.ink.png", gone],
      ["door", "symbol", "Runes/door.ink.png", false],
      ["new", "new", "Notes/a.md", undefined],
      ["lost note", "new", "Gone.md", gone],
      ["gate", "new", "Runes/gate.ink.png", damaged],
      ["later", "symbol", "Runes/later.ink.png", true],
      ["tower again", "new", "Runes/tower.ink.png", gone],
    ]);
    // Once for each file, and only files; a new symbol's note is asked of
    // the other.
    expect(asked).toEqual([
      "Runes/tower.ink.png",
      "Runes/door.ink.png",
      "Runes/gate.ink.png",
      "Runes/later.ink.png",
    ]);
    expect(notes).toEqual(["Notes/a.md", "Gone.md"]);
  });

  it("leaves out a draft of a file that opens which would bring back nothing", async () => {
    const door: DraftTarget = { kind: "file", path: "Runes/door.ink.png" };
    const listed = await listDrafts(
      [
        // The file's own strokes and name, as after a save that ended once
        // Inkline was off.
        draft({ id: "same", target: door }),
        draft({ id: "named", target: door, name: "gate" }),
        draft({ id: "same name", target: door, name: "door" }),
        draft({ id: "cleared", target: door, strokes: [] }),
        draft({ id: "typed", target: door, text: { reading: "dor" } }),
      ],
      () => Promise.resolve(opens),
      () => false,
    );
    expect(listed.map(({ draft: { id } }) => id)).toEqual([
      "named",
      "cleared",
      "typed",
    ]);
  });

  it("lists a new symbol's draft whatever it holds, and none when there is none", async () => {
    const listed = await listDrafts(
      [draft({ target: { kind: "new", note: "a.md" }, strokes: [] })],
      () => Promise.reject(new Error("no file is read")),
      () => false,
    );
    expect(listed).toEqual([
      {
        opens: "new",
        draft: draft({ target: { kind: "new", note: "a.md" }, strokes: [] }),
        path: "a.md",
        unopened: undefined,
      },
    ]);
    expect(
      await listDrafts(
        [],
        () => Promise.resolve(opens),
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
    expect(createdFile(newSymbol({ file: made }).draft)).toEqual(made);
    expect(createdFile(newSymbol().draft)).toBeUndefined();
    expect(createdFile(draft())).toBeUndefined();
  });
});

/** Local storage in memory, which a later load reads as this one left it. */
function memoryStorage(): VaultStorage {
  const values = new Map<string, string>();
  return {
    loadLocalStorage: (key): unknown => {
      const value = values.get(key);
      return value === undefined ? null : (JSON.parse(value) as unknown);
    },
    saveLocalStorage: (key, data) => {
      if (data === null || data === undefined) values.delete(key);
      else values.set(key, JSON.stringify(data));
    },
  };
}

describe("recoveredTarget", () => {
  const gate: DraftTarget = { kind: "file", path: "Runes/gate.ink.png" };
  const note: DraftTarget = { kind: "new", note: "Notes/Old.md" };
  const tower = "Runes/tower.ink.png";
  /** What a first save claims as it is about to make tower.ink.png. */
  const claimed = { path: tower, fingerprint: "ab" };
  /** And once a write cut short left a part there that stays. */
  const cut = { ...claimed, previous: "cd" };
  /** Soon after the test's drafts were kept. */
  const now = (): number => 2000;

  it("is a symbol's old symbol until its first save has made a file, whatever path that save claims", () => {
    expect(recoveredTarget(gate, undefined, undefined)).toEqual(gate);
    expect(recoveredTarget(gate, undefined, claimed)).toEqual(gate);
    expect(recoveredTarget(gate, undefined, cut)).toEqual(gate);
    expect(recoveredTarget(gate, tower, claimed)).toEqual({
      kind: "file",
      path: tower,
    });
  });

  it("names, for a new symbol's draft, the file its first save made or is making, with what it wrote, until it holds that file", () => {
    expect(recoveredTarget(note, undefined, undefined)).toEqual(note);
    expect(recoveredTarget(note, undefined, claimed)).toEqual({
      ...note,
      file: claimed,
    });
    // The file the found draft's own first save made, once claimed again.
    expect(recoveredTarget({ ...note, file: made }, undefined, cut)).toEqual({
      ...note,
      file: cut,
    });
    expect(recoveredTarget(note, made.path, made)).toEqual({
      kind: "file",
      path: made.path,
    });
  });

  it("leaves a symbol's draft, wherever its first save stops before it made a file, for no symbol at the path it claimed, and listed as the old one's", async () => {
    // Another symbol is at tower.ink.png, as one that came there as the save
    // looked, or since; gate.ink.png is gone.
    const state = (at: string): Promise<FileState> =>
      Promise.resolve(
        at === tower
          ? { kind: "opens", document: { strokes: [] }, name: "tower" }
          : gone,
      );
    for (const claim of [undefined, claimed, cut]) {
      const storage = memoryStorage();
      const kept = draft({ target: recoveredTarget(gate, undefined, claim) });
      expect(new DraftStore(storage, now).put(kept)).toBe(true);
      // A later load, as after a crash now.
      const later = new DraftStore(storage, now);
      expect(later.forTarget({ kind: "file", path: tower })).toEqual([]);
      expect(await listDrafts(later.list(), state, () => false)).toEqual([
        { opens: "new", draft: kept, path: gate.path, unopened: gone },
      ]);
    }
  });
});

describe("recoveredName", () => {
  const none = (): boolean => false;

  it("starts with the name typed in the draft, as typed", () => {
    expect(
      recoveredName(asNew("a.ink.png", gone, { name: " the gate " }), none),
    ).toBe(" the gate ");
    // Even one the folder has: saving says so, and the name can change.
    expect(
      recoveredName(
        asNew("Runes/tower.ink.png", gone, { name: "gate" }),
        () => true,
      ),
    ).toBe("gate");
    expect(recoveredName(newSymbol({}, { name: "arch" }), none)).toBe("arch");
  });

  it("starts with the file's own name, unless its folder has a symbol of it", () => {
    const asked: string[] = [];
    const taken = (name: string): boolean => {
      asked.push(name);
      return name === "gate";
    };
    expect(recoveredName(asNew("Runes/tower.ink.png", gone), taken)).toBe(
      "tower",
    );
    expect(
      recoveredName(asNew("Runes/gate.ink.png", damaged), taken),
    ).toBeUndefined();
    expect(recoveredName(asNew("001.INK.PNG", gone), taken)).toBe("001");
    expect(asked).toEqual(["tower", "gate", "001"]);
  });

  it("starts with none for a new symbol's draft, which keeps the name of a file its first save made", () => {
    expect(recoveredName(newSymbol(), () => true)).toBeUndefined();
    expect(
      recoveredName(newSymbol({ file: made }), () => true),
    ).toBeUndefined();
    expect(recoveredName(newSymbol({}, {}, true), () => true)).toBeUndefined();
  });
});

describe("what the list says", () => {
  it("names a symbol's draft by its file, in its folder", () => {
    for (const listed of [
      asNew("Runes/tower.ink.png", gone),
      onSymbol("Runes/tower.ink.png"),
    ]) {
      expect(listedName(listed)).toBe("tower");
      expect(listedPlace(listed)).toBe("Runes");
    }
    expect(listedPlace(onSymbol("tower.ink.png"))).toBe("");
  });

  it("names a new symbol's draft by the name typed, or its first save's file, from its note", () => {
    expect(listedName(newSymbol())).toBe("New symbol");
    expect(listedName(newSymbol({}, { name: "  " }))).toBe("New symbol");
    expect(listedName(newSymbol({ file: made }))).toBe("007");
    expect(listedName(newSymbol({ file: made }, { name: "arch" }))).toBe(
      "arch",
    );
    expect(listedPlace(newSymbol())).toBe("Started in Notes/Old.md");
    expect(listedPlace(newSymbol({}, {}, true))).toBe(
      "Started in Notes/Old.md",
    );
  });

  it("is found by the name it shows, as well as by its paths", () => {
    // A new symbol named in its editor and never saved: only its name says
    // what it is, as its note's path says nothing of it.
    expect(listedSearchTexts(newSymbol({}, { name: "Alpha" }))).toEqual([
      "Alpha",
      "Notes/Old.md",
    ]);
    expect(listedSearchTexts(newSymbol({ file: made }))).toEqual([
      "007",
      "Notes/Old.md",
      made.path,
    ]);
    expect(listedSearchTexts(onSymbol("Runes/tower.ink.png"))).toEqual([
      "tower",
      "Runes/tower.ink.png",
    ]);
  });

  it("says what became of each draft's symbol, and what choosing it does", () => {
    expect(listedDetail(onSymbol("tower.ink.png"), "today")).toBe(
      "Kept today. Opens the symbol, to restore its unsaved changes.",
    );
    expect(listedDetail(onSymbol("tower.ink.png", true), "today")).toBe(
      "Kept today. Its file is from a newer version of Inkline: update Inkline, then open it to restore its unsaved changes.",
    );
    expect(listedDetail(asNew("tower.ink.png", gone), "today")).toBe(
      "Kept today. Its file was deleted or moved: opens its unsaved changes as a new symbol.",
    );
    expect(listedDetail(asNew("tower.ink.png", damaged), "today")).toBe(
      "Kept today. Its file does not open: its strokes cannot be read. Opens its unsaved changes as a new symbol.",
    );
    expect(
      listedDetail(
        asNew("tower.ink.png", {
          kind: "unreadable",
          reason: "the file ends early.",
        }),
        "today",
      ),
    ).toBe(
      "Kept today. Its file does not open: the file ends early. Opens its unsaved changes as a new symbol.",
    );
    expect(listedDetail(newSymbol(), "today")).toBe(
      "Kept today. Its note was deleted or moved: opens the unsaved drawing as a new symbol, inserted in no note.",
    );
    expect(listedDetail(newSymbol({}, {}, true), "today")).toBe(
      "Kept today. Opens the unsaved drawing as a new symbol, inserted in no note.",
    );
  });
});

describe("recoveryQuestion", () => {
  it("says what happened to the file, and where the new symbol goes", () => {
    expect(
      recoveryQuestion(asNew("Runes/tower.ink.png", gone), "today"),
    ).toEqual({
      title: "Open the unsaved drawing as a new symbol?",
      content:
        "tower.ink.png is no longer in the vault, but Inkline kept unsaved changes to it from today. They can open in a new symbol, saved in Runes.",
    });
    expect(
      recoveryQuestion(asNew("tower.ink.png", damaged), "today").content,
    ).toBe(
      "tower.ink.png does not open: its strokes cannot be read. Inkline kept unsaved changes to it from today. They can open in a new symbol, saved in the vault's top folder, and tower.ink.png stays as it is.",
    );
  });

  it("says what happened to a new symbol's note, where the symbol goes, and how to insert it", () => {
    expect(recoveryQuestion(newSymbol(), "today")).toEqual({
      title: "Open the unsaved drawing as a new symbol?",
      content:
        "Old, the note a new symbol was started in, is no longer in the vault, but Inkline kept the symbol's unsaved drawing from today. It can open in a new symbol, saved where new symbols go, and inserted in no note. Once it is saved, run Inkline: Insert existing symbol with the cursor where you want it.",
    });
    expect(recoveryQuestion(newSymbol({ file: made }), "today").content).toBe(
      "Old, the note a new symbol was started in, is no longer in the vault, but Inkline kept the symbol's unsaved drawing from today. It can open in a new symbol, saved in Runes and inserted in no note. Its first save made 007.ink.png: saving writes over that file if nothing changed it since, and otherwise makes another beside it. Once it is saved, run Inkline: Insert existing symbol with the cursor where you want it.",
    );
  });

  it("says where a new symbol's draft whose note is there goes, and how to insert it", () => {
    expect(recoveryQuestion(newSymbol({}, {}, true), "today")).toEqual({
      title: "Open the unsaved drawing as a new symbol?",
      content:
        "Inkline kept the unsaved drawing of a new symbol started in Old, from today. It can open in a new symbol, saved where new symbols go, and inserted in no note. Once it is saved, run Inkline: Insert existing symbol with the cursor where you want it.",
    });
    expect(
      recoveryQuestion(newSymbol({ file: made }, {}, true), "today").content,
    ).toBe(
      "Inkline kept the unsaved drawing of a new symbol started in Old, from today. It can open in a new symbol, saved in Runes and inserted in no note. Its first save made 007.ink.png: saving writes over that file if nothing changed it since, and otherwise makes another beside it. Once it is saved, run Inkline: Insert existing symbol with the cursor where you want it.",
    );
  });

  it("ends the reason with one full stop", () => {
    const { content } = recoveryQuestion(
      asNew("tower.ink.png", {
        kind: "unreadable",
        reason: "the file ends early.",
      }),
      "today",
    );
    expect(content).toMatch(
      /^tower\.ink\.png does not open: the file ends early\. Inkline/,
    );
  });

  it("says when the drawing's base layer does not come back", () => {
    const question = (base: Draft["base"]): string =>
      recoveryQuestion(asNew("tower.ink.png", gone, { base }), "today").content;
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
      recoveryQuestion(newSymbol({}, { base: { kind: "lost" } }), "today")
        .content,
    ).toMatch(
      /where you want it\. Its base layer cannot be read, so only its strokes would come back\.$/,
    );
  });
});
