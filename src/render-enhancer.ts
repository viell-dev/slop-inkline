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

    for (const imageEl of Array.from(activeDocument.querySelectorAll<HTMLImageElement>("img.inkline-image"))) {
      if (imageEl.dataset.inklinePath === file.path) {
        imageEl.src = `${resourcePath}?inkline=${Date.now()}`;
      }
    }
  }

  private enhance(el: HTMLElement): void {
    for (const imageEl of Array.from(el.querySelectorAll<HTMLImageElement>("img"))) {
      const file = this.resolveImageFile(imageEl);
      if (!file) {
        continue;
      }

      imageEl.addClass("inkline-image");
      imageEl.dataset.inklinePath = file.path;
      imageEl.style.height = this.getSettings().displayHeight;
      imageEl.toggleClass("inkline-no-invert", !this.getSettings().darkModeInvert);
    }
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const imageEl = target.closest("img");
    if (!(imageEl instanceof HTMLImageElement)) {
      return;
    }

    const file = this.resolveImageFile(imageEl);
    if (!file) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.openEditor(file);
  }

  private resolveImageFile(imageEl: HTMLImageElement): TFile | null {
    const dataPath = imageEl.dataset.inklinePath;
    if (dataPath) {
      const file = this.plugin.app.vault.getFileByPath(dataPath);
      if (file && this.fileService.isInkFile(file)) {
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
