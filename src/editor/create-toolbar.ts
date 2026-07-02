import { ButtonComponent } from "obsidian";
import { BRUSH_SIZES } from "../constants";
import { createZoomControls } from "./create-zoom-controls";
import type { ZoomControls } from "./create-zoom-controls";
import type { InkTool } from "./ink-tool";

export interface ToolbarHandlers {
  onSelectTool(tool: InkTool): void;
  onUndo(): void;
  onRedo(): void;
  onClear(): void;
  onSelectBrush(inlinePx: number): void;
  onStepZoom(direction: -1 | 1): void;
  onTogglePin(): void;
  onSaveAndClose(): void;
}

/** The button references the editor needs to reflect state changes. */
export interface Toolbar {
  toolButtons: Map<InkTool, ButtonComponent>;
  sizeButtons: Map<number, ButtonComponent>;
  zoom: ZoomControls;
  pinButton: ButtonComponent;
}

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
