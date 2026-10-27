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
 * The characters a symbol's name cannot hold: those Obsidian refuses in a
 * file name on Windows, a superset of those it refuses elsewhere, so that a
 * vault stays usable on every system; and those that would break a link to
 * the file. Control characters go too.
 */
const forbidden = '*"\\/<>:|?#^[]';

/**
 * Names Windows keeps for devices, which no file there can have, alone or
 * before a dot, as Windows reads `CON.txt` as `CON`.
 */
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** The no-break spaces Obsidian turns into plain ones in a file's name. */
const noBreakSpaces = new Set([0xa0, 0x202f]);

/**
 * Invisible spaces, operators, and annotation marks, and the controls that
 * reorder text, which would make a name look empty, the same as another,
 * or other than it is. Other format characters stay, as the joiners and
 * direction marks that scripts and emoji need for a name to be spelled and
 * shown as it is.
 */
const invisible =
  /[\u200b\u2060-\u2064\ufeff\ufff9-\ufffb\u202a-\u202e\u2066-\u2069]/u;

/**
 * Whether `char` can be in a name: not a control character, an invisible
 * one, or one a file name cannot hold.
 */
function allowed(char: string): boolean {
  return (
    !/\p{Cc}/u.test(char) && !invisible.test(char) && !forbidden.includes(char)
  );
}

/** The most bytes most file systems allow in a file's name. */
const maxNameBytes = 255;

/** What a name typed for a symbol makes it: a number, a name, or neither. */
export type NameChoice =
  | { readonly kind: "number" }
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * What `typed`, a name typed for a symbol, makes its name: the text as
 * Obsidian stores a file's name, its characters composed and its no-break
 * spaces plain, without the characters a name cannot hold, and without
 * space around it or dots before it, which would hide the file, or after
 * it, which Windows drops. An empty name, or one of format characters
 * alone, takes the next number in its folder. A name Windows keeps for a
 * device, or one too long for a file name, is refused, with the reason.
 */
export function chooseName(typed: string): NameChoice {
  const kept = Array.from(typed.normalize("NFC"))
    .map((char) => (noBreakSpaces.has(char.codePointAt(0) ?? 0) ? " " : char))
    .filter(allowed)
    .join("");
  const name = kept
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .trim();
  if (name.replace(/\p{Cf}/gu, "").trim() === "") return { kind: "number" };
  if (reserved.test(name)) {
    return {
      kind: "refused",
      reason: `${name} is a name Windows keeps for itself`,
    };
  }
  const bytes = new TextEncoder().encode(`${name}${inkExtension}`).length;
  if (bytes > maxNameBytes) {
    return { kind: "refused", reason: `the name is too long for a file` };
  }
  return { kind: "name", name };
}

/**
 * The folder in the vault that `typed` names for new symbols: its folders'
 * names joined by `/`, with no slashes around them, or `""` to keep
 * Obsidian's place for attachments; or why it cannot be one. Each folder's
 * name follows the rules of a symbol's name, but a name that breaks them is
 * refused rather than changed, as a setting is shown again as it was typed.
 */
export function chooseFolder(
  typed: string,
): { readonly folder: string } | { readonly reason: string } {
  const text = Array.from(typed.normalize("NFC"))
    .map((char) => (noBreakSpaces.has(char.codePointAt(0) ?? 0) ? " " : char))
    .join("")
    .trim();
  if (text.includes("\\")) return { reason: "Use / between folders." };
  const parts = text.split("/").filter((part) => part !== "");
  for (const part of parts) {
    if (part === "." || part === "..") {
      return { reason: "A folder cannot be . or .., which leave the vault." };
    }
    if (part.startsWith(".")) {
      return {
        reason: `${part} starts with a dot, which hides it from Obsidian.`,
      };
    }
    if (part !== part.trim() || part.endsWith(".")) {
      return {
        reason: `${part} starts or ends with a space, or ends with a dot, which Windows drops.`,
      };
    }
    const refused = Array.from(part).find((char) => !allowed(char));
    if (refused !== undefined) {
      return {
        reason: forbidden.includes(refused)
          ? `A folder's name cannot hold ${refused}.`
          : "A folder's name cannot hold an invisible or control character.",
      };
    }
    if (reserved.test(part)) {
      return { reason: `${part} is a name Windows keeps for itself.` };
    }
    if (new TextEncoder().encode(part).length > maxNameBytes) {
      return { reason: `${part} is too long for a folder's name.` };
    }
  }
  return { folder: parts.join("/") };
}

/**
 * What `typed` makes the name of a symbol named `current`, `""` for one with
 * no file yet: as `chooseName` says, except that its own name, typed again,
 * keeps it, spaces around either aside. A file can come by a name that
 * `chooseName` would change or refuse, as one renamed elsewhere to `a#1`, or
 * to `con` on Linux; saving it leaves that name alone.
 */
export function chooseRename(typed: string, current: string): NameChoice {
  const own = current.normalize("NFC").trim();
  if (own !== "" && typed.normalize("NFC").trim() === own) {
    // As the file has it, composed or not, so that nothing renames it.
    return { kind: "name", name: current };
  }
  return chooseName(typed);
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
