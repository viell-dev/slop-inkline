import type { TFile } from "obsidian";
import type { InklineSettings } from "../settings/inklineSettings";
import { applyDisplayVariables } from "./applyDisplayVariables";

/**
 * Tag a rendered ink `<img>` and its embed wrapper with the inkline
 * classes, path marker, and display CSS variables.
 *
 * @remarks
 * Only inline embeds get shrunk to glyph size: a standalone image view
 * (opening the `.ink.png` directly) has no embed wrapper and must stay
 * full size, so it is left untouched here; `refreshInkFile` still updates
 * its src so the content stays current.
 *
 * @param imageEl - The rendered `<img>` element to style.
 * @param file - The ink file the image shows; recorded as the path marker.
 * @param settings - The current settings, driving invert and display
 *   variables.
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
