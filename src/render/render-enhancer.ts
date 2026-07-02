import type { TFile } from "obsidian";

/** The rendered-embed surface the rest of the plugin drives. */
export interface RenderEnhancer {
  /** Re-publish the display CSS variables on every open window. */
  applyRootVariables(): void;
  /** Cache-bust and restyle every rendered embed of a just-saved ink. */
  refreshFile(file: TFile): void;
  /** Open the editor for the currently selected ink image, if any. */
  openSelectedInkImage(): boolean;
}
