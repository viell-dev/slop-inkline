import type { KeymapEventListener, Scope } from "obsidian";
import { BRUSH_SIZES } from "../constants";

export interface EditorShortcutHandlers {
  /** True while the name input has focus; shortcuts yield then. */
  isTextEditing(): boolean;
  undo(): void;
  redo(): void;
  toggleTool(): void;
  stepBrush(direction: -1 | 1): void;
  selectBrush(inlinePx: number): void;
}

/**
 * Editor shortcuts on the modal's own scope, so they only live while the
 * modal is open and never become global hotkeys. Every handler yields while
 * the name input has focus: native text editing (including the input's own
 * Ctrl+Z) must win, and typing digits or letters must not switch tools.
 * Enter in the name field keeps its own listener and is not registered here.
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
