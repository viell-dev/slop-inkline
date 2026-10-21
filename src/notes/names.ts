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
  if (markdown !== null) {
    // Obsidian leaves a % bare in a Markdown link's destination, which it
    // then reads as the start of an escape (#35); one that starts none is
    // the character itself.
    const destination = (markdown[1] ?? "()").replace(
      /%(?![0-9A-Fa-f]{2})/g,
      "%25",
    );
    return `![]${destination}`;
  }
  const wiki = /^!\[\[([^|\]]+)\|[^\]]*\]\]$/.exec(embed);
  if (wiki !== null) return `![[${wiki[1] ?? ""}]]`;
  return embed;
}

/**
 * What a Markdown image embed, `![](…)`, holds between its parentheses, as
 * written; undefined for any other embed.
 */
export function markdownDestination(embed: string): string | undefined {
  const markdown = /^!\[[^\]]*\]\((.*)\)$/.exec(embed);
  return markdown === null ? undefined : (markdown[1] ?? "");
}

/**
 * A Markdown link's destination as Obsidian reads it: its percent escapes
 * decoded as `decodeURI` decodes them, which leaves those of characters such
 * as `&` and `#` as written, or all of it as written when they do not
 * decode.
 */
export function decodeDestination(destination: string): string {
  try {
    return decodeURI(destination);
  } catch {
    return destination;
  }
}

/**
 * The path that `written`, what a Markdown embed holds between its
 * parentheses, leads to as Markdown reads it: its angle brackets removed, or
 * its own parentheses balanced, and decoded. Undefined when Markdown would
 * end the destination before the end, as at a `)` that opens nothing, or
 * read none, as with a space in it.
 */
export function readDestination(written: string): string | undefined {
  const angled = /^<([^<>\n]*)>$/.exec(written);
  if (angled !== null) return decodeDestination(angled[1] ?? "");
  // A control character or a space ends a destination outside brackets.
  // eslint-disable-next-line no-control-regex -- control characters are what it finds
  if (written.startsWith("<") || /[\u0000-\u0020\u007f]/.test(written)) {
    return undefined;
  }
  let depth = 0;
  for (const char of written) {
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
      if (depth < 0) return undefined;
    }
  }
  return depth === 0 ? decodeDestination(written) : undefined;
}

/**
 * A vault path as a Markdown link's destination that reads back as the
 * path: each folder's and the file's name encoded as `encodeURI` encodes
 * them, `%` included, and parentheses too, so that none can end the
 * destination.
 */
export function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) =>
      encodeURI(part).replace(
        /[()]/g,
        (bracket) => `%${bracket.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}
