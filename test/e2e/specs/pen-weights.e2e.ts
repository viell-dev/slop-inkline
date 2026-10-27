import { browser, expect } from "@wdio/globals";
import { brushSizes } from "../../../src/editor/session.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  openAtMarker,
  startOver,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** Stems of a font's regular and bold weights, in pixels at 128 px an em. */
interface Stems {
  readonly family: string;
  /** Whether the host has the font, rather than drawing another for it. */
  readonly installed: boolean;
  readonly regular: number;
  readonly bold: number;
}

/**
 * The stems of the editor's text font and of two others, each the median of
 * the vertical stems of l, I, H and n at 128 px, as the coverage across a row
 * through them. Bold is the weight Obsidian gives bold text in notes.
 */
async function fontStems(): Promise<Stems[]> {
  return browser.execute(() => {
    const line = activeDocument.querySelector(".inkline-preview");
    if (!(line instanceof HTMLElement)) throw new Error("no preview line");
    const strong = line.createEl("strong", { text: "X" });
    const boldWeight = getComputedStyle(strong).fontWeight;
    strong.remove();
    const em = 128;
    const canvas = new OffscreenCanvas(em * 2, em * 2);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no context");
    const widthIn = (font: string) => {
      context.font = `${String(em)}px ${font}`;
      return context.measureText("mmmmmmmmmmlli").width;
    };
    const stem = (family: string, weight: string) => {
      const widths = [];
      for (const [glyph, along] of [
        ["l", 0.5],
        ["I", 0.5],
        ["H", 0.3],
        ["n", 0.6],
      ] as const) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.font = `${weight} ${String(em)}px ${family}`;
        const metrics = context.measureText(glyph);
        const baseline = em * 1.5;
        context.fillText(glyph, em / 2, baseline);
        const top = baseline - metrics.actualBoundingBoxAscent;
        const y = Math.round(top + metrics.actualBoundingBoxAscent * along);
        const row = context.getImageData(0, y, canvas.width, 1).data;
        let covered = 0;
        let stems = 0;
        let inside = false;
        for (let x = 0; x < canvas.width; x++) {
          const alpha = row[x * 4 + 3] ?? 0;
          covered += alpha / 255;
          if (alpha > 127 && !inside) stems++;
          inside = alpha > 127;
        }
        widths.push(covered / Math.max(1, stems));
      }
      widths.sort((a, b) => a - b);
      return ((widths[1] ?? 0) + (widths[2] ?? 0)) / 2;
    };
    const editorFont = getComputedStyle(line).fontFamily;
    return [editorFont, '"DejaVu Sans"', '"Noto Serif"'].map((family) => ({
      family,
      // A named font the host lacks falls back to monospace here.
      installed:
        family === editorFont ||
        widthIn(`${family}, monospace`) !== widthIn("monospace"),
      regular: stem(family, "400"),
      bold: stem(family, boldWeight),
    }));
  });
}

/**
 * The runs of ink across row `y`, or down column `x`, of the saved symbol
 * `001.ink.png`: where each starts, and its coverage, in pixels.
 */
async function savedRuns(
  line: { y: number } | { x: number } | "middle row",
): Promise<{ start: number; width: number }[]> {
  return browser.executeObsidian(async ({ app }, at) => {
    const file = app.vault.getFileByPath("001.ink.png");
    if (file === null) throw new Error("no saved ink");
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    const { canvas } = window.inklineTest;
    const bitmap = await canvas.decodePng(bytes);
    const pixels = canvas.readPixels(bitmap);
    bitmap.close();
    const across = at === "middle row" || "y" in at;
    const fixed =
      at === "middle row"
        ? Math.floor(pixels.height / 2)
        : "y" in at
          ? at.y
          : at.x;
    const length = across ? pixels.width : pixels.height;
    const runs = [];
    let run: { start: number; width: number } | undefined;
    for (let along = 0; along < length; along++) {
      const index = across
        ? fixed * pixels.width + along
        : along * pixels.width + fixed;
      const alpha = pixels.data[index * 4 + 3] ?? 0;
      if (alpha === 0) {
        run = undefined;
        continue;
      }
      if (run === undefined) {
        run = { start: along, width: 0 };
        runs.push(run);
      }
      run.width += alpha / 255;
    }
    return runs;
  }, line);
}

/**
 * The coverage of each run of ink across a row of what `selector` shows on
 * the screen, from a screenshot of it: the row `along` its ink's height, in
 * screen pixels, against the element's text colour on its background.
 */
async function shownRuns(selector: string, along: number): Promise<number[]> {
  const element = await browser.$(selector).getElement();
  const shot = await browser.takeElementScreenshot(element.elementId);
  return browser.execute(
    async (png, wanted, at) => {
      const node = activeDocument.evaluate(
        wanted,
        activeDocument,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      ).singleNodeValue;
      if (!(node instanceof Element)) throw new Error(`no ${wanted}`);
      const probe = new OffscreenCanvas(1, 1).getContext("2d");
      if (probe === null) throw new Error("no 2D context");
      probe.fillStyle = getComputedStyle(node).color;
      probe.fillRect(0, 0, 1, 1);
      const ink = probe.getImageData(0, 0, 1, 1).data;
      const lightness = (data: Uint8ClampedArray, at: number) =>
        0.2126 * (data[at] ?? 0) +
        0.7152 * (data[at + 1] ?? 0) +
        0.0722 * (data[at + 2] ?? 0);
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const { width, height, data } =
        window.inklineTest.canvas.readPixels(bitmap);
      bitmap.close();
      const ground = lightness(data, 0);
      const full = ground - lightness(ink, 0);
      const cover = (x: number, y: number) =>
        Math.max(
          0,
          Math.min(1, (ground - lightness(data, (y * width + x) * 4)) / full),
        );
      let top = height;
      let bottom = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (cover(x, y) > 0.5) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      }
      const y = Math.round(top + (bottom - top) * at);
      const runs: number[] = [];
      let inside = false;
      for (let x = 0; x < width; x++) {
        const covered = cover(x, y);
        if (covered > 0.02) {
          if (!inside) runs.push(0);
          runs[runs.length - 1] = (runs.at(-1) ?? 0) + covered;
        }
        inside = covered > 0.02;
      }
      return runs;
    },
    shot,
    selector,
    along,
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** Opens an editor for a new symbol in Editor.md. */
async function openEditor(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
}

/** Saves the symbol being drawn and waits for the editor to close. */
async function save(): Promise<void> {
  await browser.keys(["Control", "Enter"]);
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

describe("Brush sizes beside text", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
  });

  it("draws M about as heavy as regular text, L near bold, S finer and XL heavier", async function () {
    await openEditor();
    const fonts = await fontStems();
    // One upright stroke a size, with the mouse, so with no pressure.
    for (const [index] of brushSizes.entries()) {
      await browser.keys(String(index + 1));
      const x = 0.2 + index * 0.15;
      await draw([
        [x, 0.3],
        [x, 0.5],
        [x, 0.7],
      ]);
    }
    await saveScreenshot("pen-weights");
    await save();
    const runs = await savedRuns("middle row");
    const widths = runs.map((run) => run.width);
    console.log("Brush widths", JSON.stringify({ widths, fonts }));
    expect(widths).toHaveLength(brushSizes.length);
    // A stroke without pressure is as wide as its size, in document pixels.
    brushSizes.forEach((size, index) => {
      expect(Math.abs((widths[index] ?? 0) - size.em * 128)).toBeLessThan(0.5);
    });
    const [s = 0, m = 0, l = 0, xl = 0] = widths;
    // The editor's own font, and the others only where the host has them.
    for (const { regular, bold } of fonts.filter((font) => font.installed)) {
      // S about half the weight of text, for fine detail.
      expect(s).toBeLessThanOrEqual(regular * 0.6);
      // M within 15% of regular text's stems.
      expect(Math.abs(m - regular)).toBeLessThanOrEqual(regular * 0.15);
      // L well above regular, and no more than a little above bold.
      expect(l).toBeGreaterThanOrEqual(regular * 1.3);
      expect(l).toBeLessThanOrEqual(bold * 1.1);
      // XL at least about as heavy as bold.
      expect(xl).toBeGreaterThanOrEqual(bold * 0.95);
    }
  });

  it("shows M in a note about as heavy as the text beside it, in both themes", async function () {
    // Each preset as eight strokes, 64 document pixels apart, eight screen
    // pixels at a 16 px font, plus one more document pixel for each, so that
    // their mean covers every position a stroke can take against the screen's
    // pixels.
    const phases = 8;
    const sizes = brushSizes.map((size) => size.em * 128 * 16);
    await browser.executeObsidian(
      async ({ app }, units, count) => {
        const strokes = units.flatMap((size, preset) =>
          Array.from({ length: count }, (_, phase) => {
            const x = 800 + (preset * count + phase) * 1024 + phase * 16;
            return {
              tool: "pen" as const,
              size,
              pressure: false,
              points: [x, 800, x, 2000],
            };
          }),
        );
        const { bytes } = await window.inklineTest.canvas.saveInk(
          { strokes },
          undefined,
          [],
        );
        await app.vault.createBinary("weights.ink.png", bytes.slice().buffer);
        const note = await app.vault.create(
          "Weights.md",
          "llllllllllll\n\nnnnnnnnnnnnn\n\nx ![[weights.ink.png]] x\n",
        );
        await app.workspace
          .getLeaf(true)
          .openFile(note, { state: { mode: "preview" } });
      },
      sizes,
      phases,
    );
    const view = "//div[contains(@class, 'markdown-reading-view')]";
    const symbol = `${view}//img[contains(@class, 'inkline-symbol')]`;
    await browser.$(symbol).waitForDisplayed();
    // Away from the symbol, whose label shows a tooltip on hover.
    await browser
      .action("pointer")
      .move({ x: 1, y: 1, origin: "viewport" })
      .perform();
    const original = await browser.execute(() =>
      [...document.body.classList].filter(
        (name) => name === "theme-light" || name === "theme-dark",
      ),
    );
    try {
      for (const theme of ["theme-light", "theme-dark"]) {
        await browser.execute((name) => {
          document.body.classList.remove("theme-light", "theme-dark");
          document.body.classList.add(name);
        }, theme);
        // Every stroke drawn, in this theme's colour: the same twice running,
        // so that no frame of the change of theme is measured.
        let strokes: number[] = [];
        await browser.waitUntil(async () => {
          const before = strokes;
          strokes = await shownRuns(symbol, 0.5);
          return (
            strokes.length === sizes.length * phases &&
            strokes.join() === before.join()
          );
        });
        await saveScreenshot(`pen-weights-reading-${theme}`);
        const text = [
          ...(await shownRuns(
            `${view}//p[normalize-space(.)='llllllllllll']`,
            0.6,
          )),
          ...(await shownRuns(
            `${view}//p[normalize-space(.)='nnnnnnnnnnnn']`,
            0.75,
          )),
        ];
        const shown = sizes.map(
          (_, preset) =>
            strokes
              .slice(preset * phases, (preset + 1) * phases)
              .reduce((sum, width) => sum + width, 0) / phases,
        );
        console.log("Shown weights", JSON.stringify({ theme, text, shown }));
        const stem = median(text);
        const [s = 0, m = 0, l = 0, xl = 0] = shown;
        expect(s).toBeLessThan(stem * 0.75);
        expect(Math.abs(m - stem)).toBeLessThanOrEqual(stem * 0.2);
        expect(l).toBeGreaterThanOrEqual(stem * 1.3);
        expect(xl).toBeGreaterThan(l);
      }
    } finally {
      await browser.execute((themes) => {
        document.body.classList.remove("theme-light", "theme-dark");
        document.body.classList.add(...themes);
      }, original);
    }
  });

  it("keeps strokes of M a grid spacing apart distinct, for dense symbols", async function () {
    await openEditor();
    await browser.keys("2");
    // Five level strokes, 16 document pixels apart in a line box 192 tall.
    for (let line = 0; line < 5; line++) {
      const y = (48 + line * 16) / 192;
      await draw([
        [0.3, y],
        [0.5, y],
        [0.7, y],
      ]);
    }
    await save();
    const width = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no saved ink");
      const bitmap = await window.inklineTest.canvas.decodePng(
        new Uint8Array(await app.vault.readBinary(file)),
      );
      const { width } = bitmap;
      bitmap.close();
      return width;
    });
    const runs = await savedRuns({ x: Math.floor(width / 2) });
    console.log("Dense strokes", JSON.stringify(runs));
    expect(runs).toHaveLength(5);
  });
});
