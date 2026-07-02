import type { TFile } from "obsidian";
import type { NewInkTarget } from "./newInkTarget";

/** Options for opening the ink editor. */
export interface InkEditorOptions {
  /** Present when the editor opens for a new ink instead of a file. */
  newInk?: NewInkTarget;
  /** CSS display height (e.g. "1.5em") driving the baseline guides. */
  displayHeight?: string;
  /** Whether the crop and baseline guides start pinned (always visible). */
  pinGuides?: boolean;
  /**
   * Called when the user toggles the guide pin, so the preference can be
   * persisted.
   *
   * @param pinned - The new pin state.
   */
  onPinGuidesChange?: (pinned: boolean) => void | Promise<void>;
  /**
   * Called after every successful save (and after a rename that is part of
   * one).
   *
   * @param file - The saved ink file.
   */
  onSave?: (file: TFile) => void;
}
