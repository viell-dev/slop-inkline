import { IMAGE_SIZE } from "./ink-file";

// Cap height as a fraction of the text em. Measured from the default text font
// once; falls back to a nominal value. Custom-font alignment is out of scope.
const DEFAULT_CAP_HEIGHT_RATIO = 0.7;
const DEFAULT_DISPLAY_HEIGHT_EM = 1.5;

let capRatioCache: number | null = null;

export interface InkLineLayout {
  // Canvas-pixel positions (0..IMAGE_SIZE) of the cap-line and baseline.
  capLineY: number;
  baselineY: number;
  // Inline vertical-align (em, negative) that centers the cap band on the line.
  verticalAlignEm: number;
}

export function parseDisplayHeightEm(displayHeight: string): number {
  const trimmed = displayHeight.trim();
  if (trimmed.endsWith("em")) {
    const value = Number.parseFloat(trimmed);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return DEFAULT_DISPLAY_HEIGHT_EM;
}

/**
 * Center a capital-height band vertically on the text line: the cap band sits in
 * the middle of the square, so the leftover leading splits evenly into an
 * ascender/diacritic region above and a descender region below the baseline.
 */
export function computeInkLineLayout(displayHeightEm: number): InkLineLayout {
  const cap = capHeightRatio();
  const halfBand = cap / 2 / displayHeightEm;
  const capFraction = Math.max(0, 0.5 - halfBand);
  const baseFraction = Math.min(1, 0.5 + halfBand);

  return {
    capLineY: capFraction * IMAGE_SIZE,
    baselineY: baseFraction * IMAGE_SIZE,
    verticalAlignEm: -(displayHeightEm - cap) / 2,
  };
}

function capHeightRatio(): number {
  if (capRatioCache === null) {
    capRatioCache = measureCapHeightRatio();
  }

  return capRatioCache;
}

function measureCapHeightRatio(): number {
  const probe = document.createElement("span");
  probe.style.fontFamily = "var(--font-text)";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const family = getComputedStyle(probe).fontFamily || "sans-serif";
  probe.remove();

  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) {
    return DEFAULT_CAP_HEIGHT_RATIO;
  }

  const fontSize = 100;
  ctx.font = `${fontSize}px ${family}`;
  const ratio = ctx.measureText("H").actualBoundingBoxAscent / fontSize;
  return Number.isFinite(ratio) && ratio > 0.3 && ratio < 1 ? ratio : DEFAULT_CAP_HEIGHT_RATIO;
}
