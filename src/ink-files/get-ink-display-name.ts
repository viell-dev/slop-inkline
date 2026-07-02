import type { TFile } from "obsidian";
import { slugifyInkName } from "./slugify-ink-name";

/** The name shown for an ink file: its slugified filename, stem fallback. */
export function getInkDisplayName(file: TFile): string {
  return slugifyInkName(file.name) || file.basename;
}
