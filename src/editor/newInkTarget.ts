import type { CreatedInkFile } from "../inkFiles/createdInkFile";

/** Where and how a not-yet-saved ink should be created on first save. */
export interface NewInkTarget {
  /** The initial display name shown in the editor's name field. */
  name: string;
  /** The path of the note the ink is inserted into; picks the folder. */
  sourcePath: string;
  /** Stored resolution of the new ink, in pixels per side. */
  imageSize: number;
  /**
   * Called once when the first save creates the file.
   *
   * @param created - The created file with its final name and dimensions.
   */
  onCreate?: (created: CreatedInkFile) => void;
}
