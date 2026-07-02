import { IMAGE_SIZE } from "../constants";
import type { InkLineLayout } from "../layout/inkLineLayout";

/**
 * Create the baseline guides: cyan dashed baseline and cap-height lines,
 * with tick marks on the left/right edges as hover targets.
 *
 * @remarks
 * Positions come from the shared layout so they match how the image
 * renders inline. Hovering a tick reveals the lines; the pin toggle keeps
 * them visible. DOM only — the guides never touch the exported PNG.
 *
 * @param stageEl - The canvas stage element the guides overlay.
 * @param layout - The line positions to place the guides at.
 */
export function createBaselineGuides(
  stageEl: HTMLElement,
  layout: InkLineLayout,
): void {
  const guidesEl = stageEl.createDiv({ cls: "inkline-baseline-guides" });
  guidesEl.style.setProperty(
    "--inkline-capline",
    `${(layout.capLineY / IMAGE_SIZE) * 100}%`,
  );
  guidesEl.style.setProperty(
    "--inkline-baseline",
    `${(layout.baselineY / IMAGE_SIZE) * 100}%`,
  );

  for (const side of ["left", "right"]) {
    for (const line of ["cap", "base"]) {
      guidesEl.createDiv({
        cls: `inkline-htick inkline-htick-${side} inkline-htick-${line}`,
      });
    }
  }

  guidesEl.createDiv({ cls: "inkline-hline inkline-hline-cap" });
  guidesEl.createDiv({ cls: "inkline-hline inkline-hline-base" });
}
