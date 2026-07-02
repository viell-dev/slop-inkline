import { DEFAULT_CAP_HEIGHT_RATIO } from "../constants";

let capRatioCache: number | null = null;

/**
 * Cap height of the default text font as a fraction of the em, measured once
 * and cached. Falls back to the nominal ratio when measurement fails.
 */
export function capHeightRatio(): number {
  if (capRatioCache === null) {
    capRatioCache = measureCapHeightRatio();
  }

  return capRatioCache;
}

/**
 * Drop the measured cap-height ratio so the next layout computation
 * re-measures the current text font. Call on the workspace `css-change`
 * event: a theme or font change alters `--font-text`, and the stale ratio
 * would otherwise keep misaligning inks until app restart.
 */
export function invalidateCapHeightCache(): void {
  capRatioCache = null;
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
  return Number.isFinite(ratio) && ratio > 0.3 && ratio < 1
    ? ratio
    : DEFAULT_CAP_HEIGHT_RATIO;
}
