import type { App } from "obsidian";
import type { InklineSettings } from "../settings/inklineSettings";
import { applyDisplayVariables } from "./applyDisplayVariables";
import { getAllDocuments } from "./getAllDocuments";

/**
 * Publish the display height and inline vertical-align as inherited
 * variables on the document root of every open window.
 *
 * @remarks
 * This keeps every ink image aligned even when the per-image
 * post-processor has not run yet (lazily loaded embeds, re-renders).
 * Popouts opened later are covered by the `window-open` handler in
 * `createRenderEnhancer`.
 *
 * @param app - The Obsidian app whose windows are updated.
 * @param settings - The settings the variables are derived from.
 */
export function applyRootVariables(app: App, settings: InklineSettings): void {
  for (const doc of getAllDocuments(app)) {
    applyDisplayVariables(doc.body, settings);
  }
}
