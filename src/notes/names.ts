// Names for new symbols and the embeds that show them.

import { inkExtension } from "../format/ink-file.ts";

/** Digits in a number name, so that names sort in order: 001, 002, … */
const numberWidth = 3;

/** A symbol file's name without its folder or the `.ink.png` ending. */
export function symbolStem(fileName: string): string | undefined {
  return fileName.toLowerCase().endsWith(inkExtension)
    ? fileName.slice(0, -inkExtension.length)
    : undefined;
}

/**
 * The lowest number name not taken among the symbol names in a folder:
 * `001`, then `002`, and so on, filling gaps.
 */
export function nextNumberName(taken: readonly string[]): string {
  const numbers = new Set(
    taken.filter((name) => /^\d+$/.test(name)).map((name) => Number(name)),
  );
  let next = 1;
  while (numbers.has(next)) next++;
  return String(next).padStart(numberWidth, "0");
}

/**
 * An image embed from the link Obsidian generates for a file: the `!` added,
 * and any Markdown alt text or wiki alias removed, since Obsidian reads a
 * number there, such as a symbol named `001`, as a width.
 */
export function embedFromLink(link: string): string {
  const embed = link.startsWith("!") ? link : `!${link}`;
  const markdown = /^!\[[^\]]*\](\(.*\))$/.exec(embed);
  if (markdown !== null) return `![]${markdown[1] ?? "()"}`;
  const wiki = /^!\[\[([^|\]]+)\|[^\]]*\]\]$/.exec(embed);
  if (wiki !== null) return `![[${wiki[1] ?? ""}]]`;
  return embed;
}
