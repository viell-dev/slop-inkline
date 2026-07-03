import type { TFile } from "obsidian";

/** The rendered-embed surface the rest of the plugin drives. */
export interface RenderEnhancer {
  /**
   * Cache-bust and restyle every rendered embed of a just-saved ink.
   *
   * @param file - The ink file that was saved.
   */
  refreshFile(file: TFile): void;
  /**
   * Open the editor for the currently selected ink image, if any.
   *
   * @returns Whether a selected ink image was found and opened.
   */
  openSelectedInkImage(): boolean;
}
