import { Option } from "effect";
import type { App, TFile } from "obsidian";
import { isInkFile } from "../inkFiles/isInkFile";
import type { InkResourceCache } from "./inkResourceCache";

/**
 * Resolve the vault ink file a rendered `<img>` points at.
 *
 * @remarks
 * Uses the tagged `data-inkline-path` when it still resolves to an ink
 * file, otherwise falls back to a resource-path lookup on the image src.
 *
 * @param app - The Obsidian app, used for path lookups.
 * @param cache - The resource-path cache used for the src fallback.
 * @param imageEl - The rendered image element.
 * @returns The ink file behind the image, or none.
 */
export function resolveImageFile(
  app: App,
  cache: InkResourceCache,
  imageEl: HTMLImageElement,
): Option.Option<TFile> {
  const dataPath = imageEl.dataset.inklinePath;
  if (dataPath) {
    const file = inkFileFromPath(app, dataPath);
    if (Option.isSome(file)) {
      return file;
    }
  }

  const source =
    imageEl.currentSrc || imageEl.src || imageEl.getAttribute("src") || "";
  return cache.lookup(source);
}

/**
 * Look up a vault path and keep it only when it is an ink file.
 *
 * @param app - The Obsidian app, used for the lookup.
 * @param path - The vault path to resolve.
 * @returns The ink file at that path, or none.
 */
function inkFileFromPath(app: App, path: string): Option.Option<TFile> {
  return Option.fromNullable(app.vault.getFileByPath(path)).pipe(
    Option.filter(isInkFile),
  );
}
