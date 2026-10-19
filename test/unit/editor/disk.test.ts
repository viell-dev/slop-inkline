import { describe, expect, it } from "vitest";
import { FileWatch, type Reading } from "../../../src/editor/disk.ts";

const file = (fingerprint: string, readable = true): Reading => ({
  kind: "file",
  fingerprint,
  readable,
});
const gone: Reading = { kind: "gone" };

describe("FileWatch", () => {
  it("takes any file as a change while it knows of none", () => {
    const watch = new FileWatch();
    expect(watch.differs("b")).toBe(true);
    expect(watch.noticed(file("b"), true)).toBe("ask");
    expect(watch.saving(file("b"))).toBe("ask");
    expect(watch.saving(file("c", false))).toBe("unreadable");
    // Once written, as by a new symbol's first save, it is known.
    watch.took("d");
    expect(watch.saving(file("d"))).toBe("write");
  });

  it("changes its version with the file known, for telling stale reads", () => {
    const watch = new FileWatch("a");
    const before = watch.version;
    watch.keep("b");
    expect(watch.noticed(file("c"), true)).toBe("ask");
    expect(watch.version).toBe(before);
    watch.took("b");
    expect(watch.version).not.toBe(before);
  });

  it("takes in a change with nothing unsaved, and asks once otherwise", () => {
    const watch = new FileWatch("a");
    expect(watch.noticed(file("a"), true)).toBe("nothing");
    expect(watch.noticed(file("b"), false)).toBe("reload");
    expect(watch.noticed(file("b"), true)).toBe("ask");
    // Asked about already, as when the question was put off.
    expect(watch.noticed(file("b"), true)).toBe("nothing");
    // Another change is asked about again.
    expect(watch.noticed(file("c"), true)).toBe("ask");
  });

  it("asks again before a save would replace a change", () => {
    const watch = new FileWatch("a");
    expect(watch.noticed(file("b"), true)).toBe("ask");
    expect(watch.saving(file("b"))).toBe("ask");
    expect(watch.saving(file("a"))).toBe("write");
  });

  it("saves over a change once that is chosen, and asks about the next", () => {
    const watch = new FileWatch("a");
    watch.keep("b");
    expect(watch.differs("b")).toBe(false);
    expect(watch.noticed(file("b"), true)).toBe("nothing");
    expect(watch.saving(file("b"))).toBe("write");
    expect(watch.saving(file("c"))).toBe("ask");
    // Once saved, the file is the editor's again.
    watch.took("d");
    expect(watch.differs("b")).toBe(true);
    expect(watch.fingerprint).toBe("d");
  });

  it("never saves over a file it cannot read, and says so once", () => {
    const watch = new FileWatch("a");
    expect(watch.noticed(file("b", false), false)).toBe("unreadable");
    expect(watch.noticed(file("b", false), false)).toBe("nothing");
    expect(watch.saving(file("b", false))).toBe("unreadable");
    // Readable again, as when sync finishes writing it.
    expect(watch.noticed(file("c"), false)).toBe("reload");
  });

  it("makes a deleted file again when saving", () => {
    const watch = new FileWatch("a");
    expect(watch.noticed(gone, true)).toBe("gone");
    expect(watch.saving(gone)).toBe("write");
  });

  it("takes in a reloaded file as its own", () => {
    const watch = new FileWatch("a");
    expect(watch.noticed(file("b"), true)).toBe("ask");
    watch.took("b");
    expect(watch.noticed(file("b"), true)).toBe("nothing");
    expect(watch.noticed(file("a"), true)).toBe("ask");
  });
});
