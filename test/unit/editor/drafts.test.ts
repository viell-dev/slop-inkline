import { describe, expect, it } from "vitest";
import {
  DraftStore,
  decodeDraft,
  draftBase,
  draftLifetime,
  fingerprintOf,
  restoreDraft,
  sameTarget,
  type Draft,
  type VaultStorage,
} from "../../../src/editor/drafts.ts";
import type { BaseLayer } from "../../../src/format/record.ts";
import type { InkDocument } from "../../../src/ink/document.ts";
import { blank, encodePng } from "../../support/png.ts";

const png = encodePng(blank(2, 2));
const layer: BaseLayer = { x: 0, y: 0, scale: 1, png };
const stroke = {
  tool: "pen",
  size: 256,
  pressure: false,
  points: [16, 32],
} as const;

/**
 * Local storage in memory, as Obsidian's `App` offers it: values go through
 * JSON, a falsy one removes the key, and a write past `quota` characters is
 * dropped without an error.
 */
class MemoryStorage implements VaultStorage {
  readonly values = new Map<string, string>();
  quota = Number.POSITIVE_INFINITY;
  /** Keys whose writes are dropped, whatever the quota. */
  readonly refused = new Set<string>();

  loadLocalStorage(key: string): unknown {
    const value = this.values.get(key);
    return value === undefined ? null : JSON.parse(value);
  }

  saveLocalStorage(key: string, data: unknown): void {
    if (!data) {
      this.values.delete(key);
      return;
    }
    const value = JSON.stringify(data);
    const others = [...this.values]
      .filter(([other]) => other !== key)
      .reduce((total, [, text]) => total + text.length, 0);
    if (this.refused.has(key) || others + value.length > this.quota) return;
    this.values.set(key, value);
  }

  get used(): number {
    return [...this.values.values()].reduce(
      (sum, text) => sum + text.length,
      0,
    );
  }
}

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: "a",
    target: { kind: "file", path: "001.ink.png" },
    strokes: [stroke],
    base: { kind: "file" },
    savedAt: 1000,
    ...overrides,
  };
}

describe("DraftStore", () => {
  it("keeps drafts by id and lists them newest first", () => {
    const store = new DraftStore(new MemoryStorage(), () => 5000);
    expect(store.put(draft({ id: "a", savedAt: 1000 }))).toBe(true);
    store.put(draft({ id: "b", savedAt: 3000 }));
    store.put(draft({ id: "a", savedAt: 2000 }));
    expect(store.list().map((item) => [item.id, item.savedAt])).toEqual([
      ["b", 3000],
      ["a", 2000],
    ]);
  });

  it("finds a symbol's drafts, other than an editor's own", () => {
    const store = new DraftStore(new MemoryStorage(), () => 5000);
    store.put(draft({ id: "mine" }));
    store.put(draft({ id: "other", savedAt: 900 }));
    store.put(
      draft({ id: "elsewhere", target: { kind: "file", path: "002.ink.png" } }),
    );
    store.put(draft({ id: "new", target: { kind: "new", note: "a.md" } }));
    store.put(
      draft({
        id: "made",
        savedAt: 800,
        target: {
          kind: "new",
          note: "a.md",
          file: { path: "003.ink.png", fingerprint: "ab" },
        },
      }),
    );
    expect(
      store
        .forTarget({ kind: "file", path: "001.ink.png" }, "mine")
        .map((item) => item.id),
    ).toEqual(["other"]);
    // A new symbol whose first save made a file still belongs to its note.
    expect(
      store.forTarget({ kind: "new", note: "a.md" }).map((item) => item.id),
    ).toEqual(["new", "made"]);
  });

  it("removes only the draft asked for", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 5000);
    store.put(draft({ id: "a" }));
    store.put(draft({ id: "b" }));
    store.remove("a");
    expect(store.list().map((item) => item.id)).toEqual(["b"]);
    store.remove("b");
    expect(storage.values.size).toBe(0);
  });

  it("follows renames of the symbol, of the note a new one is in, and of the file its first save made", () => {
    const store = new DraftStore(new MemoryStorage(), () => 5000);
    store.put(draft({ id: "file", savedAt: 3000 }));
    store.put(
      draft({
        id: "new",
        savedAt: 2000,
        target: { kind: "new", note: "a.md" },
      }),
    );
    store.put(
      draft({
        id: "made",
        target: {
          kind: "new",
          note: "c.md",
          file: { path: "002.ink.png", fingerprint: "ab" },
        },
      }),
    );
    store.rename("001.ink.png", "Water.ink.png");
    store.rename("a.md", "b.md");
    store.rename("002.ink.png", "Fire.ink.png");
    expect(store.list().map((item) => item.target)).toEqual([
      { kind: "file", path: "Water.ink.png" },
      { kind: "new", note: "b.md" },
      {
        kind: "new",
        note: "c.md",
        file: { path: "Fire.ink.png", fingerprint: "ab" },
      },
    ]);
  });

  it("drops drafts older than their lifetime, and broken ones", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => draftLifetime + 2000);
    store.put(draft({ id: "old", savedAt: 1000 }));
    store.put(draft({ id: "fresh", savedAt: 3000 }));
    storage.saveLocalStorage("inkline-draft:broken", { version: 1 });
    storage.saveLocalStorage("inkline-drafts", ["old", "fresh", "broken", 7]);
    expect(store.list().map((item) => item.id)).toEqual(["fresh"]);
    expect([...storage.values.keys()].sort()).toEqual([
      "inkline-draft:fresh",
      "inkline-drafts",
    ]);
  });

  it("says when storage refuses a draft, and keeps the one it would have replaced", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 5000);
    expect(store.put(draft())).toBe(true);
    storage.quota = storage.used;
    const longer = draft({ strokes: [stroke, stroke] });
    expect(store.put(longer)).toBe(false);
    expect(store.list()).toEqual([draft()]);
    // A new draft that does not fit is not kept at all.
    expect(store.put(draft({ id: "b" }))).toBe(false);
    expect(store.list().map((item) => item.id)).toEqual(["a"]);
    storage.quota = Number.POSITIVE_INFINITY;
    expect(store.put(longer)).toBe(true);
    expect(store.list()).toEqual([longer]);
  });

  it("frees a draft that the index could not list", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 5000);
    store.put(draft({ id: "a" }));
    storage.refused.add("inkline-drafts");
    expect(store.put(draft({ id: "b" }))).toBe(false);
    expect([...storage.values.keys()].sort()).toEqual([
      "inkline-draft:a",
      "inkline-drafts",
    ]);
    // A draft the index already lists needs no index write.
    expect(store.put(draft({ id: "a", savedAt: 2000 }))).toBe(true);
  });
});

describe("decodeDraft", () => {
  it("reads what the store writes", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage);
    for (const written of [
      draft({ fingerprint: "ab" }),
      draft({ id: "b", base: { kind: "none" } }),
      draft({
        id: "c",
        base: { kind: "kept", layer: { x: -160, y: 32, scale: 2, png } },
        target: {
          kind: "new",
          note: "a.md",
          file: { path: "001.ink.png", fingerprint: "ab" },
        },
      }),
    ]) {
      store.put(written);
      expect(
        decodeDraft(storage.loadLocalStorage(`inkline-draft:${written.id}`)),
      ).toEqual(written);
    }
  });

  it("refuses values that are not drafts", () => {
    const storage = new MemoryStorage();
    new DraftStore(storage).put(
      draft({ base: { kind: "kept", layer: { x: 0, y: 0, scale: 1, png } } }),
    );
    const stored = storage.loadLocalStorage("inkline-draft:a");
    if (typeof stored !== "string") throw new Error("not stored as text");
    const good = JSON.parse(stored) as Record<string, unknown> & {
      ink: Record<string, unknown>;
    };
    const variant = (changes: Record<string, unknown>): string =>
      JSON.stringify({ ...good, ...changes });
    for (const value of [
      null,
      good,
      "not JSON",
      "[]",
      variant({ version: 2 }),
      variant({ id: 1 }),
      variant({ target: { kind: "file" } }),
      variant({ target: { kind: "new", note: "a.md", file: { path: "x" } } }),
      variant({ base: "cleared" }),
      // A kept base layer goes with a stored one, and only it does.
      variant({ base: "file" }),
      variant({ ink: { ...good.ink, base: undefined } }),
      variant({ savedAt: Number.NaN }),
      variant({ fingerprint: 5 }),
      variant({ ink: { ...good.ink, strokes: [{ tool: "brush" }] } }),
      variant({
        ink: { ...good.ink, base: { x: 0, y: 0, scale: 1, png: "" } },
      }),
    ]) {
      expect(decodeDraft(value)).toBeUndefined();
    }
    expect(decodeDraft(stored)).toBeDefined();
  });
});

describe("draftBase", () => {
  const saved: InkDocument = { strokes: [], base: layer };

  it("names the file's base layer when the file holds it", () => {
    expect(draftBase({ strokes: [stroke], base: layer }, saved)).toEqual({
      kind: "file",
    });
    expect(draftBase({ strokes: [] }, saved)).toEqual({ kind: "none" });
  });

  it("keeps a base layer that the file does not hold", () => {
    // Cleared, saved, and then brought back by undoing the clearing.
    expect(draftBase(saved, { strokes: [] })).toEqual({ kind: "kept", layer });
    const moved = { ...layer, x: 16 };
    expect(draftBase({ strokes: [], base: moved }, saved)).toEqual({
      kind: "kept",
      layer: moved,
    });
    const other = { ...layer, png: png.slice() };
    expect(draftBase({ strokes: [], base: other }, saved)).toEqual({
      kind: "kept",
      layer: other,
    });
  });
});

describe("restoreDraft", () => {
  const original: InkDocument = { strokes: [], base: layer };

  it("restores onto the file's own base layer, none, or the one kept", () => {
    expect(restoreDraft(original, draft())).toEqual({
      strokes: [stroke],
      base: layer,
    });
    expect(restoreDraft(original, draft({ base: { kind: "none" } }))).toEqual({
      strokes: [stroke],
    });
    const kept = { ...layer, x: 32 };
    expect(
      restoreDraft(
        { strokes: [] },
        draft({ base: { kind: "kept", layer: kept } }),
      ),
    ).toEqual({ strokes: [stroke], base: kept });
  });
});

describe("sameTarget", () => {
  it("compares by kind and path, and a new symbol by its note", () => {
    expect(
      sameTarget({ kind: "file", path: "a" }, { kind: "file", path: "a" }),
    ).toBe(true);
    expect(
      sameTarget({ kind: "file", path: "a" }, { kind: "new", note: "a" }),
    ).toBe(false);
    expect(
      sameTarget(
        { kind: "new", note: "a" },
        { kind: "new", note: "a", file: { path: "b", fingerprint: "c" } },
      ),
    ).toBe(true);
  });
});

describe("fingerprintOf", () => {
  it("is the SHA-256 of the bytes", async () => {
    expect(await fingerprintOf(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
