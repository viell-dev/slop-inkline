// A symbol whose ink stands on the editor's baseline guide stands on the
// baseline of the text beside it, wherever it falls in the line, and symbols
// of one line line up with each other (#261): in Reading view and Live
// Preview, in the text colour and its stored colour, at several text sizes,
// symbol sizes, and zoom levels. What Obsidian shows is the subject, a mask's
// ink and text drawn by the host, so each symbol's ink and each typed letter
// is measured in a screenshot of the window, to a fraction of a pixel.
//
// Both are drawn on whole pixels of the screen: a letter's baseline, and the
// top of a symbol's box, whose ink baseline lies three quarters of the way
// down it. Where that lies a whole number of screen pixels down the box, as
// in 16-pixel text at 100% and 150%, the ink stands on the letters' baseline,
// and the symbols of a line level, within 0.25 screen pixels, which allows
// for the measuring. Elsewhere two whole-pixel roundings meet, the text's and
// the box's, so the ink stands within 1.2 pixels of the letters' baseline in
// the conditions below, as measured up to 1.06, and the symbols of a line
// within 0.6 of each other where each CSS pixel is a whole number of screen
// pixels, and within one at other zoom levels: Chromium 150 resamples a mask
// into a whole-pixel rectangle whose width depends on where the box falls,
// which left up to 0.5 between them at 100% and 0.69 at 120%.

import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import { setPageZoom } from "../support/cursor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/**
 * The note: each line a typed H, the two symbols, another H, the symbols
 * again, and an H, after a different few letters, so that the symbols fall
 * at many fractions of a pixel across. Two paragraphs, so that lines fall at
 * fractions of a pixel down too where a line's height is not whole.
 */
const starts = ["", "i", "l", "m", "W", "il", "ii", "mi", "Wi", "iii", "ll"];
const line = (start: string) =>
  `${start}H![[x.ink.png]]H![[cap.ink.png]]![[x.ink.png]]![[cap.ink.png]]H`;
const note = [
  starts.slice(0, 6).map(line).join("\n"),
  "",
  starts.slice(6).map(line).join("\n"),
  "",
].join("\n");

/** The blank line between the paragraphs, for Live Preview's cursor. */
const blankLine = 6;

/** How the text and the symbols are shown for a measurement. */
interface Condition {
  readonly name: string;
  /** The text size, in CSS pixels, as Obsidian's Font size setting gives. */
  readonly font: number;
  /** The Symbol size setting, as a factor. */
  readonly scale: number;
  /** Obsidian's zoom, which makes each CSS pixel this many screen pixels. */
  readonly zoom: number;
}

const conditions: readonly Condition[] = [
  { name: "16-pixel text", font: 16, scale: 1, zoom: 1 },
  { name: "16-pixel text at 150%", font: 16, scale: 1.5, zoom: 1 },
  { name: "16-pixel text at 75%", font: 16, scale: 0.75, zoom: 1 },
  { name: "13-pixel text", font: 13, scale: 1, zoom: 1 },
  { name: "17-pixel text", font: 17, scale: 1, zoom: 1 },
  { name: "20-pixel text", font: 20, scale: 1, zoom: 1 },
  { name: "16-pixel text zoomed to 200%", font: 16, scale: 1, zoom: 2 },
  { name: "17-pixel text zoomed to 200%", font: 17, scale: 1, zoom: 2 },
  // Obsidian's Zoom in and Zoom out move the zoom a step of the square root
  // of 1.2 each way: 109.5% and 91.3% for one step, 120% for two in.
  {
    name: "16-pixel text zoomed in a step, to 109.5%",
    font: 16,
    scale: 1,
    zoom: Math.sqrt(1.2),
  },
  {
    name: "16-pixel text zoomed out a step, to 91.3%",
    font: 16,
    scale: 1,
    zoom: 1 / Math.sqrt(1.2),
  },
  {
    name: "16-pixel text zoomed in two steps, to 120%",
    font: 16,
    scale: 1,
    zoom: 1.2,
  },
];

/**
 * Whether a symbol's ink baseline, three quarters of the way down its box,
 * lies a whole number of screen pixels below the box's top, with each CSS
 * pixel a whole number of screen pixels. Zoomed to a fraction, as 91.3%, the
 * page's CSS pixels do not fall on whole screen pixels, and Chromium rounds
 * the text and the boxes from fractions of them.
 */
function whole(condition: Condition): boolean {
  const down = 0.75 * 1.5 * condition.font * condition.scale * condition.zoom;
  return (
    Number.isInteger(condition.zoom) && Math.abs(down - Math.round(down)) < 1e-6
  );
}

/**
 * How far apart the symbols of a line may be, in screen pixels, where their
 * ink baseline is not on a whole pixel: half a pixel and a little where each
 * CSS pixel is a whole number of screen pixels, as Chromium 150 left up to
 * 0.5 between boxes it resampled at different widths at 100%, and 0.00 at
 * 200%; at other zoom levels, up to a pixel, as measured up to 0.69 at 120%,
 * and up to 0.94 in other conditions.
 */
function lineSpread(condition: Condition): number {
  return Number.isInteger(condition.zoom) ? 0.6 : 1;
}

/** One symbol or typed H, as measured, in screen pixels. */
interface Measured {
  readonly kind: "symbol" | "letter";
  /** Its line, as the CSS baseline beside it, in CSS pixels. */
  readonly line: number;
  /** Its box's left edge and width, in screen pixels. */
  readonly left: number;
  readonly width: number;
  /** Where its ink ends, in screen pixels from the window's top. */
  readonly bottom: number | null;
  /** A symbol's ink's left edge and width, in screen pixels. */
  readonly inkLeft: number | null;
  readonly inkWidth: number | null;
}

async function open(mode: "source" | "preview"): Promise<void> {
  await browser.executeObsidian(
    async ({ app, obsidian }, viewMode, cursorLine) => {
      const file = app.vault.getFileByPath("Baseline.md");
      if (file === null) throw new Error("no Baseline.md");
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file, { state: { mode: viewMode, source: false } });
      if (!(leaf.view instanceof obsidian.MarkdownView)) {
        throw new Error("not a Markdown view");
      }
      app.workspace.setActiveLeaf(leaf, { focus: true });
      // Off the symbols' lines, which then show rendered.
      if (viewMode === "source") {
        leaf.view.editor.setCursor({ line: cursorLine, ch: 0 });
      }
    },
    mode,
    blankLine,
  );
}

/** Puts Inkline's display settings to these, and starts it again with them. */
async function display(symbolScale: number, textColor: boolean): Promise<void> {
  await browser.executeObsidian(
    async ({ plugins }, settings) => {
      await plugins.inkline.saveData(settings);
    },
    { symbolScale, textColor },
  );
  await obsidianPage.disablePlugin("inkline");
  await obsidianPage.enablePlugin("inkline");
  await loadModules();
}

/** Sets the text size as Obsidian's Font size setting does, or resets it. */
async function textSize(px: number | null): Promise<void> {
  await browser.execute((size) => {
    if (size === null) document.body.style.removeProperty("--font-text-size");
    else
      document.body.style.setProperty("--font-text-size", `${String(size)}px`);
  }, px);
}

/**
 * Measures every symbol and typed H in view in a screenshot of the window:
 * where each one's ink ends, from the share of the way each pixel lies from
 * the ground's colour to the ink's. A row its edge crosses counts in part,
 * so that the bottom is found to a fraction of a pixel.
 */
async function measure(stored: boolean): Promise<Measured[]> {
  const shot = await browser.takeScreenshot();
  return browser.execute(
    async (png, storedColour) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const pixels = window.inklineTest.canvas.readPixels(bitmap);
      bitmap.close();
      const ratio = pixels.width / window.innerWidth;
      const leaf = activeDocument.querySelector(".workspace-leaf.mod-active");
      const reading = leaf?.querySelector(".markdown-reading-view");
      const view =
        reading?.checkVisibility() === true
          ? reading.querySelector(".markdown-preview-view")
          : leaf?.querySelector(".markdown-source-view .cm-content");
      if (view === null || view === undefined) throw new Error("no view");
      const colourOf = (css: string): [number, number, number] => {
        const paint = new OffscreenCanvas(1, 1).getContext("2d");
        if (paint === null) throw new Error("no 2D context");
        paint.fillStyle = css;
        paint.fillRect(0, 0, 1, 1);
        const [red = 0, green = 0, blue = 0] = paint.getImageData(
          0,
          0,
          1,
          1,
        ).data;
        return [red, green, blue];
      };
      /** Where the ink in `box` ends, in screen pixels. */
      const bottomOf = (box: DOMRect, ink: readonly number[]) => {
        const left = Math.max(0, Math.floor(box.left * ratio));
        const right = Math.min(pixels.width, Math.ceil(box.right * ratio));
        const top = Math.max(0, Math.floor(box.top * ratio));
        const bottom = Math.min(pixels.height, Math.ceil(box.bottom * ratio));
        const ground = window.inklineTest.inkBlock.commonColour(pixels, {
          left,
          top,
          right,
          bottom,
        });
        const step = ink.map(
          (value, channel) => value - (ground[channel] ?? 0),
        );
        const length = step.reduce((sum, value) => sum + value * value, 0);
        if (length === 0) return null;
        const rows: number[] = [];
        for (let y = top; y < bottom; y++) {
          let sum = 0;
          for (let x = left; x < right; x++) {
            const at = (y * pixels.width + x) * 4;
            let along = 0;
            for (let channel = 0; channel < 3; channel++) {
              along +=
                ((pixels.data[at + channel] ?? 0) - (ground[channel] ?? 0)) *
                (step[channel] ?? 0);
            }
            sum += Math.min(1, Math.max(0, along / length));
          }
          rows.push(sum);
        }
        const most = Math.max(...rows);
        if (most <= 0) return null;
        // A whole row of the ink's lower part: the middle of the inked rows,
        // which an H's crossbar and a block's edges cannot move.
        const inked = rows
          .filter((sum) => sum > 0.05 * most)
          .sort((a, b) => a - b);
        const full = inked[inked.length >> 1] ?? most;
        let last = rows.length - 1;
        while (last >= 0 && (rows[last] ?? 0) < 0.9 * full) last--;
        if (last < 0) return null;
        let partial = 0;
        for (let y = last + 1; y < rows.length; y++) {
          partial += (rows[y] ?? 0) / full;
        }
        return top + last + 1 + partial;
      };
      /** The CSS baseline beside `node`, from an empty block put there. */
      const lineOf = (node: ChildNode): number => {
        const probe = createSpan({
          attr: {
            style:
              "display: inline-block; width: 0; height: 0; vertical-align: baseline",
          },
        });
        node.after(probe);
        const at = probe.getBoundingClientRect().bottom;
        probe.remove();
        return at;
      };
      const inView = (box: DOMRect) =>
        box.width > 0 && box.top > 0 && box.bottom < window.innerHeight;
      const found: {
        kind: "symbol" | "letter";
        line: number;
        left: number;
        width: number;
        bottom: number | null;
        inkLeft: number | null;
        inkWidth: number | null;
      }[] = [];
      /** The block of `ink` in `box`, in screen pixels. */
      const blockOf = (box: DOMRect, ink: readonly number[]) => {
        const region = {
          left: box.left * ratio,
          top: box.top * ratio,
          right: box.right * ratio,
          bottom: box.bottom * ratio,
        };
        const { inkBlock } = window.inklineTest;
        const ground = inkBlock.commonColour(pixels, region);
        const [red = 0, green = 0, blue = 0] = ink;
        return inkBlock.measureBlock(pixels, region, ground, [
          red,
          green,
          blue,
        ]);
      };
      for (const image of Array.from(
        view.querySelectorAll("img.inkline-symbol"),
      )) {
        const box = image.getBoundingClientRect();
        if (!inView(box)) continue;
        const ink = storedColour
          ? [126, 126, 126]
          : colourOf(getComputedStyle(image).color);
        const block = blockOf(box, ink);
        found.push({
          kind: "symbol",
          line: lineOf(image.closest(".image-embed") ?? image),
          left: box.left * ratio,
          width: box.width * ratio,
          bottom: bottomOf(box, ink),
          inkLeft: block?.left ?? null,
          inkWidth: block?.width ?? null,
        });
      }
      const text = colourOf(getComputedStyle(view).color);
      const walker = activeDocument.createTreeWalker(
        view,
        NodeFilter.SHOW_TEXT,
      );
      for (
        let node = walker.nextNode();
        node !== null;
        node = walker.nextNode()
      ) {
        if (!node.instanceOf(Text)) continue;
        const value = node.data;
        for (
          let at = value.indexOf("H");
          at >= 0;
          at = value.indexOf("H", at + 1)
        ) {
          const range = activeDocument.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + 1);
          const box = range.getBoundingClientRect();
          if (!inView(box)) continue;
          found.push({
            kind: "letter",
            line: lineOf(node),
            left: box.left * ratio,
            width: box.width * ratio,
            bottom: bottomOf(box, text),
            inkLeft: null,
            inkWidth: null,
          });
        }
      }
      return found;
    },
    shot,
    stored,
  );
}

/** What the measurements of one line say. */
interface Line {
  /** Each symbol's ink bottom less the letters', in screen pixels. */
  readonly offsets: number[];
  /** How far apart the symbols' ink bottoms are, and the letters'. */
  readonly symbolSpread: number;
  readonly letterSpread: number;
}

/** Groups `measured` by line. */
function lines(measured: readonly Measured[]): Line[] {
  const byLine = new Map<number, Measured[]>();
  for (const each of measured) {
    const key = Math.round(each.line * 4);
    byLine.set(key, [...(byLine.get(key) ?? []), each]);
  }
  const spread = (values: number[]) =>
    values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
  return [...byLine.values()].map((members) => {
    const bottoms = (kind: Measured["kind"]) =>
      members
        .filter((each) => each.kind === kind)
        .map((each) => each.bottom)
        .filter((bottom) => bottom !== null);
    const letters = bottoms("letter");
    const symbols = bottoms("symbol");
    const base =
      letters.reduce((sum, value) => sum + value, 0) / letters.length;
    return {
      offsets: symbols.map((bottom) => bottom - base),
      symbolSpread: spread(symbols),
      letterSpread: spread(letters),
    };
  });
}

/**
 * Opens the note in `mode`, moves the pointer off it, and waits for its
 * symbols to load and be measured, and for the page to draw them.
 */
async function show(mode: "source" | "preview"): Promise<void> {
  await open(mode);
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ x: 2, y: 2 })
    .perform();
  await browser.waitUntil(async () =>
    browser.execute(() => {
      const images = Array.from(
        activeDocument.querySelectorAll(
          ".workspace-leaf.mod-active img.inkline-symbol",
        ),
      );
      return (
        images.length >= 4 &&
        images.every(
          (image) =>
            image.instanceOf(HTMLImageElement) &&
            image.complete &&
            image.naturalWidth > 0 &&
            image.style.getPropertyValue("--inkline-ratio") !== "",
        )
      );
    }),
  );
  // Long enough for the page to draw what changed.
  await browser.pause(300);
}

describe("Symbols on the text's baseline", function () {
  this.timeout(300_000);

  before(async function () {
    await loadModules();
    // Two symbols like a hand-drawn pair, saved as Inkline saves a drawing:
    // 84 × 192 pixels, each a block from x 8 to 76 ending on the baseline,
    // y 144, one up to about the default font's x-height and one up to
    // about its cap height.
    await browser.executeObsidian(async ({ app }, text) => {
      const { canvas, record } = window.inklineTest;
      const unit = record.unitsPerPixel;
      for (const [name, top] of [
        ["x", 74],
        ["cap", 51],
      ] as const) {
        const saved = await canvas.saveInk(
          {
            strokes: [
              {
                tool: "pen" as const,
                kind: "fill" as const,
                points: [8, top, 76, top, 76, 144, 8, 144].map(
                  (value) => value * unit,
                ),
              },
            ],
          },
          undefined,
        );
        if (saved.width !== 84) {
          throw new Error(`saved ${String(saved.width)} pixels wide`);
        }
        await app.vault.createBinary(
          `${name}.ink.png`,
          saved.bytes.slice().buffer,
        );
      }
      await app.vault.create("Baseline.md", text);
    }, note);
  });

  after(async function () {
    await setPageZoom(1);
    await textSize(null);
    await display(100, true);
  });

  for (const stored of [false, true]) {
    const colour = stored ? "stored colour" : "text colour";

    describe(`in the ${colour}`, function () {
      for (const condition of conditions) {
        it(`stand on the letters' baseline in ${condition.name}`, async function () {
          await display(condition.scale * 100, !stored);
          await textSize(condition.font);
          await setPageZoom(condition.zoom);
          try {
            for (const mode of ["preview", "source"] as const) {
              await show(mode);
              const measured = await measure(stored);
              const file = condition.name.replace(/\W+/g, "-").toLowerCase();
              await saveScreenshot(
                `baseline-${stored ? "stored" : "text"}-${mode}-${file}`,
              );
              const shown = lines(measured);
              const offsets = shown.flatMap((each) => each.offsets);
              const symbols = measured.filter((each) => each.kind === "symbol");
              console.log(
                `${colour}, ${condition.name}, ${mode}: ${String(symbols.length)} symbols, ink less letters ${Math.min(...offsets).toFixed(2)} to ${Math.max(...offsets).toFixed(2)} px, symbols of a line up to ${Math.max(...shown.map((each) => each.symbolSpread)).toFixed(2)} px apart`,
              );
              // Every line in view, each with its four symbols, at many
              // places across: boxes that whole pixels draw narrower than
              // they are, and wider.
              expect(shown.length).toBeGreaterThanOrEqual(8);
              expect(offsets.length).toBe(4 * shown.length);
              const narrower = symbols.filter(
                (each) =>
                  Math.round(each.left + each.width) - Math.round(each.left) <
                  each.width - 0.01,
              ).length;
              const exact = whole(condition);
              if (exact && condition.zoom === 1) {
                expect(narrower).toBeGreaterThanOrEqual(4);
                expect(symbols.length - narrower).toBeGreaterThanOrEqual(4);
              }
              for (const each of shown) {
                // The letters themselves agree, which checks the measuring.
                expect(each.letterSpread).toBeLessThanOrEqual(0.1);
                expect(each.symbolSpread).toBeLessThanOrEqual(
                  exact ? 0.25 : lineSpread(condition),
                );
                for (const offset of each.offsets) {
                  expect(Math.abs(offset)).toBeLessThanOrEqual(
                    exact ? 0.25 : 1.2,
                  );
                }
              }
            }
          } finally {
            await setPageZoom(1);
          }
        });
      }

      it("draw a box a snippet makes wider whole, at the line's height and its left", async function () {
        await display(100, !stored);
        await textSize(16);
        // A snippet's rule, as a stylesheet of its own, giving symbols in
        // Reading view a width of 3 em, wider than these at the line's height.
        await browser.execute(() => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(
            "body .markdown-rendered img.inkline-symbol { width: 3em; }",
          );
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
          Reflect.set(window, "inklineTestSnippet", sheet);
        });
        try {
          await show("preview");
          const measured = await measure(stored);
          await saveScreenshot(
            `baseline-${stored ? "stored" : "text"}-snippet`,
          );
          const shown = lines(measured);
          const symbols = measured.filter((each) => each.kind === "symbol");
          console.log(
            `${colour}, a box 3 em wide: ${JSON.stringify(symbols.slice(0, 4))}`,
          );
          expect(symbols.length).toBeGreaterThanOrEqual(32);
          for (const each of symbols) {
            // The box is the snippet's, 48 pixels; the ink is the symbol's at
            // the line's height, 24 pixels, so a block from x 1 to 9.5 of it,
            // within the pixel that drawing on whole pixels can move its edges:
            // it was 9.0 wide in the text colour and 8.1 in stored colour.
            // Drawn as wide as the box, it would be 39 pixels wide.
            expect(Math.abs(each.width - 48)).toBeLessThanOrEqual(0.5);
            expect(each.inkWidth).not.toBeNull();
            expect(Math.abs((each.inkWidth ?? 0) - 8.5)).toBeLessThanOrEqual(1);
            expect(
              Math.abs((each.inkLeft ?? 0) - (each.left + 1)),
            ).toBeLessThanOrEqual(1);
          }
          for (const each of shown) {
            for (const offset of each.offsets) {
              expect(Math.abs(offset)).toBeLessThanOrEqual(0.25);
            }
          }
        } finally {
          await browser.execute(() => {
            const sheet: unknown = Reflect.get(window, "inklineTestSnippet");
            document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
              (adopted) => adopted !== sheet,
            );
          });
        }
      });
    });
  }
});
