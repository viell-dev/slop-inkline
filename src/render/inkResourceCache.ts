import { Option } from "effect";
import type { App, TFile } from "obsidian";
import { isInkFile } from "../inkFiles/isInkFile";

/**
 * Lazily built map from an ink file's resource path (query and hash
 * stripped, since `getResourcePath` appends cache-busting params) to its
 * `TFile`. Lets image resolution avoid an O(vault size) scan per image.
 * Invalidate wholesale on any vault create/delete/rename.
 */
export interface InkResourceCache {
  lookup(source: string): Option.Option<TFile>;
  invalidate(): void;
}

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

function stripQueryAndHash(value: string): string {
  return value.split("#", 1)[0].split("?", 1)[0];
}
