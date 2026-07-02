import { ButtonComponent } from "obsidian";
import { MAX_ZOOM, MIN_ZOOM } from "../constants";

/** The zoom widget's surface for reflecting state changes. */
export interface ZoomControls {
  /**
   * Reflect a new zoom level in the label and button disabled states.
   *
   * @param level - The current zoom level.
   */
  update(level: number): void;
}

/**
 * Create the zoom widget: a label, a level readout, and -/+ step buttons.
 *
 * @param parent - The toolbar row the widget is appended to.
 * @param onStep - Called with -1/+1 when a step button is clicked.
 * @returns The widget's update surface.
 */
export function createZoomControls(
  parent: HTMLElement,
  onStep: (direction: -1 | 1) => void,
): ZoomControls {
  parent.createSpan({ text: "Zoom" });
  const zoomOutButton = new ButtonComponent(parent)
    .setButtonText("-")
    .setTooltip("Zoom out")
    .onClick(() => onStep(-1));
  const zoomLevelEl = parent.createSpan({ cls: "inkline-zoom-level" });
  const zoomInButton = new ButtonComponent(parent)
    .setButtonText("+")
    .setTooltip("Zoom in")
    .onClick(() => onStep(1));

  return {
    update(level) {
      zoomLevelEl.setText(`${level}x`);
      zoomOutButton.setDisabled(level <= MIN_ZOOM);
      zoomInButton.setDisabled(level >= MAX_ZOOM);
    },
  };
}
