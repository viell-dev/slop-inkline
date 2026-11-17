// The grid's dots, read from the drawing area's pixels.

import { browser } from "@wdio/globals";
import { settledSurface } from "./editor.ts";

/**
 * The grid the drawing area shows, read from its pixels while the guides are
 * hidden, so that only its dots are there, in the right fifth for its rows and
 * the bottom fifth for its columns, which the ink in these tests keeps clear
 * of: the middles of their rows and columns, from the surface's edges, and the
 * font's lines from an independent `measureText` of the preview line's font,
 * all in document pixels, with how many device pixels make one and how many
 * document pixels the surface shows across.
 */
export interface DotsShown {
  readonly rows: number[];
  readonly columns: number[];
  readonly lines: Record<string, number>;
  readonly factor: number;
  readonly across: number;
}

export async function dotsShown(): Promise<DotsShown> {
  return browser.execute(() => {
    const doc = activeDocument;
    const view = doc.defaultView;
    if (view === null) throw new Error("no window");
    const canvas = doc.querySelector(".inkline-editor .inkline-surface");
    const line = doc.querySelector(".inkline-editor .inkline-preview");
    if (
      canvas?.instanceOf(HTMLCanvasElement) !== true ||
      line?.instanceOf(HTMLElement) !== true
    ) {
      throw new Error("no surface");
    }
    const font = view.getComputedStyle(line);
    const probe = new view.OffscreenCanvas(1, 1).getContext("2d");
    if (probe === null) throw new Error("no context");
    probe.font = `${font.fontStyle} ${font.fontWeight} 128px ${font.fontFamily}`;
    const capital = probe.measureText("H");
    const lowercase = probe.measureText("x");
    const lines = Object.fromEntries(
      (
        [
          ["ascender", 144 - capital.fontBoundingBoxAscent],
          ["cap height", 144 - capital.actualBoundingBoxAscent],
          ["x-height", 144 - lowercase.actualBoundingBoxAscent],
          ["baseline", 144],
          ["descender", 144 + capital.fontBoundingBoxDescent],
        ] as const
      ).filter(([, y]) => y >= 0 && y <= 192),
    );
    // The line box is as tall as the surface, in either view.
    const across =
      (canvas.clientWidth * 192) /
      Number.parseFloat(
        canvas.style.getPropertyValue("--inkline-surface-height"),
      );
    const factor = canvas.width / across;
    const { width, height } = canvas;
    const pixels = canvas.getContext("2d")?.getImageData(0, 0, width, height);
    if (pixels === undefined) throw new Error("no pixels");
    const inkedRows = new Array<boolean>(height).fill(false);
    const inkedColumns = new Array<boolean>(width).fill(false);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((pixels.data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
        if (x >= width * 0.8) inkedRows[y] = true;
        if (y >= height * 0.8) inkedColumns[x] = true;
      }
    }
    /** The middle of each run of inked pixels, in document pixels. */
    const middles = (inked: readonly boolean[]): number[] => {
      const found: number[] = [];
      let start = -1;
      for (let index = 0; index <= inked.length; index++) {
        if (inked[index] === true) {
          if (start < 0) start = index;
        } else if (start >= 0) {
          found.push((start + index) / 2 / factor);
          start = -1;
        }
      }
      return found;
    };
    return {
      rows: middles(inkedRows),
      columns: middles(inkedColumns),
      lines,
      factor,
      across,
    };
  });
}

/** The grid shown, once it stops changing. */
export async function settledDots(): Promise<DotsShown> {
  await settledSurface();
  let shown: DotsShown | undefined;
  await browser.waitUntil(async () => {
    const previous = shown;
    shown = await dotsShown();
    return (
      shown.rows.length > 2 &&
      JSON.stringify([shown.rows, shown.columns]) ===
        JSON.stringify([previous?.rows, previous?.columns])
    );
  });
  if (shown === undefined) throw new Error("no dots");
  return shown;
}
