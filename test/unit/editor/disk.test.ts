import { describe, expect, it } from "vitest";
import { FileWatch, type Reading } from "../../../src/editor/disk.ts";

const file = (fingerprint: string, readable = true): Reading => ({
  kind: "file",
  fingerprint,
  readable,
});
const gone: Reading = { kind: "gone" };
/** A file whose fingerprint without its text is `drawing`. */
const drawn = (fingerprint: string, drawing: string, readable = true) =>
  ({ kind: "file", fingerprint, drawing, readable }) as const;

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

  it("takes in a change to the text alone, whatever is unsaved", () => {
    const watch = new FileWatch("a", "d");
    expect(watch.noticed(drawn("b", "d"), false)).toBe("text");
    expect(watch.noticed(drawn("b", "d"), true)).toBe("text");
    expect(watch.saving(drawn("b", "d"))).toBe("text");
  });

  it("moves on to the file whose text it took in, and nothing else", () => {
    const watch = new FileWatch("a", "d");
    const before = watch.version;
    watch.tookText(drawn("b", "d"));
    expect(watch.fingerprint).toBe("b");
    expect(watch.drawing).toBe("d");
    expect(watch.version).not.toBe(before);
    expect(watch.noticed(drawn("b", "d"), true)).toBe("nothing");
    expect(watch.saving(drawn("b", "d"))).toBe("write");
    // The file it left is a change now, and one to the text again.
    expect(watch.noticed(drawn("a", "d"), true)).toBe("text");
  });

  it("still asks about a change to the drawing, with text or without", () => {
    const watch = new FileWatch("a", "d");
    expect(watch.noticed(drawn("b", "e"), false)).toBe("reload");
    expect(watch.noticed(drawn("b", "e"), true)).toBe("ask");
    expect(watch.saving(drawn("c", "e"))).toBe("ask");
    // Not lost by taking in text meanwhile.
    watch.tookText(drawn("f", "d"));
    expect(watch.noticed(drawn("g", "e"), true)).toBe("ask");
  });

  it("calls nothing a change to the text where it cannot tell", () => {
    // Neither side known, as for a file that is not a whole PNG, which is a
    // change like any other: undefined must not match undefined.
    expect(new FileWatch("a").noticed(file("b"), true)).toBe("ask");
    expect(new FileWatch("a").noticed(drawn("b", "d"), true)).toBe("ask");
    expect(new FileWatch("a", "d").noticed(file("b"), true)).toBe("ask");
    expect(new FileWatch("a", "d").saving(file("b"))).toBe("ask");
    // A file known only by what `holds` said, before its save ends.
    const watch = new FileWatch("a", "d");
    watch.took("b");
    expect(watch.noticed(drawn("c", "d"), true)).toBe("ask");
  });

  it("never calls a file it cannot read a change to the text", () => {
    const watch = new FileWatch("a", "d");
    expect(watch.noticed(drawn("b", "d", false), false)).toBe("unreadable");
    expect(watch.saving(drawn("b", "d", false))).toBe("unreadable");
  });

  it("goes by a change that saving is to replace, as well as the file", () => {
    const watch = new FileWatch("a", "d");
    watch.keep("b", "e");
    // On top of what was kept: its drawing is the one saving replaces.
    expect(watch.noticed(drawn("c", "e"), true)).toBe("text");
    expect(watch.saving(drawn("c", "e"))).toBe("text");
    watch.tookText(drawn("c", "e"));
    expect(watch.fingerprint).toBe("a");
    expect(watch.differs("c")).toBe(false);
    expect(watch.saving(drawn("c", "e"))).toBe("write");
    // That is the only one saving replaces.
    expect(watch.saving(drawn("b", "e"))).toBe("text");
    expect(watch.noticed(drawn("f", "g"), true)).toBe("ask");
    // Once saved, what was kept is forgotten with the rest.
    watch.took("h", "i");
    expect(watch.noticed(drawn("j", "e"), true)).toBe("ask");
  });

  it("takes in a reloaded file as its own", () => {
    const watch = new FileWatch("a");
    expect(watch.noticed(file("b"), true)).toBe("ask");
    watch.took("b");
    expect(watch.noticed(file("b"), true)).toBe("nothing");
    expect(watch.noticed(file("a"), true)).toBe("ask");
  });
});
