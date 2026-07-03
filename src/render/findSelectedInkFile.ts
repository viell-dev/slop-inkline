import { Option } from "effect";
import type { App, TFile } from "obsidian";
import type { InkResourceCache } from "./inkResourceCache";
import { resolveImageFile } from "./resolveImageFile";

/**
 * Find the ink file behind the currently focused rendered image embed.
 *
 * @remarks
 * Obsidian sets no CSS state class on a clicked embed; the embed element
 * (`tabindex="-1"`) simply receives DOM focus, so the lookup starts from
 * the active element.
 *
 * @param app - The Obsidian app, used to resolve images to files.
 * @param cache - The resource cache used for src lookups.
 * @returns The ink file of the focused embed's image, or none.
 */
export function findSelectedInkFile(
  app: App,
  cache: InkResourceCache,
): Option.Option<TFile> {
  return Option.fromNullable(getFocusedImageElement()).pipe(
    Option.flatMap((imageEl) => resolveImageFile(app, cache, imageEl)),
  );
}

/**
 * The image inside the internal embed that contains the focused element.
 *
 * @returns The image element, or null when nothing relevant is focused.
 */
function getFocusedImageElement(): HTMLImageElement | null {
  const activeElement = activeDocument.activeElement;
  if (!(activeElement instanceof HTMLElement)) {
    return null;
  }

  return activeElement.closest(".internal-embed")?.querySelector("img") ?? null;
}
