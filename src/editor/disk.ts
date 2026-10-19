// How the editor follows its symbol's file on disk: whether what the file
// holds is what the editor last opened, reloaded, or saved, and what to do
// when sync, another app, or another editor changes it. Plain state with no
// files or Obsidian, so that unit tests can drive it.

/** A fresh read of the symbol's file. */
export type Reading =
  | { readonly kind: "gone" }
  | {
      readonly kind: "file";
      readonly fingerprint: string;
      /** Whether this version of Inkline can open it for editing. */
      readonly readable: boolean;
    };

/**
 * What to do about a reading made while editing: nothing, take the change
 * in, ask whether to, say that it cannot be read, or say that it is gone.
 */
export type Noticed = "nothing" | "reload" | "ask" | "unreadable" | "gone";

/**
 * What a save does about a reading made just before it writes: write, ask
 * first, or refuse to write over a file it cannot read.
 */
export type AtSave = "write" | "ask" | "unreadable";

export class FileWatch {
  /** The file as last opened, reloaded, or saved; undefined before a file. */
  #fingerprint: string | undefined;
  /** A change that saving was chosen to replace. */
  #kept: string | undefined;
  /** A change already asked or told about while editing. */
  #asked: string | undefined;

  constructor(fingerprint?: string) {
    this.#fingerprint = fingerprint;
  }

  /** A fingerprint of the file as last opened, reloaded, or saved. */
  get fingerprint(): string | undefined {
    return this.#fingerprint;
  }

  /**
   * Whether a file holding `fingerprint` is a change that the editor has
   * neither taken in nor chosen to save over.
   */
  differs(fingerprint: string): boolean {
    return (
      this.#fingerprint !== undefined &&
      fingerprint !== this.#fingerprint &&
      fingerprint !== this.#kept
    );
  }

  /**
   * What to do about `reading`, made while editing, as after the vault says
   * the file changed. A change with no unsaved drawing to lose is taken in;
   * otherwise the editor asks, once for each change.
   */
  noticed(reading: Reading, dirty: boolean): Noticed {
    if (this.#fingerprint === undefined) return "nothing";
    if (reading.kind === "gone") return "gone";
    if (
      !this.differs(reading.fingerprint) ||
      reading.fingerprint === this.#asked
    ) {
      return "nothing";
    }
    if (!reading.readable) {
      this.#asked = reading.fingerprint;
      return "unreadable";
    }
    if (!dirty) return "reload";
    this.#asked = reading.fingerprint;
    return "ask";
  }

  /**
   * What a save does about `reading`, made just before it writes. A change
   * is asked about even if it was before, since saving would replace it; a
   * file it cannot read is never written over. A deleted file is made again.
   */
  saving(reading: Reading): AtSave {
    if (reading.kind === "gone" || !this.differs(reading.fingerprint)) {
      return "write";
    }
    if (!reading.readable) return "unreadable";
    this.#asked = reading.fingerprint;
    return "ask";
  }

  /** Records that saving is to replace the change `fingerprint` names. */
  keep(fingerprint: string): void {
    this.#kept = fingerprint;
  }

  /** Records that the file holds what the editor has, as opened or saved. */
  took(fingerprint: string): void {
    this.#fingerprint = fingerprint;
    this.#kept = undefined;
    this.#asked = undefined;
  }
}
