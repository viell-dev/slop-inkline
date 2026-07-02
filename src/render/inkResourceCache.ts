import { Option } from "effect";
import type { App, TFile } from "obsidian";
import { isInkFile } from "../inkFiles/isInkFile";

/**
 * Lazily built map from an ink file's resource path to its `TFile`, letting
 * image resolution avoid an O(vault size) scan per image.
 *
 * @remarks
 * Keys have query and hash stripped, since `getResourcePath` appends
 * cache-busting params. Invalidate wholesale on any vault
 * create/delete/rename.
 */
export interface InkResourceCache {
  /**
   * Resolve an image src to the ink file it serves.
   *
   * @param source - The image's src or currentSrc.
   * @returns The matching ink file, or none.
   */
  lookup(source: string): Option.Option<TFile>;
  /** Drop the cached map; the next lookup rebuilds it from the vault. */
  invalidate(): void;
}

/**
 * Create an ink resource cache over the given app's vault.
 *
 * @remarks
 * The map is built on first lookup and reused until
 * {@link InkResourceCache.invalidate} is called. Lookup tries an exact
 * resource-path match first, then falls back to substring matching on the
 * (possibly URI-encoded) vault path.
 *
 * @param app - The Obsidian app whose vault is indexed.
 * @returns The cache surface.
 */
export function createInkResourceCache(app: App): InkResourceCache {
  let cache: Map<string, TFile> | null = null;

  const entries = (): Map<string, TFile> => {
    if (!cache) {
      cache = new Map<string, TFile>();
      for (const file of app.vault.getFiles()) {
        if (isInkFile(file)) {
          cache.set(stripQueryAndHash(app.vault.getResourcePath(file)), file);
        }
      }
    }

    return cache;
  };

  return {
    lookup(source) {
      const stripped = stripQueryAndHash(source);
      const map = entries();

      const exactMatch = map.get(stripped);
      if (exactMatch) {
        return Option.some(exactMatch);
      }

      for (const file of map.values()) {
        if (
          stripped.includes(encodeURI(file.path)) ||
          stripped.includes(file.path)
        ) {
          return Option.some(file);
        }
      }

      return Option.none();
    },
    invalidate() {
      cache = null;
    },
  };
}

/**
 * Strip the query and hash parts from a URL-like string.
 *
 * @param value - The string to strip.
 * @returns Everything before the first `#` or `?`.
 */
function stripQueryAndHash(value: string): string {
  return value.split("#", 1)[0].split("?", 1)[0];
}
