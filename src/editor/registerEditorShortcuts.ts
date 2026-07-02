import type { KeymapEventListener, Scope } from "obsidian";
import { BRUSH_SIZES } from "../constants";

/** The editor actions the keyboard shortcuts dispatch to. */
export interface EditorShortcutHandlers {
  /**
   * Whether text editing has focus (the name input); shortcuts yield then.
   *
   * @returns True while the name input has focus.
   */
  isTextEditing(): boolean;
  /** Undo the last drawing change. */
  undo(): void;
  /** Redo the last undone drawing change. */
  redo(): void;
  /** Switch between pen and eraser. */
  toggleTool(): void;
  /**
   * Step to the previous/next brush size.
   *
   * @param direction - -1 for smaller, 1 for larger.
   */
  stepBrush(direction: -1 | 1): void;
  /**
   * Select a brush by its inline size.
   *
   * @param inlinePx - The brush's inline size, in CSS pixels.
   */
  selectBrush(inlinePx: number): void;
}

/**
 * Register the editor shortcuts: Mod+Z/Mod+Shift+Z/Mod+Y for undo/redo,
 * E to toggle the tool, [ and ] to step the brush, and 1–4 to select a
 * brush directly.
 *
 * @remarks
 * Registered on the modal's own scope, so they only live while the modal
 * is open and never become global hotkeys. Every handler yields while the
 * name input has focus: native text editing (including the input's own
 * Ctrl+Z) must win, and typing digits or letters must not switch tools.
 * Enter in the name field keeps its own listener and is not registered
 * here.
 *
 * @param scope - The modal's keymap scope.
 * @param handlers - The actions the shortcuts dispatch to.
 */
export function registerEditorShortcuts(
  scope: Scope,
  handlers: EditorShortcutHandlers,
): void {
  const shortcut = (action: () => void): KeymapEventListener => {
    return () => {
      if (handlers.isTextEditing()) {
        return;
      }

      action();
      return false;
    };
  };

  scope.register(["Mod"], "Z", shortcut(() => handlers.undo()));
  scope.register(["Mod", "Shift"], "Z", shortcut(() => handlers.redo()));
  scope.register(["Mod"], "Y", shortcut(() => handlers.redo()));
  scope.register([], "E", shortcut(() => handlers.toggleTool()));
  scope.register([], "[", shortcut(() => handlers.stepBrush(-1)));
  scope.register([], "]", shortcut(() => handlers.stepBrush(1)));
  BRUSH_SIZES.forEach((brush, index) => {
    scope.register(
      [],
      `${index + 1}`,
      shortcut(() => handlers.selectBrush(brush.inlinePx)),
    );
  });
}
