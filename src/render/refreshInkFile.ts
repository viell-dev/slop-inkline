import { Option } from "effect";
import type { App, TFile } from "obsidian";
import type { InklineSettings } from "../settings/inklineSettings";
import { applyInkStyles } from "./applyInkStyles";
import type { InkResourceCache } from "./inkResourceCache";
import { resolveImageFile } from "./resolveImageFile";

/**
 * Point every rendered `<img>` of `file` at a cache-busted src and re-apply
 * the ink styles, so a just-saved drawing shows up without a re-render.
 */
export function refreshInkFile(
  app: App,
  cache: InkResourceCache,
  settings: InklineSettings,
  file: TFile,
): void {
  const resourcePath = app.vault.getResourcePath(file);
  const nextSrc = `${resourcePath}?inkline=${Date.now()}`;
  const images = activeDocument.querySelectorAll<HTMLImageElement>("img");

  for (const imageEl of Array.from(images)) {
    const resolved = Option.getOrNull(resolveImageFile(app, cache, imageEl));
    if (resolved?.path === file.path) {
      imageEl.src = nextSrc;
      applyInkStyles(imageEl, file, settings);
    }
  }
}
