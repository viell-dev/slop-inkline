// The embed that shows a symbol in a note: the link Obsidian makes for it, as
// names.ts adapts it, checked to lead back to it.

import { getLinkpath, type App, type TFile } from "obsidian";
import {
  decodeDestination,
  embedFromLink,
  encodePath,
  markdownDestination,
} from "./names.ts";

/**
 * The embed that shows `file` in the note at `notePath`, in the link format
 * Obsidian is set to use. A Markdown link that Obsidian would read as another
 * file, as it can when the file's path holds a `%` (#35), names the file by
 * its vault path instead.
 */
export function embedFor(app: App, file: TFile, notePath: string): string {
  const embed = embedFromLink(
    app.fileManager.generateMarkdownLink(file, notePath),
  );
  const destination = markdownDestination(embed);
  if (destination === undefined) return embed;
  const target = app.metadataCache.getFirstLinkpathDest(
    getLinkpath(decodeDestination(destination)),
    notePath,
  );
  return target === file ? embed : `![](${encodePath(file.path)})`;
}
