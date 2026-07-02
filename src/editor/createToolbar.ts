import { ButtonComponent } from "obsidian";
import { BRUSH_SIZES } from "../constants";
import { createZoomControls } from "./createZoomControls";
import type { ZoomControls } from "./createZoomControls";
import type { InkTool } from "./inkTool";

/** The editor actions the toolbar buttons dispatch to. */
export interface ToolbarHandlers {
  /**
   * Switch the active tool.
   *
   * @param tool - The tool to activate.
   */
  onSelectTool(tool: InkTool): void;
  /** Undo the last drawing change. */
  onUndo(): void;
  /** Redo the last undone drawing change. */
  onRedo(): void;
  /** Wipe the drawing surface (undoable). */
  onClear(): void;
  /**
   * Select a brush by its inline size.
   *
   * @param inlinePx - The brush's inline size, in CSS pixels.
   */
  onSelectBrush(inlinePx: number): void;
  /**
   * Step the zoom level.
   *
   * @param direction - -1 to zoom out, 1 to zoom in.
   */
  onStepZoom(direction: -1 | 1): void;
  /** Toggle whether the guides stay always visible. */
  onTogglePin(): void;
  /** Save the drawing and close the modal. */
  onSaveAndClose(): void;
}

/** The button references the editor needs to reflect state changes. */
export interface Toolbar {
  /** The pen/eraser buttons, keyed by tool, for active-state styling. */
  toolButtons: Map<InkTool, ButtonComponent>;
  /** The brush buttons, keyed by inline size, for active-state styling. */
  sizeButtons: Map<number, ButtonComponent>;
  /** The zoom widget's update surface. */
  zoom: ZoomControls;
  /** The pin-guides button, for active-state styling. */
  pinButton: ButtonComponent;
}

/**
 * Create the editor toolbar: a tools row (pen, eraser, undo, redo, clear),
 * a size row (brush buttons and zoom controls), and an actions row (pin
 * guides, save and close).
 *
 * @param parent - The modal content element the toolbar is appended to.
 * @param handlers - The actions the buttons dispatch to.
 * @returns The button references for reflecting state changes.
 */
export function createToolbar(
  parent: HTMLElement,
  handlers: ToolbarHandlers,
): Toolbar {
  const toolbarEl = parent.createDiv({ cls: "inkline-editor-toolbar" });

  const toolsRowEl = toolbarEl.createDiv({ cls: "inkline-toolbar-row" });
  const toolButtons = new Map<InkTool, ButtonComponent>([
    ["pen", createToolButton(toolsRowEl, "Pen", "pen", handlers)],
    ["eraser", createToolButton(toolsRowEl, "Eraser", "eraser", handlers)],
  ]);

  new ButtonComponent(toolsRowEl)
    .setButtonText("Undo")
    .onClick(() => handlers.onUndo());

  new ButtonComponent(toolsRowEl)
    .setButtonText("Redo")
    .onClick(() => handlers.onRedo());

  new ButtonComponent(toolsRowEl)
    .setButtonText("Clear")
    .onClick(() => handlers.onClear());

  const sizeRowEl = toolbarEl.createDiv({ cls: "inkline-toolbar-row" });
  sizeRowEl.createSpan({ text: "Size" });
  const sizeButtons = new Map<number, ButtonComponent>();
  for (const brush of BRUSH_SIZES) {
    const button = new ButtonComponent(sizeRowEl)
      .setButtonText(brush.label)
      .setTooltip(`Brush size ${brush.label} (~${brush.inlinePx}px inline)`)
      .onClick(() => handlers.onSelectBrush(brush.inlinePx));
    sizeButtons.set(brush.inlinePx, button);
  }
  const zoom = createZoomControls(sizeRowEl, handlers.onStepZoom);

  const actionsRowEl = toolbarEl.createDiv({ cls: "inkline-toolbar-row" });
  const pinButton = new ButtonComponent(actionsRowEl)
    .setButtonText("Pin guides")
    .setTooltip("Keep the crop and baseline guides always visible")
    .onClick(() => handlers.onTogglePin());

  new ButtonComponent(actionsRowEl)
    .setButtonText("Save and Close")
    .setCta()
    .onClick(() => handlers.onSaveAndClose());

  return { toolButtons, sizeButtons, zoom, pinButton };
}

/**
 * Create one tool-selection button.
 *
 * @param parentEl - The toolbar row the button is appended to.
 * @param label - The button text.
 * @param tool - The tool the button selects.
 * @param handlers - The toolbar handlers to dispatch the selection to.
 * @returns The created button.
 */
function createToolButton(
  parentEl: HTMLElement,
  label: string,
  tool: InkTool,
  handlers: ToolbarHandlers,
): ButtonComponent {
  return new ButtonComponent(parentEl)
    .setButtonText(label)
    .onClick(() => handlers.onSelectTool(tool));
}
