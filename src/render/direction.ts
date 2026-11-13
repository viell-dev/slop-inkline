// PROTOTYPE for #167, section 6, not for release: runs of symbols right to
// left, whatever the direction of the text around them.
//
// A run is one or more symbol embeds in a line with nothing but spaces or
// zero-width spaces between them. While the main window's root has the class
// `inkline-proto-runs`, each run is shown as a right-to-left isolate: in Live
// Preview by a CodeMirror mark that CodeMirror also treats as an isolate when
// it moves the cursor, and in Reading view by a `<span dir="rtl">` around the
// run's embeds, made as the note renders. The note's text does not change.
// A release would decide which runs are right to left from where their
// symbols are, as a folder, rather than from a switch.

import { type Extension, Prec, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  Direction,
  EditorView,
} from "@codemirror/view";

/** The prototype's switch, on the root of the main window. */
export const runsClass = "inkline-proto-runs";

/** The class of what holds a run, in either view. */
export const runClass = "inkline-rtl-run";

/** A symbol's embed in a note's text, as a wiki link or a Markdown image. */
const embed =
  /!\[\[[^\]\n]*?\.ink\.png(?:[|#][^\]\n]*)?\]\]|!\[[^\]\n]*\]\([^)\n]*?\.ink\.png[^)\n]*\)/giu;

/** What may stand between two symbols of one run. */
const gap = /^[ \t​]*$/u;

/** The runs of symbols in `text`, by offsets into it. */
export function symbolRuns(text: string): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  let current: { from: number; to: number } | undefined;
  for (const match of text.matchAll(embed)) {
    const from = match.index;
    const to = from + match[0].length;
    if (current !== undefined && gap.test(text.slice(current.to, from))) {
      current.to = to;
    } else {
      current = { from, to };
      runs.push(current);
    }
  }
  return runs;
}

const runMark = Decoration.mark({
  bidiIsolate: Direction.RTL,
  attributes: { dir: "rtl" },
  class: runClass,
});

/** The runs in the lines `view` shows, while the switch is on. */
function runsOf(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const on =
    view.dom.ownerDocument.documentElement.classList.contains(runsClass);
  if (!on) return builder.finish();
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    let at = from;
    while (at <= to) {
      const line = view.state.doc.lineAt(at);
      if (line.number > last) {
        for (const run of symbolRuns(line.text)) {
          builder.add(line.from + run.from, line.from + run.to, runMark);
        }
        last = line.number;
      }
      at = line.to + 1;
    }
  }
  return builder.finish();
}

/**
 * The second switch: each symbol's embed is an isolate in CodeMirror's own
 * model of the line's order, as its picture is a neutral object to the
 * browser, while CodeMirror otherwise orders the embed's hidden text, whose
 * file name is left to right. The page is not changed.
 */
export const neutralClass = "inkline-proto-neutral";

const embedIsolate = Decoration.mark({ bidiIsolate: Direction.LTR });

/** Each symbol embed in the lines `view` shows, while the switch is on. */
function embedsOf(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const on =
    view.dom.ownerDocument.documentElement.classList.contains(neutralClass);
  if (!on) return builder.finish();
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    let at = from;
    while (at <= to) {
      const line = view.state.doc.lineAt(at);
      if (line.number > last) {
        for (const match of line.text.matchAll(embed)) {
          builder.add(
            line.from + match.index,
            line.from + match.index + match[0].length,
            embedIsolate,
          );
        }
        last = line.number;
      }
      at = line.to + 1;
    }
  }
  return builder.finish();
}

/** Live Preview's and Source mode's part of the prototype. */
export const runsExtension: Extension = [
  Prec.high(EditorView.decorations.of(runsOf)),
  EditorView.bidiIsolatedRanges.of(runsOf),
  EditorView.bidiIsolatedRanges.of(embedsOf),
];

/** Whether `node` is a symbol's embed in rendered text. */
function isSymbolNode(node: Node): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  const source = node.getAttribute("src") ?? "";
  if (!/\.ink\.png/iu.test(source)) return false;
  return node.matches("span.internal-embed, img");
}

/** Whether `node` may stand between two symbols of one run. */
function isGap(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && gap.test(node.textContent ?? "");
}

/**
 * Reading view's part of the prototype: wraps each run of symbols that
 * `element` renders in a right-to-left span, while the switch is on.
 */
export function wrapRuns(element: HTMLElement): void {
  if (!element.doc.documentElement.classList.contains(runsClass)) return;
  const parents = [element, ...Array.from(element.querySelectorAll("*"))];
  for (const parent of parents) {
    if (parent.closest(`.${runClass}`) !== null) continue;
    const children = Array.from(parent.childNodes);
    let index = 0;
    while (index < children.length) {
      const first = children[index];
      if (first === undefined || !isSymbolNode(first)) {
        index++;
        continue;
      }
      // The run: symbols, with gaps only between two of them.
      let end = index;
      let next = index + 1;
      while (next < children.length) {
        let probe = next;
        while (probe < children.length) {
          const node = children[probe];
          if (node === undefined || !isGap(node)) break;
          probe++;
        }
        const candidate = children[probe];
        if (candidate === undefined || !isSymbolNode(candidate)) break;
        end = probe;
        next = probe + 1;
      }
      const span = element.doc.createElement("span");
      span.setAttribute("dir", "rtl");
      span.className = runClass;
      parent.insertBefore(span, first);
      for (const node of children.slice(index, end + 1)) span.append(node);
      index = end + 1;
    }
  }
}
