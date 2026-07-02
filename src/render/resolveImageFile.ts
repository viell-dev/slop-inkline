import { Option } from "effect";
import type { App, TFile } from "obsidian";
import { isInkFile } from "../inkFiles/isInkFile";
import type { InkResourceCache } from "./inkResourceCache";

/**
 * The vault ink file a rendered `<img>` points at: the tagged
 * `data-inkline-path` when still valid, otherwise a resource-path lookup on
 * the image src.
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

function inkFileFromPath(app: App, path: string): Option.Option<TFile> {
  return Option.fromNullable(app.vault.getFileByPath(path)).pipe(
    Option.filter(isInkFile),
  );
}
