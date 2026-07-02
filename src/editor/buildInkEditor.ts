import { Notice } from "obsidian";
import type { Modal, TFile } from "obsidian";
import {
  BRUSH_SIZES,
  DEFAULT_BRUSH_INLINE_PX,
  DEFAULT_DISPLAY_HEIGHT_EM,
  DEFAULT_ZOOM,
  IMAGE_SIZE,
} from "../constants";
import { capHeightRatio } from "../layout/capHeightRatio";
import { computeInkLineLayout } from "../layout/computeInkLineLayout";
import { parseDisplayHeightEm } from "../layout/parseDisplayHeightEm";
import { getInkDisplayName } from "../inkFiles/getInkDisplayName";
import { clampImageSize } from "../ink/clampImageSize";
import type { WidthStep } from "../ink/widthStep";
import { applyBrushCursor } from "./applyBrushCursor";
import { attachStrokeHandlers } from "./attachStrokeHandlers";
import { blockBackdropClose } from "./blockBackdropClose";
import { clampZoom } from "./clampZoom";
import { createBaselineGuides } from "./createBaselineGuides";
import { createCropGuides } from "./createCropGuides";
import { createHistory } from "./createHistory";
import { createNameField } from "./createNameField";
import { createToolbar } from "./createToolbar";
import { currentWidthStep } from "./currentWidthStep";
import type { InkEditorOptions } from "./inkEditorOptions";
import type { InkTool } from "./inkTool";
import { initializeInkSurface } from "./initializeInkSurface";
import { loadInkIntoCanvas } from "./loadInkIntoCanvas";
import { registerEditorShortcuts } from "./registerEditorShortcuts";
import { saveInk } from "./saveInk";

/**
 * Assemble the ink editor inside an opened modal: build the DOM through the
 * element creators, initialize the drawing surface, and wire every piece
 * together with the small closures below that own the editor state.
 */
export function buildInkEditor(
  modal: Modal,
  initialFile: TFile | null,
  options: InkEditorOptions,
): void {
  const { app, contentEl } = modal;

  let file = initialFile;
  let tool: InkTool = "pen";
  let brushInlinePx: number = DEFAULT_BRUSH_INLINE_PX;
  let zoomLevel = DEFAULT_ZOOM;
  // The file's own resolution replaces this once the image has loaded; the
  // configured size only applies to newly created inks.
  let exportSize = clampImageSize(
    initialFile ? IMAGE_SIZE : options.newInk?.imageSize ?? IMAGE_SIZE,
  );
  let loadedStep: WidthStep | null = null;
  let contentModified = false;
  let guidesPinned = options.pinGuides ?? false;

  modal.modalEl.addClass("inkline-editor-modal-frame");
  contentEl.empty();
  contentEl.addClass("inkline-editor-modal");

  const nameInputEl = createNameField(contentEl, displayName(), () => {
    void save();
  });

  const toolbar = createToolbar(contentEl, {
    onSelectTool: setTool,
    onUndo: () => history.undo(),
    onRedo: () => history.redo(),
    onClear: clear,
    onSelectBrush: setBrush,
    onStepZoom: (direction) => setZoom(zoomLevel + direction),
    onTogglePin: () => {
      void togglePinGuides();
    },
    onSaveAndClose: () => {
      void saveAndClose();
    },
  });

  blockBackdropClose(modal, hasUnsavedChanges);

  const canvasWrapEl = contentEl.createDiv({ cls: "inkline-canvas-wrap" });
  const stageEl = canvasWrapEl.createDiv({ cls: "inkline-canvas-stage" });
  const canvasEl = stageEl.createEl("canvas", {
    cls: "inkline-editor-canvas",
  });
  const ctx = initializeInkSurface(canvasEl);
  const cropGuides = createCropGuides(stageEl);
  createBaselineGuides(
    stageEl,
    computeInkLineLayout(
      parseDisplayHeightEm(
        options.displayHeight ?? `${DEFAULT_DISPLAY_HEIGHT_EM}em`,
      ),
      capHeightRatio(),
    ),
  );

  const history = createHistory({
    canvasEl,
    ctx,
    onRestore: () => {
      contentModified = true;
      refreshWidthStep();
    },
  });

  attachStrokeHandlers({
    canvasEl,
    ctx,
    history,
    getTool: () => tool,
    getBrushInlinePx: () => brushInlinePx,
    onInkChanged: () => {
      contentModified = true;
    },
    onStrokeEnd: refreshWidthStep,
  });

  registerEditorShortcuts(modal.scope, {
    isTextEditing: () =>
      nameInputEl.ownerDocument.activeElement === nameInputEl,
    undo: () => history.undo(),
    redo: () => history.redo(),
    toggleTool: () => setTool(tool === "pen" ? "eraser" : "pen"),
    stepBrush,
    selectBrush: setBrush,
  });

  updateToolState();
  updateSizeState();
  toolbar.zoom.update(zoomLevel);
  applyGuidePinState();
  applyDisplaySize();
  applyCursor();
  refreshWidthStep();

  if (initialFile) {
    const target = initialFile;
    // Through the history queue so strokes are blocked until the image has
    // landed on the surface (see attachStrokeHandlers).
    history.run(async () => {
      await loadInkIntoCanvas(
        {
          app,
          ctx,
          onExportSize: (size) => {
            exportSize = size;
            applyDisplaySize();
            applyCursor();
          },
          onLoadedStep: (step) => {
            loadedStep = step;
          },
        },
        target,
      );
      refreshWidthStep();
    });
  }

  function displayName(): string {
    return file ? getInkDisplayName(file) : options.newInk?.name ?? "";
  }

  function setTool(next: InkTool): void {
    tool = next;
    updateToolState();
    applyCursor();
  }

  function setBrush(inlinePx: number): void {
    brushInlinePx = inlinePx;
    updateSizeState();
    applyCursor();
  }

  function stepBrush(direction: -1 | 1): void {
    const index = BRUSH_SIZES.findIndex(
      (brush) => brush.inlinePx === brushInlinePx,
    );
    const nextIndex = Math.min(
      Math.max(index + direction, 0),
      BRUSH_SIZES.length - 1,
    );
    setBrush(BRUSH_SIZES[nextIndex].inlinePx);
  }

  function setZoom(level: number): void {
    zoomLevel = clampZoom(level);
    toolbar.zoom.update(zoomLevel);
    applyDisplaySize();
    applyCursor();
  }

  function updateToolState(): void {
    for (const [buttonTool, button] of toolbar.toolButtons) {
      button.buttonEl.toggleClass("inkline-active", buttonTool === tool);
    }
  }

  function updateSizeState(): void {
    for (const [inlinePx, button] of toolbar.sizeButtons) {
      button.buttonEl.toggleClass("inkline-active", inlinePx === brushInlinePx);
    }
  }

  /**
   * CSS display size of the drawing surface: the file's stored export size
   * scaled by the zoom level, so one zoom step is one display pixel per
   * stored pixel. The fixed backing surface never changes; only the
   * on-screen box does. Guide symbols (crop marks, baseline ticks) sit just
   * outside this box at a static size and are not part of it.
   */
  function applyDisplaySize(): void {
    canvasEl.style.width = `${exportSize * zoomLevel}px`;
  }

  function applyCursor(): void {
    applyBrushCursor(canvasEl, tool, brushInlinePx);
  }

  /** Re-detect the export width step and move the crop guides to match. */
  function refreshWidthStep(): void {
    cropGuides.update(currentWidthStep(ctx, { contentModified, loadedStep }));
  }

  function clear(): void {
    history.run(() => {
      history.record();
      contentModified = true;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
      refreshWidthStep();
    });
  }

  async function togglePinGuides(): Promise<void> {
    guidesPinned = !guidesPinned;
    applyGuidePinState();
    await options.onPinGuidesChange?.(guidesPinned);
  }

  function applyGuidePinState(): void {
    stageEl.toggleClass("inkline-guides-pinned", guidesPinned);
    toolbar.pinButton.buttonEl.toggleClass("inkline-active", guidesPinned);
  }

  function hasUnsavedChanges(): boolean {
    return contentModified || nameInputEl.value.trim() !== displayName();
  }

  async function save(): Promise<void> {
    const saved = await saveInk({
      app,
      canvasEl,
      ctx,
      nameInputEl,
      newInk: options.newInk,
      getFile: () => file,
      setFile: (next) => {
        file = next;
      },
      getExportSize: () => exportSize,
      detectStep: () => currentWidthStep(ctx, { contentModified, loadedStep }),
      awaitHistory: () => history.settled(),
      onRename: options.onSave,
    });

    loadedStep = saved.step;
    contentModified = false;
    options.onSave?.(saved.file);
    new Notice(`Saved inline ink: ${saved.file.basename}`);
  }

  async function saveAndClose(): Promise<void> {
    await save();
    modal.close();
  }
}
