import type { App } from "obsidian";
import type { InklineSettings } from "../settings/inklineSettings";
import { applyDisplayVariables } from "./applyDisplayVariables";

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

/**
 * Collect the documents of the main window and every popout that hosts a
 * workspace leaf.
 *
 * @param app - The Obsidian app whose leaves are iterated.
 * @returns The deduplicated set of documents.
 */
function getAllDocuments(app: App): Set<Document> {
  const documents = new Set<Document>([document]);
  app.workspace.iterateAllLeaves((leaf) => {
    documents.add(leaf.view.containerEl.ownerDocument);
  });

  return documents;
}
