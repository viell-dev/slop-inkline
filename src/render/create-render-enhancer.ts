import { Option } from "effect";
import type { Plugin, TFile } from "obsidian";
import type { InklineSettings } from "../settings/inkline-settings";
import { applyDisplayVariables } from "./apply-display-variables";
import { applyInkStyles } from "./apply-ink-styles";
import { applyRootVariables } from "./apply-root-variables";
import { createInkResourceCache } from "./ink-resource-cache";
import { findSelectedInkFile } from "./find-selected-ink-file";
import { refreshInkFile } from "./refresh-ink-file";
import type { RenderEnhancer } from "./render-enhancer";
import { resolveImageFile } from "./resolve-image-file";

export interface RenderEnhancerDeps {
  plugin: Plugin;
  getSettings: () => InklineSettings;
  openEditor: (file: TFile) => void;
}

/**
 * Wire the markdown post-processor, vault cache invalidation, and window
 * variable publication, and return the enhancer surface the plugin uses.
 */
export function createRenderEnhancer(deps: RenderEnhancerDeps): RenderEnhancer {
  const { plugin, getSettings, openEditor } = deps;
  const app = plugin.app;
  const cache = createInkResourceCache(app);

  const enhance = (el: HTMLElement): void => {
    for (const imageEl of Array.from(el.querySelectorAll<HTMLImageElement>("img"))) {
      const file = Option.getOrNull(resolveImageFile(app, cache, imageEl));
      if (file) {
        applyInkStyles(imageEl, file, getSettings());
      }
    }
  };

  applyRootVariables(app, getSettings());

  plugin.registerMarkdownPostProcessor((el) => {
    enhance(el);
  });

  const { vault, workspace } = app;
  plugin.registerEvent(vault.on("create", () => cache.invalidate()));
  plugin.registerEvent(vault.on("delete", () => cache.invalidate()));
  plugin.registerEvent(vault.on("rename", () => cache.invalidate()));

  plugin.registerEvent(
    workspace.on("window-open", (win) => {
      applyDisplayVariables(win.doc.body, getSettings());
    }),
  );

  return {
    applyRootVariables() {
      applyRootVariables(app, getSettings());
    },
    refreshFile(file) {
      refreshInkFile(app, cache, getSettings(), file);
    },
    openSelectedInkImage() {
      return Option.match(findSelectedInkFile(app, cache), {
        onNone: () => false,
        onSome: (file) => {
          openEditor(file);
          return true;
        },
      });
    },
  };
}
