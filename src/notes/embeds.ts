// The embed that shows a symbol in a note: the link Obsidian makes for it, as
// names.ts adapts it, checked to lead back to it.

import { getLinkpath, type App, type TFile } from "obsidian";
import {
  embedFromLink,
  encodePath,
  markdownDestination,
  readDestination,
} from "./names.ts";

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
  const written = markdownDestination(embed);
  if (written === undefined) return embed;
  const path = readDestination(written);
  const target =
    path === undefined
      ? null
      : app.metadataCache.getFirstLinkpathDest(getLinkpath(path), notePath);
  return target === file ? embed : `![](${encodePath(file.path)})`;
}
