import type { TFile } from "obsidian";
import type { NewInkTarget } from "./newInkTarget";

export interface InkEditorOptions {
  /** Present when the editor opens for a new ink instead of a file. */
  newInk?: NewInkTarget;
  displayHeight?: string;
  pinGuides?: boolean;
  onPinGuidesChange?: (pinned: boolean) => void | Promise<void>;
  onSave?: (file: TFile) => void;
}
