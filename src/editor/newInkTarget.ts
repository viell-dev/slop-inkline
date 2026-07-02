import type { CreatedInkFile } from "../inkFiles/createdInkFile";

/** Where and how a not-yet-saved ink should be created on first save. */
export interface NewInkTarget {
  name: string;
  sourcePath: string;
  imageSize: number;
  onCreate?: (created: CreatedInkFile) => void;
}
