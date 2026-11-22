// Keeping a drawing safe, in the orders that saves, changes to the file,
// drafts, and questions meet in, which end-to-end tests reach only by holding
// Obsidian back. The host and the canvas's codec are fakes. The drawing
// session and the draft store are real, and the codec writes and opens real
// symbol files, with blank pixels, so that the file's fingerprints, its text,
// and what it opens to are as they would be.

import { describe, expect, it, vi } from "vitest";
import {
  DraftStore,
  drawingOf,
  fingerprintOf,
  type Draft,
  type DraftTarget,
  type VaultStorage,
} from "../../../src/editor/drafts.ts";
import {
  DecodedBases,
  Keeping,
  type InkCodec,
  type KeepingHost,
  type KeepingOptions,
  type KeepingText,
  type Question,
  type SymbolFile,
  type SymbolUses,
} from "../../../src/editor/keeping.ts";
import { DrawingSession } from "../../../src/editor/session.ts";
import { StatusLine } from "../../../src/editor/status.ts";
import { writeInkFile } from "../../../src/format/ink-file.ts";
import { readChunks } from "../../../src/format/png.ts";
import { imageHeight, type Stroke } from "../../../src/format/record.ts";
import {
  readText,
  textProblem,
  writeText,
  type SymbolText,
  type TextField,
} from "../../../src/format/text.ts";
import { openInk } from "../../../src/ink/canvas.ts";
import {
  emptyDocument,
  recordFromDocument,
  type InkDocument,
} from "../../../src/ink/document.ts";
import {
  fieldText,
  isTouched,
  noText,
  takeFile,
  textFields,
  typedValues,
  type TextChanges,
  type TypedText,
} from "../../../src/notes/text-fields.ts";
import { blank, encodePng } from "../../support/png.ts";

const path = "Symbols/one.ink.png";
const pixels = encodePng(blank(4, imageHeight));

/** A pen stroke across the line box at `x`, in pixels. */
function stroke(x: number): Stroke {
  return { tool: "pen", size: 256, points: [x * 16, 32 * 16, x * 16, 96 * 16] };
}

/** A symbol file holding `document`, with any readings and translations. */
async function fileOf(
  document: InkDocument,
  text: Partial<SymbolText> = {},
): Promise<Uint8Array> {
  let bytes = await writeInkFile(pixels, recordFromDocument(document, 0));
  for (const field of textFields) {
    const values = text[field];
    if (values !== undefined) bytes = await writeText(bytes, field, values);
  }
  return bytes;
}

/** What a symbol file holds: its strokes, and its readings and translations. */
async function heldBy(bytes: Uint8Array | undefined): Promise<{
  strokes: number;
  text: SymbolText;
}> {
  if (bytes === undefined) throw new Error("no file");
  const ink = await openInk(bytes);
  if (ink.kind !== "editable") throw new Error(`the file is ${ink.kind}`);
  return {
    strokes: ink.document.strokes.length,
    text: await readText(readChunks(bytes)),
  };
}

/** A promise, and what settles it. */
function gate(): { readonly wait: Promise<void>; readonly open: () => void } {
  let open = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    open = () => {
      resolve();
    };
  });
  return { wait, open };
}

/** The symbol's file on disk, whose next read can be held back. */
class SymbolOnDisk implements SymbolFile {
  readonly path = path;
  bytes: Uint8Array | undefined;
  reads = 0;
  #next: Promise<void> | undefined;

  constructor(bytes: Uint8Array | undefined) {
    this.bytes = bytes;
  }

  /**
   * Holds the next read back, with what the file holds as it starts, until the
   * function returned lets it go.
   */
  holdNextRead(): () => void {
    const held = gate();
    this.#next = held.wait;
    return held.open;
  }

  async read(): Promise<Uint8Array | undefined> {
    this.reads++;
    const bytes = this.bytes;
    const next = this.#next;
    this.#next = undefined;
    if (next !== undefined) await next;
    return bytes;
  }
}

/** Local storage in memory, whose writes to some keys are dropped. */
class MemoryStorage implements VaultStorage {
  readonly values = new Map<string, string>();
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
    if (!this.refused.has(key)) this.values.set(key, JSON.stringify(data));
  }
}

/**
 * The readings and translations' fields, as `TextFields` decides them, from
 * the same plain functions, without the elements that show them.
 */
class Fields implements KeepingText {
  given: SymbolText;
  readonly #typed: Record<TextField, string>;

  constructor(given: SymbolText = noText) {
    this.given = given;
    this.#typed = {
      reading: fieldText(given.reading),
      translation: fieldText(given.translation),
    };
  }

  /** Types `text` in `field`, as a person would. */
  type(field: TextField, text: string): void {
    this.#typed[field] = text;
  }

  get touched(): boolean {
    return textFields.some((field) =>
      isTouched(this.given[field], this.#typed[field]),
    );
  }

  changes(): TextChanges {
    const changes: TextChanges = {};
    for (const field of textFields) {
      if (isTouched(this.given[field], this.#typed[field])) {
        changes[field] = typedValues(this.#typed[field]);
      }
    }
    return changes;
  }

  typed(): TypedText {
    const typed: TypedText = {};
    for (const field of textFields) {
      const text = this.#typed[field];
      if (isTouched(this.given[field], text)) typed[field] = text;
    }
    return typed;
  }

  restore(typed: TypedText): void {
    for (const field of textFields) {
      const text = typed[field];
      if (text !== undefined) this.#typed[field] = text;
    }
  }

  problem(): string | undefined {
    for (const field of textFields) {
      const text = this.#typed[field];
      if (!isTouched(this.given[field], text)) continue;
      const problem = textProblem(typedValues(text));
      if (problem !== undefined) return problem;
    }
    return undefined;
  }

  take(now: SymbolText): TextField[] {
    const conflicts: TextField[] = [];
    for (const field of textFields) {
      const { typed, conflict } = takeFile(
        this.given[field],
        this.#typed[field],
        now[field],
      );
      this.#typed[field] = typed;
      if (conflict) conflicts.push(field);
    }
    this.given = now;
    return conflicts;
  }

  conflicts(now: SymbolText): TextField[] {
    return textFields.filter(
      (field) =>
        takeFile(this.given[field], this.#typed[field], now[field]).conflict,
    );
  }

  drop(fields: readonly TextField[]): void {
    for (const field of fields) {
      this.#typed[field] = fieldText(this.given[field]);
    }
  }

  saved(changes: TextChanges, sent: TypedText): void {
    this.given = { ...this.given, ...changes };
    for (const field of textFields) {
      const values = changes[field];
      if (values !== undefined && this.#typed[field] === sent[field]) {
        this.#typed[field] = fieldText(values);
      }
    }
  }

  focus(): void {
    // Nothing to focus without elements.
  }
}

/** What a test can do along the way of a save, as the host's write runs. */
interface WriteHooks {
  /** Waited for first, so that the save is running meanwhile. */
  beforeWrite?: () => Promise<void>;
  /** Runs once, just before the write looks at the file a last time. */
  beforeCheck?: () => Promise<void>;
  /** What the next write leaves when it is cut short, as by a full disk. */
  cutShort?: Uint8Array;
}

interface Setup {
  /** The drawing its file holds; a new symbol has no file until saved. */
  readonly existing?: InkDocument;
  readonly uses?: SymbolUses;
  readonly drafts?: { readonly store: DraftStore };
  readonly fields?: Fields;
  readonly decode?: InkCodec["drawableBase"];
}

/** An editor's keeping, with a fake host that records what it is asked. */
async function editor(setup: Setup = {}) {
  const said: string[] = [];
  const notices: string[] = [];
  const asked: Question[] = [];
  const open = new Set<Question>();
  const calls: string[] = [];
  /** What each write that resolved wrote. */
  const writes: Uint8Array[] = [];
  /**
   * Whether the editor is closing, and how often it has looked: once a read
   * of the file ends, it looks before anything else.
   */
  const state = { closing: false, looked: 0 };
  const hooks: WriteHooks = {};
  const existing = setup.existing;
  const disk = new SymbolOnDisk(
    existing === undefined ? undefined : await fileOf(existing),
  );
  const opened =
    disk.bytes === undefined ? undefined : await openInk(disk.bytes);
  if (opened !== undefined && opened.kind !== "editable") {
    throw new Error("the file does not open");
  }
  const document = opened?.document ?? emptyDocument;
  const session = new DrawingSession(document);
  const line = new StatusLine(() => undefined);
  const nameField = { value: existing === undefined ? "" : "one" };
  const fields = setup.fields;
  const codec: InkCodec = {
    async save(drawing, _base, carried) {
      const record = recordFromDocument(drawing, 0);
      return {
        bytes: await writeInkFile(pixels, record, carried),
        record,
        left: 0,
      };
    },
    open: openInk,
    drawableBase:
      setup.decode ??
      (() => Promise.reject(new Error("no canvas in unit tests"))),
  };
  const host: KeepingHost = {
    closing: () => {
      state.looked++;
      return state.closing;
    },
    say: (text, holds) => {
      said.push(text);
      line.say(text, holds);
    },
    notice: (text) => {
      notices.push(text);
    },
    ask: (question) => {
      asked.push(question);
      open.add(question);
    },
    questionsOpen: () => open.size > 0,
    onTop: () => open.size === 0,
    updateControls: () => {
      calls.push("controls");
    },
    requestRender: () => {
      calls.push("render");
    },
    fitView: () => {
      calls.push("fit");
    },
    shift: (dx) => {
      calls.push(`shift ${String(dx)}`);
    },
    refocus: () => {
      calls.push("refocus");
    },
    finish: () => {
      calls.push("finish");
      close();
    },
    typedName: () => nameField.value,
    showName: (name, typed) => {
      if (typed !== undefined && nameField.value === typed) {
        nameField.value = name;
      }
    },
    restoreName: (name) => {
      nameField.value = name;
    },
    showUnnamed: () => undefined,
    text: () => fields,
    showText: () => {
      calls.push("showText");
    },
    showTextSummary: () => undefined,
    showWaiting: () => undefined,
    later: (then) => {
      calls.push("later");
      setTimeout(then, 0);
    },
  };
  const { uses } = setup;
  const fingerprint =
    disk.bytes === undefined ? undefined : await fingerprintOf(disk.bytes);
  const drawing =
    disk.bytes === undefined ? undefined : await drawingOf(disk.bytes);
  const options: KeepingOptions = {
    title: "New symbol",
    ...(existing === undefined ? {} : { name: "one" }),
    document,
    ...(opened === undefined ? {} : { carried: opened.carried }),
    write: async (bytes, _record, keepDraft, holds, _name, check) => {
      await hooks.beforeWrite?.();
      keepDraft();
      const before = hooks.beforeCheck;
      delete hooks.beforeCheck;
      await before?.();
      await check();
      // As in Inkline: the host says what the file holds only where its write
      // can still reject after the file changed, as when the write is cut
      // short, or once it has made a new symbol's file, whose embed is still
      // to go in. What a write that resolves wrote, the editor records itself.
      const part = hooks.cutShort;
      if (part !== undefined) {
        delete hooks.cutShort;
        disk.bytes = part;
        holds(await fingerprintOf(part));
        throw new Error("the disk is full");
      }
      const made = disk.bytes === undefined;
      disk.bytes = bytes;
      writes.push(bytes);
      if (made) holds(await fingerprintOf(bytes));
      return true;
    },
    ...(uses === undefined ? {} : { uses: () => uses }),
    // A new symbol's file is made by its first save.
    file: () => (disk.bytes === undefined ? undefined : disk),
    ...(fingerprint === undefined ? {} : { fingerprint }),
    ...(drawing === undefined ? {} : { drawing }),
    ...(setup.drafts === undefined
      ? {}
      : {
          drafts: {
            store: setup.drafts.store,
            target: (): DraftTarget => ({ kind: "file", path }),
          },
        }),
  };
  const keeping = new Keeping(options, {
    host,
    session,
    decoded: new DecodedBases(),
    line,
    codec,
    picture: {
      previewing: () => false,
      applyBeforeSave: () => Promise.resolve(true),
    },
  });
  /**
   * Closes the editor, as `InkEditorModal` does once it has finished: its
   * questions close unanswered, and it lets go of the drafts it holds.
   */
  const close = (): void => {
    state.closing = true;
    for (const asking of [...open]) {
      open.delete(asking);
      asking.dismissed?.();
    }
    keeping.release();
  };
  /** The open question titled `title`. */
  const question = (title: string): Question => {
    const found = [...open].find((asking) => asking.title === title);
    if (found === undefined) throw new Error(`no question "${title}"`);
    return found;
  };
  return {
    keeping,
    session,
    disk,
    said,
    notices,
    asked,
    open,
    calls,
    writes,
    state,
    hooks,
    nameField,
    /** Draws a stroke at `x`, as the pointer would. */
    draw(x: number): void {
      session.begin({ x, y: 40 });
      session.end({ x: x + 10, y: 120 });
      keeping.keepDraft();
    },
    /** Answers `title` with `text`, as its button does, which closes it. */
    answer(title: string, text: string): void {
      const asking = question(title);
      const found = asking.answers.find((answer) => answer.text === text);
      if (found === undefined) throw new Error(`no answer "${text}"`);
      if (!state.closing && !keeping.retired) found.act();
      open.delete(asking);
    },
    /** Closes `title` unanswered, as its Not now button or Esc does. */
    dismiss(title: string): void {
      const asking = question(title);
      open.delete(asking);
      asking.dismissed?.();
    },
    close,
    /**
     * Waits until the editor has read the file as it is now and responded,
     * with no other read under way, by reporting a change to it, as the vault
     * would. A report starts a read at once, unless one is under way: then the
     * editor reads again once it has responded to that one, and this reports
     * again until a read starts at once. Only while the editor is open and no
     * save runs.
     */
    async settled(): Promise<void> {
      for (;;) {
        const reads = disk.reads;
        keeping.touched(path);
        if (disk.reads > reads) break;
        await vi.waitFor(() => {
          expect(disk.reads).toBeGreaterThan(reads);
        });
      }
      // Once the read ends, the editor looks whether it has closed, first.
      const looked = state.looked;
      await vi.waitFor(() => {
        expect(state.looked).toBeGreaterThan(looked);
      });
    },
  };
}

/** What a change made elsewhere is asked about as. */
const changedOnDisk = "The symbol changed on disk";

describe("Keeping", () => {
  it("saves the drawing, follows the file it wrote, and asks nothing about it", async () => {
    const editing = await editor({ existing: { strokes: [stroke(10)] } });
    // A report about another file reads nothing, as a read would start at
    // once.
    editing.keeping.touched("Symbols/other.ink.png");
    expect(editing.disk.reads).toBe(0);
    editing.draw(30);
    expect(editing.keeping.unsaved).toBe(true);
    await editing.keeping.saveOnly();
    expect(editing.writes).toHaveLength(1);
    expect(editing.keeping.unsaved).toBe(false);
    expect(editing.said.at(-1)).toBe("Saved");
    expect((await heldBy(editing.disk.bytes)).strokes).toBe(2);
    // The look at the file after the save, and the vault's report of its
    // write, find what the editor wrote, which changes nothing.
    await editing.settled();
    expect(editing.asked).toHaveLength(0);
    expect(editing.said.at(-1)).toBe("Saved");
  });

  it("writes over what its own write cut short left, which it cannot read", async () => {
    const editing = await editor({ existing: { strokes: [stroke(10)] } });
    editing.draw(30);
    // The start of a PNG's signature, and nothing more.
    editing.hooks.cutShort = new Uint8Array([137, 80, 78, 71]);
    await editing.keeping.saveOnly();
    expect(editing.writes).toHaveLength(0);
    expect(editing.said.at(-1)).toBe("Not saved: the disk is full");
    // The look at the file after the save finds what the host said it left.
    await editing.settled();
    expect(editing.notices).toEqual([
      "Could not save the symbol: the disk is full",
    ]);
    await editing.keeping.saveOnly();
    expect(editing.writes).toHaveLength(1);
    expect(editing.said.at(-1)).toBe("Saved");
    expect((await heldBy(editing.disk.bytes)).strokes).toBe(2);
  });

  it("keeps a draft of unsaved strokes, and drops it once they are saved", async () => {
    const store = new DraftStore(new MemoryStorage());
    const editing = await editor({
      existing: { strokes: [stroke(10)] },
      drafts: { store },
    });
    editing.draw(30);
    expect(store.list().map(({ id }) => id)).toEqual([editing.keeping.draftId]);
    await editing.keeping.saveOnly();
    expect(store.list()).toEqual([]);
  });

  it("does not make an empty new symbol", async () => {
    const editing = await editor();
    await editing.keeping.saveOnly();
    expect(editing.writes).toHaveLength(0);
    expect(editing.said).toEqual(["Not saved: nothing drawn yet"]);
  });

  it("asks about a file changed on disk while the drawing is unsaved, and takes in one changed while it was not", async () => {
    const unsaved = await editor({ existing: { strokes: [stroke(10)] } });
    unsaved.draw(30);
    unsaved.disk.bytes = await fileOf({ strokes: [stroke(50)] });
    unsaved.keeping.touched(path);
    await vi.waitFor(() => {
      expect(unsaved.asked.map(({ title }) => title)).toEqual([changedOnDisk]);
    });
    expect(unsaved.session.document.strokes).toHaveLength(2);

    const saved = await editor({ existing: { strokes: [stroke(10)] } });
    saved.disk.bytes = await fileOf({ strokes: [stroke(50), stroke(60)] });
    saved.keeping.touched(path);
    await vi.waitFor(() => {
      expect(saved.said).toEqual(["Reloaded: the file changed on disk"]);
    });
    expect(saved.session.document.strokes).toHaveLength(2);
    expect(saved.asked).toHaveLength(0);
  });

  it("reads the file again after a save, not while it runs, when the vault reports a change meanwhile", async () => {
    const editing = await editor({ existing: { strokes: [stroke(10)] } });
    editing.draw(30);
    const writing = gate();
    editing.hooks.beforeWrite = () => writing.wait;
    const saving = editing.keeping.saveOnly();
    await vi.waitFor(() => {
      expect(editing.keeping.saving).toBe(true);
    });
    const reads = editing.disk.reads;
    editing.keeping.touched(path);
    // Not now, as a read would start at once.
    expect(editing.disk.reads).toBe(reads);
    writing.open();
    await saving;
    // One read as the write looks at the file, and the check after the save,
    // which starts as it ends.
    expect(editing.disk.reads).toBeGreaterThanOrEqual(reads + 2);
    await editing.settled();
    expect(editing.asked).toHaveLength(0);
    expect(editing.said.at(-1)).toBe("Saved");
  });

  it("reads the file once more after a read that a change was reported during", async () => {
    const editing = await editor({ existing: { strokes: [stroke(10)] } });
    const letGo = editing.disk.holdNextRead();
    editing.keeping.touched(path);
    editing.disk.bytes = await fileOf({ strokes: [stroke(50), stroke(60)] });
    editing.keeping.touched(path);
    letGo();
    await vi.waitFor(() => {
      expect(editing.said).toEqual(["Reloaded: the file changed on disk"]);
    });
    expect(editing.session.document.strokes).toHaveLength(2);
  });

  it("sets aside a read of the file that a save overtook", async () => {
    const editing = await editor({ existing: { strokes: [stroke(10)] } });
    editing.draw(30);
    // A read of the file as it was before the save, which ends after it.
    const letGo = editing.disk.holdNextRead();
    editing.keeping.touched(path);
    await editing.keeping.saveOnly();
    expect(editing.writes).toHaveLength(1);
    letGo();
    await editing.settled();
    // Taken in, the old read would have reloaded the drawing from before the
    // save, as the drawing is saved now.
    expect(editing.said).not.toContain("Reloaded: the file changed on disk");
    expect(editing.session.document.strokes).toHaveLength(2);
    expect(editing.asked).toHaveLength(0);
  });

  it("stays open for strokes drawn while saving, and says what is left", async () => {
    const editing = await editor({ existing: { strokes: [stroke(10)] } });
    editing.draw(30);
    const writing = gate();
    editing.hooks.beforeWrite = () => writing.wait;
    const closing = editing.keeping.saveAndClose();
    await vi.waitFor(() => {
      expect(editing.keeping.saving).toBe(true);
    });
    editing.draw(50);
    writing.open();
    await closing;
    expect(editing.calls).not.toContain("finish");
    expect(editing.keeping.unsaved).toBe(true);
    expect(editing.said.at(-1)).toBe(
      "Saved, except for what changed while saving",
    );
    expect((await heldBy(editing.disk.bytes)).strokes).toBe(2);
  });

  it("starts a save again once it has ended, when it finds a change to the file's text alone", async () => {
    const editing = await editor({ existing: { strokes: [stroke(10)] } });
    editing.draw(30);
    editing.hooks.beforeCheck = async () => {
      const bytes = editing.disk.bytes;
      if (bytes === undefined) throw new Error("no file");
      editing.disk.bytes = await writeText(bytes, "reading", ["elsewhere"]);
    };
    await editing.keeping.saveOnly();
    // The first save stopped without a word of its own, and the second wrote.
    await vi.waitFor(() => {
      expect(editing.writes).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(editing.said.at(-1)).toBe("Saved");
    });
    expect(editing.said).toContain(
      "Readings and translations updated: the file changed on disk",
    );
    expect(editing.notices).toHaveLength(0);
    const held = await heldBy(editing.disk.bytes);
    expect(held.strokes).toBe(2);
    expect(held.text.reading).toEqual(["elsewhere"]);
  });

  it.each(["Next", "Save and close"] as const)(
    "goes on with %s through a change to the file's text found as it saves",
    async (how) => {
      const editing = await editor({ existing: { strokes: [stroke(10)] } });
      editing.draw(30);
      editing.hooks.beforeCheck = async () => {
        const bytes = editing.disk.bytes;
        if (bytes === undefined) throw new Error("no file");
        editing.disk.bytes = await writeText(bytes, "reading", ["elsewhere"]);
      };
      const advance = vi.fn();
      await (how === "Next"
        ? editing.keeping.saveAndNext(advance)
        : editing.keeping.saveAndClose());
      // The save starts again once what waited on it has heard that it
      // stopped: Next, for one, does nothing while it is still under way.
      await vi.waitFor(() => {
        expect(
          how === "Next"
            ? advance.mock.calls.length
            : editing.calls.filter((call) => call === "finish").length,
        ).toBe(1);
      });
      expect(editing.writes).toHaveLength(1);
      const held = await heldBy(editing.disk.bytes);
      expect(held.strokes).toBe(2);
      expect(held.text.reading).toEqual(["elsewhere"]);
    },
  );

  it("writes nothing when the file changed a field that was typed in", async () => {
    const fields = new Fields();
    const editing = await editor({
      existing: { strokes: [stroke(10)] },
      fields,
    });
    editing.draw(30);
    fields.type("reading", "mine");
    editing.hooks.beforeCheck = async () => {
      const bytes = editing.disk.bytes;
      if (bytes === undefined) throw new Error("no file");
      editing.disk.bytes = await writeText(bytes, "reading", ["theirs"]);
    };
    await editing.keeping.saveOnly();
    // Nor does it start again, which it would ask for as it ended.
    expect(editing.calls).not.toContain("later");
    await editing.settled();
    expect(editing.writes).toHaveLength(0);
    expect(editing.said.at(-1)).toBe(
      "Not saved: the file changed text you typed, so look at what it now says and save again",
    );
    expect(editing.notices).toHaveLength(0);
    expect(editing.calls).toContain("showText");
    expect(fields.typed()).toEqual({ reading: "mine" });
    // Seen, what they typed is theirs to save, over what the file says.
    await editing.keeping.saveOnly();
    expect(editing.writes).toHaveLength(1);
    expect((await heldBy(editing.disk.bytes)).text.reading).toEqual(["mine"]);
  });

  it("goes on with a save that stopped to ask about a change on disk, once the drawing is kept", async () => {
    const editing = await editor({ existing: { strokes: [stroke(10)] } });
    editing.draw(30);
    editing.hooks.beforeCheck = async () => {
      editing.disk.bytes = await fileOf({ strokes: [stroke(50)] });
    };
    await editing.keeping.saveOnly();
    expect(editing.writes).toHaveLength(0);
    expect(editing.said).toContain("Not saved: the file changed on disk");
    expect(editing.asked.map(({ title }) => title)).toEqual([changedOnDisk]);
    editing.answer(changedOnDisk, "Keep mine");
    await vi.waitFor(() => {
      expect(editing.writes).toHaveLength(1);
    });
    expect((await heldBy(editing.disk.bytes)).strokes).toBe(2);
    expect(editing.asked).toHaveLength(1);
  });

  it.each(["Keep mine", "dismissed"] as const)(
    "takes in a change to the text alone once the question about another change is answered: %s",
    async (how) => {
      const first = { strokes: [stroke(10)] };
      const editing = await editor({ existing: first });
      editing.draw(30);
      editing.disk.bytes = await fileOf({ strokes: [stroke(50)] });
      await editing.settled();
      expect(editing.open.size).toBe(1);
      // The file goes back to its drawing, with a reading added, while the
      // question has what the other change read to go on with.
      editing.disk.bytes = await fileOf(first, { reading: ["elsewhere"] });
      await editing.settled();
      const updated =
        "Readings and translations updated: the file changed on disk";
      expect(editing.said).not.toContain(updated);
      if (how === "Keep mine") editing.answer(changedOnDisk, "Keep mine");
      else editing.dismiss(changedOnDisk);
      await vi.waitFor(() => {
        expect(editing.said).toContain(updated);
      });
      expect(editing.asked).toHaveLength(1);
      expect(editing.session.document.strokes).toHaveLength(2);
    },
  );

  it("asks one Replace question for every save that waits on it", async () => {
    const editing = await editor({
      existing: { strokes: [stroke(10)] },
      uses: { links: 3, notes: 2 },
    });
    editing.draw(30);
    const saves = [
      editing.keeping.saveOnly(),
      editing.keeping.saveAndClose(),
      editing.keeping.saveOnly(),
    ];
    const title = "Change one everywhere?";
    expect(editing.asked.map((asking) => asking.title)).toEqual([title]);
    editing.answer(title, "Replace");
    await Promise.all(saves);
    expect(editing.asked).toHaveLength(1);
    expect(editing.writes.length).toBeGreaterThan(0);
    expect(editing.calls.filter((call) => call === "finish")).toHaveLength(1);
    // Replace was chosen: a later change saves without asking again.
    editing.state.closing = false;
    editing.draw(50);
    await editing.keeping.saveOnly();
    expect(editing.asked).toHaveLength(1);
  });

  it("saves and goes on to the next symbol once, however often Next is asked", async () => {
    const editing = await editor({ existing: { strokes: [stroke(10)] } });
    editing.draw(30);
    const advance = vi.fn();
    await Promise.all([
      editing.keeping.saveAndNext(advance),
      editing.keeping.saveAndNext(advance),
    ]);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(editing.writes).toHaveLength(1);
  });

  it("settles its draft once as a save ends after it retired, with the time it was kept", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage, () => 10_000);
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const editing = await editor({
        existing: { strokes: [stroke(10)] },
        drafts: { store },
      });
      editing.draw(30);
      const key = `inkline-draft:${editing.keeping.draftId}`;
      const writing = gate();
      editing.hooks.beforeWrite = () => writing.wait;
      const saving = editing.keeping.saveOnly();
      await vi.waitFor(() => {
        expect(editing.keeping.saving).toBe(true);
      });
      now.mockReturnValue(2000);
      expect(editing.keeping.retire()).toBe(true);
      expect(editing.keeping.retire()).toBe(false);
      expect(store.keptAt(editing.keeping.draftId)).toBe(2000);
      const kept = storage.writes.get(key) ?? 0;
      now.mockReturnValue(3000);
      writing.open();
      await saving;
      // Retired, the save stopped before writing, and the draft was kept once
      // more, for the file, with the time it was kept.
      expect(editing.writes).toHaveLength(0);
      expect(storage.writes.get(key)).toBe(kept + 1);
      expect(store.keptAt(editing.keeping.draftId)).toBe(2000);
      const [draft] = store.list();
      expect(draft?.strokes).toHaveLength(2);
      expect(draft?.base).toEqual({ kind: "none" });
      // Nothing more is kept or saved, and a save says nothing.
      const words = editing.said.length;
      editing.keeping.keepDraft();
      await editing.keeping.saveOnly();
      expect(storage.writes.get(key)).toBe(kept + 1);
      expect(editing.said).toHaveLength(words);
    } finally {
      now.mockRestore();
    }
  });

  it("does not bring back a draft that went while a save ran after it retired, nor forget one", async () => {
    const store = new DraftStore(new MemoryStorage());
    const editing = await editor({
      existing: { strokes: [stroke(10)] },
      drafts: { store },
    });
    editing.draw(30);
    const writing = gate();
    editing.hooks.beforeWrite = () => writing.wait;
    const saving = editing.keeping.saveOnly();
    await vi.waitFor(() => {
      expect(editing.keeping.saving).toBe(true);
    });
    expect(editing.keeping.retire()).toBe(true);
    // Another load of Inkline restored or discarded it meanwhile.
    store.remove(editing.keeping.draftId);
    writing.open();
    await saving;
    expect(store.list()).toEqual([]);
    // Nor does it try to, which would fail, as it has no time it was kept.
    expect(editing.notices).toEqual([
      "Could not save the symbol: Inkline was disabled",
    ]);
    // One kept as it retired stays, whatever asks to forget it.
    const other = await editor({
      existing: { strokes: [stroke(10)] },
      drafts: { store },
    });
    other.draw(30);
    expect(other.keeping.retire()).toBe(true);
    other.keeping.forgetDraft();
    expect(store.list().map(({ id }) => id)).toEqual([other.keeping.draftId]);
  });

  it("says once that a draft was not kept, and that it was once it is again", async () => {
    const storage = new MemoryStorage();
    const store = new DraftStore(storage);
    const editing = await editor({
      existing: { strokes: [stroke(10)] },
      drafts: { store },
    });
    const key = `inkline-draft:${editing.keeping.draftId}`;
    storage.refused.add(key);
    editing.draw(30);
    expect(editing.said).toEqual(["Draft not kept"]);
    expect(editing.notices).toHaveLength(1);
    editing.draw(50);
    expect(editing.said).toEqual(["Draft not kept"]);
    expect(editing.notices).toHaveLength(1);
    storage.refused.delete(key);
    editing.draw(70);
    expect(editing.said).toEqual(["Draft not kept", "Draft kept"]);
    expect(editing.notices).toHaveLength(1);
  });

  it("asks again, rather than reloading, when the drawing changed while Reload read the file", async () => {
    const editing = await editor({ existing: { strokes: [stroke(10)] } });
    editing.draw(30);
    editing.disk.bytes = await fileOf({ strokes: [stroke(50)] });
    editing.keeping.touched(path);
    await vi.waitFor(() => {
      expect(editing.open.size).toBe(1);
    });
    const letGo = editing.disk.holdNextRead();
    editing.answer(changedOnDisk, "Reload");
    editing.draw(70);
    letGo();
    await vi.waitFor(() => {
      expect(editing.asked).toHaveLength(2);
    });
    expect(editing.said).not.toContain("Reloaded: the file changed on disk");
    expect(editing.session.document.strokes).toHaveLength(3);
  });

  it("lets an offer go when a save starts, a question opens, or the editor closes, while its base layer decodes", async () => {
    for (const meanwhile of ["save", "question", "close"] as const) {
      const storage = new MemoryStorage();
      const store = new DraftStore(storage);
      const other: Draft = {
        id: "other-editor",
        target: { kind: "file", path },
        strokes: [stroke(40)],
        base: {
          kind: "kept",
          layer: {
            x: 0,
            y: 0,
            width: 32,
            height: 32,
            png: encodePng(blank(2, 2)),
          },
        },
        savedAt: Date.now(),
        gridOrigin: 0,
      };
      expect(store.put(other)).toBe(true);
      const decoding = gate();
      const editing = await editor({
        existing: { strokes: [stroke(10)] },
        drafts: { store },
        decode: async () => {
          await decoding.wait;
          throw new Error("no canvas in unit tests");
        },
      });
      editing.keeping.holdDraft();
      const offering = editing.keeping.offerDraft();
      const writing = gate();
      if (meanwhile === "save") {
        editing.draw(30);
        editing.hooks.beforeWrite = () => writing.wait;
        void editing.keeping.saveOnly();
        await vi.waitFor(() => {
          expect(editing.keeping.saving).toBe(true);
        });
      } else if (meanwhile === "question") {
        editing.open.add({
          title: "Help",
          content: "",
          answers: [],
          cancel: "",
        });
      } else {
        editing.close();
      }
      decoding.open();
      await offering;
      writing.open();
      expect(editing.asked, meanwhile).toHaveLength(0);
      // Not held: another editor of the symbol can offer it.
      expect(
        store.offers({ kind: "file", path }).drafts.map(({ id }) => id),
        meanwhile,
      ).toContain("other-editor");
    }
  });

  it.each(["check", "Reload"] as const)(
    "asks nothing and reloads nothing once the editor has closed while it read the file: %s",
    async (how) => {
      const editing = await editor({ existing: { strokes: [stroke(10)] } });
      editing.disk.bytes = await fileOf({ strokes: [stroke(50), stroke(60)] });
      let letGo: () => void;
      if (how === "Reload") {
        // Reload answers the question about a change to an unsaved drawing.
        editing.draw(30);
        await editing.settled();
        letGo = editing.disk.holdNextRead();
        editing.answer(changedOnDisk, "Reload");
      } else {
        letGo = editing.disk.holdNextRead();
        editing.keeping.touched(path);
      }
      editing.close();
      const looked = editing.state.looked;
      letGo();
      // Once the read ends, the editor looks whether it has closed, first.
      await vi.waitFor(() => {
        expect(editing.state.looked).toBeGreaterThan(looked);
      });
      expect(editing.said).toEqual([]);
      expect(editing.asked).toHaveLength(how === "Reload" ? 1 : 0);
      expect(editing.session.document.strokes).toHaveLength(
        how === "Reload" ? 2 : 1,
      );
    },
  );

  it("reads the file no more once the editor has closed, as over the question about a change", async () => {
    const editing = await editor({ existing: { strokes: [stroke(10)] } });
    editing.draw(30);
    editing.disk.bytes = await fileOf({ strokes: [stroke(50)] });
    await editing.settled();
    expect(editing.asked.map(({ title }) => title)).toEqual([changedOnDisk]);
    const reads = editing.disk.reads;
    // Closing dismisses the question, which looks at the file again while the
    // editor is open, and a report after it reads nothing either, as a read
    // would start at once.
    editing.close();
    editing.keeping.touched(path);
    expect(editing.disk.reads).toBe(reads);
  });

  it.each(["closes", "is retired"] as const)(
    "says nothing and saves nothing when the editor %s while it asks whether to change a symbol everywhere",
    async (how) => {
      const editing = await editor({
        existing: { strokes: [stroke(10)] },
        uses: { links: 3, notes: 2 },
      });
      editing.draw(30);
      const saving = editing.keeping.saveAndClose();
      expect(editing.open.size).toBe(1);
      // As Inkline unloading does: retiring closes the editor, and with it
      // the question.
      if (how === "is retired") editing.keeping.retire();
      editing.close();
      await saving;
      expect(editing.writes).toHaveLength(0);
      expect(editing.said).toEqual([]);
      expect(editing.calls).not.toContain("refocus");
      expect(editing.calls).not.toContain("finish");
    },
  );

  it("does not go on to the next symbol once Save and close, waiting on the same save, has closed the editor", async () => {
    const editing = await editor({ existing: { strokes: [stroke(10)] } });
    editing.draw(30);
    const writing = gate();
    editing.hooks.beforeWrite = () => writing.wait;
    const closing = editing.keeping.saveAndClose();
    await vi.waitFor(() => {
      expect(editing.keeping.saving).toBe(true);
    });
    const advance = vi.fn();
    const next = editing.keeping.saveAndNext(advance);
    writing.open();
    await Promise.all([closing, next]);
    expect(editing.writes).toHaveLength(1);
    expect(editing.calls.filter((call) => call === "finish")).toHaveLength(1);
    expect(advance).not.toHaveBeenCalled();
  });
});
