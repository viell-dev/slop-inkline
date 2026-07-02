import { ButtonComponent } from "obsidian";
import { MAX_ZOOM, MIN_ZOOM } from "../constants";

export interface ZoomControls {
  /** Reflect a new zoom level in the label and button disabled states. */
  update(level: number): void;
}

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
