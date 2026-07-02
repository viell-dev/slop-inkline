import { capHeightRatio } from "../layout/cap-height-ratio";
import { computeInkLineLayout } from "../layout/compute-ink-line-layout";
import { parseDisplayHeightEm } from "../layout/parse-display-height-em";
import type { InklineSettings } from "../settings/inkline-settings";

/**
 * Set the display-height and inline vertical-align CSS variables on an
 * element. Used on document roots and on individual embeds so the size CSS
 * keyed on the `.ink.png` src always has values to inherit.
 */
export function applyDisplayVariables(
  el: HTMLElement,
  settings: InklineSettings,
): void {
  const layout = computeInkLineLayout(
    parseDisplayHeightEm(settings.displayHeight),
    capHeightRatio(),
  );

  el.style.setProperty("--inkline-display-height", settings.displayHeight);
  el.style.setProperty("--inkline-valign", `${layout.verticalAlignEm}em`);
}
