// Exploration for #167 §6, not part of the suite: right-to-left text and
// symbols. It shows synthetic digit symbols (d0 to d9, a seven-segment digit
// each, and one named in Hebrew) in lines of Hebrew, English and neither, and
// records how Obsidian orders them: Reading view, Live Preview, Source mode,
// PDF export, without Inkline, with Obsidian's right-to-left setting, with
// cssclasses, and with two prototypes (each symbol as a strong right-to-left
// character, and runs of symbols as right-to-left isolates). It also walks the
// cursor through such lines with the arrow keys, types `;;` and uses Next in
// a right-to-left line, wraps long runs, copies them, and opens Inkline's lists
// in a right-to-left interface.
//
// It writes rtl/<version>.json in the output directory and screenshots for a
// person to look at. It asserts almost nothing: it measures.

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { blank, encodePng, type Pixels } from "../../support/png.ts";
import { loadModules, toBase64 } from "../support/browser.ts";
import {
  draw,
  markEditor,
  openAtMarker,
  startOver,
  waitForEditor,
  waitForNext,
} from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);

const RLM = "‏";
const ALM = "؜";
const RLI = "⁧";
const PDI = "⁩";
const RLO = "‮";
const PDF = "‬";
const ZWSP = "​";
/** "Shalom" and "olam", two Hebrew words. */
const he1 = "שלום";
const he2 = "עולם";
/** The Hebrew letter shin, as a symbol's name. */
const shin = "ש";
/** "Marhaban" and "alam", two Arabic words. */
const ar1 = "مرحبا";
const ar2 = "عالم";

/** Fills a rectangle of `pixels` with ink, from (x0, y0) to just before (x1, y1). */
function fill(
  pixels: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      pixels.data.set([126, 126, 126, 255], (y * pixels.width + x) * 4);
    }
  }
}

/** A seven-segment digit's segments, in a 96 × 192 image, baseline at 144. */
const segments: Record<string, [number, number, number, number]> = {
  a: [20, 40, 76, 52],
  b: [64, 40, 76, 96],
  c: [64, 88, 76, 144],
  d: [20, 132, 76, 144],
  e: [20, 88, 32, 144],
  f: [20, 40, 32, 96],
  g: [20, 86, 76, 98],
};
const digitSegments = [
  "abcdef",
  "bc",
  "abged",
  "abgcd",
  "fgbc",
  "afgcd",
  "afgedc",
  "abc",
  "abcdefg",
  "abcdfg",
];

function digitPng(digit: number): Uint8Array {
  const pixels = blank(96, 192);
  for (const name of digitSegments[digit] ?? "") {
    const box = segments[name];
    if (box !== undefined) fill(pixels, ...box);
  }
  return encodePng(pixels);
}

/** A wiki embed of digit symbol `n`. */
const e = (n: number) => `![[d${String(n)}.ink.png]]`;
const run = (ns: readonly number[]) => ns.map(e).join("");

interface Case {
  id: string;
  text: string;
}

/** One paragraph each, in this order; the comments say what each tries. */
const lineCases: Case[] = [
  // Nothing strong at all: Obsidian's default and dir="auto" decide.
  { id: "inks-only", text: run([1, 2, 3]) },
  { id: "inks-spaced", text: [1, 2, 3].map(e).join(" ") },
  { id: "he-around", text: `${he1} ${run([1, 2, 3])} ${he2}` },
  // The editor takes a line with nothing strong from the line before.
  { id: "inks-only-after-he", text: run([1, 2, 3]) },
  { id: "en-around", text: `Hello ${run([1, 2, 3])} world` },
  { id: "inks-then-he", text: `${run([1, 2, 3])} ${he1}` },
  { id: "he-inks-en", text: `${he1} ${run([1, 2, 3])} world` },
  { id: "en-inks-he", text: `Hello ${run([1, 2, 3])} ${he1}` },
  { id: "rlm-first", text: `${RLM}${run([1, 2, 3])}` },
  { id: "alm-first", text: `${ALM}${run([1, 2, 3])}` },
  { id: "rli-in-en", text: `Hello ${RLI}${run([1, 2, 3])}${PDI} world` },
  { id: "rlo-in-en", text: `Hello ${RLO}${run([1, 2, 3])}${PDF} world` },
  {
    id: "rlm-each-in-en",
    text: `Hello ${[1, 2, 3].map((n) => e(n) + RLM).join("")} world`,
  },
  {
    id: "span-dir-in-en",
    text: `Hello <span dir="rtl">${run([1, 2, 3])}</span> world`,
  },
  {
    id: "bdo-in-en",
    text: `Hello <bdo dir="rtl">${run([1, 2, 3])}</bdo> world`,
  },
  {
    id: "span-img-in-en",
    text: `Hello <span dir="rtl">${[1, 2, 3].map((n) => `<img src="Symbols/d${String(n)}.ink.png">`).join("")}</span> world`,
  },
  { id: "hebrew-name-first", text: `![[${shin}.ink.png]]${run([1, 2])}` },
  {
    id: "md-links-only",
    text: [1, 2, 3].map((n) => `![](Symbols/d${String(n)}.ink.png)`).join(""),
  },
  { id: "reversed-workaround", text: run([3, 2, 1]) },
  { id: "soft-break", text: `${he1} ${run([1, 2])}\n${run([3, 4])} Hello` },
  { id: "zwsp-split", text: `${RLM}${run([1, 2])}${ZWSP}${run([3, 4])}` },
  { id: "ar-around", text: `${ar1} ${run([1, 2, 3])} ${ar2}` },
];

const linesNote = [
  ...lineCases.map((c) => c.text),
  `<div dir="rtl">`,
  "",
  run([5, 6, 7]),
  "",
  "</div>",
  "",
].join("\n\n");

const classedNote = [
  "---",
  "cssclasses:",
  "  - inkline-rtl",
  "---",
  "",
  run([1, 2, 3]),
  "",
  `Hello ${run([1, 2, 3])} world.`,
  "",
  `${he1} ${run([1, 2, 3])} ${he2}`,
  "",
  `${run([1, 2, 3])} ${he1}`,
  "",
].join("\n");

/** Digit labels for a run of `count` symbols, the first being 1. */
const sequence = (count: number) =>
  Array.from({ length: count }, (_, index) => (index + 1) % 10);

const wrapCount = 50;
const wrapNote = [
  // True right-to-left: in reading order, and a mark makes it right to left.
  `${RLM}${run(sequence(wrapCount))}`,
  "",
  // The owner's workaround: the same symbols entered last first.
  run(sequence(wrapCount).reverse()),
  "",
].join("\n");

const keyCases: Case[] = [
  { id: "he-around", text: `${he1} ${run([1, 2, 3])} ${he2}` },
  { id: "en-around", text: `Hello ${run([1, 2, 3])} world` },
  { id: "rlm-first", text: `${RLM}${run([1, 2, 3])}` },
  { id: "rli-in-en", text: `Hello ${RLI}${run([1, 2, 3])}${PDI} world` },
  { id: "inks-then-he", text: `${run([1, 2, 3])} ${he1}` },
];
const keysNote = `${keyCases.map((c) => c.text).join("\n\n")}\n`;

type Mode = "source" | "preview";

/** Opens `file` in the active leaf, in Live Preview, Source mode, or Reading view. */
async function open(
  file: string,
  mode: Mode,
  sourceMode = false,
): Promise<void> {
  await browser.executeObsidian(
    async ({ app, obsidian }, wanted, viewMode, source) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(found, { state: { mode: viewMode, source } });
      if (!(leaf.view instanceof obsidian.MarkdownView)) {
        throw new Error("not a Markdown view");
      }
      app.workspace.setActiveLeaf(leaf, { focus: true });
    },
    file,
    mode,
    sourceMode,
  );
  await browser.pause(400);
  await settleImages();
}

/** Images in the active leaf that have not loaded, by their address. */
async function unloaded(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(
      activeDocument.querySelectorAll(".workspace-leaf.mod-active img"),
    )
      .filter(
        (image) =>
          !(image instanceof HTMLImageElement) ||
          !image.complete ||
          image.naturalWidth === 0,
      )
      .filter((image) => !image.classList.contains("cm-widgetBuffer"))
      .map((image) => image.getAttribute("src") ?? ""),
  );
}

/**
 * Waits until every image in the active leaf has loaded, or for five
 * seconds, and records those that did not, as one whose address Obsidian
 * does not resolve.
 */
async function settleImages(): Promise<void> {
  try {
    await browser.waitUntil(async () => (await unloaded()).length === 0, {
      timeout: 5000,
    });
  } catch {
    const missing = await unloaded();
    const list = (results["unloaded"] as string[] | undefined) ?? [];
    for (const source of missing) {
      if (!list.includes(source)) list.push(source);
    }
    results["unloaded"] = list;
  }
  await browser.pause(150);
}

/** Puts the measuring functions in the page, as `window.inklineRtl`. */
async function installProbe(): Promise<void> {
  await browser.execute(() => {
    const controls: Record<string, string> = {
      "‎": "<LRM>",
      "‏": "<RLM>",
      "؜": "<ALM>",
      "⁦": "<LRI>",
      "⁧": "<RLI>",
      "⁨": "<FSI>",
      "⁩": "<PDI>",
      "‪": "<LRE>",
      "‫": "<RLE>",
      "‬": "<PDF>",
      "‭": "<LRO>",
      "‮": "<RLO>",
      "​": "<ZWSP>",
    };
    const esc = (text: string) =>
      Array.from(text, (c) => controls[c] ?? c).join("");
    const name = (image: Element) => {
      const source = image.getAttribute("src") ?? "";
      const file = decodeURIComponent(
        source.split("?")[0]?.split("/").pop() ?? "",
      );
      return file.replace(/\.ink\.png$/i, "");
    };
    /** Images grouped into visual rows, each left to right. */
    const rows = (images: Element[]) => {
      const boxes = images.map((image, index) => {
        const rect = image.getBoundingClientRect();
        return {
          index,
          name: name(image),
          left: Math.round(rect.left),
          middle: rect.top + rect.height / 2,
          height: rect.height,
        };
      });
      const sorted = [...boxes].sort((a, b) => a.middle - b.middle);
      const grouped: (typeof boxes)[] = [];
      for (const box of sorted) {
        const last = grouped.at(-1);
        const first = last?.[0];
        if (
          last !== undefined &&
          first !== undefined &&
          Math.abs(first.middle - box.middle) < box.height * 0.4
        ) {
          last.push(box);
        } else grouped.push([box]);
      }
      return grouped.map((row) =>
        row
          .sort((a, b) => a.left - b.left)
          .map((box) => `${box.name}@${String(box.left)}`),
      );
    };
    const describe = (element: Element) => {
      const style = getComputedStyle(element);
      const images = Array.from(element.querySelectorAll("img"));
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        cls: element.className.toString().slice(0, 80),
        dir: element.getAttribute("dir"),
        parentDir: element.parentElement?.getAttribute("dir") ?? null,
        direction: style.direction,
        textAlign: style.textAlign,
        unicodeBidi: style.unicodeBidi,
        text: esc(element.textContent).slice(0, 160),
        box: [Math.round(rect.left), Math.round(rect.right)],
        logical: images.map(name),
        rows: rows(images),
        embedDisplay: images.map((image) => {
          const holder = image.closest(".internal-embed");
          return holder === null ? "none" : getComputedStyle(holder).display;
        })[0],
      };
    };
    Reflect.set(window, "inklineRtl", { esc, name, rows, describe });
  });
}

interface Described {
  tag: string;
  dir: string | null;
  parentDir: string | null;
  direction: string;
  textAlign: string;
  text: string;
  logical: string[];
  rows: string[][];
}

/** The blocks of the active Reading view, described. */
async function readingBlocks(): Promise<unknown[]> {
  return browser.execute(() => {
    const probe = Reflect.get(window, "inklineRtl") as {
      describe(element: Element): Described;
    };
    const view = activeDocument.querySelector(
      ".workspace-leaf.mod-active .markdown-reading-view",
    );
    if (view === null) throw new Error("no Reading view");
    const container = view.querySelector(".markdown-preview-view");
    const blocks = Array.from(
      view.querySelectorAll(".markdown-preview-sizer > div"),
    )
      .filter((block) => !block.matches(".mod-header, .mod-footer"))
      .map((block) => {
        const inner =
          block.querySelector("p, [dir]") ?? block.firstElementChild ?? block;
        return { ...probe.describe(inner), outer: block.className };
      });
    return [
      {
        container: container?.className,
        containerDir: container?.getAttribute("dir") ?? null,
        containerDirection:
          container === null ? null : getComputedStyle(container).direction,
      },
      ...blocks,
    ];
  });
}

/** The lines of the active editor, described, with the note's text of each. */
async function editorLines(): Promise<unknown[]> {
  return browser.executeObsidian(({ app, obsidian }) => {
    const probe = Reflect.get(window, "inklineRtl") as {
      describe(element: Element): Described;
      esc(text: string): string;
    };
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (view === null) throw new Error("no Markdown view");
    const cm = Reflect.get(view.editor, "cm") as {
      posAtDOM(node: Node): number;
      contentDOM: HTMLElement;
      state: {
        doc: {
          lineAt(pos: number): { number: number; text: string; from: number };
        };
      };
      bidiSpans(line: object): { from: number; to: number; level: number }[];
      textDirectionAt(pos: number): number;
    };
    const content = cm.contentDOM;
    const lines = Array.from(content.querySelectorAll(".cm-line")).map(
      (line) => {
        let number = -1;
        let source = "";
        let spans = "";
        let cmDirection = -1;
        try {
          const at = cm.state.doc.lineAt(cm.posAtDOM(line));
          number = at.number;
          source = probe.esc(at.text).slice(0, 160);
          spans = cm
            .bidiSpans(at)
            .map((span) => `${String(span.from)}-${String(span.to)}:${String(span.level)}`)
            .join(" ");
          cmDirection = cm.textDirectionAt(at.from);
        } catch {
          // A line CodeMirror does not map.
        }
        const image = line.querySelector("img:not(.cm-widgetBuffer)");
        const chain: string[] = [];
        for (
          let node = image?.parentElement ?? null;
          node !== null && node !== line;
          node = node.parentElement
        ) {
          chain.push(
            `${node.tagName.toLowerCase()}.${node.className.toString().split(" ").join(".")}[${getComputedStyle(node).display}]`,
          );
        }
        return {
          number,
          source,
          ...probe.describe(line),
          widgets: Array.from(line.querySelectorAll(".cm-widgetBuffer"))
            .length,
          runs: Array.from(line.querySelectorAll(".inkline-rtl-run")).map(
            (run) => run.querySelectorAll("img:not(.cm-widgetBuffer)").length,
          ),
          spans,
          cmDirection,
          chain: chain.join(" < "),
        };
      },
    );
    return [
      {
        contentDir: content.getAttribute("dir"),
        contentDirection: getComputedStyle(content).direction,
        sourceView: content.closest(".markdown-source-view")?.className,
      },
      ...lines.filter((line) => line.text !== "" || line.logical.length > 0),
    ];
  });
}

/** Saves a screenshot of the active leaf only. */
async function shot(name: string): Promise<void> {
  await saveScreenshot(name, browser.$(".workspace-leaf.mod-active"));
}

/** Everything the run measured, by test, written as each test ends. */
const results: Record<string, unknown> = {};

async function record(key: string, value: unknown): Promise<void> {
  results[key] = value;
  const folder = path.join(outputDir, "rtl");
  await mkdir(folder, { recursive: true });
  const run = `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;
  await writeFile(
    path.join(folder, `${run}.json`),
    JSON.stringify(results, null, 2),
  );
}

/** Makes the vault's symbols and notes. */
async function makeVault(): Promise<void> {
  const files: Record<string, string> = {};
  for (let digit = 0; digit < 10; digit++) {
    files[`Symbols/d${String(digit)}.ink.png`] = toBase64(digitPng(digit));
  }
  files[`Symbols/${shin}.ink.png`] = toBase64(digitPng(7));
  await browser.executeObsidian(
    async ({ app }, pictures, notes) => {
      if (app.vault.getFolderByPath("Symbols") === null) {
        await app.vault.createFolder("Symbols");
      }
      for (const [file, encoded] of Object.entries(pictures)) {
        if (app.vault.getFileByPath(file) !== null) continue;
        const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        await app.vault.createBinary(file, bytes.buffer);
      }
      for (const [file, text] of Object.entries(notes)) {
        const existing = app.vault.getFileByPath(file);
        if (existing === null) await app.vault.create(file, text);
        else await app.vault.modify(existing, text);
      }
    },
    files,
    {
      "Lines.md": linesNote,
      "Classed.md": classedNote,
      "Wrap.md": wrapNote,
      "Keys.md": keysNote,
      "Typing.md": `${he1} HERE ${he2}\n\nHello THERE world\n`,
      "Next.md": `${he1} HERE ${he2}\n`,
    },
  );
}

/** Toggles a prototype's class on the main window's root. */
async function prototype(
  name: "inkline-proto-strong" | "inkline-proto-runs" | "inkline-proto-neutral",
  on: boolean,
): Promise<void> {
  await browser.executeObsidian(({ app, obsidian }, cls, wanted) => {
    document.documentElement.classList.toggle(cls, wanted);
    // The editor's decorations follow the switch on its next update.
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      if (!(leaf.view instanceof obsidian.MarkdownView)) continue;
      const cm = Reflect.get(leaf.view.editor, "cm") as {
        dispatch(spec: object): void;
      };
      cm.dispatch({});
    }
  }, name, on);
  await browser.pause(200);
}

/** The editor's cursor: its line, column, and where CodeMirror draws it. */
async function caret() {
  return browser.executeObsidian(({ app, obsidian }) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (view === null) throw new Error("no Markdown view");
    const cursor = view.editor.getCursor();
    const cm = Reflect.get(view.editor, "cm") as {
      state: {
        selection: { main: { head: number; assoc: number } };
        doc: { lineAt(pos: number): { from: number } };
      };
      coordsAtPos(
        pos: number,
        side: number,
      ): { left: number; right: number } | null;
      domAtPos(pos: number): { node: Node };
    };
    const { head, assoc } = cm.state.selection.main;
    const coords = cm.coordsAtPos(head, assoc === 0 ? 1 : assoc);
    const drawn = document.querySelector(
      ".workspace-leaf.mod-active .cm-cursor-primary, .workspace-leaf.mod-active .cm-cursor",
    );
    const lineElement = (() => {
      let node: Node | null = cm.domAtPos(head).node;
      while (node !== null && !(node instanceof HTMLElement)) {
        node = node.parentNode;
      }
      return node?.closest(".cm-line") ?? null;
    })();
    const native = activeWindow.getSelection();
    const range =
      native !== null && native.rangeCount > 0 ? native.getRangeAt(0) : null;
    const nativeRect = range?.getClientRects()[0];
    return {
      line: cursor.line,
      ch: cursor.ch,
      assoc,
      x: coords === null ? null : Math.round(coords.left),
      drawn:
        drawn === null ? null : Math.round(drawn.getBoundingClientRect().left),
      native: nativeRect === undefined ? null : Math.round(nativeRect.left),
      images: lineElement?.querySelectorAll("img").length ?? -1,
      revealed: (lineElement?.textContent ?? "").includes("![["),
    };
  });
}

/** Puts the cursor in `line` at its start or end, with the focus. */
async function place(line: number, at: "start" | "end"): Promise<void> {
  await browser.executeObsidian(
    ({ app, obsidian }, number, where) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (view === null) throw new Error("no Markdown view");
      const ch = where === "start" ? 0 : view.editor.getLine(number).length;
      view.editor.setCursor({ line: number, ch });
      view.editor.focus();
    },
    line,
    at,
  );
  await browser.pause(150);
}

/**
 * Presses `key` up to `steps` times from the start or end of `line`, and
 * records the cursor after each press, until it leaves the line.
 */
async function walk(
  line: number,
  at: "start" | "end",
  key: "ArrowLeft" | "ArrowRight",
  steps: number,
) {
  await place(line, at);
  const trail = [await caret()];
  for (let step = 0; step < steps; step++) {
    await browser.keys([key]);
    await browser.pause(60);
    const now = await caret();
    trail.push(now);
    if (now.line !== line) break;
  }
  return trail.map(
    (c) =>
      `${String(c.line)}:${String(c.ch)} x=${String(c.x)} drawn=${String(c.drawn)}${c.revealed ? " REVEALED" : ""} img=${String(c.images)}`,
  );
}

/** Types `text` with the keyboard. */
async function type(text: string): Promise<void> {
  for (const key of text) await browser.keys([key]);
}

/** Inserts symbol `name` from the `;;` list at the cursor. */
async function insertByTrigger(name: string): Promise<void> {
  await type(`;;${name}`);
  await browser.$(".suggestion-item").waitForExist();
  await browser.pause(150);
  await browser.keys(["Enter"]);
  await browser.pause(300);
}

/** The active note's text, with `|` at the cursor. */
async function markedText(): Promise<string> {
  return browser.executeObsidian(({ app, obsidian }) => {
    const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
    if (view === null) throw new Error("no Markdown view");
    const text = view.editor.getValue();
    const at = view.editor.posToOffset(view.editor.getCursor());
    const esc = (Reflect.get(window, "inklineRtl") as {
      esc(t: string): string;
    }).esc;
    return esc(`${text.slice(0, at)}|${text.slice(at)}`);
  });
}

/** Where the cursor stands against the symbols of its line, left to right. */
async function caretAmongSymbols() {
  const where = await caret();
  const symbols = await browser.execute(() => {
    const line = activeDocument.querySelector(
      ".workspace-leaf.mod-active .cm-active.cm-line, .workspace-leaf.mod-active .cm-line.cm-active",
    );
    if (line === null) return [];
    const probe = Reflect.get(window, "inklineRtl") as {
      name(image: Element): string;
    };
    return Array.from(line.querySelectorAll("img"))
      .map((image) => {
        const rect = image.getBoundingClientRect();
        return {
          name: probe.name(image),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        };
      })
      .sort((a, b) => a.left - b.left);
  });
  return { caret: where, symbols };
}

/** Redirects the PDF export's save dialog and captures its print document. */
async function prepareExport(destination: string): Promise<void> {
  await browser.execute((filePath) => {
    const electron: unknown = Reflect.get(window, "electron");
    if (typeof electron !== "object" || electron === null)
      throw new Error("no Electron bridge");
    const remote = Reflect.get(electron, "remote") as object;
    const dialog = Reflect.get(remote, "dialog") as object;
    const descriptor = Object.getOwnPropertyDescriptor(
      dialog,
      "showSaveDialog",
    );
    Object.defineProperty(dialog, "showSaveDialog", {
      configurable: true,
      writable: true,
      value: () => Promise.resolve({ canceled: false, filePath }),
    });
    const open = window.open.bind(window);
    const probe = {
      blocks: [] as unknown[],
      closed: false,
      restore: () => {
        window.open = open;
        if (descriptor !== undefined) {
          Object.defineProperty(dialog, "showSaveDialog", descriptor);
        }
      },
    };
    Reflect.set(window, "inklineRtlPrint", probe);
    window.open = (...args) => {
      const child = open(...args);
      if (child === null) return child;
      const doc = child.document;
      queueMicrotask(() => {
        const bridge = Reflect.get(child, "electron") as object | undefined;
        const ipc =
          bridge === undefined
            ? undefined
            : (Reflect.get(bridge, "ipcRenderer") as object);
        const send =
          ipc === undefined ? undefined : (Reflect.get(ipc, "send") as unknown);
        if (ipc === undefined || typeof send !== "function") return;
        Object.defineProperty(ipc, "send", {
          configurable: true,
          value: (channel: unknown, ...rest: unknown[]): void => {
            if (channel === "print-to-pdf") {
              const options = rest[0];
              if (typeof options === "object" && options !== null) {
                rest[0] = { ...options, open: false };
              }
            }
            Reflect.apply(send, ipc, [channel, ...rest]);
          },
        });
      });
      const capture = () => {
        const paragraphs = Array.from(doc.querySelectorAll(".print p"));
        if (paragraphs.length === 0) return;
        probe.blocks = paragraphs.map((p) => {
          const images = Array.from(p.querySelectorAll("img")).map((image) => {
            const rect = image.getBoundingClientRect();
            const source = image.getAttribute("src") ?? "";
            return {
              name: decodeURIComponent(
                source.split("?")[0]?.split("/").pop() ?? "",
              ).replace(/\.ink\.png$/i, ""),
              left: Math.round(rect.left),
              top: Math.round(rect.top),
              tagged: image.classList.contains("inkline-symbol"),
            };
          });
          return {
            dir: p.getAttribute("dir"),
            direction: child.getComputedStyle(p).direction,
            text: (p.textContent ?? "").slice(0, 80),
            images,
          };
        });
      };
      const observer = new MutationObserver(capture);
      observer.observe(doc, { subtree: true, childList: true, attributes: true });
      child.addEventListener(
        "unload",
        () => {
          observer.disconnect();
          probe.closed = true;
        },
        { once: true },
      );
      return child;
    };
  }, destination);
}

/** Exports the active note to `<name>.pdf` and returns what the print showed. */
async function exportPdf(name: string) {
  const folder = path.join(
    outputDir,
    "rtl-pdfs",
    `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`,
  );
  await mkdir(folder, { recursive: true });
  const prefix = path.join(folder, name);
  const pdf = `${prefix}.pdf`;
  await prepareExport(pdf);
  try {
    await browser.executeObsidianCommand("workspace:export-pdf");
    await browser.$(".modal button.mod-cta").waitForDisplayed();
    await browser.$(".modal button.mod-cta").click();
    await browser.waitUntil(
      async () => {
        try {
          return (await readFile(pdf)).subarray(0, 5).toString() === "%PDF-";
        } catch {
          return false;
        }
      },
      { timeoutMsg: "no PDF", timeout: 40_000 },
    );
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            (Reflect.get(window, "inklineRtlPrint") as { closed: boolean })
              .closed,
        ),
      { timeoutMsg: "export window stayed open" },
    );
    const blocks = await browser.execute(
      () =>
        (Reflect.get(window, "inklineRtlPrint") as { blocks: unknown[] })
          .blocks,
    );
    execFileSync("pdftoppm", ["-singlefile", "-r", "96", "-png", pdf, prefix]);
    const xml = execFileSync("pdftotext", ["-bbox", pdf, "-"], {
      encoding: "utf8",
    });
    await writeFile(`${prefix}.xml`, xml);
    const words = Array.from(
      xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]+)<\/word>/g),
      (m) => `${m[3] ?? ""}@${String(Math.round(Number(m[1])))},${String(Math.round(Number(m[2])))}`,
    );
    return { blocks, words };
  } finally {
    await browser.execute(() => {
      (Reflect.get(window, "inklineRtlPrint") as { restore(): void }).restore();
    });
  }
}

/** Sets Obsidian's own right-to-left editor setting. */
async function setRightToLeft(on: boolean) {
  return browser.executeObsidian(({ app }, wanted) => {
    const vault = app.vault as unknown as {
      setConfig(key: string, value: unknown): void;
      getConfig(key: string): unknown;
    };
    const before = vault.getConfig("rightToLeft");
    vault.setConfig("rightToLeft", wanted);
    const update: unknown = Reflect.get(app.workspace, "updateOptions");
    if (typeof update === "function") Reflect.apply(update, app.workspace, []);
    return { before, after: vault.getConfig("rightToLeft") };
  }, on);
}

describe("Right to left (#167 §6)", function () {
  before(async function () {
    await startOver();
    await loadModules();
    await installProbe();
    await makeVault();
    const versions = await browser.execute(() => {
      const process: unknown = Reflect.get(window, "process");
      const v =
        typeof process === "object" && process !== null
          ? (Reflect.get(process, "versions") as Record<string, string>)
          : {};
      return {
        chrome: v["chrome"],
        electron: v["electron"],
        userAgent: navigator.userAgent,
        width: window.innerWidth,
        height: window.innerHeight,
      };
    });
    await record("versions", versions);
  });

  afterEach(async function () {
    // A test that failed with the editor open leaves it over the next one.
    for (let tries = 0; tries < 5; tries++) {
      if (!(await browser.$(".modal-container").isExisting())) break;
      const discard = browser.$(".modal-container button=Discard");
      if (await discard.isExisting()) await discard.click();
      else await browser.keys(["Escape"]);
      await browser.pause(300);
    }
  });

  after(async function () {
    await prototype("inkline-proto-strong", false);
    await prototype("inkline-proto-runs", false);
    await prototype("inkline-proto-neutral", false);
  });

  it("orders the line cases in Reading view, Live Preview and Source mode", async function () {
    await record(
      "cases",
      lineCases.map((c) => c.id),
    );
    await open("Lines.md", "preview");
    await record("lines-reading", await readingBlocks());
    await shot("lines-reading");
    await browser.execute(() => {
      const view = activeDocument.querySelector(
        ".workspace-leaf.mod-active .markdown-preview-view",
      );
      view?.scrollTo({ top: 10_000 });
    });
    await browser.pause(300);
    await shot("lines-reading-end");
    await open("Lines.md", "source");
    await record("lines-live", await editorLines());
    await shot("lines-live");
    await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      view?.editor.scrollTo(0, 10_000);
    });
    await browser.pause(300);
    await record("lines-live-end", await editorLines());
    await shot("lines-live-end");
    await open("Lines.md", "source", true);
    await record("lines-source", await editorLines());
    await shot("lines-source");
  });

  it("orders them with Obsidian's right-to-left setting", async function () {
    await record("rtl-setting-on", await setRightToLeft(true));
    try {
      await open("Lines.md", "preview");
      await record("rtl-setting-reading", await readingBlocks());
      await shot("rtl-setting-reading");
      await open("Lines.md", "source");
      await record("rtl-setting-live", await editorLines());
      await shot("rtl-setting-live");
      await open("Keys.md", "source");
      await record(
        "rtl-setting-keys-he",
        await walk(0, "start", "ArrowLeft", 12),
      );
    } finally {
      await record("rtl-setting-off", await setRightToLeft(false));
    }
  });

  it("orders a note with cssclasses inkline-rtl", async function () {
    await open("Classed.md", "preview");
    await record("classed-reading", await readingBlocks());
    await shot("classed-reading");
    await open("Classed.md", "source");
    await record("classed-live", await editorLines());
    await shot("classed-live");
  });

  it("orders them with each symbol a strong right-to-left character", async function () {
    await prototype("inkline-proto-strong", true);
    try {
      await open("Lines.md", "preview");
      await record("strong-reading", await readingBlocks());
      await shot("strong-reading");
      await open("Lines.md", "source");
      await record("strong-live", await editorLines());
      await shot("strong-live");
      await open("Keys.md", "source");
      await record("strong-keys-en", await walk(2, "start", "ArrowRight", 12));
    } finally {
      await prototype("inkline-proto-strong", false);
    }
  });

  it("orders them with runs of symbols as right-to-left isolates", async function () {
    await prototype("inkline-proto-runs", true);
    try {
      await open("Lines.md", "preview");
      await record("runs-reading", await readingBlocks());
      await shot("runs-reading");
      await open("Lines.md", "source");
      await record("runs-live", await editorLines());
      await shot("runs-live");
    } finally {
      await prototype("inkline-proto-runs", false);
    }
  });

  it("walks the cursor through symbols with the arrow keys", async function () {
    for (const mode of ["plain", "neutral", "runs-neutral"] as const) {
      const runs = mode === "runs-neutral";
      const tag = mode === "plain" ? "" : `-${mode}`;
      await prototype("inkline-proto-runs", runs);
      await prototype("inkline-proto-neutral", mode !== "plain");
      await open("Keys.md", "source");
      const walks: Record<string, string[]> = {};
      for (const [index, c] of keyCases.entries()) {
        const line = index * 2;
        for (const at of ["start", "end"] as const) {
          for (const key of ["ArrowLeft", "ArrowRight"] as const) {
            walks[`${c.id} from ${at} ${key}`] = await walk(line, at, key, 12);
          }
        }
      }
      await record(`keys${tag}`, walks);
      await record(`keys${tag}-lines`, await editorLines());
      // A selection of three steps from the start of each line.
      const selections: Record<string, string> = {};
      for (const [index, c] of keyCases.entries()) {
        for (const key of ["ArrowLeft", "ArrowRight"] as const) {
          await place(index * 2, "start");
          for (let step = 0; step < 3; step++) {
            await browser.keys(["Shift", key]);
            await browser.pause(60);
          }
          selections[`${c.id} ${key}`] = await browser.executeObsidian(
            ({ app, obsidian }) => {
              const view = app.workspace.getActiveViewOfType(
                obsidian.MarkdownView,
              );
              const esc = (Reflect.get(window, "inklineRtl") as {
                esc(t: string): string;
              }).esc;
              return esc(view?.editor.getSelection() ?? "");
            },
          );
          if (index === 0 && key === "ArrowLeft") {
            await shot(`keys${tag}-selection-he`);
          }
        }
      }
      await record(`selections${tag}`, selections);
      await place(0, "start");
      await browser.keys(["ArrowLeft"]);
      await browser.keys(["ArrowLeft"]);
      await browser.pause(100);
      await shot(`keys${tag}-he-two-left`);
    }
    await prototype("inkline-proto-runs", false);
    await prototype("inkline-proto-neutral", false);
  });

  it("inserts symbols from ;; in a right-to-left line, and in an English one", async function () {
    await openAtMarker("Typing.md", "HERE");
    const steps: unknown[] = [];
    for (const n of [1, 2, 3]) {
      await insertByTrigger(`d${String(n)}`);
      steps.push({ text: await markedText(), ...(await caretAmongSymbols()) });
    }
    await shot("typing-he");
    await openAtMarker("Typing.md", "THERE");
    for (const n of [1, 2, 3]) {
      await insertByTrigger(`d${String(n)}`);
      steps.push({ text: await markedText(), ...(await caretAmongSymbols()) });
    }
    await shot("typing-en");
    await record("typing", steps);
  });

  it("inserts a run from Next in a right-to-left line", async function () {
    await openAtMarker("Next.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    const before = await browser.executeObsidian(
      ({ app }) =>
        app.vault.getFiles().filter((f) => f.path.endsWith(".ink.png")).length,
    );
    await draw([
      [0.5, 0.2],
      [0.5, 0.8],
    ]);
    await markEditor();
    await browser.keys(["Control", "Shift", "Enter"]);
    await waitForNext(before + 1);
    await draw([
      [0.4, 0.2],
      [0.4, 0.8],
    ]);
    await draw([
      [0.6, 0.2],
      [0.6, 0.8],
    ]);
    await markEditor();
    await browser.keys(["Control", "Shift", "Enter"]);
    await waitForNext(before + 2);
    await draw([
      [0.4, 0.3],
      [0.45, 0.7],
      [0.5, 0.3],
      [0.55, 0.7],
    ]);
    await saveScreenshot("next-editor-preview-line");
    await browser.keys(["Control", "Enter"]);
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
    await browser.pause(500);
    await settleImages();
    await record("next", {
      text: await markedText(),
      ...(await caretAmongSymbols()),
    });
    await shot("next-he");
  });

  it("wraps a long run, both ways, and copies it", async function () {
    await browser.execute(() => {
      document.body.style.setProperty("--file-line-width", "300px");
    });
    try {
      await open("Wrap.md", "preview");
      await record("wrap-reading", await readingBlocks());
      await shot("wrap-reading");
      // What a copy of each paragraph in Reading view puts on the clipboard.
      const copies: unknown[] = [];
      for (const index of [0, 1]) {
        copies.push(
          await browser.execute((which) => {
            const view = activeDocument.querySelector(
              ".workspace-leaf.mod-active .markdown-preview-view",
            );
            const paragraph = view?.querySelectorAll("p")[which];
            if (paragraph === undefined) return "no paragraph";
            const range = activeDocument.createRange();
            range.selectNodeContents(paragraph);
            const selection = activeWindow.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            activeDocument.execCommand("copy");
            const req: unknown = Reflect.get(window, "require");
            let text = "";
            let html = "";
            if (typeof req === "function") {
              const electron = req("electron") as {
                clipboard?: { readText(): string; readHTML(): string };
              };
              text = electron.clipboard?.readText() ?? "";
              html = electron.clipboard?.readHTML() ?? "";
            }
            const esc = (Reflect.get(window, "inklineRtl") as {
              esc(t: string): string;
            }).esc;
            return {
              selection: esc(selection?.toString() ?? ""),
              text: esc(text).slice(0, 300),
              html: html.slice(0, 400),
            };
          }, index),
        );
      }
      await record("wrap-copy-reading", copies);
      await open("Wrap.md", "source");
      await record("wrap-live", await editorLines());
      await shot("wrap-live");
    } finally {
      await browser.execute(() => {
        document.body.style.removeProperty("--file-line-width");
      });
    }
  });

  it("exports the line cases and the classed note to PDF", async function () {
    await open("Lines.md", "preview");
    await record("pdf-lines", await exportPdf("lines"));
    await open("Classed.md", "preview");
    await record("pdf-classed", await exportPdf("classed"));
    await open("Wrap.md", "preview");
    await record("pdf-wrap", await exportPdf("wrap"));
  });

  it("orders them without Inkline, and in the dark theme", async function () {
    await obsidianPage.disablePlugin("inkline");
    try {
      await open("Lines.md", "preview");
      await record("without-reading", await readingBlocks());
      await shot("without-reading");
      await open("Lines.md", "source");
      await record("without-live", await editorLines());
      await shot("without-live");
    } finally {
      await obsidianPage.enablePlugin("inkline");
    }
    await browser.executeObsidian(({ app }) => {
      Reflect.apply(Reflect.get(app, "changeTheme") as () => void, app, [
        "obsidian",
      ]);
    });
    try {
      await open("Lines.md", "preview");
      await shot("lines-reading-dark");
      await open("Keys.md", "source");
      await shot("keys-live-dark");
    } finally {
      await browser.executeObsidian(({ app }) => {
        Reflect.apply(Reflect.get(app, "changeTheme") as () => void, app, [
          "moonstone",
        ]);
      });
    }
  });

  it("shows Inkline's lists and editor in a right-to-left interface", async function () {
    await browser.execute(() => {
      window.localStorage.setItem("language", "he");
    });
    try {
      await browser.reloadObsidian();
      await loadModules();
      await installProbe();
      await makeVault();
      const ui = await browser.execute(() => ({
        rtl: document.body.classList.contains("mod-rtl"),
        lang: document.documentElement.getAttribute("lang"),
        dir: document.documentElement.getAttribute("dir"),
      }));
      await record("rtl-ui", ui);
      await browser.executeObsidianCommand("inkline:show-library");
      await browser.$(".inkline-library").waitForExist();
      await browser.pause(800);
      await saveScreenshot("rtl-ui-library");
      await record(
        "rtl-ui-library",
        await browser.execute(() => {
          const pictures = Array.from(
            document.querySelectorAll(".inkline-library img"),
          ).slice(0, 3);
          return pictures.map((image) => {
            const rect = image.getBoundingClientRect();
            const row = image.parentElement?.getBoundingClientRect();
            return {
              picture: [Math.round(rect.left), Math.round(rect.right)],
              row:
                row === undefined
                  ? null
                  : [Math.round(row.left), Math.round(row.right)],
              direction: getComputedStyle(image).direction,
              maskPosition: getComputedStyle(image).maskPosition,
            };
          });
        }),
      );
      await openAtMarker("Typing.md", "HERE");
      await type(";;d");
      await browser.$(".suggestion-item").waitForExist();
      await browser.pause(300);
      await saveScreenshot("rtl-ui-suggest");
      await browser.keys(["Escape"]);
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await waitForEditor();
      await draw([
        [0.5, 0.2],
        [0.5, 0.8],
      ]);
      await browser.pause(300);
      await saveScreenshot("rtl-ui-editor");
      await record(
        "rtl-ui-editor",
        await browser.execute(() => {
          const line = document.querySelector(".inkline-editor .inkline-preview");
          if (line === null) return null;
          const rect = line.getBoundingClientRect();
          return {
            direction: getComputedStyle(line).direction,
            text: line.textContent,
            box: [Math.round(rect.left), Math.round(rect.right)],
            children: Array.from(line.children).map((child) => {
              const r = child.getBoundingClientRect();
              return `${child.tagName}@${String(Math.round(r.left))}`;
            }),
          };
        }),
      );
    } finally {
      await browser.execute(() => {
        window.localStorage.setItem("language", "en");
      });
      await startOver().catch(() => undefined);
      await browser.reloadObsidian();
    }
  });
});
