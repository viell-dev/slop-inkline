// The editor's controls: its rows of buttons, the picture's bar with the file
// chooser and its hint, the bar that makes ink of the picture, and the keys,
// made from the table of controls in buttons.ts, so that a button and its keys
// run the same command; and Help, the quick start. The controls call only the
// editor's commands, which the modal implements, and show what the modal says
// the buttons show.

import {
  ButtonComponent,
  Modal,
  setIcon,
  type App,
  type Scope,
} from "obsidian";
import { thresholdRange } from "../ink/pixels.ts";
import {
  buttonFace,
  controls,
  keyText,
  quickStart,
  type ButtonLabels,
  type ButtonStates,
  type Control,
  type ControlRow,
  type EditorCommands,
  type PictureKey,
} from "./buttons.ts";
import { keepsArrows, typing } from "./focus.ts";
import type { StatusLine } from "./status.ts";

/** What the editor's controls are given. */
export interface ControlOptions {
  /** What the buttons and keys do. */
  readonly commands: EditorCommands;
  /** The status line, which each action the person takes goes through. */
  readonly line: StatusLine;
  /** Whether the buttons show icons, text, or both. */
  readonly labels: ButtonLabels;
  /** What the editor offers that only some editors do, as a new symbol's. */
  readonly offers: { readonly copyFrom: boolean; readonly next: boolean };
}

/** `record`'s own entry for `id`, and not one it inherits, if it has one. */
function own(
  record: Readonly<Record<string, boolean>>,
  id: string,
): boolean | undefined {
  return Object.hasOwn(record, id) ? record[id] : undefined;
}

/**
 * The editor's buttons, in the rows that {@link controls} puts them in, with
 * the picture's file chooser and hint and Make ink's threshold, and its keys.
 * It holds its elements and nothing else: the modal says what they show,
 * with {@link show}. They go with the modal's content, and the keys with its
 * scope, so there is nothing to dispose of.
 */
export class EditorControls {
  /** The picture's row, which grows a line when its hint wraps. */
  readonly pictureBar: HTMLElement;
  readonly #options: ControlOptions;
  readonly #buttons = new Map<string, ButtonComponent>();
  readonly #chooser: HTMLInputElement;
  readonly #hint: HTMLElement;
  readonly #convertBar: HTMLElement;
  readonly #threshold: HTMLInputElement;

  /** Adds the rows to `parent`, in the order they show. */
  constructor(parent: HTMLElement, options: ControlOptions) {
    this.#options = options;
    const { commands: editor, line } = options;
    // Three rows: what draws; its size and the history; then the view and
    // what ends the editor. Each row wraps by itself in a narrow window.
    const tools = parent.createDiv({ cls: "inkline-toolbar" });
    const history = parent.createDiv({ cls: "inkline-toolbar" });
    const view = parent.createDiv({ cls: "inkline-toolbar" });
    // A picture to trace over, what chooses it, and what moves or removes it.
    const pictureBar = parent.createDiv({ cls: "inkline-picture" });
    // The system's file dialog, which reaches files in the vault and out of
    // it; the picture chosen is traced as a pasted one is.
    const chooser = pictureBar.createEl("input", {
      type: "file",
      attr: { accept: "image/*", tabindex: "-1", "aria-hidden": "true" },
    });
    chooser.hide();
    chooser.addEventListener("change", () => {
      const [file] = chooser.files ?? [];
      // So that choosing the same file again is a change too.
      chooser.value = "";
      if (file !== undefined) editor.trace(file);
      editor.refocus();
    });
    chooser.addEventListener("cancel", () => {
      editor.refocus();
    });
    // What turns the picture into ink, while Make ink is on.
    const convertBar = parent.createDiv({ cls: "inkline-convert" });
    convertBar.hide();
    const threshold = convertBar
      .createEl("label", { text: "Threshold" })
      .createEl("input", {
        type: "range",
        attr: {
          min: String(thresholdRange.min),
          max: String(thresholdRange.max),
          step: "1",
        },
      });
    threshold.addEventListener("input", () => {
      line.act(() => {
        editor.setThreshold(Number(threshold.value));
      });
    });
    const rows: Readonly<Record<ControlRow, HTMLElement>> = {
      tools,
      history,
      view,
      picture: pictureBar,
      convert: convertBar,
    };
    for (const control of controls) {
      if (this.#offers(control)) this.#addButton(rows[control.row], control);
    }
    this.#hint = pictureBar.createSpan({ cls: "inkline-picture-hint" });
    this.pictureBar = pictureBar;
    this.#chooser = chooser;
    this.#convertBar = convertBar;
    this.#threshold = threshold;
  }

  /** Whether the editor offers `control`, as a new symbol's offers Next. */
  #offers(control: Control): boolean {
    return control.needs === undefined || this.#options.offers[control.needs];
  }

  /**
   * Adds `control`'s button, showing its icon, its text, or both, as the
   * settings choose. Obsidian shows a button's `aria-label` as its tooltip,
   * so that one attribute is its name and its tooltip under every choice:
   * its label, which holds the text, then any description, then its first
   * key.
   */
  #addButton(parent: HTMLElement, control: Control): void {
    const { id, text, label = text, description } = control;
    const name = description === undefined ? label : `${label}: ${description}`;
    const [shortcut] = control.keys;
    const button = new ButtonComponent(parent)
      .setTooltip(
        shortcut === undefined ? name : `${name} (${keyText(shortcut)})`,
      )
      .onClick((event) => {
        this.#options.line.act(() => {
          control.run(this.#options.commands, event.shiftKey);
        });
      });
    const face = buttonFace(id, this.#options.labels);
    if (face.icon === undefined) {
      button.setButtonText(text);
    } else {
      button.buttonEl.addClass(
        face.text ? "inkline-with-icon" : "inkline-icon-only",
      );
      const icon = button.buttonEl.createSpan({
        cls: "inkline-button-icon",
        attr: { "aria-hidden": "true" },
      });
      setIcon(icon, face.icon);
      if (face.text) button.buttonEl.createSpan({ text });
    }
    button.buttonEl.dataset.inklineButton = id;
    if (control.cta === true) button.setCta();
    this.#buttons.set(id, button);
  }

  /**
   * Registers the editor's keys in `scope`: those with no button of their own,
   * then each button's. Those that would also edit text, the single keys and
   * undo and redo, yield to a text field that has the focus; saving does not.
   *
   * Obsidian's scope runs only the first handler that matches a key, and it
   * matches a handler by the character the key types or by the key's code.
   * So one key can match two handlers, as on a Czech layout, where the key in
   * 1's place types + with 1's code: + and − come before the brush sizes, so
   * that such a key scales the picture while Move is on, as + does elsewhere.
   */
  registerKeys(scope: Scope): void {
    const { commands: editor, line } = this.#options;
    const key = (
      modifiers: ("Mod" | "Shift")[],
      name: string,
      action: () => void,
      yields = true,
    ): void => {
      scope.register(modifiers, name, () => {
        if (yields && typing(activeDocument.activeElement)) return true;
        line.act(action);
        return false;
      });
    };
    key(
      ["Mod"],
      "s",
      () => {
        editor.saveOnly();
      },
      false,
    );
    // Enter on the drawing area ends a polygon or path being placed where it
    // is; elsewhere it is left to what has the focus, such as a button.
    scope.register([], "Enter", () => !line.actIf(() => editor.endShape()));
    // While moving the picture, the arrow keys move it and + and − scale
    // it; otherwise they keep what they do.
    const moving = (
      modifiers: "Shift"[],
      name: PictureKey,
      action: () => void,
    ): void => {
      scope.register(modifiers, name, () => {
        // Otherwise a magnified view moves along the drawing, as Obsidian's
        // scope runs only the first handler for a key.
        if (!editor.movingPicture()) {
          return !line.actIf(() => editor.arrowKey(name, modifiers.length > 0));
        }
        // A text field, or the threshold's slider, keeps its own keys.
        if (keepsArrows(activeDocument.activeElement)) return true;
        line.act(action);
        return false;
      });
    };
    for (const [modifiers, byCell] of [
      [[], false],
      // With Shift, by a grid cell's width.
      [["Shift"], true],
    ] as const) {
      const by = (dx: -1 | 0 | 1, dy: -1 | 0 | 1) => () => {
        editor.nudgePicture(dx, dy, byCell);
      };
      moving([...modifiers], "ArrowLeft", by(-1, 0));
      moving([...modifiers], "ArrowRight", by(1, 0));
      moving([...modifiers], "ArrowUp", by(0, -1));
      moving([...modifiers], "ArrowDown", by(0, 1));
    }
    const scaled = (larger: boolean) => () => {
      editor.scalePictureStep(larger);
    };
    // + takes Shift on many keyboards, and = is the same key without it.
    moving([], "+", scaled(true));
    moving(["Shift"], "+", scaled(true));
    moving([], "=", scaled(true));
    moving([], "-", scaled(false));
    // Then each button's keys.
    for (const control of controls) {
      if (control.arrowKeys === true || !this.#offers(control)) continue;
      for (const { modifiers, key: name } of control.keys) {
        key(
          [...modifiers],
          name,
          () => {
            control.run(editor, modifiers.includes("Shift"));
          },
          control.anywhere !== true,
        );
      }
    }
  }

  /**
   * Shows what `states` says: which buttons are pressed and which are off,
   * the bar that makes ink and its threshold, and the picture's hint. A
   * button that `states` has no entry for keeps what it shows.
   */
  show(states: ButtonStates): void {
    for (const [id, button] of this.#buttons) {
      const pressed = own(states.pressed, id);
      if (pressed !== undefined) {
        button.buttonEl.setAttribute("aria-pressed", String(pressed));
      }
      const disabled = own(states.disabled, id);
      if (disabled !== undefined) button.setDisabled(disabled);
    }
    this.#convertBar.toggle(states.convertBar);
    if (states.threshold !== undefined) {
      this.#threshold.value = String(states.threshold);
    }
    this.#hint.setText(states.hint);
  }

  /** Whether the bar that makes ink shows now. */
  convertBarShown(): boolean {
    return this.#convertBar.isShown();
  }

  /** Opens the system's file dialog, for a picture to trace over. */
  choosePicture(): void {
    this.#chooser.click();
  }

  /** Puts the focus on the button `id`. */
  focusButton(id: string): void {
    this.#buttons.get(id)?.buttonEl.focus();
  }

  /** Puts the focus on Make ink's threshold. */
  focusThreshold(): void {
    this.#threshold.focus();
  }
}

/** What opening Help does around it, for {@link openHelp}. */
export interface HelpHooks {
  /** Help opened, as one of the editor's questions, which close with it. */
  opened(help: Modal): void;
  /** Help closed. */
  closed(help: Modal): void;
  /** After Help closed, once Obsidian gave the focus back to its opener. */
  resume(): void;
}

/** Opens Help: a short guide available without leaving a drawing. */
export function openHelp(app: App, hooks: HelpHooks): void {
  const help = new Modal(app);
  help.setTitle(quickStart.title);
  help.modalEl.addClass("inkline-help");
  const content = help.contentEl;
  content.createEl("p", { text: quickStart.intro });
  const steps = content.createEl("ul");
  for (const text of quickStart.steps) steps.createEl("li", { text });
  content.createEl("h2", { text: quickStart.guidesTitle });
  content.createEl("p", { text: quickStart.guidesIntro });
  const guides = content.createEl("ul");
  for (const text of quickStart.guides) guides.createEl("li", { text });
  help.onClose = () => {
    hooks.closed(help);
  };
  // Obsidian restores the opener's focus after onClose; resume drawing
  // after that, so the next shortcut cannot activate the Help button.
  const close = help.close.bind(help);
  help.close = () => {
    close();
    hooks.resume();
  };
  hooks.opened(help);
  help.open();
}
