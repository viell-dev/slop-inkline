// Keeping the drawing safe: the editor's own draft and the drafts it restored
// or offers, the symbol's file as last read and the changes made to it
// elsewhere, the questions about such a change and about replacing a symbol
// that notes use more than once, reloading, and saving, with Save, Save and
// close, and Next's save. It holds no element and no Obsidian object: the
// editor passes in what it needs, as its host, and the canvas's codec, so that
// unit tests drive it in Node.js.

import { carriedChunks, type CarriedChunk } from "../format/ink-file.ts";
import {
  parseRecord,
  serializeRecord,
  type BaseLayer,
  type InkRecord,
} from "../format/record.ts";
import { readText, writeText, type SymbolText } from "../format/text.ts";
import { nextTask, type EditableInk, type UnusableInk } from "../ink/canvas.ts";
import type { InkDocument } from "../ink/document.ts";
import type { DrawableBase } from "../ink/render.ts";
import { savingWaits, type RenameWait } from "../notes/file-writes.ts";
import { chooseRename, symbolStem } from "../notes/names.ts";
import { textFields, type TextFields } from "../notes/text-fields.ts";
import { FileWatch, type FileReading, type Reading } from "./disk.ts";
import {
  draftBase,
  draftOffer,
  drawingOf,
  fingerprintOf,
  offerQuestion,
  restoreDraft,
  sameTarget,
  unshownBase,
  type Draft,
  type DraftBase,
  type DraftStore,
  type DraftTarget,
} from "./drafts.ts";
import type { PictureTracing } from "./picture.ts";
import type { DrawingSession } from "./session.ts";
import type { StatusLine } from "./status.ts";

/** How the vault's notes use a symbol: how many links, in how many notes. */
export interface SymbolUses {
  readonly links: number;
  readonly notes: number;
}

/** How a question about saving says that the symbol `name` is used. */
export function usedText(name: string, { links, notes }: SymbolUses): string {
  return `${name} is used ${String(links)} times, in ${String(notes)} ${notes === 1 ? "note" : "notes"}.`;
}

/** The symbol's file, as the editor reads it again to see if it changed. */
export interface SymbolFile {
  /** Where it is, following renames, or where it was once deleted. */
  readonly path: string;
  /** What it holds now, or undefined when no file is there. */
  read(): Promise<Uint8Array | undefined>;
}

/** A file opened again, and what it says about its symbol. */
type OpenedFile = EditableInk & { readonly text: SymbolText };

/** What keeping the drawing safe is given of the editor's options. */
export interface KeepingOptions {
  /** What the editor calls the symbol until it has a name: "New symbol". */
  readonly title: string;
  /**
   * The symbol's name, which its name field starts with, or undefined for a
   * new one, whose field starts empty.
   */
  readonly name?: string;
  readonly document: InkDocument;
  readonly carried?: readonly CarriedChunk[];
  /**
   * Writes a saved symbol: the first save of a new symbol creates its file
   * and inserts it. Rejects when anything could not be done, which keeps the
   * editor open with the drawing, so that the next save tries again.
   * `keepDraft` keeps the editor's draft at once, as before a step that a
   * draft must name, and returns whether it was kept. `holds` tells the
   * editor what the file holds where the write can still reject after the
   * file changed: once a new symbol's file is made, adopted, or written,
   * before any later step that can fail, such as inserting its embed, and once
   * a write is cut short, with what it left. The editor then goes on
   * comparing the file with that. A write that resolves, the editor records
   * itself, so an existing symbol's host calls `holds` only for a write cut
   * short. `name` is what the name field holds, as typed, for the file to
   * take as its name.
   * `check` looks at the file once more: the host calls it just before it
   * writes over a file, where no other save can come between them, and again
   * if another file took that one's place meanwhile. It writes nothing if
   * `check` rejects, which it does to ask about a change or refuse one.
   * `wait` hears when a step that writes takes too long, or a rename stops,
   * and says whether a person is being asked something above this editor.
   * Resolves to whether that name was kept or applied. False means only the
   * rename failed: the drawing is saved, and the name stays for a retry.
   */
  readonly write: (
    bytes: Uint8Array,
    record: InkRecord,
    keepDraft: () => boolean,
    holds: (fingerprint: string) => void,
    name: string,
    check: () => Promise<void>,
    wait: RenameWait,
  ) => Promise<boolean>;
  /**
   * For an existing symbol, which other notes may show: how the vault's
   * notes use it, asked before the first save of a changed drawing, so that
   * the editor can ask first, when it is used more than once, whether to
   * change it everywhere. Undefined for a new symbol.
   */
  readonly uses?: () => SymbolUses;
  /**
   * The symbol's file: an existing symbol's, or a new one's once its first
   * save made it, and undefined before then. The editor reads it again when
   * the vault says it changed and before each save, so that a change made
   * elsewhere is never written over unasked.
   */
  readonly file?: () => SymbolFile | undefined;
  /** A fingerprint of the file as opened, for an existing symbol. */
  readonly fingerprint?: string;
  /** The same of all but its text, as `drawingOf` gives it. */
  readonly drawing?: string;
  /** Where unsaved strokes are kept, and which symbol they belong to. */
  readonly drafts?: {
    readonly store: DraftStore;
    /** The symbol now: a new one is its file once the first save made it. */
    readonly target: () => DraftTarget;
    /**
     * Told when another editor's draft is restored, before this editor keeps
     * its own, so that a new symbol can finish with the file that draft's
     * first save made.
     */
    readonly restored?: (draft: Draft) => void;
    /**
     * A draft to open with, restored as Restore would restore it, without
     * asking, as the person chose it already: one whose symbol's file is gone
     * or does not open, which this editor makes a new symbol of. No other
     * draft is offered then.
     */
    readonly recover?: Draft;
    /**
     * The id of a draft for the symbol to offer before any other, as one
     * chosen from the list of drafts, rather than the newest.
     */
    readonly first?: string;
  };
}

/**
 * Base layer images decoded for drawing, by their PNG, each kept while
 * something holds that PNG: a state that Undo or Redo can reach, the drawing
 * as opened or saved, or a draft. One that only abandoned states held, after
 * a new change past an Undo or past the history's limit, goes.
 */
export class DecodedBases {
  readonly #decoded = new WeakMap<Uint8Array, DrawableBase>();
  /** The base layer placed where the document puts it, for drawing. */
  #placed: { layer: BaseLayer; drawable: DrawableBase } | undefined;

  /** Keeps `drawable`, the image of the base layer whose PNG is `png`. */
  set(png: Uint8Array, drawable: DrawableBase): void {
    this.#decoded.set(png, drawable);
  }

  /** The decoded image of `layer`, where the document puts it. */
  placed(layer: BaseLayer | undefined): DrawableBase | undefined {
    const drawable =
      layer === undefined ? undefined : this.#decoded.get(layer.png);
    if (layer === undefined || drawable === undefined) {
      // The last one placed would otherwise keep its image after the
      // drawing let it go.
      this.#placed = undefined;
      return undefined;
    }
    if (this.#placed?.layer !== layer) {
      this.#placed = {
        layer,
        drawable: {
          ...drawable,
          x: layer.x,
          y: layer.y,
          width: layer.width,
          height: layer.height,
        },
      };
    }
    return this.#placed.drawable;
  }
}

/** A question to ask the person, which the editor shows above it. */
export interface Question {
  readonly title: string;
  readonly content: string;
  readonly answers: readonly {
    readonly text: string;
    readonly primary?: boolean;
    readonly destructive?: boolean;
    readonly act: () => void;
  }[];
  /** What the button that answers nothing says. */
  readonly cancel: string;
  /** Runs when the question closes without an answer. */
  readonly dismissed?: () => void;
}

/**
 * What turns a drawing into a symbol's file and back, and decodes base layers,
 * which needs the browser's canvas: `saveInk`, `openInk`, and `drawableBase`.
 */
export interface InkCodec {
  save(
    document: InkDocument,
    base: DrawableBase | undefined,
    carried: readonly CarriedChunk[],
  ): Promise<{ bytes: Uint8Array; record: InkRecord; left: number }>;
  open(bytes: Uint8Array): Promise<EditableInk | UnusableInk>;
  drawableBase(layer: BaseLayer): Promise<DrawableBase>;
}

/** What a save, a reload, and a draft ask of the readings and translations. */
export type KeepingText = Pick<
  TextFields,
  | "touched"
  | "typed"
  | "changes"
  | "problem"
  | "focus"
  | "saved"
  | "take"
  | "conflicts"
  | "drop"
  | "restore"
>;

/** What keeping the drawing safe asks of the picture to trace over. */
export type KeepingPicture = Pick<
  PictureTracing,
  "previewing" | "applyBeforeSave"
>;

/** What keeping the drawing safe is given by the editor around it. */
export interface KeepingHost {
  /** Whether the editor is closing, as it does once asked to or done. */
  closing(): boolean;
  /** Says `text` in the status line, for as long as `holds` says, if given. */
  say(text: string, holds?: () => boolean): void;
  /** Shows a notice, for what must be read even once the editor is gone. */
  notice(text: string): void;
  /** Asks `question` in a dialog of its own, which closes with the editor. */
  ask(question: Question): void;
  /** Whether a question, Help, or another dialog of the editor's is open. */
  questionsOpen(): boolean;
  /** Whether the editor is the dialog on top, under nothing else. */
  onTop(): boolean;
  updateControls(): void;
  requestRender(): void;
  /** Fits the view to the whole drawing, as one restored or reloaded. */
  fitView(): void;
  /**
   * Moves the view, the picture, and a drag of it `dx` along the drawing, as
   * a save moved the drawing, so that they stay where they were.
   */
  shift(dx: number): void;
  /** Puts the focus back on the drawing area. */
  refocus(): void;
  /** Closes the editor without asking. */
  finish(): void;
  /** What the name field holds, as typed, or undefined before it is made. */
  typedName(): string | undefined;
  /**
   * Shows `name`, the symbol's now, in the name field, and as its text if it
   * still holds `typed`.
   */
  showName(name: string, typed: string | undefined): void;
  /** Puts `name` in the name field, as a draft kept it. */
  restoreName(name: string): void;
  /** Shows what leaving the name empty does now, while it has none. */
  showUnnamed(): void;
  /** The readings and translations' fields, once they are made. */
  text(): KeepingText | undefined;
  /** Opens the readings and translations' fields. */
  showText(): void;
  /** Has the fields' button say what they hold. */
  showTextSummary(): void;
  /** Says that a save waits for Obsidian, and what to do, or nothing for "". */
  showWaiting(text: string): void;
  /** Runs `then` once what runs now has finished, in the editor's window. */
  later(then: () => void): void;
}

/** What keeping the drawing safe shares with the rest of the editor. */
export interface KeepingParts {
  readonly host: KeepingHost;
  /** The drawing, its history, and what is drawn now. */
  readonly session: DrawingSession;
  readonly decoded: DecodedBases;
  /** What the status line says, to tell whether "Draft not kept" still does. */
  readonly line: Pick<StatusLine, "text">;
  readonly codec: InkCodec;
  readonly picture: KeepingPicture;
}

/** A save that stopped to ask a question, which says why without a notice. */
class Unsaved extends Error {}

/**
 * A save that found the file's text changed, took it in, and is to start again,
 * as what it was about to write held the text as it was. It need say nothing.
 */
class SaveAgain extends Error {
  /** Starts the save again, once this one has ended. */
  readonly again: () => void;

  constructor(again: () => void) {
    super("the file's text changed");
    this.again = again;
  }
}

const unreadable =
  "the file changed on disk, and this version of Inkline cannot read it";

const textReplaced =
  "the file changed text you typed, so look at what it now says and save again";

/**
 * Keeping the drawing safe, for one editor. The editor makes it as it is made,
 * holds its own draft as it opens ({@link holdDraft}), and lets go of its holds
 * as it closes ({@link release}), which can be done twice. {@link retire}
 * retires it as Inkline unloads: nothing more is saved or kept as a draft
 * then, but for the draft that a save still running settles once, as it ends.
 * Once the editor has closed or retired, nothing that resumes after waiting,
 * as a read of the file, a decode, or a save, changes the drawing or asks
 * anything.
 */
export class Keeping {
  readonly #options: KeepingOptions;
  readonly #host: KeepingHost;
  readonly #session: DrawingSession;
  readonly #decoded: DecodedBases;
  readonly #line: Pick<StatusLine, "text">;
  readonly #codec: InkCodec;
  readonly #picture: KeepingPicture;
  /** This editor's own draft, which no other editor writes. */
  readonly draftId = crypto.randomUUID();
  /** The symbol's file as last opened, reloaded, or saved, and changes to it. */
  readonly #watch: FileWatch;
  /** Whether the file is being read again, and whether to read it once more. */
  #checking = false;
  #recheck = false;
  /** The file's chunks to keep when it is saved, from the file last read. */
  #carried: readonly CarriedChunk[];
  /** The document the file held as opened or last reloaded. */
  #opened: InkDocument;
  /** The symbol's name as last opened or saved, or empty before it has one. */
  #savedName: string;
  /** Whether the last save kept the drawing but could not rename the file. */
  #notRenamed = false;
  /**
   * Whether the question about a change on disk is open, and the save it
   * goes on with if the drawing is kept.
   */
  #askingChanged = false;
  #resume: (() => void) | undefined;
  /**
   * Whether this editor need not ask again before saving over a symbol used
   * more than once, as Replace was chosen.
   */
  #choseReplace = false;
  /** The question whether to replace a shared symbol, while it is open. */
  #askingReplace: Promise<boolean> | undefined;
  /** Whether Next is under way, so that it opens one editor however asked. */
  #advancing = false;
  #saving: Promise<boolean> | undefined;
  /**
   * Set when retired: nothing more is saved or written as a draft, but for
   * {@link #settleDraft} once a save that was running then ends.
   */
  #retired = false;
  /** Whether a save was running when the editor was retired, until it ends. */
  #settling = false;
  /** Whether the last draft written was kept; storage can refuse one. */
  #draftKept = true;
  /**
   * The draft this editor restored, until its own draft or a save takes its
   * place: storage may refuse the editor's own at first.
   */
  #replacing: string | undefined;
  /** The draft this editor is offering back, held while it asks. */
  #offered: string | undefined;
  /**
   * The draft this editor opened as a new symbol, as `drafts.recover` gives
   * it, once restored: its own draft stands in for it until a first save
   * makes a file of its own, as {@link #draft} says.
   */
  #recovered: Draft | undefined;
  /**
   * The base layer of {@link #recovered} that this editor could not show: one
   * it took from its file, or one it kept itself that cannot be decoded. Its
   * own draft goes on naming it while it stands in for that draft, so that
   * nothing of it is dropped before the first save starts writing: names the
   * file it makes, or takes over the file a first save made.
   */
  #unshownBase: DraftBase | undefined;

  constructor(options: KeepingOptions, parts: KeepingParts) {
    this.#options = options;
    this.#host = parts.host;
    this.#session = parts.session;
    this.#decoded = parts.decoded;
    this.#line = parts.line;
    this.#codec = parts.codec;
    this.#picture = parts.picture;
    this.#watch = new FileWatch(options.fingerprint, options.drawing);
    this.#carried = options.carried ?? [];
    this.#opened = options.document;
    this.#savedName = options.name ?? "";
  }

  /** Whether Inkline was disabled while the editor was open. */
  get retired(): boolean {
    return this.#retired;
  }

  /** Whether a save is running. */
  get saving(): boolean {
    return this.#saving !== undefined;
  }

  /** The symbol's name as last opened or saved, or empty before it has one. */
  get savedName(): string {
    return this.#savedName;
  }

  /** Whether the editor has closed, or Inkline was disabled. */
  #ended(): boolean {
    return this.#host.closing() || this.#retired;
  }

  /**
   * Retires the editor without asking, as when the plugin unloads: unsaved
   * strokes are kept as a draft, and nothing more is saved or written as a
   * draft, even by a save still running, which only settles that draft as it
   * ends ({@link #settleDraft}). Returns whether it was not retired already,
   * for the editor to close then.
   */
  retire(): boolean {
    if (this.#retired) return false;
    this.#session.end();
    if (!this.keepDraft()) this.#sayNotKept();
    this.#settling = this.#saving !== undefined;
    this.#retired = true;
    return true;
  }

  /** Says that the latest changes are in no draft, once the editor is gone. */
  #sayNotKept(): void {
    this.#host.notice(
      `Inkline could not keep a draft of the latest changes to ${this.displayName}.`,
    );
  }

  /** What the name field holds, as typed. */
  get #typedName(): string {
    return this.#host.typedName() ?? this.#savedName;
  }

  /**
   * Whether saving would give the symbol another name than it has: the name
   * field, as saving reads it, holds another, or one that saving would
   * refuse. Left empty, or holding the name the symbol has, the field keeps
   * it, or takes a number for a new one.
   */
  get #nameChanged(): boolean {
    const choice = chooseRename(this.#typedName, this.#savedName);
    if (choice.kind === "number") return false;
    return choice.kind === "refused" || choice.name !== this.#savedName;
  }

  /** Whether anything is unsaved: strokes, a new name, or text typed. */
  get unsaved(): boolean {
    return (
      this.#session.dirty ||
      this.#nameChanged ||
      this.#host.text()?.touched === true
    );
  }

  /** What notices call the symbol: its name, or "New symbol" until it has one. */
  get displayName(): string {
    return this.#savedName === "" ? this.#options.title : this.#savedName;
  }

  /** Whether text typed would replace a change that `opened` holds. */
  #textClashes(opened: OpenedFile | undefined): boolean {
    const fields = this.#host.text();
    return (
      opened !== undefined &&
      fields !== undefined &&
      fields.conflicts(opened.text).length > 0
    );
  }

  /** The name of the file the editor saves to, or undefined before it has one. */
  #fileName(): string | undefined {
    const path = this.#options.file?.()?.path;
    const file = path?.slice(path.lastIndexOf("/") + 1);
    return file === undefined ? undefined : symbolStem(file);
  }

  /**
   * After a save that sent `typed` as the name, or a rename made elsewhere,
   * takes the name the file now has, and shows it in the field if the field
   * still holds `typed`. Undefined leaves the field as it is, as after a
   * rename that failed.
   */
  #named(typed: string | undefined): void {
    const name = this.#fileName();
    if (name === undefined) return;
    this.#savedName = name;
    this.#host.showName(name, typed);
  }

  /**
   * Takes the name the file now has, if the file at `path` is the symbol's,
   * as after a rename made elsewhere, as in the file explorer or by sync: a
   * later save does not rename it back.
   */
  followRename(path: string): void {
    if (path === this.#options.file?.()?.path) this.#named(this.#savedName);
  }

  /**
   * Reads the file again if the vault reports a change to the file at `path`,
   * or one moved from `oldPath`, as the symbol's.
   */
  touched(path: string, oldPath?: string): void {
    const file = this.#options.file?.()?.path;
    if (file !== undefined && (path === file || oldPath === file)) {
      this.checkFile();
    }
  }

  /** What a save says when something is still unsaved after it. */
  get #partlySaved(): string {
    if (!this.#notRenamed) return "Saved, except for what changed while saving";
    return this.#session.dirty
      ? "Saved, except for the name and what changed while saving"
      : "Saved, but not renamed";
  }

  /** After a committed change: update the controls, the surface, the draft. */
  #changed(): void {
    this.#host.updateControls();
    this.#host.requestRender();
    this.keepDraft();
  }

  /** Says that a save is running, which stays said until it ends. */
  announceSaving(): void {
    this.#host.say("Saving…", () => this.#saving !== undefined);
  }

  /**
   * Says that a save is waiting for Obsidian, until it no longer is, and how to
   * get the strokes back if it never ends. This has a line of its own, as the
   * status line goes on saying other things meanwhile.
   */
  #sayWaiting(waiting: boolean): void {
    if (!waiting) {
      this.#host.showWaiting("");
      return;
    }
    const again =
      this.#options.drafts?.target().kind === "file"
        ? "open this symbol again"
        : "start a new symbol in this note";
    this.#host.showWaiting(
      `${savingWaits} ${
        this.keepDraft()
          ? `Your strokes are safe in a draft, so if nothing changes, restart Obsidian and ${again}.`
          : "If nothing changes, restart Obsidian, but your latest strokes could not be kept in a draft."
      }`,
    );
  }

  /**
   * Keeps this editor's unsaved drawing as its draft, or drops it once saved,
   * and returns whether the drawing is safe: saved, or kept. When storage
   * refuses a draft, the last one kept stays, and a notice says so once.
   */
  keepDraft(): boolean {
    const drafts = this.#options.drafts;
    if (drafts === undefined || this.#retired) return true;
    // While a save runs, the file holds the drawing as it was or as the save
    // writes it, so the draft is kept, and keeps its own base layer, but for
    // one that stands in for a draft opened as a new symbol, as #draft says.
    const pending = this.#saving !== undefined;
    if (!pending && !this.unsaved) {
      this.forgetDraft();
      return true;
    }
    const { document } = this.#session;
    const kept = drafts.store.put(this.#draft(drafts.target(), pending));
    if (!kept && this.#draftKept) {
      // The latest changes stay unkept until a draft is kept again.
      this.#host.say("Draft not kept", () => !this.#draftKept);
      this.#host.notice(
        parseRecord(serializeRecord(document)).ok
          ? "Inkline could not keep a draft of the latest changes, because the vault's local storage refused it. Save the symbol to keep them."
          : "Inkline could not keep a draft of the latest changes, because they take the drawing past what a symbol can hold. Undo them to save it.",
      );
    } else if (
      kept &&
      !this.#draftKept &&
      this.#line.text === "Draft not kept"
    ) {
      this.#host.say("Draft kept");
    }
    this.#draftKept = kept;
    if (kept) this.#replaced();
    return kept;
  }

  /**
   * This editor's drawing as its draft for `target`. While the file may hold
   * the drawing as it was or as a save writes it, the draft is `pending`, and
   * keeps its own base layer, so that it does not depend on which version the
   * file holds. A draft that stands in for one opened as a new symbol, as
   * below, names instead the base layer that one named and this editor could
   * not show, until the first save starts writing.
   */
  #draft(target: DraftTarget, pending: boolean): Draft {
    const { document, saved } = this.#session;
    // A draft opened as a new symbol is still for its old symbol until the
    // first save gives it a file of its own, as the editor then holds that
    // file, or names another path: this one takes its place there, during a
    // save too, as one cut short by Inkline's unloading keeps its draft. It
    // goes on naming a base layer it could not show, one taken from that
    // symbol's file or one that cannot be decoded, with that file's
    // fingerprints, so that restoring it on the file, should it open again,
    // brings the base layer back, as the draft found would have. Where the
    // save makes a file at that same path, as for a symbol deleted, a draft
    // kept meanwhile restored on it gives the same drawing, as that file
    // holds no base layer.
    const standIn =
      this.#recovered !== undefined &&
      this.#watch.fingerprint === undefined &&
      sameTarget(target, this.#recovered.target)
        ? this.#recovered
        : undefined;
    const fingerprint = this.#watch.fingerprint ?? standIn?.fingerprint;
    const drawing = this.#watch.drawing ?? standIn?.drawing;
    const unshown = standIn === undefined ? undefined : this.#unshownBase;
    const fields = this.#host.text();
    return {
      id: this.draftId,
      target,
      strokes: document.strokes,
      base:
        unshown !== undefined && document.base === undefined
          ? unshown
          : draftBase(document, pending ? undefined : saved),
      ...(fingerprint === undefined ? {} : { fingerprint }),
      ...(drawing === undefined ? {} : { drawing }),
      savedAt: Date.now(),
      gridOrigin: this.#session.gridOrigin,
      ...(this.#nameChanged ? { name: this.#typedName } : {}),
      ...(fields?.touched === true ? { text: fields.typed() } : {}),
    };
  }

  /**
   * Settles the draft that {@link retire} kept while a save ran, once that
   * save ends, which can be after Inkline is off: Obsidian finishes a rename
   * it has begun, which nothing takes back, and the draft names the file's
   * path from before it. The draft is kept again for the file where it is now,
   * on its own base layer and with the time it was kept, so that it depends on
   * nothing the file holds and expires as it would have; or, standing in for a
   * draft opened as a new symbol, on the base layer that draft named, as
   * {@link #draft} says. Whether the file
   * holds everything it does is for the next editor of the file to tell, as it
   * offers drafts ({@link draftOffer}): the file can change at any time
   * after the save, and this editor follows it no more.
   *
   * This touches only this editor's own draft, once, and only while a list
   * would keep it: another load may have restored, discarded, or dropped it
   * meanwhile, as one that expired, and nothing brings it back. It reads no
   * file, removes no draft, and writes no file and no note.
   */
  #settleDraft(): void {
    if (!this.#settling) return;
    this.#settling = false;
    const drafts = this.#options.drafts;
    const keptAt = drafts?.store.keptAt(this.draftId);
    if (drafts === undefined || keptAt === undefined) return;
    const draft = { ...this.#draft(drafts.target(), true), savedAt: keptAt };
    if (!drafts.store.put(draft)) this.#sayNotKept();
  }

  /**
   * Drops this editor's own draft, and the one it restored, which its
   * drawing has taken the place of; never another's.
   */
  forgetDraft(): void {
    if (this.#retired) return;
    this.#options.drafts?.store.remove(this.draftId);
    this.#draftKept = true;
    this.#replaced();
  }

  /** Drops the draft this editor restored, once nothing needs it. */
  #replaced(): void {
    const replacing = this.#replacing;
    if (replacing === undefined) return;
    this.#replacing = undefined;
    this.#options.drafts?.store.remove(replacing);
    this.#options.drafts?.store.release(replacing);
  }

  /** Holds this editor's own draft, so that no other editor offers it. */
  holdDraft(): void {
    this.#options.drafts?.store.hold(this.draftId);
  }

  /**
   * Lets go of this editor's own draft, of the one it restored, and of the one
   * it is offering, as it closes. Each draft stays as it was kept.
   */
  release(): void {
    const store = this.#options.drafts?.store;
    store?.release(this.draftId);
    if (this.#replacing !== undefined) store?.release(this.#replacing);
    if (this.#offered !== undefined) store?.release(this.#offered);
  }

  /**
   * Offers back the newest draft another editor left for this symbol, or the
   * one `drafts.first` names, once any base layer it keeps is decoded, holding
   * it meanwhile so that no other editor offers it too. Dismissing the
   * question keeps the draft for next time; only Restore or Discard use it up,
   * and Restore only once this editor's own draft has taken its place.
   */
  async offerDraft(): Promise<void> {
    const drafts = this.#options.drafts;
    if (drafts === undefined) return;
    const { recover } = drafts;
    const offers =
      recover === undefined
        ? drafts.store.offers(drafts.target())
        : { drafts: [], newer: false };
    // A draft for the file that would bring back nothing is dropped. The
    // editor follows the file from its opening, so a change to it after that
    // is taken in or asked about as any other is.
    const { offer, drop } = draftOffer(
      drafts.target(),
      offers.drafts,
      this.#opened,
      this.#savedName,
      drafts.first,
    );
    for (const id of drop) drafts.store.remove(id);
    const found = recover ?? offer;
    // A later version's draft cannot be read here, so it stays for that
    // version to offer, and this says so, as the changes would seem lost.
    if (offers.newer) {
      this.#host.notice(
        "This symbol has unsaved changes from a newer version of Inkline, which this version cannot restore. Update Inkline to get them back.",
      );
    }
    if (found === undefined) return;
    drafts.store.hold(found.id);
    this.#offered = found.id;
    const letGo = (): void => {
      drafts.store.release(found.id);
      this.#offered = undefined;
    };
    let readable = found.base.kind !== "lost";
    if (found.base.kind === "kept") {
      const { layer } = found.base;
      try {
        this.#decoded.set(layer.png, await this.#codec.drawableBase(layer));
      } catch {
        readable = false;
      }
      // Meanwhile the editor may have closed, saved a new symbol into its
      // own file, started a save, or asked before closing: then the draft
      // waits for another time, which a draft opened as a new symbol says,
      // as nothing else would show that it was not. Such an editor stays
      // open, as what was drawn, saved, or asked in it meanwhile is the
      // person's; anything drawn there is kept as its own draft, and the
      // draft found stays as it was, to be opened again.
      if (
        this.#ended() ||
        this.#saving !== undefined ||
        this.#host.questionsOpen() ||
        !sameTarget(drafts.target(), found.target)
      ) {
        letGo();
        if (recover !== undefined && !this.#retired) {
          this.#host.notice(
            "The unsaved drawing was not opened, as the editor was in use while it was read. It is still kept: run Inkline: Recover drafts to open it.",
          );
        }
        return;
      }
    }
    const draft: Draft = readable
      ? found
      : { ...found, base: { kind: "none" } };
    if (recover !== undefined) {
      this.#recovered = found;
      this.#unshownBase = unshownBase(found, readable);
      this.#restore(drafts, draft);
      if (readable) {
        this.#host.say("Opened the unsaved drawing as a new symbol");
      } else {
        this.#host.notice(
          "The unsaved drawing's base layer cannot be read, so only its strokes came back.",
        );
      }
      return;
    }
    const { title, content } = offerQuestion(
      draft,
      readable,
      this.#watch,
      new Date(draft.savedAt).toLocaleString(),
    );
    this.#host.ask({
      title,
      content,
      answers: [
        {
          text: "Restore",
          primary: true,
          act: () => {
            this.#restore(drafts, draft);
          },
        },
        {
          text: "Discard",
          destructive: true,
          act: () => {
            drafts.store.remove(draft.id);
            letGo();
          },
        },
      ],
      cancel: "Not now",
      dismissed: letGo,
    });
  }

  /**
   * Restores `draft`, which this editor holds, in place of the drawing, with
   * any name and text it kept, and keeps this editor's own draft in its place.
   */
  #restore(drafts: NonNullable<KeepingOptions["drafts"]>, draft: Draft): void {
    // A stroke begun while the draft was read is committed first, so that
    // undoing the restore brings it back.
    this.#session.end();
    this.#session.replace(restoreDraft(this.#opened, draft), draft.gridOrigin);
    if (draft.name !== undefined) this.#host.restoreName(draft.name);
    if (draft.text !== undefined) {
      this.#host.text()?.restore(draft.text);
      this.#host.showTextSummary();
      this.#host.showText();
    }
    drafts.restored?.(draft);
    // Restoring can change what an empty name keeps.
    this.#host.showUnnamed();
    // Still held: offered to no other editor until this one's own replaces it.
    this.#offered = undefined;
    this.#replacing = draft.id;
    this.#host.fitView();
    this.#host.updateControls();
    this.#host.requestRender();
    this.keepDraft();
  }

  /**
   * Reads the symbol's file again, as after the vault reports a change to
   * it, and responds to what changed. A save reads it itself, so a check
   * waits for a running save, and one asked for meanwhile runs after it.
   */
  checkFile(): void {
    if (this.#ended()) return;
    if (this.#checking || this.#saving !== undefined) {
      this.#recheck = true;
      return;
    }
    this.#checking = true;
    const known = this.#watch.version;
    void this.#readFile()
      .then((found) => {
        if (found === undefined || this.#ended()) return;
        // A save that ran meanwhile, or a reload, makes the read stale.
        if (this.#saving !== undefined || this.#watch.version !== known) {
          this.#recheck = true;
          return;
        }
        this.#respond(found.reading, found.opened);
      })
      // A file that cannot be read now is read again at the next report, and
      // a save reads it itself.
      .catch(() => undefined)
      .finally(() => {
        this.#checking = false;
        if (this.#recheck) {
          this.#recheck = false;
          this.checkFile();
        }
      });
  }

  /**
   * The symbol's file read again: a reading to compare, and the file opened
   * for editing when it changed and can be, with its text. Undefined while
   * there is no file, as before a new symbol's first save.
   */
  async #readFile(): Promise<
    { reading: Reading; opened?: OpenedFile } | undefined
  > {
    const file = this.#options.file?.();
    if (file === undefined) return undefined;
    const bytes = await file.read();
    if (bytes === undefined) return { reading: { kind: "gone" } };
    const fingerprint = await fingerprintOf(bytes);
    if (!this.#watch.differs(fingerprint)) {
      return { reading: { kind: "file", fingerprint, readable: true } };
    }
    let opened: OpenedFile | undefined;
    try {
      const ink = await this.#codec.open(bytes);
      if (ink.kind === "editable") {
        const text = await readText(ink.carried.map(({ chunk }) => chunk));
        opened = { ...ink, text };
      }
    } catch {
      // Not a PNG that decodes, so not readable.
    }
    return {
      reading: {
        kind: "file",
        fingerprint,
        drawing: await drawingOf(bytes),
        readable: opened !== undefined,
      },
      ...(opened === undefined ? {} : { opened }),
    };
  }

  /**
   * Responds to the file as read while editing. Text typed that a change to
   * the file would be lost to, or replace, is as much to ask about as strokes.
   */
  #respond(reading: Reading, opened: OpenedFile | undefined): void {
    const action = this.#watch.noticed(
      reading,
      this.#session.dirty || this.#textClashes(opened),
    );
    if (action === "gone") {
      this.#host.say("The file was deleted; saving makes it again");
      return;
    }
    if (reading.kind !== "file") return;
    if (action === "unreadable") {
      this.#host.say(`Not reloaded: ${unreadable}`);
      this.#host.notice(
        `${this.displayName} changed on disk, and this version of Inkline cannot read it, so the editor will not save over it.`,
      );
    } else if (action === "reload" && opened !== undefined) {
      this.#reload(reading, opened);
    } else if (action === "text" && opened !== undefined) {
      // A question open is about another change, and has what that change read
      // to go on with. The file is looked at again once it is answered.
      if (!this.#askingChanged) this.#takeText(reading, opened);
    } else if (action === "ask") {
      this.#askChanged(reading, opened);
    }
  }

  /**
   * Takes in a change to the file's text alone. Nothing about the drawing
   * changed, so the strokes, unsaved or not, and Undo stay as they are, and there
   * is nothing to ask. A field someone typed in keeps what they typed, as nothing
   * else could bring that back, while the file's value stays in the file; the
   * fields say what saving would replace, as the library's do, and open to say
   * it. Returns whether that is so of any field.
   */
  #takeText(reading: FileReading, opened: OpenedFile): boolean {
    this.#carried = opened.carried;
    this.#watch.tookText(reading);
    const clashing = (this.#host.text()?.take(opened.text) ?? []).length > 0;
    this.#host.showTextSummary();
    if (clashing) this.#host.showText();
    this.#host.say(
      clashing
        ? "The file changed text you typed: saving replaces what it now says"
        : "Readings and translations updated: the file changed on disk",
    );
    this.keepDraft();
    return clashing;
  }

  /**
   * Asks what to do about a change made to the file elsewhere: reload it, or
   * keep the drawing, so that saving replaces the change. Keeping the drawing
   * replaces only the drawing, and the fields a person typed in: the chunks a
   * save carries become those of `opened`, the changed file, as the question
   * says nothing of any text the change added, and the other field follows
   * it. `resume` goes on with a save that stopped to ask. One such question is
   * open at a time; a save that stops while it is open goes on once it is
   * answered.
   */
  #askChanged(
    reading: FileReading,
    opened: OpenedFile | undefined,
    resume?: () => void,
  ): void {
    if (resume !== undefined) this.#resume = resume;
    if (this.#askingChanged) return;
    this.#askingChanged = true;
    const answered = (): (() => void) | undefined => {
      const then = this.#resume;
      this.#askingChanged = false;
      this.#resume = undefined;
      return then;
    };
    const clash = this.#textClashes(opened);
    this.#host.ask({
      title: "The symbol changed on disk",
      content: `${this.displayName} was changed outside this editor. Reload it to take that change in; Undo then brings your drawing back while the editor is open${clash ? ", but not the readings or translations you typed, which the file changed too" : ""}. Or keep your drawing, and saving it replaces the change.`,
      answers: [
        {
          text: "Reload",
          primary: true,
          act: () => {
            answered();
            void this.#reloadFile();
          },
        },
        {
          text: "Keep mine",
          act: () => {
            const then = answered();
            this.#watch.keep(reading.fingerprint, reading.drawing);
            if (opened !== undefined) {
              this.#carried = opened.carried;
              this.#host.text()?.take(opened.text);
              this.#host.showTextSummary();
            }
            then?.();
            this.checkFile();
          },
        },
      ],
      cancel: "Not now",
      dismissed: () => {
        answered();
        this.checkFile();
      },
    });
  }

  /** Reads the file again and takes in what it now holds, as Reload asks. */
  async #reloadFile(): Promise<void> {
    const known = this.#watch.version;
    const drawn = this.#session.document;
    const typed = JSON.stringify(this.#host.text()?.typed());
    const found = await this.#readFile();
    if (found === undefined || this.#ended()) return;
    // A save or reload meanwhile makes the read stale: a fresh check decides.
    if (this.#saving !== undefined || this.#watch.version !== known) {
      this.checkFile();
      return;
    }
    const { reading, opened } = found;
    if (reading.kind === "gone") {
      this.#host.say("The file was deleted; saving makes it again");
    } else if (!this.#watch.differs(reading.fingerprint)) {
      // Changed back meanwhile: the drawing already follows it.
    } else if (opened === undefined) {
      this.#host.say(`Not reloaded: ${unreadable}`);
    } else if (
      // A large file takes a moment. Reload was the answer about the drawing as
      // it stood then, and says nothing of what was added to it since.
      this.#session.drawing ||
      this.#session.document !== drawn ||
      JSON.stringify(this.#host.text()?.typed()) !== typed
    ) {
      this.#askChanged(reading, opened);
    } else {
      this.#reload(reading, opened);
    }
  }

  /**
   * Takes in what the file now holds, as one step that Undo takes back, so
   * that the drawing it replaces is not lost while the editor is open.
   */
  #reload(reading: FileReading, opened: OpenedFile): void {
    // A stroke being drawn is committed first, so that Undo brings it back.
    this.#session.end();
    const { document, base, carried, text } = opened;
    if (document.base !== undefined && base !== undefined) {
      this.#decoded.set(document.base.png, base);
    }
    this.#carried = carried;
    // A field the file changed too takes the file's values, as Reload said;
    // any other keeps what was typed, which the change had nothing to do with.
    const fields = this.#host.text();
    if (fields !== undefined) {
      const clashing = fields.conflicts(text);
      fields.take(text);
      fields.drop(clashing);
    }
    this.#host.showTextSummary();
    this.#opened = document;
    this.#session.replace(document);
    this.#session.markSaved(document);
    this.#watch.took(reading.fingerprint, reading.drawing);
    this.#host.fitView();
    this.#changed();
    this.#host.say("Reloaded: the file changed on disk");
  }

  /**
   * How the vault's notes use this symbol, when saving over it must ask
   * first: for an existing symbol used more than once, whose drawing changed,
   * before Replace was chosen in this editor. Undefined when a save goes over
   * it without asking, as for one used once, where the editor most likely
   * opened it, or a save that only renames it, as links follow a rename.
   */
  sharedUses(): SymbolUses | undefined {
    const uses = this.#options.uses;
    if (uses === undefined || this.#choseReplace) return undefined;
    if (!this.#session.dirty && !this.#picture.previewing()) return undefined;
    const found = uses();
    return found.links > 1 ? found : undefined;
  }

  /**
   * Records that Replace was chosen, as the question before closing asks it,
   * so that saving over a symbol used more than once asks no more.
   */
  chooseReplace(): void {
    this.#choseReplace = true;
  }

  /**
   * Whether to go on with a save: at once, unless {@link sharedUses} says
   * to ask first whether to change the symbol everywhere, when the answer
   * says. A question already open answers for every save that waits on it.
   */
  #mayReplace(): Promise<boolean> {
    const uses = this.sharedUses();
    if (uses === undefined) return Promise.resolve(true);
    if (this.#askingReplace !== undefined) return this.#askingReplace;
    const name = this.displayName;
    const asking = new Promise<boolean>((resolve) => {
      this.#host.ask({
        title: `Change ${name} everywhere?`,
        content: `${usedText(name, uses)} Replace changes it in all of them. For a variant that leaves them as they are, start a new symbol with Copy from instead.`,
        answers: [
          {
            text: "Replace",
            primary: true,
            act: () => {
              this.#choseReplace = true;
              resolve(true);
            },
          },
        ],
        cancel: "Keep editing",
        dismissed: () => {
          if (!this.#ended()) {
            this.#host.say("Not saved: kept editing");
            this.#host.refocus();
          }
          resolve(false);
        },
      });
    }).finally(() => {
      this.#askingReplace = undefined;
    });
    this.#askingReplace = asking;
    return asking;
  }

  /** Saves, keeping the editor open. */
  async saveOnly(): Promise<void> {
    if (!(await this.#mayReplace())) return;
    if (!(await this.#picture.applyBeforeSave())) return;
    // Ink made just now is a change too, if the preview had not shown it yet.
    if (await this.#mayReplace()) await this.#save();
  }

  /**
   * Saves, then calls `advance`, which opens the editor for the next symbol,
   * whose embed follows this one's, with the same tools, and closes this one.
   * As with Save and close, strokes drawn while the save ran keep this editor
   * open instead.
   */
  async saveAndNext(advance: () => void): Promise<void> {
    if (this.#advancing) return;
    this.#advancing = true;
    try {
      if (!(await this.#picture.applyBeforeSave())) return;
      if (!(await this.#save(() => void this.saveAndNext(advance)))) return;
      // Closed meanwhile, as by Save and close or by Inkline being disabled.
      if (this.#ended()) return;
      if (this.unsaved) {
        this.#host.say(this.#partlySaved);
        return;
      }
      advance();
    } finally {
      this.#advancing = false;
    }
  }

  /**
   * Saves, then closes if nothing changed during the save. Strokes drawn
   * while it ran keep the editor open, since they are not saved yet.
   */
  async saveAndClose(): Promise<void> {
    if (!(await this.#mayReplace())) return;
    if (!(await this.#picture.applyBeforeSave())) return;
    if (!(await this.#mayReplace())) return;
    if (!(await this.#save(() => void this.saveAndClose()))) return;
    if (this.unsaved) {
      this.#host.say(this.#partlySaved);
      return;
    }
    this.#host.finish();
  }

  /**
   * Reads the file again just before a save writes over it, and throws if the
   * save must not go on: it asks first about a change made elsewhere, and
   * `resume` saves again if the answer is to; a file it cannot read is never
   * written over. It only starts the question, as the host calls this in the
   * save's turn, which every other save waits for.
   *
   * A change to the text alone asks nothing, but what the save was about to
   * write holds the text as it was, so that it stops and `resume` starts it
   * again with the change. Unless the change is to a field someone typed in:
   * then nothing is written until they have seen what the file now says, as the
   * library's fields do, and the next save is theirs to make.
   */
  async #checkBeforeWriting(resume: () => void): Promise<void> {
    const found = await this.#readFile();
    if (this.#retired) throw new Error("Inkline was disabled");
    if (found === undefined) return;
    const { reading, opened } = found;
    const action = this.#watch.saving(reading);
    if (action === "unreadable") throw new Error(unreadable);
    if (action === "write" || reading.kind !== "file") return;
    if (action === "text" && opened !== undefined && !this.#askingChanged) {
      if (this.#takeText(reading, opened)) throw new Unsaved(textReplaced);
      throw new SaveAgain(resume);
    }
    this.#askChanged(reading, opened, resume);
    throw new Unsaved("the file changed on disk");
  }

  /**
   * Whether this is a new symbol, with no file yet, that holds nothing to
   * show: no stroke of the pen and no base layer. Saving it would make an
   * empty file and put its embed in the note, as a second click on Next did
   * in the editor that the first opened. A symbol that has a file still saves
   * when it is erased to nothing.
   */
  #nothingToMake(): boolean {
    if (this.#options.file?.() !== undefined) return false;
    const { strokes, base } = this.#session.document;
    return base === undefined && !strokes.some(({ tool }) => tool === "pen");
  }

  /**
   * Saves the drawing as it is now, with a stroke still being drawn ended
   * first. Only one save runs at a time; strokes drawn meanwhile stay
   * unsaved. After a save, the session moves into the saved file's
   * coordinates. A failed save says why and keeps the editor open. Returns
   * whether the drawing was saved. `resume` saves again, if a change to the
   * file stops this one and the answer is to go on.
   */
  #save(resume: () => void = () => void this.#save()): Promise<boolean> {
    if (this.#saving !== undefined) return this.#saving;
    if (this.#retired) return Promise.resolve(false);
    if (this.#session.drawing) {
      this.#session.end();
      this.#changed();
    }
    if (this.#nothingToMake()) {
      this.#host.say("Not saved: nothing drawn yet");
      return Promise.resolve(false);
    }
    // Before anything is written, as text that cannot be saved is a reason not
    // to save what goes with it: the strokes wait, in the draft.
    const fields = this.#host.text();
    const problem = fields?.problem();
    if (problem !== undefined) {
      this.#host.showText();
      fields?.focus();
      this.#host.say(`Not saved: ${problem}`);
      return Promise.resolve(false);
    }
    const document = this.#session.document;
    const base = this.#decoded.placed(document.base);
    const changes = fields?.changes() ?? {};
    const typedText = fields?.typed() ?? {};
    this.announceSaving();
    /** Starts this save again once it has ended, if it is to. */
    let again: (() => void) | undefined;
    this.#saving = (async () => {
      try {
        // Ready for the draft that goes with the write below, which can't pause.
        if (document.base !== undefined) {
          await this.#options.drafts?.store.keepBase(document.base.png, {
            pause: nextTask,
          });
        }
        const {
          bytes: inked,
          record,
          left,
        } = await this.#codec.save(document, base, this.#carried);
        // Only a field that changed: the rest stay as the chunks that `saveInk`
        // carried, byte for byte, whatever they hold.
        let bytes = inked;
        for (const field of textFields) {
          const values = changes[field];
          if (values !== undefined) {
            bytes = await writeText(bytes, field, values);
          }
        }
        // Kept before the file can change, with its own base layer, so that
        // the draft does not depend on which version the file holds.
        const written = await fingerprintOf(bytes);
        const drawn = await drawingOf(bytes);
        this.keepDraft();
        const typed = this.#typedName;
        const named = await this.#options.write(
          bytes,
          record,
          () => this.keepDraft(),
          (fingerprint) => {
            this.#watch.took(
              fingerprint,
              fingerprint === written ? drawn : undefined,
            );
          },
          typed,
          () => this.#checkBeforeWriting(resume),
          {
            told: (waiting) => {
              this.#sayWaiting(waiting);
            },
            asked: () => !this.#host.onTop(),
          },
        );
        // A rename that failed leaves the name typed in the field, unsaved,
        // for the next save to try again.
        this.#notRenamed = !named;
        this.#named(this.#notRenamed ? undefined : typed);
        // The next save starts from what this one wrote, which may be more
        // than the chunks it carried.
        this.#carried = carriedChunks(bytes);
        this.#host.text()?.saved(changes, typedText);
        this.#host.showTextSummary();
        this.#watch.took(written, drawn);
        this.#session.markSaved(document);
        this.#session.rebase(-left);
        // The view and the picture move with the drawing, so that they stay
        // where they were, and so does where a drag of the picture holds it.
        this.#host.shift(-left);
        this.#host.say(this.#notRenamed ? "Saved, but not renamed" : "Saved");
        return true;
      } catch (error) {
        if (error instanceof SaveAgain) {
          again = error.again;
          return false;
        }
        const reason = error instanceof Error ? error.message : String(error);
        this.#host.say(`Not saved: ${reason}`);
        if (!(error instanceof Unsaved)) {
          this.#host.notice(`Could not save the symbol: ${reason}`);
        }
        return false;
      } finally {
        this.#saving = undefined;
        this.#host.updateControls();
        this.#host.requestRender();
        this.keepDraft();
        // Or, if the editor was retired while this ran, the draft it kept.
        this.#settleDraft();
        // Changes reported while it ran, its own write among them.
        this.checkFile();
        // Not yet, as what waits on this save must hear that it stopped first:
        // Next, for one, goes by whether it is still under way.
        if (again !== undefined) this.#host.later(again);
      }
    })();
    this.#host.updateControls();
    return this.#saving;
  }
}
