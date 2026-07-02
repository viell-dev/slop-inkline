import { Option } from "effect";
import type { Plugin, TFile } from "obsidian";
import type { InklineSettings } from "../settings/inklineSettings";
import { applyDisplayVariables } from "./applyDisplayVariables";
import { applyInkStyles } from "./applyInkStyles";
import { applyRootVariables } from "./applyRootVariables";
import { createInkResourceCache } from "./inkResourceCache";
import { findSelectedInkFile } from "./findSelectedInkFile";
import { refreshInkFile } from "./refreshInkFile";
import type { RenderEnhancer } from "./renderEnhancer";
import { resolveImageFile } from "./resolveImageFile";

/** Dependencies of {@link createRenderEnhancer}. */
export interface RenderEnhancerDeps {
  /** The plugin, used to register events and the post-processor. */
  plugin: Plugin;
  /** Read the current settings; called on every enhancement pass. */
  getSettings: () => InklineSettings;
  /**
   * Open the ink editor for a resolved ink file.
   *
   * @param file - The `.ink.png` vault file to edit.
   */
  openEditor: (file: TFile) => void;
}

/**
 * Wire the markdown post-processor, vault cache invalidation, and window
 * variable publication, and return the enhancer surface the plugin uses.
 *
 * @remarks
 * Registration goes through the plugin, so everything wired here is
 * unloaded with it. The post-processor styles every rendered ink image;
 * vault create/delete/rename events invalidate the resource cache; and
 * newly opened popout windows receive the display variables.
 *
 * @param deps - The enhancer's dependencies.
 * @returns The enhancer surface.
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
