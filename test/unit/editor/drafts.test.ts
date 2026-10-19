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
import { limits, type BaseLayer } from "../../../src/format/record.ts";
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
  /** How many writes each key had, refused ones included. */
  readonly writes = new Map<string, number>();

  loadLocalStorage(key: string): unknown {
    const value = this.values.get(key);
    return value === undefined ? null : JSON.parse(value);
  }

  saveLocalStorage(key: string, data: unknown): void {
    if (!data) {
      this.values.delete(key);
      return;
    }
    this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
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

  /** The keys stored under a prefix. */
  keys(prefix: string): string[] {
    return [...this.values.keys()].filter((key) => key.startsWith(prefix));
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

  it("finds a symbol's drafts, other than those open editors hold", () => {
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
    store.hold("mine");
    expect(
      store
        .forTarget({ kind: "file", path: "001.ink.png" })
        .map((item) => item.id),
    ).toEqual(["other"]);
    store.release("mine");
    expect(
      store
        .forTarget({ kind: "file", path: "001.ink.png" })
        .map((item) => item.id),
    ).toEqual(["mine", "other"]);
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

  it("drops a draft with no strokes stored, and still lists the others", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 5000);
    store.put(draft({ id: "good" }));
    const stored = storage.loadLocalStorage("inkline-draft:good");
    if (typeof stored !== "string") throw new Error("not stored as text");
    const { ink: _ink, ...envelope } = JSON.parse(stored) as Record<
      string,
      unknown
    >;
    storage.saveLocalStorage(
      "inkline-draft:broken",
      JSON.stringify({ ...envelope, id: "broken" }),
    );
    storage.saveLocalStorage("inkline-drafts", ["broken", "good"]);
    expect(store.list().map((item) => item.id)).toEqual(["good"]);
    expect(storage.keys("inkline-draft:")).toEqual(["inkline-draft:good"]);
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

  it("does not keep a draft that reading would refuse", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 5000);
    store.put(draft());
    const many = draft({
      strokes: Array.from({ length: limits.strokes + 1 }, () => stroke),
    });
    expect(store.put(many)).toBe(false);
    const huge = new Uint8Array(limits.baseBytes + 1);
    huge.set(png);
    expect(
      store.put(
        draft({ base: { kind: "kept", layer: { ...layer, png: huge } } }),
      ),
    ).toBe(false);
    expect(storage.keys("inkline-draft-base:")).toEqual([]);
    expect(store.list()).toEqual([draft()]);
  });

  it("stores a kept base layer once, and drops it once no draft uses it", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 5000);
    const kept = { kind: "kept", layer } as const;
    for (let count = 1; count <= 5; count++) {
      const strokes = Array.from({ length: count }, () => stroke);
      expect(store.put(draft({ strokes, base: kept }))).toBe(true);
    }
    const [baseKey, ...others] = storage.keys("inkline-draft-base:");
    expect(others).toEqual([]);
    expect(storage.writes.get(baseKey ?? "")).toBe(1);
    expect(storage.writes.get("inkline-draft:a")).toBe(5);
    // Its pixels are not in the draft itself.
    expect(storage.values.get("inkline-draft:a")).not.toContain("iVBOR");
    store.put(draft({ id: "b", savedAt: 900, base: kept }));
    store.remove("a");
    store.list();
    expect(storage.keys("inkline-draft-base:")).toEqual([baseKey]);
    store.remove("b");
    store.list();
    expect(storage.keys("inkline-draft-base:")).toEqual([]);
    expect(storage.values.has("inkline-draft-bases")).toBe(false);
  });

  it("drops a base layer it stored for a draft that was refused", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 5000);
    storage.refused.add("inkline-draft:a");
    expect(store.put(draft({ base: { kind: "kept", layer } }))).toBe(false);
    expect(storage.keys("inkline-draft-base")).toEqual([]);
    storage.refused.clear();
    expect(store.put(draft({ base: { kind: "kept", layer } }))).toBe(true);
    expect(storage.keys("inkline-draft-base:")).toHaveLength(1);
  });

  it("stores a base layer again that another store dropped while unused", () => {
    const storage = new MemoryStorage();
    const first = new DraftStore(storage, () => 5000);
    const kept = draft({ base: { kind: "kept", layer } });
    expect(first.put(kept)).toBe(true);
    // Another store removes the draft, and then its unused base layer.
    const other = new DraftStore(storage, () => 5000);
    other.remove("a");
    other.list();
    expect(storage.keys("inkline-draft-base:")).toEqual([]);
    expect(first.put(kept)).toBe(true);
    expect(new DraftStore(storage, () => 5000).list()).toEqual([kept]);
  });

  it("reads a kept base layer in another session, or marks it lost", () => {
    const storage = new MemoryStorage();
    const written = draft({
      base: { kind: "kept", layer: { x: -160, y: 32, scale: 2, png } },
    });
    new DraftStore(storage, () => 5000).put(written);
    expect(new DraftStore(storage, () => 5000).list()).toEqual([written]);
    for (const key of storage.keys("inkline-draft-base:")) {
      storage.saveLocalStorage(key, "not base64!");
    }
    const [lost] = new DraftStore(storage, () => 5000).list();
    expect(lost?.base).toEqual({ kind: "lost" });
    expect(lost?.strokes).toEqual(written.strokes);
  });
});

describe("decodeDraft", () => {
  it("reads what the store writes", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage);
    for (const written of [
      draft({ fingerprint: "ab" }),
      draft({ id: "b", base: { kind: "none" } }),
      draft({ id: "c", base: { kind: "lost" } }),
      draft({
        id: "d",
        target: {
          kind: "new",
          note: "a.md",
          file: { path: "001.ink.png", fingerprint: "ab" },
        },
      }),
      draft({
        id: "e",
        target: {
          kind: "new",
          note: "a.md",
          file: { path: "001.ink.png", fingerprint: "ab", previous: "cd" },
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
    new DraftStore(storage).put(draft({ base: { kind: "kept", layer } }));
    const stored = storage.loadLocalStorage("inkline-draft:a");
    if (typeof stored !== "string") throw new Error("not stored as text");
    const good = JSON.parse(stored) as Record<string, unknown> & {
      ink: Record<string, unknown>;
      layer: Record<string, unknown>;
    };
    const bases = (key: string): Uint8Array | undefined =>
      key === good.layer.key ? png : undefined;
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
      variant({
        target: {
          kind: "new",
          note: "a.md",
          file: { path: "x", fingerprint: "ab", previous: 1 },
        },
      }),
      variant({ base: "cleared" }),
      // A kept base layer has a place, and only it does.
      variant({ base: "file" }),
      variant({ layer: undefined }),
      variant({ layer: { ...good.layer, scale: 0 } }),
      variant({ layer: { ...good.layer, x: 0.5 } }),
      variant({ savedAt: Number.NaN }),
      variant({ fingerprint: 5 }),
      variant({ ink: undefined }),
      variant({ ink: { ...good.ink, strokes: [{ tool: "brush" }] } }),
      // Its pixels are stored apart, never in the strokes' record.
      variant({
        ink: {
          ...good.ink,
          base: { x: 0, y: 0, scale: 1, png: "iVBORw0KGgo=" },
        },
      }),
    ]) {
      expect(decodeDraft(value, bases)).toBeUndefined();
    }
    expect(decodeDraft(stored, bases)?.base).toEqual({ kind: "kept", layer });
  });
});

describe("draftBase", () => {
  const saved: InkDocument = { strokes: [], base: layer };

  it("names the file's base layer when the file holds it", () => {
    expect(draftBase({ strokes: [stroke], base: layer }, saved)).toEqual({
      kind: "file",
    });
    // The same picture, decoded from a draft into bytes of its own.
    const copy = { ...layer, png: png.slice() };
    expect(draftBase({ strokes: [], base: copy }, saved)).toEqual({
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
    const other = { ...layer, png: encodePng(blank(3, 3)) };
    expect(draftBase({ strokes: [], base: other }, saved)).toEqual({
      kind: "kept",
      layer: other,
    });
    // While a save writes the file, what it holds is not known.
    expect(draftBase(saved, undefined)).toEqual({ kind: "kept", layer });
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
    expect(restoreDraft(original, draft({ base: { kind: "lost" } }))).toEqual({
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
