// A symbol's readings and translations as a person sees and types them, in the
// editor and in the library: a field for each, one value to a line, and a line
// of what a symbol holds. What the fields decide about a file that changes
// underneath them is in plain functions, so that unit tests can check it.

import {
  textProblem,
  type SymbolText,
  type TextField,
} from "../format/text.ts";

export const noText: SymbolText = { reading: [], translation: [] };

/** The fields in the order they are shown. */
export const textFields: readonly TextField[] = ["reading", "translation"];

/** The most values shown in a line, as a list can hold thousands of them. */
const shownValues = 8;

/** What the fields changed to, by those that changed. */
export type TextChanges = Partial<Record<TextField, readonly string[]>>;

/** What was typed in the fields that changed, as a draft keeps it. */
export type TypedText = Partial<Record<TextField, string>>;

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Whether a symbol holds no reading and no translation. */
export function isBlank(text: SymbolText): boolean {
  return text.reading.length === 0 && text.translation.length === 0;
}

/** A field's values as its field shows them: one to a line. */
export function fieldText(values: readonly string[]): string {
  return values.join("\n");
}

/**
 * The values typed in a field: a line each, without the spaces around it, which
 * nobody can see and which would stop a search matching. A blank line is no
 * value, as the format has no empty ones. Pasted text brings its own breaks.
 */
export function typedValues(typed: string): string[] {
  return typed
    .split(/\r\n|[\n\r\u2028\u2029]/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Whether what is typed in a field changes what it was given. Text left as it
 * was changes nothing, even where it would read differently if typed, as with
 * a file's value that has a space around it, and so does a blank line added.
 */
export function isTouched(given: readonly string[], typed: string): boolean {
  return typed !== fieldText(given) && !sameValues(given, typedValues(typed));
}

/** A field after the file changes to say `now`. */
export interface TakenField {
  /** What the field holds now. */
  readonly typed: string;
  /** Whether it keeps text that replaces what the file now says. */
  readonly conflict: boolean;
}

/**
 * What a field holding `typed`, given `given`, does when its file now says
 * `now`. A field nobody changed follows the file. One somebody changed keeps
 * what they typed, which nothing else could bring back, and is in conflict if
 * the file's value changed too, to something else.
 */
export function takeFile(
  given: readonly string[],
  typed: string,
  now: readonly string[],
): TakenField {
  if (!isTouched(given, typed)) {
    return { typed: fieldText(now), conflict: false };
  }
  return {
    typed,
    conflict: !sameValues(given, now) && !sameValues(typedValues(typed), now),
  };
}

/** What a field's values are called, as a label. */
export function fieldLabel(field: TextField, count: number): string {
  const word = field === "reading" ? "Reading" : "Translation";
  return count === 1 ? word : `${word}s`;
}

/**
 * Shows a field's values in `parent` on a line of their own, each in its own
 * `bdi`, as a value can hold bidirectional controls, which must not reorder what
 * follows it. `found`, a value a search matched, comes first, and stands out.
 */
export function showValues(
  parent: HTMLElement,
  field: TextField,
  values: readonly string[],
  found?: string,
): void {
  const line = parent.createDiv({ cls: "inkline-values" });
  line.createSpan({
    cls: "inkline-values-label",
    text: `${fieldLabel(field, values.length)}: `,
  });
  const ordered =
    found === undefined
      ? values
      : [found, ...values.filter((value) => value !== found)];
  ordered.slice(0, shownValues).forEach((value, index) => {
    if (index > 0) line.appendText(", ");
    const shown = line.createEl("bdi", { text: value });
    if (value === found) shown.addClass("inkline-value-found");
  });
  const more = ordered.length - shownValues;
  if (more > 0) line.appendText(`, and ${String(more)} more`);
}

/**
 * The fields for a symbol's readings and translations, with what they were
 * last given by its file, which tells what a person has changed.
 */
export class TextFields {
  readonly #changed: () => void;
  readonly #areas = new Map<TextField, HTMLTextAreaElement>();
  readonly #errors = new Map<TextField, HTMLElement>();
  /** Says what saving would replace, for the fields in {@link #replacing}. */
  readonly #note: HTMLElement;
  /** The fields typed in that the file changed under what was typed. */
  readonly #replacing = new Set<TextField>();
  #given: SymbolText;

  constructor(parent: HTMLElement, given: SymbolText, changed: () => void) {
    this.#given = given;
    this.#changed = changed;
    const fields = parent.createDiv({ cls: "inkline-text-fields" });
    for (const field of textFields) {
      const label = fields.createEl("label", { cls: "inkline-text-field" });
      label.createSpan({ text: fieldLabel(field, 2) });
      const area = label.createEl("textarea", {
        // Each line takes its own direction from `unicode-bidi: plaintext` in
        // the styles, as readings in two scripts share a field.
        attr: {
          "data-inkline-field": field,
          dir: "auto",
          rows: "2",
          spellcheck: "false",
          autocomplete: "off",
        },
      });
      area.value = fieldText(given[field]);
      area.addEventListener("input", () => {
        this.#check();
        this.#showReplaced();
        this.#changed();
      });
      this.#areas.set(field, area);
      this.#errors.set(
        field,
        label.createDiv({
          cls: "inkline-text-error",
          attr: { role: "alert" },
        }),
      );
    }
    parent.createDiv({
      cls: "inkline-text-hint",
      text: "One per line, the main one first.",
    });
    this.#note = parent.createDiv({
      cls: "inkline-text-note",
      attr: { role: "status" },
    });
  }

  #typed(field: TextField): string {
    return this.#areas.get(field)?.value ?? fieldText(this.#given[field]);
  }

  /** Whether a person has changed either field. */
  get touched(): boolean {
    return textFields.some((field) =>
      isTouched(this.#given[field], this.#typed(field)),
    );
  }

  /** What the fields read as now, whether or not it can be saved. */
  get values(): SymbolText {
    const shown = (field: TextField): readonly string[] =>
      isTouched(this.#given[field], this.#typed(field))
        ? typedValues(this.#typed(field))
        : this.#given[field];
    return { reading: shown("reading"), translation: shown("translation") };
  }

  /** What the file said as last read. */
  get given(): SymbolText {
    return this.#given;
  }

  /** The new values of the fields that a person changed. */
  changes(): TextChanges {
    const changes: TextChanges = {};
    for (const field of textFields) {
      const typed = this.#typed(field);
      if (isTouched(this.#given[field], typed)) {
        changes[field] = typedValues(typed);
      }
    }
    return changes;
  }

  /** What is typed in the fields a person changed, for a draft to keep. */
  typed(): TypedText {
    const typed: TypedText = {};
    for (const field of textFields) {
      const text = this.#typed(field);
      if (isTouched(this.#given[field], text)) typed[field] = text;
    }
    return typed;
  }

  /** Puts back what a draft kept. */
  restore(typed: TypedText): void {
    for (const field of textFields) {
      const area = this.#areas.get(field);
      const text = typed[field];
      if (area !== undefined && text !== undefined) area.value = text;
    }
    this.#check();
  }

  /**
   * What stops the fields being saved, in a sentence, or undefined. A field
   * nobody changed holds what its file does, and cannot be at fault.
   */
  problem(): string | undefined {
    return this.#check();
  }

  /** Says what is wrong with each field, and returns the first of it. */
  #check(): string | undefined {
    let first: string | undefined;
    for (const field of textFields) {
      const typed = this.#typed(field);
      const problem = isTouched(this.#given[field], typed)
        ? textProblem(typedValues(typed))
        : undefined;
      const text =
        problem === undefined ? "" : `${fieldLabel(field, 2)}: ${problem}.`;
      this.#errors.get(field)?.setText(text);
      this.#areas.get(field)?.setAttribute("aria-invalid", String(text !== ""));
      if (text !== "") first ??= text;
    }
    return first;
  }

  /**
   * Says what saving would replace, for as long as a field holds text that
   * would replace a change to the file: that is the only place the file's value
   * can be seen, and a person who is told can keep it or their own.
   */
  #showReplaced(): void {
    for (const field of this.#replacing) {
      if (!isTouched(this.#given[field], this.#typed(field))) {
        this.#replacing.delete(field);
      }
    }
    this.#note.empty();
    if (this.#replacing.size === 0) return;
    this.#note.createDiv({
      text: "The file changed meanwhile. Saving replaces what it now says:",
    });
    for (const field of this.#replacing) {
      const now = this.#given[field];
      if (now.length > 0) showValues(this.#note, field, now);
      else this.#note.createDiv({ text: `${fieldLabel(field, 2)}: none` });
    }
  }

  /**
   * Takes what the file now says, as {@link takeFile} does for each field, says
   * what saving would replace, and returns the fields whose typed text would
   * replace a change the file just made.
   */
  take(now: SymbolText): TextField[] {
    const conflicts: TextField[] = [];
    for (const field of textFields) {
      const area = this.#areas.get(field);
      if (area === undefined) continue;
      const { typed, conflict } = takeFile(
        this.#given[field],
        area.value,
        now[field],
      );
      area.value = typed;
      if (conflict) {
        conflicts.push(field);
        this.#replacing.add(field);
      }
    }
    this.#given = now;
    this.#check();
    this.#showReplaced();
    return conflicts;
  }

  /** The fields whose typed text a file saying `now` would be in conflict with. */
  conflicts(now: SymbolText): TextField[] {
    return textFields.filter(
      (field) =>
        takeFile(this.#given[field], this.#typed(field), now[field]).conflict,
    );
  }

  /** Drops what was typed in `fields`, for what the file says. */
  drop(fields: readonly TextField[]): void {
    for (const field of fields) {
      const area = this.#areas.get(field);
      if (area !== undefined) area.value = fieldText(this.#given[field]);
    }
    this.#check();
    this.#showReplaced();
  }

  /**
   * Records that `changes` were written. A field that still holds `sent`, what
   * was typed for them, shows the values as saved, without their spaces; one
   * typed in since then stays, and is still to save.
   */
  saved(changes: TextChanges, sent: TypedText): void {
    this.#given = { ...this.#given, ...changes };
    for (const field of textFields) {
      const area = this.#areas.get(field);
      const values = changes[field];
      if (
        area !== undefined &&
        values !== undefined &&
        area.value === sent[field]
      ) {
        area.value = fieldText(values);
      }
    }
    this.#check();
    // The save has replaced what it said it would.
    this.#replacing.clear();
    this.#showReplaced();
  }

  /** Lets the fields be typed in, or not. */
  set enabled(enabled: boolean) {
    for (const area of this.#areas.values()) area.readOnly = !enabled;
  }

  focus(): void {
    this.#areas.get("reading")?.focus();
  }
}
