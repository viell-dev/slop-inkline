/**
 * Turn a Markdown or wiki link into a bare image embed: ensure the leading
 * `!`, strip Markdown alt text, and strip wiki aliases.
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
