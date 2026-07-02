import type { App } from "obsidian";
import type { InklineSettings } from "../settings/inklineSettings";
import { applyDisplayVariables } from "./applyDisplayVariables";

/**
 * Publish the display height and inline vertical-align as inherited
 * variables on the document root of every open window. This keeps every ink
 * image aligned even when the per-image post-processor has not run yet
 * (lazily loaded embeds, re-renders). Popouts opened later are covered by
 * the `window-open` handler in createRenderEnhancer.
 */
export function applyRootVariables(app: App, settings: InklineSettings): void {
  for (const doc of getAllDocuments(app)) {
    applyDisplayVariables(doc.body, settings);
  }
}

function getAllDocuments(app: App): Set<Document> {
  const documents = new Set<Document>([document]);
  app.workspace.iterateAllLeaves((leaf) => {
    documents.add(leaf.view.containerEl.ownerDocument);
  });

  return documents;
}
