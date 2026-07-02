import type { TFile } from "obsidian";

/** The result of creating a new ink file in the vault. */
export interface CreatedInkFile {
  /** The created vault file. */
  file: TFile;
  /**
   * The display name the ink ended up with: the requested name, or the
   * final stem when a collision suffix or auto-number replaced it.
   */
  name: string;
  /** The vault path the file was created at. */
  path: string;
  /** The stored image width, in pixels. */
  width: number;
  /** The stored image height, in pixels. */
  height: number;
}
