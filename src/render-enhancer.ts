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
  /**
   * Lazily built map from an ink file's resource path (query and hash
   * stripped, since `getResourcePath` appends cache-busting params) to its
   * `TFile`. Lets `resolveImageFile` avoid an O(vault size) scan per image.
   * Invalidated wholesale on any vault create/delete/rename.
   */
  private inkResourcePathCache: Map<string, TFile> | null = null;

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

    const { vault, workspace } = this.plugin.app;
    this.plugin.registerEvent(vault.on("create", () => this.invalidateInkResourcePathCache()));
    this.plugin.registerEvent(vault.on("delete", () => this.invalidateInkResourcePathCache()));
    this.plugin.registerEvent(vault.on("rename", () => this.invalidateInkResourcePathCache()));

    this.plugin.registerEvent(
      workspace.on("window-open", (win) => {
        this.applyVariablesToDocument(win.doc);
      }),
    );
  }

  /**
   * Publish the display height and inline vertical-align as inherited variables
   * on the document root of every open window. The size and vertical-align CSS
   * is keyed on the `.ink.png` src, so this keeps every ink image aligned even
   * when the per-image post-processor has not run yet (lazily loaded embeds,
   * re-renders). Popouts opened later are covered by the `window-open` handler
   * in `register`.
   */
  applyRootVariables(): void {
    for (const doc of this.getAllDocuments()) {
      this.applyVariablesToDocument(doc);
    }
  }

  private applyVariablesToDocument(doc: Document): void {
    const displayHeight = this.getSettings().displayHeight;
    const valign = `${computeInkLineLayout(parseDisplayHeightEm(displayHeight)).verticalAlignEm}em`;

    doc.body.style.setProperty("--inkline-display-height", displayHeight);
    doc.body.style.setProperty("--inkline-valign", valign);
  }

  private getAllDocuments(): Set<Document> {
    const documents = new Set<Document>([document]);
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      documents.add(leaf.view.containerEl.ownerDocument);
    });

    return documents;
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
    const cache = this.getInkResourcePathCache();

    const exactMatch = cache.get(source);
    if (exactMatch) {
      return exactMatch;
    }

    for (const file of cache.values()) {
      if (source.includes(encodeURI(file.path)) || source.includes(file.path)) {
        return file;
      }
    }

    return null;
  }

  private getInkResourcePathCache(): Map<string, TFile> {
    if (!this.inkResourcePathCache) {
      const cache = new Map<string, TFile>();
      for (const file of this.plugin.app.vault.getFiles()) {
        if (this.fileService.isInkFile(file)) {
          cache.set(stripQueryAndHash(this.plugin.app.vault.getResourcePath(file)), file);
        }
      }

      this.inkResourcePathCache = cache;
    }

    return this.inkResourcePathCache;
  }

  private invalidateInkResourcePathCache(): void {
    this.inkResourcePathCache = null;
  }
}

function stripQueryAndHash(value: string): string {
  return value.split("#", 1)[0].split("?", 1)[0];
}
