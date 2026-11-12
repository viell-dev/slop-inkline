import { describe, expect, it } from "vitest";
import {
  DraftStore,
  decodeDraft,
  draftBase,
  draftLifetime,
  drawingOf,
  fingerprintOf,
  restoreDraft,
  sameTarget,
  type Draft,
  type VaultStorage,
} from "../../../src/editor/drafts.ts";
import { readChunks } from "../../../src/format/png.ts";
import {
  limits,
  toBase64,
  type BaseLayer,
} from "../../../src/format/record.ts";
import { writeText } from "../../../src/format/text.ts";
import type { InkDocument } from "../../../src/ink/document.ts";
import { blank, encodePng } from "../../support/png.ts";
import { noise, paused } from "../../support/slices.ts";

const png = encodePng(blank(2, 2));
const layer: BaseLayer = { x: 0, y: 0, width: 32, height: 32, png };
const stroke = {
  tool: "pen",
  size: 256,
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

/** The keys of the base layers stored. */
function baseKeys(storage: MemoryStorage): string[] {
  return storage.keys("inkline-draft-base:");
}

/** The base layers that the index lists, by the keys they are stored under. */
function indexedBases(storage: MemoryStorage): unknown {
  const keys = storage.loadLocalStorage("inkline-draft-bases");
  return Array.isArray(keys)
    ? keys.map((key) => `inkline-draft-base:${String(key)}`)
    : keys;
}

/** A PNG of noise, so that its pixels take room, as a picture's do. */
function noisePng(size: number): Uint8Array {
  return encodePng({ width: size, height: size, data: noise(size * size * 4) });
}

/** A draft keeping `png` as its base layer. */
function keeping(png: Uint8Array, overrides: Partial<Draft> = {}): Draft {
  return draft({
    base: { kind: "kept", layer: { ...layer, png } },
    ...overrides,
  });
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
      base: {
        kind: "kept",
        layer: { x: -160, y: 32, width: 64, height: 64, png },
      },
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

  it("drops a base layer once the draft that replaces its last is kept, without a list", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    expect(store.put(keeping(png))).toBe(true);
    const [first] = baseKeys(storage);
    // A copy of another symbol, read afresh, is another PNG.
    expect(store.put(keeping(png.slice()))).toBe(true);
    const [second, ...others] = baseKeys(storage);
    expect(others).toEqual([]);
    expect(second).not.toBe(first);
    expect(indexedBases(storage)).toEqual([second]);
    expect(store.put(draft())).toBe(true);
    expect(baseKeys(storage)).toEqual([]);
    expect(store.put(keeping(png))).toBe(true);
    store.remove("a");
    expect(baseKeys(storage)).toEqual([]);
    expect(storage.values.has("inkline-draft-bases")).toBe(false);
  });

  it("reads back only the draft it writes, not the one it replaces", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    expect(store.put(keeping(png))).toBe(true);
    const read: string[] = [];
    const load = storage.loadLocalStorage.bind(storage);
    storage.loadLocalStorage = (key): unknown => {
      if (key.startsWith("inkline-draft:")) read.push(key);
      return load(key);
    };
    // For each stroke: reading the draft it replaces would cost about as
    // much again as writing the new one.
    expect(store.put(keeping(png, { strokes: [stroke, stroke] }))).toBe(true);
    expect(read).toEqual(["inkline-draft:a"]);
  });

  it("keeps the draft that storage refused to replace, with its base layer", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    const original = keeping(png);
    expect(store.put(original)).toBe(true);
    const stored = baseKeys(storage);
    storage.refused.add("inkline-draft:a");
    expect(store.put(keeping(png.slice()))).toBe(false);
    expect(store.put(draft())).toBe(false);
    storage.refused.clear();
    // Too little room for another base layer.
    storage.quota = storage.used + 10;
    expect(store.put(keeping(noisePng(16)))).toBe(false);
    expect(baseKeys(storage)).toEqual(stored);
    expect(new DraftStore(storage, () => 1000).list()).toEqual([original]);
  });

  it("keeps a base layer while any draft names it, a held one too", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    const shared = keeping(png, { id: "b", savedAt: 900 });
    expect(store.put(keeping(png))).toBe(true);
    expect(store.put(shared)).toBe(true);
    const stored = baseKeys(storage);
    expect(stored).toHaveLength(1);
    // As an editor holds a draft it offers back, or restored.
    store.hold("b");
    expect(store.put(draft())).toBe(true);
    expect(baseKeys(storage)).toEqual(stored);
    expect(new DraftStore(storage, () => 1000).list()).toEqual([
      draft(),
      shared,
    ]);
    store.remove("b");
    expect(baseKeys(storage)).toEqual([]);
  });

  it("keeps a restored draft's base layer for the draft that replaces it", () => {
    const storage = new MemoryStorage();
    const written = keeping(noisePng(16));
    expect(new DraftStore(storage, () => 1000).put(written)).toBe(true);
    const [key] = baseKeys(storage);
    if (key === undefined) throw new Error("no base layer stored");
    // After a reload, another editor restores it as its own draft.
    const store = new DraftStore(storage, () => 1000);
    const [found] = store.forTarget(written.target);
    if (found === undefined) throw new Error("no draft offered");
    store.hold(found.id);
    const own = { ...found, id: "b", savedAt: 2000 };
    expect(store.put(own)).toBe(true);
    store.remove(found.id);
    store.release(found.id);
    expect(baseKeys(storage)).toEqual([key]);
    expect(storage.writes.get(key)).toBe(1);
    expect(new DraftStore(storage, () => 1000).list()).toEqual([own]);
  });

  it("keeps a base layer that a draft another store wrote names", () => {
    const storage = new MemoryStorage();
    const first = new DraftStore(storage, () => 1000);
    expect(first.put(keeping(png))).toBe(true);
    const second = new DraftStore(storage, () => 1000);
    const [found] = second.list();
    if (found === undefined) throw new Error("no draft listed");
    const other = { ...found, id: "b" };
    expect(second.put(other)).toBe(true);
    const stored = baseKeys(storage);
    expect(stored).toHaveLength(1);
    expect(first.put(draft())).toBe(true);
    first.remove("a");
    expect(baseKeys(storage)).toEqual(stored);
    expect(new DraftStore(storage, () => 1000).list()).toEqual([other]);
  });

  it("keeps a draft through any number of new base layers with room for two", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    const picture = noisePng(64);
    expect(store.put(keeping(picture))).toBe(true);
    const size = JSON.stringify(toBase64(picture)).length;
    // The new base layer is stored before the draft that names it, and the
    // old one dropped after; the index lists both meanwhile.
    storage.quota = storage.used + size + 100;
    expect(storage.quota).toBeLessThan(storage.used + 2 * size);
    let last = picture;
    for (let count = 0; count < 10; count++) {
      // As Copy from or Make ink do, each time a PNG of its own.
      last = picture.slice();
      expect(store.put(keeping(last))).toBe(true);
      expect(baseKeys(storage)).toHaveLength(1);
    }
    const [listed] = new DraftStore(storage, () => 1000).list();
    expect(listed?.base).toEqual({
      kind: "kept",
      layer: { ...layer, png: last },
    });
  });
});

describe("DraftStore.keepBase", () => {
  const kept = draft({ base: { kind: "kept", layer } });

  it("stores a PNG for the draft that keeps it, once", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    await store.keepBase(png);
    const [key] = baseKeys(storage);
    expect(baseKeys(storage)).toHaveLength(1);
    if (key === undefined) throw new Error("no base layer stored");
    expect(storage.loadLocalStorage(key)).toBe(toBase64(png));
    expect(store.put(kept)).toBe(true);
    expect(baseKeys(storage)).toEqual([key]);
    expect(storage.writes.get(key)).toBe(1);
    expect(store.list()[0]?.base).toEqual({ kind: "kept", layer });
  });

  it("does nothing for a PNG a draft has stored already", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    expect(store.put(kept)).toBe(true);
    const [key] = baseKeys(storage);
    if (key === undefined) throw new Error("no base layer stored");
    await store.keepBase(png);
    expect(baseKeys(storage)).toEqual([key]);
    expect(storage.writes.get(key)).toBe(1);
  });

  it("stores it again once another store has dropped it", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    await store.keepBase(png);
    // Nothing uses it, so listing the drafts drops it.
    new DraftStore(storage, () => 1000).list();
    expect(baseKeys(storage)).toEqual([]);
    await store.keepBase(png);
    expect(baseKeys(storage)).toHaveLength(1);
    expect(store.put(kept)).toBe(true);
    expect(store.list()[0]?.base).toEqual({ kind: "kept", layer });
  });

  it("leaves a stored PNG for no draft to the next list", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    await store.keepBase(png);
    expect(store.list()).toEqual([]);
    expect(baseKeys(storage)).toEqual([]);
  });

  it("writes and reads back in separate tasks", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    const steps: string[] = [];
    const save = storage.saveLocalStorage.bind(storage);
    const load = storage.loadLocalStorage.bind(storage);
    storage.saveLocalStorage = (key, value): void => {
      if (key.startsWith("inkline-draft-base:")) steps.push("write");
      save(key, value);
    };
    storage.loadLocalStorage = (key): unknown => {
      if (steps.at(-1) !== "read") steps.push("read");
      return load(key);
    };
    await store.keepBase(png, {
      pause: () => {
        steps.push("pause");
        return Promise.resolve();
      },
    });
    const write = steps.indexOf("write");
    expect(write).toBeGreaterThan(-1);
    expect(steps[write + 1]).toBe("pause");
    expect(steps[write + 2]).toBe("read");
  });

  it("pauses all through a large PNG", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    const data = new Uint8Array(400 * 400 * 4);
    for (let index = 0; index < data.length; index++) {
      data[index] = (index * 2654435761) >>> 24;
    }
    const large = encodePng({ width: 400, height: 400, data });
    const { pauses } = await paused((pause) =>
      store.keepBase(large, { pause }),
    );
    expect(pauses).toBeGreaterThanOrEqual(3);
    expect(baseKeys(storage)).toHaveLength(1);
  });

  it("keeps no PNG that reading would refuse", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    const bad = png.slice();
    const data = readChunks(bad).find(({ type }) => type === "IDAT");
    if (data === undefined) throw new Error("no image data");
    const at = data.data.byteOffset - bad.byteOffset;
    bad[at] = (bad[at] ?? 0) ^ 0xff;
    await store.keepBase(bad);
    expect(baseKeys(storage)).toEqual([]);
    expect(
      store.put(
        draft({ base: { kind: "kept", layer: { ...layer, png: bad } } }),
      ),
    ).toBe(false);
  });

  it("leaves a PNG storage refuses for put to report", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    storage.quota = 10;
    await store.keepBase(png);
    expect(baseKeys(storage)).toEqual([]);
    expect(store.put(kept)).toBe(false);
    storage.quota = Number.POSITIVE_INFINITY;
    expect(store.put(kept)).toBe(true);
    expect(store.list()[0]?.base).toEqual({ kind: "kept", layer });
  });

  it("stores no second copy of a PNG that a draft stored while it read it", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    const large = noisePng(200);
    let drawn = false;
    await paused((pause) =>
      store.keepBase(large, {
        pause: () => {
          // A stroke drawn meanwhile keeps a draft, which stores the PNG.
          if (!drawn && baseKeys(storage).length === 0) {
            drawn = store.put(keeping(large));
          }
          return pause();
        },
      }),
    );
    expect(drawn).toBe(true);
    // Not even for a moment: a large one takes long to write, and room.
    const written = [...storage.writes.keys()].filter((key) =>
      key.startsWith("inkline-draft-base:"),
    );
    expect(written).toEqual(baseKeys(storage));
    expect(written).toHaveLength(1);
  });

  it("drops its own copy of a PNG that a draft stored while it wrote it", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    let wrote = false;
    const save = storage.saveLocalStorage.bind(storage);
    storage.saveLocalStorage = (key, value): void => {
      if (key.startsWith("inkline-draft-base:") && value !== null) wrote = true;
      save(key, value);
    };
    let drawn = false;
    await store.keepBase(png, {
      pause: () => {
        if (wrote && !drawn) drawn = store.put(kept);
        return Promise.resolve();
      },
    });
    expect(drawn).toBe(true);
    expect(baseKeys(storage)).toHaveLength(1);
    expect(indexedBases(storage)).toEqual(baseKeys(storage));
    expect(new DraftStore(storage, () => 1000).list()).toEqual([kept]);
  });

  it("keeps a PNG stored ahead of its draft while another draft's base layer goes", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 1000);
    expect(store.put(kept)).toBe(true);
    const prepared = noisePng(16);
    let replaced = false;
    await store.keepBase(prepared, {
      pause: () => {
        if (!replaced) replaced = store.put(draft());
        return Promise.resolve();
      },
    });
    expect(replaced).toBe(true);
    const [key, ...others] = baseKeys(storage);
    expect(others).toEqual([]);
    expect(store.put(keeping(prepared, { id: "b" }))).toBe(true);
    expect(baseKeys(storage)).toEqual([key]);
    expect(storage.writes.get(key ?? "")).toBe(1);
  });
});

describe("decodeDraft", () => {
  it("keeps the strokes of a draft whose text cannot be read", () => {
    const stored = JSON.stringify({
      version: 2,
      id: "a",
      target: { kind: "file", path: "001.ink.png" },
      base: "none",
      savedAt: 1,
      text: { reading: 4 },
      ink: { strokes: [] },
    });
    const read = decodeDraft(stored);
    expect(read?.id).toBe("a");
    expect(read?.text).toBeUndefined();
  });

  it("reads what the store writes", () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage);
    for (const written of [
      draft({ fingerprint: "ab" }),
      draft({ id: "with-drawing", fingerprint: "ab", drawing: "cd" }),
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
      draft({ id: "f", gridOrigin: 1.5 }),
      draft({ id: "g", text: { reading: "TA\nDA", translation: "" } }),
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
      variant({ version: 1 }),
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
      variant({ layer: { ...good.layer, width: 0 } }),
      variant({ layer: { ...good.layer, x: 0.5 } }),
      variant({ savedAt: Number.NaN }),
      variant({ fingerprint: 5 }),
      variant({ ink: undefined }),
      variant({ ink: { ...good.ink, strokes: [{ tool: "brush" }] } }),
      // Its pixels are stored apart, never in the strokes' record.
      variant({
        ink: {
          ...good.ink,
          base: { x: 0, y: 0, width: 1, height: 1, png: "iVBORw0KGgo=" },
        },
      }),
    ]) {
      expect(decodeDraft(value, bases)).toBeUndefined();
    }
    expect(decodeDraft(stored, bases)?.base).toEqual({ kind: "kept", layer });
  });

  it("reads a draft whose grid cannot be read, without its grid", () => {
    const storage = new MemoryStorage();
    new DraftStore(storage).put(draft({ gridOrigin: 1.5 }));
    const stored = storage.loadLocalStorage("inkline-draft:a");
    if (typeof stored !== "string") throw new Error("not stored as text");
    const good = JSON.parse(stored) as Record<string, unknown>;
    for (const gridOrigin of ["1.5", null, [1.5]]) {
      expect(decodeDraft(JSON.stringify({ ...good, gridOrigin }))).toEqual(
        draft(),
      );
    }
  });

  it("keeps the name typed for a symbol, and reads one it cannot without it", () => {
    const storage = new MemoryStorage();
    new DraftStore(storage).put(draft({ name: "the gate" }));
    const stored = storage.loadLocalStorage("inkline-draft:a");
    if (typeof stored !== "string") throw new Error("not stored as text");
    const good = JSON.parse(stored) as Record<string, unknown>;
    expect(decodeDraft(stored)?.name).toBe("the gate");
    for (const name of [3, null, ["the gate"]]) {
      expect(decodeDraft(JSON.stringify({ ...good, name }))).toEqual(draft());
    }
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

describe("drawingOf", () => {
  it("is the same whatever the file's text says, and only then", async () => {
    const said = await writeText(png, "reading", ["TA"]);
    const other = await writeText(said, "reading", ["KA"]);
    expect(await fingerprintOf(said)).not.toBe(await fingerprintOf(other));
    expect(await drawingOf(said)).toBe(await drawingOf(other));
    expect(await drawingOf(said)).toBe(await fingerprintOf(png));
    const changed = encodePng(blank(3, 2));
    expect(await drawingOf(changed)).not.toBe(await drawingOf(png));
  });

  it("gives nothing for a file that is not a whole PNG", async () => {
    expect(await drawingOf(new TextEncoder().encode("x"))).toBeUndefined();
    expect(await drawingOf(png.subarray(0, 20))).toBeUndefined();
  });
});
