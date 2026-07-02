import type { TFile } from "obsidian";

export interface CreatedInkFile {
  file: TFile;
  name: string;
  path: string;
  width: number;
  height: number;
}
