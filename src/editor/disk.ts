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
  /**
   * The file as last opened, reloaded, or written; undefined before a file.
   * The editor reads only a file that exists, so while none is known, any
   * file found is a change, never one to write over unasked.
   */
  #fingerprint: string | undefined;
  /** How often the file known has changed, to tell stale reads. */
  #version = 0;
  /** A change that saving was chosen to replace. */
  #kept: string | undefined;
  /** A change already asked or told about while editing. */
  #asked: string | undefined;

  constructor(fingerprint?: string) {
    this.#fingerprint = fingerprint;
  }

  /** A fingerprint of the file as last opened, reloaded, or written. */
  get fingerprint(): string | undefined {
    return this.#fingerprint;
  }

  /**
   * A number that changes whenever the file known does, so that a read begun
   * before can be told from one begun after.
   */
  get version(): number {
    return this.#version;
  }

  /**
   * Whether a file holding `fingerprint` is a change that the editor has
   * neither taken in nor chosen to save over.
   */
  differs(fingerprint: string): boolean {
    return fingerprint !== this.#fingerprint && fingerprint !== this.#kept;
  }

  /**
   * What to do about `reading`, made while editing, as after the vault says
   * the file changed. A change with no unsaved drawing to lose is taken in;
   * otherwise the editor asks, once for each change.
   */
  noticed(reading: Reading, dirty: boolean): Noticed {
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

  /**
   * Records that the file holds `fingerprint`, as opened, reloaded, or
   * written by the editor.
   */
  took(fingerprint: string): void {
    this.#fingerprint = fingerprint;
    this.#kept = undefined;
    this.#asked = undefined;
    this.#version++;
  }
}
