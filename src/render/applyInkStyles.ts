import type { TFile } from "obsidian";
import type { InklineSettings } from "../settings/inklineSettings";
import { applyDisplayVariables } from "./applyDisplayVariables";

/**
 * Tag a rendered ink `<img>` and its embed wrapper with the inkline classes,
 * path marker, and display CSS variables. Only inline embeds get shrunk to
 * glyph size: a standalone image view (opening the .ink.png directly) has no
 * embed wrapper and must stay full size; refreshInkFile still updates its
 * src so the content stays current.
 */
export function applyInkStyles(
  imageEl: HTMLImageElement,
  file: TFile,
  settings: InklineSettings,
): void {
  const embedEl = imageEl.closest<HTMLElement>(".image-embed, .internal-embed");
  if (!embedEl) {
    return;
  }

  imageEl.addClass("inkline-image");
  imageEl.dataset.inklinePath = file.path;
  imageEl.toggleClass("inkline-no-invert", !settings.darkModeInvert);
  applyDisplayVariables(imageEl, settings);

  embedEl.addClass("inkline-embed");
  embedEl.dataset.inklinePath = file.path;
  applyDisplayVariables(embedEl, settings);
}
