import type { App } from "obsidian";

/**
 * Collect the documents of the main window and every popout that hosts a
 * workspace leaf.
 *
 * @param app - The Obsidian app whose leaves are iterated.
 * @returns The deduplicated set of documents.
 */
export function getAllDocuments(app: App): Set<Document> {
  const documents = new Set<Document>([document]);
  app.workspace.iterateAllLeaves((leaf) => {
    documents.add(leaf.view.containerEl.ownerDocument);
  });

  return documents;
}
