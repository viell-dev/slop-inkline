import { WIDTH_STEPS } from "../constants";
import type { WidthStep } from "../ink/widthStep";

export interface CropGuides {
  /** Emphasize the line pair for `step` and move the corner crop-marks. */
  update(step: WidthStep): void;
}

/**
 * Red dashed cut lines at every width-step boundary (the 1.0 pair sits on
 * the canvas edges), with the pair for the currently detected step
 * emphasized and following the drawing live. Corner crop-marks just outside
 * the canvas track the detected step too (their inner edge is the cut
 * line); hovering a mark reveals all lines, and the pin toggle keeps them
 * visible. These are DOM only and never touch the exported PNG.
 */
export function createCropGuides(stageEl: HTMLElement): CropGuides {
  const guidesEl = stageEl.createDiv({ cls: "inkline-crop-guides" });

  for (const corner of ["tl", "tr", "bl", "br"]) {
    guidesEl.createDiv({ cls: `inkline-crop-mark inkline-crop-mark-${corner}` });
  }

  const cropLinesByStep = new Map<WidthStep, HTMLElement[]>();
  for (const step of WIDTH_STEPS) {
    const leftPercent = ((1 - step) / 2) * 100;
    const lines: HTMLElement[] = [];
    for (const linePercent of [leftPercent, 100 - leftPercent]) {
      const lineEl = guidesEl.createDiv({ cls: "inkline-crop-line" });
      lineEl.style.left = `${linePercent}%`;
      lines.push(lineEl);
    }
    cropLinesByStep.set(step, lines);
  }

  const update = (step: WidthStep): void => {
    const leftPercent = ((1 - step) / 2) * 100;
    guidesEl.style.setProperty("--inkline-crop-left", `${leftPercent}%`);
    guidesEl.style.setProperty("--inkline-crop-right", `${100 - leftPercent}%`);

    for (const [lineStep, lines] of cropLinesByStep) {
      for (const lineEl of lines) {
        lineEl.toggleClass("inkline-crop-line-active", lineStep === step);
      }
    }
  };

  update(WIDTH_STEPS[0]);
  return { update };
}
