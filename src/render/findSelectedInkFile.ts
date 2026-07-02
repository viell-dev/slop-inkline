import { Option } from "effect";
import type { App, TFile } from "obsidian";
import type { InkResourceCache } from "./inkResourceCache";
import { resolveImageFile } from "./resolveImageFile";

const SELECTED_IMAGE_SELECTORS = [
  ".inkline-embed.is-selected img",
  ".inkline-embed.is-focused img",
  ".inkline-embed.mod-active img",
  ".image-embed.is-selected img",
  ".image-embed.is-focused img",
  ".image-embed.mod-active img",
  ".image-embed[aria-selected='true'] img",
  ".internal-embed.is-selected img",
  ".internal-embed.is-focused img",
  ".internal-embed.mod-active img",
  ".internal-embed[aria-selected='true'] img",
  "img.is-selected",
  "img.is-focused",
  "img.mod-active",
  "img[aria-selected='true']",
].join(",");

/** The ink file behind the currently selected/focused rendered image. */
export function findSelectedInkFile(
  app: App,
  cache: InkResourceCache,
): Option.Option<TFile> {
  for (const imageEl of getSelectedImageElements()) {
    const file = resolveImageFile(app, cache, imageEl);
    if (Option.isSome(file)) {
      return file;
    }
  }

  return Option.none();
}

function getSelectedImageElements(): HTMLImageElement[] {
  const images = Array.from(
    activeDocument.querySelectorAll<HTMLImageElement>(
      SELECTED_IMAGE_SELECTORS,
    ),
  );
  const activeElement = activeDocument.activeElement;

  if (activeElement instanceof HTMLElement) {
    const activeImage = activeElement
      .closest(".image-embed, .internal-embed, .inkline-embed")
      ?.querySelector("img");
    if (activeImage instanceof HTMLImageElement) {
      images.push(activeImage);
    }
  }

  return [...new Set(images)];
}
