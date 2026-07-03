import { findImageTokensOnLine } from "./findImageTokensOnLine";

/** A line span that inserted text must not land strictly inside. */
export interface AtomicRange {
  /** Character offset of the range's start on the line (inclusive). */
  from: number;
  /** Character offset of the range's end on the line (exclusive). */
  to: number;
}

/**
 * Collect every span on a line that an insertion may not split: image
 * embeds of both styles, wiki links, and Markdown links.
 *
 * @remarks
 * Markdown link bodies are atomic too: Obsidian does not render a wiki
 * embed inside a link body, so there is no valid insertion inside a link
 * (an HTML anchor is the escape hatch for linked inks). Link bodies that
 * already contain brackets escape the whole-link scanner; their
 * `](target)` tails are still protected separately. Bare URLs in plain
 * text are not detected.
 *
 * @param line - The line text to scan.
 * @returns The ranges in scanner order; ranges may overlap.
 */
export function findAtomicRangesOnLine(line: string): AtomicRange[] {
  return [
    ...findImageTokensOnLine(line).map(
      (token): AtomicRange => ({ from: token.from, to: token.to }),
    ),
    ...findWikiLinkRanges(line),
    ...findMarkdownLinkRanges(line),
    ...findMarkdownLinkTailRanges(line),
  ];
}

/**
 * Collect every non-embed wiki link (`[[page]]`) on a line.
 *
 * @remarks
 * Embeds (`![[...]]`) are skipped; they are already covered as image
 * tokens.
 *
 * @param line - The line text to scan.
 * @returns The full-link ranges in source order.
 */
function findWikiLinkRanges(line: string): AtomicRange[] {
  const ranges: AtomicRange[] = [];
  const pattern = /\[\[[^\]]+\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (line[match.index - 1] !== "!") {
      ranges.push({ from: match.index, to: match.index + match[0].length });
    }
  }

  return ranges;
}

/**
 * Collect every whole Markdown link (`[body](target)`) on a line.
 *
 * @remarks
 * Images (`![...](...)`) are skipped; they are already covered as image
 * tokens. Bodies containing `]` (e.g. a nested image) do not match; the
 * link's tail is still caught by the tail scanner.
 *
 * @param line - The line text to scan.
 * @returns The full-link ranges in source order.
 */
function findMarkdownLinkRanges(line: string): AtomicRange[] {
  const ranges: AtomicRange[] = [];
  const pattern = /\[[^\]]*\]\((<[^>]+>|[^)]*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (line[match.index - 1] !== "!") {
      ranges.push({ from: match.index, to: match.index + match[0].length });
    }
  }

  return ranges;
}

/**
 * Collect every `](target)` tail of a Markdown link or image on a line.
 *
 * @param line - The line text to scan.
 * @returns The tail ranges in source order, each spanning the closing
 *   bracket through the closing parenthesis.
 */
function findMarkdownLinkTailRanges(line: string): AtomicRange[] {
  const ranges: AtomicRange[] = [];
  const pattern = /\]\((<[^>]+>|[^)]*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }

  return ranges;
}
