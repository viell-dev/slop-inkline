import { Plugin, TFile } from "obsidian";
import { InkFileService } from "./ink-file";
import { InklineSettings } from "./settings";

export class RenderEnhancer {
  constructor(
    private readonly plugin: Plugin,
    private readonly fileService: InkFileService,
    private readonly getSettings: () => InklineSettings,
    private readonly openEditor: (file: TFile) => void,
  ) {}

  register(): void {
    this.plugin.registerMarkdownPostProcessor((el, _ctx) => {
      this.enhance(el);
    });

    this.plugin.registerDomEvent(activeDocument, "click", (event) => {
      this.handleClick(event);
    });
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
    imageEl.addClass("inkline-image");
    imageEl.dataset.inklinePath = file.path;
    imageEl.toggleClass("inkline-no-invert", !this.getSettings().darkModeInvert);
    imageEl.style.setProperty("--inkline-display-height", this.getSettings().displayHeight);

    const embedEl = imageEl.closest<HTMLElement>(".image-embed, .internal-embed");
    if (embedEl) {
      embedEl.addClass("inkline-embed");
      embedEl.dataset.inklinePath = file.path;
      embedEl.style.setProperty("--inkline-display-height", this.getSettings().displayHeight);
    }
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
