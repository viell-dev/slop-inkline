import { Plugin, TFile } from "obsidian";
import { InkFileService } from "./ink-file";
import { computeInkLineLayout, parseDisplayHeightEm } from "./layout";
import { InklineSettings } from "./settings";

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

export class RenderEnhancer {
  constructor(
    private readonly plugin: Plugin,
    private readonly fileService: InkFileService,
    private readonly getSettings: () => InklineSettings,
    private readonly openEditor: (file: TFile) => void,
  ) {}

  register(): void {
    this.applyRootVariables();

    this.plugin.registerMarkdownPostProcessor((el, _ctx) => {
      this.enhance(el);
    });

    this.plugin.registerDomEvent(activeDocument, "click", (event) => {
      this.handleClick(event);
    });
  }

  /**
   * Publish the display height and inline vertical-align as inherited variables
   * on the document root. The size and vertical-align CSS is keyed on the
   * `.ink.png` src, so this keeps every ink image aligned even when the per-image
   * post-processor has not run yet (lazily loaded embeds, re-renders).
   */
  applyRootVariables(): void {
    const displayHeight = this.getSettings().displayHeight;
    const valign = `${computeInkLineLayout(parseDisplayHeightEm(displayHeight)).verticalAlignEm}em`;

    activeDocument.body.style.setProperty("--inkline-display-height", displayHeight);
    activeDocument.body.style.setProperty("--inkline-valign", valign);
  }

  refreshFile(file: TFile): void {
    const resourcePath = this.plugin.app.vault.getResourcePath(file);
    const nextSrc = `${resourcePath}?inkline=${Date.now()}`;

    for (const imageEl of Array.from(activeDocument.querySelectorAll<HTMLImageElement>("img"))) {
      const resolvedFile = this.resolveImageFile(imageEl);
      if (resolvedFile?.path === file.path) {
        imageEl.src = nextSrc;
        this.enhanceImage(imageEl, file);
      }
    }
  }

  openSelectedInkImage(): boolean {
    const file = this.findSelectedInkFile();
    if (!file) {
      return false;
    }

    this.openEditor(file);
    return true;
  }

  private enhance(el: HTMLElement): void {
    for (const imageEl of Array.from(el.querySelectorAll<HTMLImageElement>("img"))) {
      const file = this.resolveImageFile(imageEl);
      if (!file) {
        continue;
      }

      this.enhanceImage(imageEl, file);
    }
  }

  private enhanceImage(imageEl: HTMLImageElement, file: TFile): void {
    const embedEl = imageEl.closest<HTMLElement>(".image-embed, .internal-embed");
    if (!embedEl) {
      // Only inline embeds get shrunk to glyph size. A standalone image view
      // (opening the .ink.png directly) has no embed wrapper and must stay full
      // size; refreshFile still updates its src so the content stays current.
      return;
    }

    const displayHeight = this.getSettings().displayHeight;
    const valign = `${computeInkLineLayout(parseDisplayHeightEm(displayHeight)).verticalAlignEm}em`;

    imageEl.addClass("inkline-image");
    imageEl.dataset.inklinePath = file.path;
    imageEl.toggleClass("inkline-no-invert", !this.getSettings().darkModeInvert);
    imageEl.style.setProperty("--inkline-display-height", displayHeight);
    imageEl.style.setProperty("--inkline-valign", valign);

    embedEl.addClass("inkline-embed");
    embedEl.dataset.inklinePath = file.path;
    embedEl.style.setProperty("--inkline-display-height", displayHeight);
    embedEl.style.setProperty("--inkline-valign", valign);
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const embedEl = target.closest<HTMLElement>(".inkline-embed");
    const imageEl = target.closest("img");
    if (!embedEl && !(imageEl instanceof HTMLImageElement)) {
      return;
    }

    const file = embedEl?.dataset.inklinePath
      ? this.fileFromPath(embedEl.dataset.inklinePath)
      : imageEl instanceof HTMLImageElement
        ? this.resolveImageFile(imageEl)
        : null;
    if (!file) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.openEditor(file);
  }

  private findSelectedInkFile(): TFile | null {
    for (const imageEl of this.getSelectedImageElements()) {
      const file = this.resolveImageFile(imageEl);
      if (file) {
        return file;
      }
    }

    return null;
  }

  private getSelectedImageElements(): HTMLImageElement[] {
    const images = Array.from(activeDocument.querySelectorAll<HTMLImageElement>(SELECTED_IMAGE_SELECTORS));
    const activeElement = activeDocument.activeElement;

    if (activeElement instanceof HTMLElement) {
      const activeImage = activeElement.closest(".image-embed, .internal-embed, .inkline-embed")?.querySelector("img");
      if (activeImage instanceof HTMLImageElement) {
        images.push(activeImage);
      }
    }

    return [...new Set(images)];
  }

  private fileFromPath(path: string): TFile | null {
    const file = this.plugin.app.vault.getFileByPath(path);
    if (file && this.fileService.isInkFile(file)) {
      return file;
    }

    return null;
  }

  private resolveImageFile(imageEl: HTMLImageElement): TFile | null {
    const dataPath = imageEl.dataset.inklinePath;
    if (dataPath) {
      const file = this.fileFromPath(dataPath);
      if (file) {
        return file;
      }
    }

    const source = stripQueryAndHash(imageEl.currentSrc || imageEl.src || imageEl.getAttribute("src") || "");

    for (const file of this.plugin.app.vault.getFiles()) {
      if (!this.fileService.isInkFile(file)) {
        continue;
      }

      const resourcePath = stripQueryAndHash(this.plugin.app.vault.getResourcePath(file));
      if (
        source === resourcePath ||
        source.includes(encodeURI(file.path)) ||
        source.includes(file.path)
      ) {
        return file;
      }
    }

    return null;
  }
}

function stripQueryAndHash(value: string): string {
  return value.split("#", 1)[0].split("?", 1)[0];
}
