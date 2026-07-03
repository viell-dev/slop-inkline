import type { App, TFile } from "obsidian";
import { INK_EXTENSION } from "../constants";
import type { InklineSettings } from "../settings/inklineSettings";
import { applyInkStyles } from "./applyInkStyles";
import { getAllDocuments } from "./getAllDocuments";
import { stripQueryAndHash } from "./stripQueryAndHash";

/**
 * Point every rendered `<img>` of `file` at a cache-busted src and
 * re-apply the ink styles, so a just-saved drawing shows up without a
 * re-render.
 *
 * @remarks
 * Candidates are prefiltered by the ink extension in their src — the same
 * marker the plugin CSS matches on — then matched by comparing their src
 * (query and hash stripped) against the file's resource path, since
 * live-preview embeds are never tagged by the post-processor; the
 * `data-inkline-path` marker is still honored for tagged embeds. Covers
 * every open window, including standalone file views of the image.
 *
 * @param app - The Obsidian app, used to build the resource path.
 * @param settings - The current settings to re-apply.
 * @param file - The ink file that was just saved.
 */
export function refreshInkFile(
  app: App,
  settings: InklineSettings,
  file: TFile,
): void {
  const resourcePath = app.vault.getResourcePath(file);
  const strippedPath = stripQueryAndHash(resourcePath);
  const nextSrc = `${resourcePath}?inkline=${Date.now()}`;
  const selector = `img[src*="${INK_EXTENSION}" i]`;

  for (const doc of getAllDocuments(app)) {
    for (const imageEl of Array.from(
      doc.querySelectorAll<HTMLImageElement>(selector),
    )) {
      if (
        imageEl.dataset.inklinePath === file.path ||
        stripQueryAndHash(imageEl.src) === strippedPath
      ) {
        imageEl.src = nextSrc;
        applyInkStyles(imageEl, file, settings);
      }
    }
  }
}
