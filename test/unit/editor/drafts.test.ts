import { describe, expect, it } from "vitest";
import {
  DraftStore,
  decodeDraft,
  draftLifetime,
  fingerprintOf,
  restoreDraft,
  sameTarget,
  type Draft,
  type VaultStorage,
} from "../../../src/editor/drafts.ts";
import type { InkDocument } from "../../../src/ink/document.ts";

const png = Uint8Array.of(137, 80, 78, 71);
const stroke = {
  tool: "pen",
  size: 256,
  pressure: false,
  points: [16, 32],
} as const;

/** Local storage in memory, with values copied through JSON as Obsidian does. */
class MemoryStorage implements VaultStorage {
  readonly values = new Map<string, string>();
  loadLocalStorage(key: string): unknown {
    const value = this.values.get(key);
    return value === undefined ? null : JSON.parse(value);
  }
  saveLocalStorage(key: string, data: unknown): void {
    if (data === null) this.values.delete(key);
    else this.values.set(key, JSON.stringify(data));
  }
}

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: "a",
    target: { kind: "file", path: "001.ink.png" },
    strokes: [stroke],
    baseCleared: false,
    savedAt: 1000,
    ...overrides,
  };
}

describe("DraftStore", () => {
  it("keeps drafts by id and lists them newest first", () => {
    const store = new DraftStore(new MemoryStorage(), () => 5000);
    store.put(draft({ id: "a", savedAt: 1000 }));
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
    expect(
      store
        .forTarget({ kind: "file", path: "001.ink.png" }, "mine")
        .map((item) => item.id),
    ).toEqual(["other"]);
    expect(
      store.forTarget({ kind: "new", note: "a.md" }).map((item) => item.id),
    ).toEqual(["new"]);
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

  it("follows renames of the symbol, and of the note a new one is in", () => {
    const store = new DraftStore(new MemoryStorage(), () => 5000);
    store.put(draft({ id: "file" }));
    store.put(draft({ id: "new", target: { kind: "new", note: "a.md" } }));
    store.rename("001.ink.png", "Water.ink.png");
    store.rename("a.md", "b.md");
    expect(store.list().map((item) => item.target)).toEqual([
      { kind: "file", path: "Water.ink.png" },
      { kind: "new", note: "b.md" },
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
});

describe("decodeDraft", () => {
  it("reads what the store writes", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage);
    const written = draft({ fingerprint: "ab" });
    store.put(written);
    expect(decodeDraft(storage.loadLocalStorage("inkline-draft:a"))).toEqual(
      written,
    );
  });

  it("refuses values that are not drafts", () => {
    const good = { version: 1, ...draft() };
    for (const value of [
      null,
      "text",
      { ...good, version: 2 },
      { ...good, id: 1 },
      { ...good, target: { kind: "file" } },
      { ...good, baseCleared: "no" },
      { ...good, savedAt: Number.NaN },
      { ...good, fingerprint: 5 },
      { ...good, strokes: [{ tool: "brush" }] },
    ]) {
      expect(decodeDraft(value)).toBeUndefined();
    }
  });
});

describe("restoreDraft", () => {
  it("restores onto the file's own base layer unless it was cleared", () => {
    const original: InkDocument = {
      strokes: [],
      base: { x: 0, y: 0, scale: 1, png },
    };
    expect(restoreDraft(original, draft())).toEqual({
      strokes: [stroke],
      base: original.base,
    });
    expect(restoreDraft(original, draft({ baseCleared: true }))).toEqual({
      strokes: [stroke],
    });
  });
});

describe("sameTarget", () => {
  it("compares by kind and path", () => {
    expect(
      sameTarget({ kind: "file", path: "a" }, { kind: "file", path: "a" }),
    ).toBe(true);
    expect(
      sameTarget({ kind: "file", path: "a" }, { kind: "new", note: "a" }),
    ).toBe(false);
  });
});

describe("fingerprintOf", () => {
  it("is the SHA-256 of the bytes", async () => {
    expect(await fingerprintOf(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
