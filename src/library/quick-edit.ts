// Quick edit's save, apart from Obsidian: one Save of a symbol's readings and
// translations and then of its name, run as two steps, and what the library's
// row and notices say of how it went. view.ts gives it the write and the rename
// to run, and shows what it decides; unit tests run it with steps of their own.

import type { SymbolText } from "../format/text.ts";
import {
  RenameDisturbed,
  renameWaits,
  savingWaits,
  TextMoved,
} from "../notes/file-writes.ts";

/** The steps of a save, in the order they run. */
export type Step = "write" | "rename";

/** A step under way. */
export interface Work {
  readonly done: Promise<void>;
  /** Stops it; returns false if it has gone to the vault, and can still end. */
  readonly stop: () => boolean;
}

/** Told `true` when a step has waited long, and `false` when it goes on. */
export type Told = (waiting: boolean) => void;

/** The steps a save was asked for, each started when its turn comes. */
export interface Steps {
  /** Writes the readings and translations, if they changed. */
  readonly write?: (told: Told) => Work;
  /** Renames the symbol, if its name changed. */
  readonly rename?: (told: Told) => Work;
}

/** A step that the person left while it waited. */
export interface Left {
  readonly step: Step;
  /** Whether it was stopped, and so changes nothing. */
  readonly stopped: boolean;
  /** Whether the readings and translations were written by then. */
  readonly written: boolean;
  /** Whether a rename was asked for. */
  readonly renaming: boolean;
}

/** How a save ended. */
export interface Outcome {
  /** Whether the readings and translations were asked to be written. */
  readonly writing: boolean;
  /** Whether a rename was asked for. */
  readonly renaming: boolean;
  /** Whether the readings and translations were written. */
  readonly written: boolean;
  /** Whether the rename ended as asked. */
  readonly renamed: boolean;
  /** Whether a step waited long enough for the person to be told. */
  readonly waited: boolean;
  readonly left: Left | undefined;
  /** The step that failed, and why, which is where the save stopped. */
  readonly failure:
    { readonly step: Step; readonly error: unknown } | undefined;
}

/**
 * One Save, as two steps: the readings and translations, then the name, the
 * editor's order, which writes the drawing before it renames. The rename starts
 * only once the write has ended as asked, and not at all after a write that
 * failed, or one the person left while it waited, even if it still finished.
 */
export class QuickSave {
  readonly #steps: Steps;
  readonly #told: (waiting: Step | undefined) => void;
  /** The step running now, which a failure belongs to, and its work. */
  #step: Step | undefined;
  #work: Work | undefined;
  /** Whether that step waits long enough for the person to be told. */
  #waiting = false;
  #left: Left | undefined;
  #written = false;
  #waited = false;

  /**
   * `told` hears which step waits long enough to tell the person, and
   * undefined once none does.
   */
  constructor(steps: Steps, told: (waiting: Step | undefined) => void) {
    this.#steps = steps;
    this.#told = told;
  }

  /** The step that waits now, if any: only then can the save be left. */
  get waiting(): Step | undefined {
    return this.#waiting ? this.#step : undefined;
  }

  /** Whether the readings and translations are written. */
  get written(): boolean {
    return this.#written;
  }

  /**
   * Leaves the step that waits, stopping it if it still can, so that no later
   * step starts; returns what was left, or undefined if nothing waits.
   */
  leave(): Left | undefined {
    const step = this.waiting;
    const work = this.#work;
    if (step === undefined || work === undefined || this.#left !== undefined) {
      return undefined;
    }
    this.#left = {
      step,
      stopped: work.stop(),
      written: this.#written,
      renaming: this.#steps.rename !== undefined,
    };
    return this.#left;
  }

  /** Runs the steps asked for, and says how the save ended. */
  async run(): Promise<Outcome> {
    let renamed = false;
    let failure: Outcome["failure"];
    try {
      if (this.#steps.write !== undefined) {
        await this.#run("write", this.#steps.write);
        this.#written = true;
      }
      if (this.#steps.rename !== undefined && this.#left === undefined) {
        await this.#run("rename", this.#steps.rename);
        renamed = true;
      }
    } catch (error) {
      failure = { step: this.#step ?? "write", error };
    }
    return {
      writing: this.#steps.write !== undefined,
      renaming: this.#steps.rename !== undefined,
      written: this.#written,
      renamed,
      waited: this.#waited,
      left: this.#left,
      failure,
    };
  }

  async #run(step: Step, start: (told: Told) => Work): Promise<void> {
    this.#step = step;
    this.#work = undefined;
    this.#waiting = false;
    const work = start((still) => {
      this.#waited ||= still;
      this.#waiting = still;
      this.#told(this.waiting);
    });
    this.#work = work;
    try {
      await work.done;
    } finally {
      this.#waiting = false;
    }
  }
}

/** What a person can do about a write that has waited that long. */
const savingLeft =
  "If nothing changes, copy what you typed and restart Obsidian. Cancel closes this, and stops the save if it still can.";

/** What a person can do about a rename that has stopped that long. */
const renameLeft =
  "If nothing changes, copy the name you typed and restart Obsidian. Cancel closes this, and stops the rename if it still can.";

/** What the row says while `step` waits, after the write if `written`. */
export function waitLine(step: Step, written: boolean): string {
  if (step === "write") return `${savingWaits} ${savingLeft}`;
  return written
    ? `${renameWaits} The readings and translations are saved. ${renameLeft}`
    : `${renameWaits} ${renameLeft}`;
}

/** The names a save is told of by. */
export interface Names {
  /** The name the row was given, which the save calls the symbol by. */
  readonly was: string;
  /** The name typed. */
  readonly typed: string;
  /** The name the file has once the save ends. */
  readonly now: string;
}

/** What a notice says as the person leaves a step that waits, if anything. */
export function leftNotice(left: Left, { was }: Names): string | undefined {
  if (left.step === "write") {
    if (left.stopped) return undefined;
    return left.renaming
      ? `Saving ${was} had reached Obsidian, so it may still finish. It will not be renamed.`
      : `Saving ${was} had reached Obsidian, so it may still finish.`;
  }
  if (left.stopped) {
    return left.written ? `Saved ${was}. It was not renamed.` : undefined;
  }
  return left.written
    ? `Saved ${was}. Renaming it had reached Obsidian, so it may still finish.`
    : `Renaming ${was} had reached Obsidian, so it may still finish.`;
}

/** What the row and a notice say once a save ends. */
export interface Report {
  /** Whether the save did what was asked, which closes the row. */
  readonly closes: boolean;
  /** What the row says, a line each, when it stays open to try again. */
  readonly lines: readonly string[];
  /** What a notice says, for a person who has left the row or looked away. */
  readonly notice: string | undefined;
  /** What the file says now, for the fields to take, after a write refused. */
  readonly moved: SymbolText | undefined;
  /** Where the focus goes when the row stays open. */
  readonly focus: "name" | "fields";
}

/** A failure's message, or `otherwise` for one that is not an error. */
export function reasonOf(failure: unknown, otherwise: string): string {
  return failure instanceof Error ? failure.message : otherwise;
}

/** Said of a save that did what was asked, to someone told that it waited. */
function doneNotice(outcome: Outcome, { was, now }: Names): string {
  if (!outcome.renaming) return `Saved ${was}.`;
  return outcome.written
    ? `Saved ${was} and renamed it to ${now}.`
    : `Renamed ${was} to ${now}.`;
}

/** Said of a write that failed once the row has gone. */
function writeNotice(renaming: boolean, reason: string, names: Names): string {
  return renaming
    ? `The readings and translations of ${names.was} were not saved, and it was not renamed to ${names.typed}: ${reason}`
    : `The readings and translations of ${names.was} were not saved: ${reason}`;
}

/** Said of a rename that failed once the row has gone. */
function renameNotice(
  written: boolean,
  failure: unknown,
  names: Names,
): string {
  const reason = reasonOf(failure, "The symbol could not be renamed.");
  const first = written ? `Saved ${names.was}. ` : "";
  return failure instanceof RenameDisturbed
    ? `${first}Renaming ${names.was} to ${names.typed}: ${reason}`
    : `${first}${names.was} could not be renamed to ${names.typed}: ${reason}`;
}

/**
 * What the row and a notice say once a save ends, with the row still `open`
 * or gone, as when the library closes or Inkline unloads. Nothing typed is
 * lost without a word: an open row keeps it, and a notice names what was not
 * done for a row that has gone. A step the person stopped says nothing more.
 */
export function reportSave(
  outcome: Outcome,
  names: Names,
  open: boolean,
): Report {
  const report = (parts: Partial<Report> & Pick<Report, "closes">): Report => ({
    lines: [],
    notice: undefined,
    moved: undefined,
    focus: "name",
    ...parts,
  });
  const { failure, left, written, renaming } = outcome;
  if (failure === undefined) {
    // A write left while it waited and finished all the same, and the rename
    // did not start; anything else did what was asked.
    return report({
      closes: true,
      notice:
        left?.step === "write"
          ? `Saved ${names.was}.`
          : outcome.waited
            ? doneNotice(outcome, names)
            : undefined,
    });
  }
  if (left !== undefined) {
    return report({
      closes: true,
      notice: left.stopped
        ? undefined
        : failure.step === "write"
          ? writeNotice(
              renaming,
              reasonOf(failure.error, "The symbol could not be saved."),
              names,
            )
          : renameNotice(written, failure.error, names),
    });
  }
  if (failure.step === "write") {
    const reason = reasonOf(failure.error, "The symbol could not be saved.");
    if (!open) {
      return report({
        closes: false,
        notice: writeNotice(renaming, reason, names),
      });
    }
    if (failure.error instanceof TextMoved) {
      return report({
        closes: false,
        lines: renaming
          ? ["The file changed meanwhile, so nothing was saved or renamed."]
          : [],
        moved: failure.error.text,
        focus: "fields",
      });
    }
    return report({
      closes: false,
      lines: [reason, ...(renaming ? ["Nothing was renamed."] : [])],
      focus: "fields",
    });
  }
  if (!open) {
    return report({
      closes: false,
      notice: renameNotice(written, failure.error, names),
    });
  }
  // What came between a rename says where the file is now, which may have the
  // new name all the same.
  const saved =
    failure.error instanceof RenameDisturbed
      ? "The readings and translations are saved."
      : "The readings and translations are saved, but the symbol was not renamed:";
  return report({
    closes: false,
    lines: [
      ...(written ? [saved] : []),
      reasonOf(failure.error, "The symbol could not be renamed."),
    ],
  });
}

/** The name field, as typed, and the file's name it was last given. */
export interface NameField {
  readonly typed: string;
  readonly given: string;
}

/**
 * The name field once the file is renamed to `now` elsewhere, as by sync: a
 * name nobody typed in follows it, and one typed stays. Either way the field
 * is now given `now`, so that Save, which renames only a name that differs
 * from the one given, never takes the file back to a name it had before.
 */
export function followName(field: NameField, now: string): NameField {
  return {
    typed: field.typed === field.given ? now : field.typed,
    given: now,
  };
}
