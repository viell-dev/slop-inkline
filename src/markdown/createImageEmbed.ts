/**
 * Turn a Markdown or wiki link into a bare image embed.
 *
 * @remarks
 * Ensures the leading `!`, strips Markdown alt text, and strips wiki
 * aliases. Links in neither form are returned as-is (with the `!` added).
 *
 * @param markdownLink - The link, as produced by Obsidian's link
 *   generation.
 * @returns The embed markup to insert into the note.
 */
export function createImageEmbed(markdownLink: string): string {
  const embed = markdownLink.startsWith("!") ? markdownLink : `!${markdownLink}`;
  const markdownImage = /^!\[[^\]]*\]\((.*)\)$/.exec(embed);
  if (markdownImage) {
    return `![](${markdownImage[1]})`;
  }

  const wikiImage = /^!\[\[([^|\]]+)\|[^\]]*\]\]$/.exec(embed);
  if (wikiImage) {
    return `![[${wikiImage[1]}]]`;
  }

  return embed;
}
