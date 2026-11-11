// Exploration for #167 §1, not part of the suite: symbols whose ink reaches
// past the room they take in the line, so that what follows is drawn over
// part of them. It runs the prototype in src/render/advance.ts against two
// ways of showing that in CSS, and a control without either:
//
// - "box", technique B: the image's box is the advance, and the ink past it is
//   painted outside the box (box shadow and an unclipped mask);
// - "margins", technique A: the image keeps its whole width, and negative
//   margins take the overhang out of the line;
// - "off": no overhang, as Inkline 1.0, a version 1 reader, shows such a file.
//
// It records measurements in overhang/<version>.json in the output directory
// and leaves screenshots for a person to look at. Its few assertions only stop
// it where a later measurement would mean nothing.

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { readChunks, writeChunks } from "../../../src/format/png.ts";
import { blank, encodePng, type Pixels } from "../../support/png.ts";
import { loadModules, toBase64 } from "../support/browser.ts";
import { startOver } from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);

/** Fills a rectangle of `pixels` with ink, from (x0, y0) to just before (x1, y1). */
function fill(
  pixels: Pixels,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  for (let y = Math.max(0, y0); y < Math.min(pixels.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(pixels.width, x1); x++) {
      pixels.data.set([126, 126, 126, 255], (y * pixels.width + x) * 4);
    }
  }
}

/**
 * A PNG with the prototype's version 2 record chunk: the advance, from
 * `start` to `end` image pixels, before an empty record.
 */
function withAdvance(png: Uint8Array, start: number, end: number): Uint8Array {
  const chunks = readChunks(png);
  const record = deflateSync(Buffer.from('{"strokes":[]}'));
  const data = new Uint8Array(12 + record.length);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2);
  view.setInt32(4, start * 16);
  view.setInt32(8, end * 16);
  data.set(record, 12);
  const [header, ...rest] = chunks;
  if (header === undefined) throw new Error("no header");
  return writeChunks([header, { type: "inKL", data }, ...rest]);
}

/**
 * Geometry of the synthetic symbols, in image pixels. The image is 192 high
 * with the baseline at 144, as every symbol's is.
 */
const swash = {
  width: 448,
  advance: [0, 112] as const,
  // A Z between x 16 and 96, and a flourish under the baseline from x 16 to
  // 440, ending in a short upstroke, under the text that follows.
  flourish: { x0: 16, x1: 440, y0: 160, y1: 176 },
};
const hook = {
  width: 320,
  advance: [224, 320] as const,
  // A stem from x 240 to 256, and a tail under the baseline that reaches back
  // to x 8, under the text before it.
  flourish: { x0: 8, x1: 256, y0: 160, y1: 176 },
};

function swashPng(): Uint8Array {
  const pixels = blank(swash.width, 192);
  fill(pixels, 16, 48, 96, 60);
  fill(pixels, 16, 132, 96, 144);
  for (let y = 60; y < 132; y++) {
    const centre = Math.round(96 - ((y - 60) * 80) / 72);
    fill(pixels, centre - 7, y, centre + 7, y + 1);
  }
  const { x0, x1, y0, y1 } = swash.flourish;
  fill(pixels, x0, y0, x1, y1);
  fill(pixels, 428, 136, 440, 176);
  return withAdvance(encodePng(pixels), ...swash.advance);
}

function hookPng(): Uint8Array {
  const pixels = blank(hook.width, 192);
  fill(pixels, 240, 48, 256, 176);
  const { x0, x1, y0, y1 } = hook.flourish;
  fill(pixels, x0, y0, x1, y1);
  return withAdvance(encodePng(pixels), ...hook.advance);
}

/** A version 1 style symbol with no record: a block on the baseline. */
function blockPng(): Uint8Array {
  const pixels = blank(64, 192);
  fill(pixels, 8, 48, 56, 144);
  return encodePng(pixels);
}

const overhangNote = [
  "Top line.",
  "",
  "Before ![[swash.ink.png]]ollow the arc here.",
  "",
  "Two ![[swash.ink.png]]![[swash.ink.png]]then more text.",
  "",
  "Mark ![[hook.ink.png]] after the hook.",
  "",
  "Sized ![[swash.ink.png|112]]ollow at a fixed size.",
  "",
  "Plain ![[block.ink.png]] block.",
  "",
  "![[hook.ink.png]] starts this line.",
  "",
].join("\n");

/**
 * Lines with a run of `a` of growing length, then the swash, then a word,
 * around the length at which the swash is the last thing before the line
 * wraps, from `around`, so that every line is near the top of the note and
 * Live Preview renders it.
 */
function lineEndNote(around: number): string {
  return Array.from(
    { length: 16 },
    (_, index) =>
      `${"a".repeat(Math.max(1, around - 12 + index))} ![[swash.ink.png]] tail`,
  ).join("\n\n");
}

const pdfNote = [
  "# Overhang",
  "",
  "PdfBefore ![[swash.ink.png]]PdfOver the arc.",
  "",
  "PdfMark ![[hook.ink.png]] PdfAfter.",
  "",
].join("\n");

type Mode = "source" | "preview";
type Technique = "box" | "margins" | "off";

/** Opens `file` in the active leaf, in Live Preview or Reading view. */
async function open(file: string, mode: Mode): Promise<void> {
  await browser.executeObsidian(
    async ({ app, obsidian }, wanted, viewMode) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(found, { state: { mode: viewMode, source: false } });
      if (!(leaf.view instanceof obsidian.MarkdownView)) {
        throw new Error("not a Markdown view");
      }
      app.workspace.setActiveLeaf(leaf, { focus: true });
    },
    file,
    mode,
  );
}

/** Puts the technique's class on the main window's root. */
async function useTechnique(technique: Technique): Promise<void> {
  await browser.execute((chosen) => {
    const root = activeDocument.documentElement;
    root.classList.toggle("inkline-proto-margins", chosen === "margins");
    root.classList.toggle("inkline-proto-off", chosen === "off");
  }, technique);
  await browser.pause(100);
}

function view(mode: Mode): string {
  return mode === "source"
    ? ".workspace-leaf.mod-active .markdown-source-view"
    : ".workspace-leaf.mod-active .markdown-reading-view";
}

/** Waits until `count` symbols in the view are tagged and, unless `plain`, marked. */
async function waitForSymbols(
  mode: Mode,
  count: number,
  marked: number,
): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (selector, wantedCount, wantedMarked) => {
          const all = Array.from(
            activeDocument.querySelectorAll(`${selector} img.inkline-symbol`),
          );
          return (
            all.length >= wantedCount &&
            all.filter((image) => image.hasAttribute("data-inkline-overhang"))
              .length >= wantedMarked &&
            all.every(
              (image) =>
                image.instanceOf(HTMLImageElement) &&
                image.complete &&
                image.naturalWidth > 0,
            )
          );
        },
        view(mode),
        count,
        marked,
      ),
    { timeoutMsg: `symbols were not tagged in ${mode}` },
  );
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Measured {
  src: string;
  marked: boolean;
  natural: number;
  box: Rect;
  holder: Rect;
  baseline: number;
  fontSize: number;
  next?: { rect: Rect; text: string; hit: string };
  prev?: { rect: Rect; text: string };
  style: Record<string, string>;
  holderStyle: Record<string, string>;
  wrapperStyle?: Record<string, string>;
}

/** Where each symbol in the view lies, and what lies before and after it. */
async function measure(mode: Mode): Promise<Measured[]> {
  return browser.execute((selector) => {
    const rectOf = (r: DOMRect) => ({
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
    });
    const pick = (element: Element, names: string[]) => {
      const style = getComputedStyle(element);
      return Object.fromEntries(
        names.map((name) => [name, style.getPropertyValue(name)]),
      );
    };
    const images = Array.from(
      activeDocument.querySelectorAll(`${selector} img.inkline-symbol`),
    ).filter((node) => node.instanceOf(HTMLImageElement));
    return images.map((image) => {
      const holder = image.closest(".image-embed") ?? image;
      const block = holder.closest("p, .cm-line, td, li") ?? holder.parentNode;
      const probe = createSpan({
        attr: {
          style:
            "display: inline-block; width: 0; height: 0; vertical-align: baseline",
        },
      });
      holder.after(probe);
      const baseline = probe.getBoundingClientRect().bottom;
      probe.remove();
      // The first character after the symbol that is not a space, or the
      // next symbol; and the last character before it.
      const walker = activeDocument.createTreeWalker(
        block ?? activeDocument.body,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      );
      const charRect = (node: Text, at: number) => {
        const range = activeDocument.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        return rectOf(range.getBoundingClientRect());
      };
      let next: Measured["next"];
      walker.currentNode = holder;
      // Skip what is inside the holder.
      let node: Node | null = walker.nextNode();
      while (node !== null && holder.contains(node)) node = walker.nextNode();
      for (; node !== null; node = walker.nextNode()) {
        if (
          node.instanceOf(HTMLImageElement) &&
          node.classList.contains("inkline-symbol")
        ) {
          next = {
            rect: rectOf(node.getBoundingClientRect()),
            text: "<symbol>",
            hit: "",
          };
          break;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? "";
          const at = text.search(/\S/);
          if (at >= 0 && node instanceof Text) {
            const rect = charRect(node, at);
            const hitAt = activeDocument.elementFromPoint(
              (rect.left + rect.right) / 2,
              (rect.top + rect.bottom) / 2,
            );
            next = {
              rect,
              text: text.slice(at, at + 6),
              hit:
                hitAt === null
                  ? "none"
                  : `${hitAt.tagName.toLowerCase()}.${Array.from(hitAt.classList).join(".")}`,
            };
            break;
          }
        }
      }
      let prev: Measured["prev"];
      walker.currentNode = holder;
      for (
        let back: Node | null = walker.previousNode();
        back !== null;
        back = walker.previousNode()
      ) {
        if (back.nodeType === Node.TEXT_NODE && back instanceof Text) {
          const text = back.textContent ?? "";
          const trimmed = text.trimEnd();
          if (trimmed.length > 0) {
            prev = {
              rect: charRect(back, trimmed.length - 1),
              text: trimmed.slice(-6),
            };
            break;
          }
        }
      }
      const names = [
        "display",
        "width",
        "height",
        "margin-left",
        "margin-right",
        "mask-clip",
        "mask-size",
        "mask-position",
        "box-shadow",
        "overflow",
        "object-fit",
        "object-position",
        "vertical-align",
      ];
      const wrapper = image.closest(".image-wrapper");
      return {
        src: image.src.split(/[?#]/, 1)[0]?.split("/").pop() ?? "",
        marked: image.hasAttribute("data-inkline-overhang"),
        natural: image.naturalWidth,
        box: rectOf(image.getBoundingClientRect()),
        holder: rectOf(holder.getBoundingClientRect()),
        baseline,
        fontSize: Number.parseFloat(getComputedStyle(image).fontSize),
        ...(next === undefined ? {} : { next }),
        ...(prev === undefined ? {} : { prev }),
        style: pick(image, names),
        holderStyle: pick(holder, [
          "display",
          "overflow",
          "width",
          "margin-left",
          "margin-right",
        ]),
        ...(wrapper === null
          ? {}
          : { wrapperStyle: pick(wrapper, ["display", "overflow", "width"]) }),
      };
    });
  }, view(mode));
}

/**
 * The share of columns in each rectangle that hold ink in a screenshot of
 * the window: a pixel nearer the text colour than the background, which is
 * read at `ground`, a point with nothing drawn on it.
 */
async function inkIn(
  rects: Rect[],
  ground: { x: number; y: number },
  textSelector: string,
): Promise<number[]> {
  const shot = await browser.takeScreenshot();
  return browser.execute(
    async (png, wanted, at, colourOf) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const { data, width, height } =
        window.inklineTest.canvas.readPixels(bitmap);
      bitmap.close();
      const ratio = width / window.innerWidth;
      const element = activeDocument.querySelector(colourOf);
      const probe = new OffscreenCanvas(1, 1).getContext("2d");
      if (probe === null || element === null) throw new Error("no probe");
      probe.fillStyle = getComputedStyle(element).color;
      probe.fillRect(0, 0, 1, 1);
      const text = [...probe.getImageData(0, 0, 1, 1).data];
      const pixel = (x: number, y: number) => {
        const i = (Math.round(y * ratio) * width + Math.round(x * ratio)) * 4;
        return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      };
      const bg = pixel(at.x, at.y);
      const distance = (a: number[], b: number[]) =>
        Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)));
      const full = distance(text, bg);
      return wanted.map((rect) => {
        let columns = 0;
        let inked = 0;
        for (
          let x = Math.ceil(rect.left * ratio);
          x < Math.floor(rect.right * ratio);
          x++
        ) {
          columns++;
          for (
            let y = Math.ceil(rect.top * ratio);
            y < Math.floor(rect.bottom * ratio);
            y++
          ) {
            if (y < 0 || y >= height || x < 0 || x >= width) continue;
            const i = (y * width + x) * 4;
            const rgb = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
            if (distance(rgb, bg) > full / 2) {
              inked++;
              break;
            }
          }
        }
        return columns === 0 ? 0 : inked / columns;
      });
    },
    shot,
    rects,
    ground,
    textSelector,
  );
}

/** The screen rectangle of a symbol's flourish, from where its box lies. */
function flourishRect(
  measured: Measured,
  technique: Technique,
  geometry: typeof swash | typeof hook,
): Rect {
  const scale = (measured.box.bottom - measured.box.top) / 192;
  const origin =
    technique === "box" && measured.marked
      ? measured.box.left - geometry.advance[0] * scale
      : measured.box.left;
  const { x0, x1, y0, y1 } = geometry.flourish;
  // Inside the flourish by a pixel each side, and its middle rows.
  return {
    left: origin + x0 * scale + 1,
    right: origin + x1 * scale - 1,
    top: measured.box.top + (y0 + 4) * scale,
    bottom: measured.box.top + (y1 - 4) * scale,
  };
}

const results: Record<string, unknown> = {};

async function record(name: string, value: unknown): Promise<void> {
  results[name] = value;
  const folder = path.join(outputDir, "overhang");
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(
      folder,
      `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}.json`,
    ),
    JSON.stringify(results, null, 2),
  );
}

/** A point in the active view with nothing drawn on it, for the background. */
async function emptyPoint(mode: Mode): Promise<{ x: number; y: number }> {
  return browser.execute((selector) => {
    const container = activeDocument.querySelector(selector);
    if (container === null) throw new Error("no view");
    const rect = container.getBoundingClientRect();
    return { x: rect.right - 30, y: rect.bottom - 30 };
  }, view(mode));
}

describe("Symbols wider than their advance (#167 §1)", function () {
  before(async function () {
    await startOver();
    await loadModules();
    await browser.executeObsidian(
      async ({ app }, files, notes) => {
        const bytes = (b64: string) =>
          Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
        for (const [name, data] of Object.entries(files)) {
          await app.vault.createBinary(name, bytes(data));
        }
        for (const [name, text] of Object.entries(notes)) {
          await app.vault.create(name, text);
        }
      },
      {
        "swash.ink.png": toBase64(swashPng()),
        "hook.ink.png": toBase64(hookPng()),
        "block.ink.png": toBase64(blockPng()),
      },
      {
        "Overhang.md": overhangNote,
        "Pdf.md": pdfNote,
      },
    );
  });

  after(async function () {
    await useTechnique("box");
    await startOver();
  });

  it("is a later version to Inkline 1.0's reader", async function () {
    const kinds = await browser.execute(async (encoded) => {
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const source = await window.inklineTest.inkFile.readInkFile(bytes);
      return source.kind === "pixels" ? source.reason : source.kind;
    }, toBase64(swashPng()));
    await record("v1-reader", kinds);
    await record(
      "browser",
      await browser.execute(() => ({
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        width: window.innerWidth,
        height: window.innerHeight,
        noClip: CSS.supports("mask-clip", "no-clip"),
        overflowOnImages: CSS.supports("overflow", "visible"),
      })),
    );
    expect(kinds).toBe("newer-version");
  });

  for (const mode of ["preview", "source"] as const) {
    for (const technique of ["box", "margins", "off"] as const) {
      it(`lays out and draws in ${mode} with ${technique}`, async function () {
        await useTechnique(technique);
        await open("Overhang.md", mode);
        // Two swashes, a third, two hooks, a sized swash, and the block; all
        // but the block marked.
        await waitForSymbols(mode, 7, 6);
        await browser.pause(300);
        const measured = await measure(mode);
        const ground = await emptyPoint(mode);
        const rects = measured.flatMap((each) =>
          each.src === "swash.ink.png"
            ? [flourishRect(each, technique, swash)]
            : each.src === "hook.ink.png"
              ? [flourishRect(each, technique, hook)]
              : [],
        );
        // Under the text after the first swash, from its first letter to
        // the flourish's end, and under the text before the first hook.
        const [first] = measured;
        const firstHook = measured.find((each) => each.src === "hook.ink.png");
        const under: Rect[] = [];
        if (first?.next !== undefined) {
          const flourish = flourishRect(first, technique, swash);
          under.push({
            ...flourish,
            left: Math.max(flourish.left, first.next.rect.left),
          });
        }
        if (firstHook?.prev !== undefined) {
          const flourish = flourishRect(firstHook, technique, hook);
          under.push({
            ...flourish,
            right: Math.min(flourish.right, firstHook.prev.rect.right),
          });
        }
        const ink = await inkIn(rects, ground, view(mode));
        const inkUnder = await inkIn(under, ground, view(mode));
        let scroll: { scrollWidth: number; clientWidth: number } | undefined;
        scroll = await browser.execute((selector) => {
          const scroller = activeDocument.querySelector(
            `${selector} .cm-scroller, ${selector}.markdown-reading-view .markdown-preview-view, ${selector} .markdown-preview-view`,
          );
          return scroller === null
            ? { scrollWidth: -1, clientWidth: -1 }
            : {
                scrollWidth: scroller.scrollWidth,
                clientWidth: scroller.clientWidth,
              };
        }, view(mode));
        await saveScreenshot(`overhang-${mode}-${technique}`);
        await record(`layout-${mode}-${technique}`, {
          measured,
          flourishInk: ink,
          inkUnderNeighbours: inkUnder,
          scroll,
        });
        expect(measured.length).toBeGreaterThanOrEqual(7);
      });
    }
  }

  for (const technique of ["box", "margins"] as const) {
    it(`places the cursor and takes clicks in Live Preview with ${technique}`, async function () {
      await useTechnique(technique);
      await open("Overhang.md", "source");
      await waitForSymbols("source", 7, 6);
      const line = "Before ![[swash.ink.png]]ollow the arc here.";
      const after = line.indexOf("]]") + 2;
      // The cursor just after the first swash's embed.
      await browser.executeObsidian(({ app, obsidian }, ch) => {
        const editor = app.workspace.getActiveViewOfType(
          obsidian.MarkdownView,
        )?.editor;
        if (editor === undefined) throw new Error("no editor");
        editor.focus();
        editor.setCursor({ line: 2, ch });
      }, after);
      await browser.pause(400);
      const coords = await browser.executeObsidian(({ app, obsidian }, ch) => {
        const editor = app.workspace.getActiveViewOfType(
          obsidian.MarkdownView,
        )?.editor;
        if (editor === undefined) throw new Error("no editor");
        const cm: unknown = Reflect.get(editor, "cm");
        if (typeof cm !== "object" || cm === null) return null;
        const at: unknown = Reflect.get(cm, "coordsAtPos");
        if (typeof at !== "function") return null;
        const offset = editor.posToOffset({ line: 2, ch });
        const before: unknown = Reflect.apply(at, cm, [offset, -1]);
        const afterSide: unknown = Reflect.apply(at, cm, [offset, 1]);
        return { before, after: afterSide };
      }, after);
      const cursor = await browser.execute((selector) => {
        const caret = activeDocument.querySelector(
          `${selector} .cm-cursor-primary, ${selector} .cm-cursor`,
        );
        const images = Array.from(
          activeDocument.querySelectorAll(`${selector} .cm-line`),
        )
          .filter(
            (line) =>
              line.textContent?.startsWith("Before") === true ||
              line.querySelector("img.inkline-symbol") !== null,
          )[0]
          ?.querySelectorAll("img.inkline-symbol").length;
        return {
          caret:
            caret === null
              ? null
              : (() => {
                  const r = caret.getBoundingClientRect();
                  return { left: r.left, top: r.top, bottom: r.bottom };
                })(),
          imagesOnLine: images,
        };
      }, view("source"));
      await saveScreenshot(`overhang-cursor-${technique}`);
      // Away from the line, so that it shows rendered again, then measure.
      await browser.executeObsidian(({ app, obsidian }) => {
        const editor = app.workspace.getActiveViewOfType(
          obsidian.MarkdownView,
        )?.editor;
        editor?.setCursor({ line: 0, ch: 0 });
      });
      await browser.pause(400);
      const [first] = await measure("source");
      // Click the middle of the third letter after the swash, "l", which
      // lies over its flourish.
      const target = await browser.execute((selector) => {
        const image = activeDocument.querySelector(
          `${selector} .cm-line img.inkline-symbol`,
        );
        const embed = image?.closest(".image-embed");
        let node: Node | null = embed?.nextSibling ?? null;
        while (node !== null && node.nodeType !== Node.TEXT_NODE)
          node = node.firstChild ?? node.nextSibling;
        if (node === null || !(node instanceof Text)) return null;
        const range = activeDocument.createRange();
        range.setStart(node, 2);
        range.setEnd(node, 3);
        const r = range.getBoundingClientRect();
        return {
          x: (r.left + r.right) / 2,
          y: (r.top + r.bottom) / 2,
          char: node.textContent?.slice(2, 3),
        };
      }, view("source"));
      let clicked: unknown = null;
      if (target !== null) {
        await browser
          .action("pointer", { parameters: { pointerType: "mouse" } })
          .move({ x: Math.round(target.x), y: Math.round(target.y) })
          .down()
          .up()
          .perform();
        await browser.pause(400);
        clicked = await browser.executeObsidian(({ app, obsidian }) => {
          const editor = app.workspace.getActiveViewOfType(
            obsidian.MarkdownView,
          )?.editor;
          return {
            from: editor?.getCursor("from"),
            to: editor?.getCursor("to"),
            line: editor?.getLine(0),
          };
        });
        await saveScreenshot(`overhang-click-${technique}`);
      }
      await record(`cursor-${technique}`, {
        after,
        cursor,
        coords,
        expectedCaretX: first?.next?.rect.left,
        boxRight: first?.box.right,
        holderRight: first?.holder.right,
        target,
        clicked,
      });
      // Hover the same letter: does Obsidian show the symbol's tooltip?
      await browser.keys(["Escape"]);
    });
  }

  it("selects across a symbol in Reading view and Live Preview", async function () {
    for (const technique of ["box", "margins"] as const) {
      await useTechnique(technique);
      await open("Overhang.md", "preview");
      await waitForSymbols("preview", 7, 6);
      await browser.execute((selector) => {
        const paragraph = activeDocument
          .querySelector(`${selector} img.inkline-symbol`)
          ?.closest("p");
        if (paragraph === null || paragraph === undefined) {
          throw new Error("no paragraph");
        }
        const selection = activeDocument.getSelection();
        selection?.selectAllChildren(paragraph);
      }, view("preview"));
      await browser.pause(200);
      await saveScreenshot(`overhang-select-preview-${technique}`);
      await open("Overhang.md", "source");
      await waitForSymbols("source", 7, 6);
      await browser.executeObsidian(({ app, obsidian }) => {
        const editor = app.workspace.getActiveViewOfType(
          obsidian.MarkdownView,
        )?.editor;
        if (editor === undefined) throw new Error("no editor");
        editor.focus();
        // From the start of the second symbol line to the end of the third,
        // which keeps the first one's embeds rendered.
        editor.setSelection(
          { line: 4, ch: 0 },
          { line: 6, ch: editor.getLine(6).length },
        );
      });
      await browser.pause(300);
      await saveScreenshot(`overhang-select-source-${technique}`);
    }
  });

  for (const mode of ["preview", "source"] as const) {
    it(`reaches past the line's end in ${mode}`, async function () {
      const found: Record<string, unknown> = {};
      // How many letters fill a line beside the swash's advance, from the
      // first line of the other note in this mode.
      await useTechnique("box");
      await open("Overhang.md", mode);
      await waitForSymbols(mode, 7, 6);
      const widths = await browser.execute((selector) => {
        const image = activeDocument.querySelector(
          `${selector} img.inkline-symbol`,
        );
        const block = image?.closest("p, .cm-line");
        if (
          block === null ||
          block === undefined ||
          !block.instanceOf(HTMLElement)
        ) {
          throw new Error("no line");
        }
        const style = getComputedStyle(block);
        const content =
          block.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight);
        const span = createSpan({ text: "a".repeat(200) });
        span.style.whiteSpace = "nowrap";
        block.append(span);
        const letter = span.getBoundingClientRect().width / 200;
        span.textContent = "a a";
        const space = span.getBoundingClientRect().width - 2 * letter;
        span.remove();
        const advance = image?.getBoundingClientRect().width ?? 0;
        return { content, letter, space, advance };
      }, view(mode));
      const around = Math.floor(
        (widths.content - widths.space - widths.advance) / widths.letter,
      );
      const name = `LineEnd-${mode}.md`;
      await browser.executeObsidian(
        async ({ app }, file, text) => {
          const existing = app.vault.getFileByPath(file);
          if (existing === null) await app.vault.create(file, text);
          else await app.vault.modify(existing, text);
        },
        name,
        lineEndNote(around),
      );
      found.widths = { ...widths, around };
      for (const technique of ["box", "margins", "off"] as const) {
        await useTechnique(technique);
        await open(name, mode);
        await waitForSymbols(mode, 12, 12);
        await browser.pause(300);
        // The line whose swash is last before the wrap, furthest right.
        const chosen = await browser.execute((selector) => {
          const images = Array.from(
            activeDocument.querySelectorAll(`${selector} img.inkline-symbol`),
          );
          let best: { index: number; left: number } | undefined;
          images.forEach((image, index) => {
            const block = image.closest("p, .cm-line");
            const walker = activeDocument.createTreeWalker(
              block ?? image,
              NodeFilter.SHOW_TEXT,
            );
            let tail: Text | undefined;
            for (
              let node = walker.nextNode();
              node !== null;
              node = walker.nextNode()
            ) {
              if (
                node instanceof Text &&
                node.textContent?.includes("tail") === true
              )
                tail = node;
            }
            if (tail === undefined) return;
            const range = activeDocument.createRange();
            const at = tail.textContent?.indexOf("tail") ?? 0;
            range.setStart(tail, at);
            range.setEnd(tail, at + 1);
            const tailRect = range.getBoundingClientRect();
            const box = image.getBoundingClientRect();
            if (
              tailRect.top > box.bottom - 2 &&
              (best === undefined || box.left > best.left)
            ) {
              best = { index, left: box.left };
            }
          });
          if (best === undefined) return null;
          const image = images[best.index];
          if (image === undefined) return null;
          image.scrollIntoView({ block: "center" });
          return best.index;
        }, view(mode));
        if (chosen === null) {
          found[technique] = "no line wrapped after the swash";
          continue;
        }
        await browser.pause(400);
        const measured = (await measure(mode))[chosen];
        const edges = await browser.execute(
          (selector, index) => {
            const image = activeDocument.querySelectorAll(
              `${selector} img.inkline-symbol`,
            )[index];
            const block = image?.closest("p, .cm-line");
            const sizer = image?.closest(
              ".markdown-preview-sizer, .cm-content",
            );
            const scroller = image?.closest(
              ".markdown-preview-view, .cm-scroller",
            );
            const leaf = image?.closest(".workspace-leaf-content");
            const r = (element: Element | null | undefined) => {
              if (element === null || element === undefined) return null;
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                left: rect.left,
                right: rect.right,
                paddingRight: style.paddingRight,
                overflowX: style.overflowX,
              };
            };
            return {
              block: r(block),
              sizer: r(sizer),
              scroller: r(scroller),
              leaf: r(leaf),
              scrollWidth: scroller?.scrollWidth,
              clientWidth: scroller?.clientWidth,
            };
          },
          view(mode),
          chosen,
        );
        const ground = await emptyPoint(mode);
        const ink =
          measured === undefined
            ? []
            : await inkIn(
                [flourishRect(measured, technique, swash)],
                ground,
                view(mode),
              );
        await saveScreenshot(`overhang-line-end-${mode}-${technique}`);
        found[technique] = { chosen, measured, edges, flourishInk: ink };
      }
      await record(`line-end-${mode}`, found);
    });
  }

  it("draws in both themes and in stored colour", async function () {
    const found: Record<string, unknown> = {};
    try {
      for (const theme of ["obsidian", "moonstone"] as const) {
        await browser.executeObsidian(({ app }, chosen) => {
          const change: unknown = Reflect.get(app, "changeTheme");
          if (typeof change !== "function") throw new Error("no themes");
          Reflect.apply(change, app, [chosen]);
        }, theme);
        for (const stored of [false, true]) {
          for (const technique of ["box", "margins"] as const) {
            await useTechnique(technique);
            await browser.execute((on) => {
              activeDocument.documentElement.classList.toggle(
                "inkline-stored-color",
                on,
              );
            }, stored);
            for (const mode of ["preview", "source"] as const) {
              await open("Overhang.md", mode);
              await waitForSymbols(mode, 7, 6);
              await browser.pause(300);
              const measured = await measure(mode);
              const ground = await emptyPoint(mode);
              const [first] = measured;
              const ink =
                first === undefined
                  ? []
                  : await inkIn(
                      [flourishRect(first, technique, swash)],
                      ground,
                      view(mode),
                    );
              const name = `${theme}-${stored ? "stored" : "text"}-${technique}-${mode}`;
              await saveScreenshot(`overhang-theme-${name}`);
              found[name] = { flourishInk: ink, first: first?.style };
            }
          }
        }
      }
    } finally {
      await browser.execute(() => {
        activeDocument.documentElement.classList.remove("inkline-stored-color");
      });
      await browser.executeObsidian(({ app }) => {
        const change: unknown = Reflect.get(app, "changeTheme");
        if (typeof change === "function")
          Reflect.apply(change, app, ["moonstone"]);
      });
    }
    await record("themes", found);
  });

  it("prints to PDF with the box technique", async function () {
    await useTechnique("box");
    await open("Pdf.md", "preview");
    await waitForSymbols("preview", 2, 2);
    const folder = path.join(
      outputDir,
      "overhang",
      `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`,
    );
    await mkdir(folder, { recursive: true });
    const pdf = path.join(folder, "overhang.pdf");
    await browser.execute((filePath) => {
      const electron: unknown = Reflect.get(window, "electron");
      if (typeof electron !== "object" || electron === null)
        throw new Error("no electron");
      const remote: unknown = Reflect.get(electron, "remote");
      if (typeof remote !== "object" || remote === null)
        throw new Error("no remote");
      const dialog: unknown = Reflect.get(remote, "dialog");
      if (typeof dialog !== "object" || dialog === null)
        throw new Error("no dialog");
      Object.defineProperty(dialog, "showSaveDialog", {
        configurable: true,
        writable: true,
        value: () => Promise.resolve({ canceled: false, filePath }),
      });
      const open = window.open.bind(window);
      const captured: unknown[] = [];
      Reflect.set(window, "overhangPrint", captured);
      window.open = (...args) => {
        const child = open(...args);
        if (child === null) return child;
        queueMicrotask(() => {
          const bridge: unknown = Reflect.get(child, "electron");
          if (typeof bridge !== "object" || bridge === null) return;
          const ipc: unknown = Reflect.get(bridge, "ipcRenderer");
          if (typeof ipc !== "object" || ipc === null) return;
          const send: unknown = Reflect.get(ipc, "send");
          if (typeof send !== "function") return;
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
          const images = Array.from(
            child.document.querySelectorAll(".print img"),
          );
          if (images.length === 0) return;
          captured.length = 0;
          for (const image of images) {
            const rect = image.getBoundingClientRect();
            captured.push({
              marked: image.hasAttribute("data-inkline-overhang"),
              tagged: image.classList.contains("inkline-symbol"),
              left: rect.left,
              width: rect.width,
              height: rect.height,
            });
          }
        };
        const observer = new MutationObserver(capture);
        observer.observe(child.document, {
          subtree: true,
          childList: true,
          attributes: true,
        });
        return child;
      };
    }, pdf);
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
      { timeout: 60_000, timeoutMsg: "no PDF" },
    );
    await browser.pause(1500);
    const prefix = path.join(folder, "overhang");
    execFileSync("pdftoppm", ["-singlefile", "-r", "96", "-png", pdf, prefix]);
    const xml = execFileSync("pdftotext", ["-bbox", pdf, "-"], {
      encoding: "utf8",
    });
    await writeFile(`${prefix}.xml`, xml);
    const words: Record<string, Rect> = {};
    for (const match of xml.matchAll(
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g,
    )) {
      const [, l, t, r, b, word] = match;
      if (word === undefined) continue;
      words[word] = {
        left: (Number(l) * 96) / 72,
        top: (Number(t) * 96) / 72,
        right: (Number(r) * 96) / 72,
        bottom: (Number(b) * 96) / 72,
      };
    }
    const raster = toBase64(new Uint8Array(await readFile(`${prefix}.png`)));
    const captured = await browser.execute(
      () => Reflect.get(window, "overhangPrint") as { height: number }[],
    );
    // In the PDF's pixels: the text's baseline from "PdfBefore", which has no
    // descender, and the dark columns in the middle rows of the flourishes,
    // below it. The page is rasterized at 96 DPI, a CSS pixel each.
    const printed = await browser.execute(
      async (png, boxes, height) => {
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes]));
        const { data, width } = window.inklineTest.canvas.readPixels(bitmap);
        bitmap.close();
        const scale = height / 192;
        const dark = (x: number, y: number) => {
          const i = (y * width + x) * 4;
          return (
            (data[i] ?? 255) < 160 &&
            (data[i + 1] ?? 255) < 160 &&
            (data[i + 2] ?? 255) < 160
          );
        };
        const textBottom = (box: Rect) => {
          let bottom = -1;
          for (let y = Math.floor(box.top); y < Math.ceil(box.bottom); y++) {
            for (let x = Math.ceil(box.left); x < Math.floor(box.right); x++) {
              if (dark(x, y)) bottom = Math.max(bottom, y);
            }
          }
          return bottom;
        };
        // The dark columns between `from` and `to` in the flourish's rows.
        const band = (from: number, to: number, baseline: number) => {
          const top = Math.round(baseline + 20 * scale);
          const bottom = Math.round(baseline + 28 * scale);
          let left: number | undefined;
          let right: number | undefined;
          let inked = 0;
          for (let x = Math.ceil(from); x < Math.floor(to); x++) {
            for (let y = top; y <= bottom; y++) {
              if (dark(x, y)) {
                left ??= x;
                right = x;
                inked++;
                break;
              }
            }
          }
          return { left, right, inked, rows: [top, bottom] };
        };
        const before = boxes.PdfBefore;
        const over = boxes.PdfOver;
        const mark = boxes.PdfMark;
        const afterWord = boxes["PdfAfter."];
        if (
          before === undefined ||
          over === undefined ||
          mark === undefined ||
          afterWord === undefined
        ) {
          return { error: "words missing" };
        }
        const baseline = textBottom(before);
        const baseline2 = textBottom(mark);
        return {
          scale,
          baseline,
          baseline2,
          swashBand: band(before.right, over.right + 80, baseline),
          hookBand: band(mark.left - 40, afterWord.left, baseline2),
          before,
          over,
          mark,
          after: afterWord,
        };
      },
      raster,
      words,
      captured[0]?.height ?? 24,
    );
    await record("pdf", { words, printed, captured });
  });

  it("shows the plain picture without Inkline, and then shifts when Inkline reads the file", async function () {
    await useTechnique("box");
    await obsidianPage.disablePlugin("inkline");
    await open("Overhang.md", "preview");
    await browser.pause(800);
    const plain = await browser.execute(
      (selector) =>
        Array.from(activeDocument.querySelectorAll(`${selector} img`)).map(
          (image) => {
            const rect = image.getBoundingClientRect();
            return {
              width: rect.width,
              height: rect.height,
              tagged: image.classList.contains("inkline-symbol"),
            };
          },
        ),
      view("preview"),
    );
    await saveScreenshot("overhang-without-inkline");
    await obsidianPage.enablePlugin("inkline");
    // How long the text after a swash stays where the whole image puts it.
    const timing = await browser.execute(async (selector) => {
      const start = performance.now();
      let tagged: number | undefined;
      let marked: number | undefined;
      while (performance.now() - start < 10_000) {
        const image = activeDocument.querySelector(`${selector} img`);
        if (
          tagged === undefined &&
          image?.classList.contains("inkline-symbol") === true
        ) {
          tagged = performance.now() - start;
        }
        if (
          marked === undefined &&
          image?.hasAttribute("data-inkline-overhang") === true
        ) {
          marked = performance.now() - start;
          break;
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return { tagged, marked };
    }, view("preview"));
    await loadModules();
    await record("without-inkline", { plain, timing });
  });
});
