// The embed that shows a symbol in a note: the link Obsidian makes for it, as
// names.ts adapts it, checked to lead back to it.

import type { App, TFile } from "obsidian";
import { embedPath } from "./links.ts";
import { embedFromLink, encodePath } from "./names.ts";

/**
 * The embed that shows `file` in the note at `notePath`, in the link format
 * Obsidian is set to use. A Markdown link that Obsidian would read as another
 * file, as it can when the file's path holds a `%` (#35), or that Markdown
 * would end early, as at a `)` in a name, names the file by its vault path
 * instead.
 */
export function embedFor(app: App, file: TFile, notePath: string): string {
  const embed = embedFromLink(
    app.fileManager.generateMarkdownLink(file, notePath),
  );
  // Only a Markdown link can lead elsewhere: a wiki link takes no escapes.
  if (!embed.startsWith("![](")) return embed;
  // Read as the links of a note are read, as Obsidian reads them.
  const path = embedPath(embed);
  const target =
    path === undefined
      ? null
      : app.metadataCache.getFirstLinkpathDest(path, notePath);
  return target === file ? embed : `![](${encodePath(file.path)})`;
}
