// How the editor's buttons show what they do: the icon from Obsidian's own
// set (Lucide) that each one has, the setting that shows icons, text, or both,
// and which buttons are pressed and which can be used, from what the editor
// holds. A plain module, so that unit tests can check it; modal.ts makes the
// buttons and applies what this says.

import type { Tool } from "../format/record.ts";
import { brushSizes, type Shape } from "./session.ts";

/** What the editor's buttons show: an icon and text, an icon, or text. */
export type ButtonLabels = "both" | "icons" | "text";

/** Each choice, as the settings name it. */
export const buttonLabelNames: Readonly<Record<ButtonLabels, string>> = {
  both: "Icons and text",
  icons: "Icons only",
  text: "Text only",
};

/** Whether `value` is one of the choices. */
export function isButtonLabels(value: unknown): value is ButtonLabels {
  return value === "both" || value === "icons" || value === "text";
}

/**
 * The icon of each button that has one, by the button's id. The brush sizes
 * keep their letters, as short as an icon and clearer than a dot's size; the
 * bar that Make ink opens keeps its words, as its buttons answer a question
 * while it is open, as a dialog's do.
 */
export const buttonIcons: Readonly<Record<string, string>> = {
  pen: "pencil",
  eraser: "eraser",
  ellipse: "circle",
  polygon: "pentagon",
  path: "pen-tool",
  fill: "circle-dot",
  undo: "undo-2",
  redo: "redo-2",
  clear: "trash-2",
  guides: "baseline",
  grid: "grid",
  "flat-ends": "scissors-line-dashed",
  copy: "copy",
  fit: "scan",
  "move-up": "arrow-up",
  "move-down": "arrow-down",
  zoom: "zoom-in",
  save: "save",
  next: "arrow-right",
  help: "circle-help",
  choose: "image-plus",
  move: "move",
  ink: "droplet",
  remove: "image-minus",
};

/**
 * What a button shows under `labels`: the icon, if it has one and the choice
 * shows icons, and the text, unless the choice shows icons only and it has
 * one. A button without an icon shows its text under every choice.
 */
export function buttonFace(
  id: string,
  labels: ButtonLabels,
): { readonly icon: string | undefined; readonly text: boolean } {
  const icon = labels === "text" ? undefined : buttonIcons[id];
  return { icon, text: icon === undefined || labels === "both" };
}

/** What the picture bar's hint says, by what is done with the picture. */
export const pictureHints = {
  none: "Paste, drop, or choose a picture to trace over it.",
  tracing: "Tracing over a picture, which is not saved.",
  making: "Making ink of the picture: set the threshold, then Apply.",
} as const;

/** What the editor holds that its buttons show, for {@link buttonStates}. */
export interface ButtonInputs {
  readonly tool: Tool;
  readonly shape: Shape;
  /** Whether the shapes drawn from now on are filled. */
  readonly fill: boolean;
  /** Whether dragging moves the picture to trace over, rather than drawing. */
  readonly moving: boolean;
  /** Whether there is a picture to trace over. */
  readonly picture: boolean;
  /** Make ink, while its bar is open, and while Apply makes the ink. */
  readonly converting:
    { readonly threshold: number; readonly light: boolean } | undefined;
  readonly applying: boolean;
  readonly guides: boolean;
  /** Whether the grid shows. */
  readonly grid: boolean;
  /** Whether strokes drawn now can end flat, and whether they do. */
  readonly canEndFlat: boolean;
  readonly flatEnds: boolean;
  /** Whether the view is magnified, or will be once the pointer is let go. */
  readonly zoomed: boolean;
  readonly sizeIndex: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Whether a polygon or a path is being placed. */
  readonly placing: boolean;
  /** Whether the drawing holds no stroke and no base layer. */
  readonly empty: boolean;
  readonly saving: boolean;
}

/** What {@link buttonStates} says the editor's buttons show. */
export interface ButtonStates {
  /** Each switch's button, by id, and whether it is pressed. */
  readonly pressed: Readonly<Record<string, boolean>>;
  /** Each button that can be turned off, by id, and whether it is. */
  readonly disabled: Readonly<Record<string, boolean>>;
  /** Whether the bar that makes ink of the picture shows. */
  readonly convertBar: boolean;
  /** What its threshold reads while it shows. */
  readonly threshold: number | undefined;
  readonly hint: string;
}

/**
 * Which of the editor's buttons are pressed and which are turned off, from
 * what it holds: a tool or a shape shows pressed while drawing, not while
 * moving the picture; Toggle fill is for shapes, and Flat ends for strokes
 * that can end flat; the picture's buttons need a picture; Undo is on while
 * there is a step or a corner to take back; Up and Down need something to
 * move, and not while making ink; and Save and Next wait for a save.
 */
export function buttonStates(state: ButtonInputs): ButtonStates {
  const drawing = !state.moving;
  const shaped = state.shape !== "free";
  const { converting } = state;
  const making = converting !== undefined;
  const pressed: Record<string, boolean> = {
    pen: drawing && state.tool === "pen",
    eraser: drawing && state.tool === "eraser",
    ellipse: drawing && state.shape === "ellipse",
    polygon: drawing && state.shape === "polygon",
    path: drawing && state.shape === "path",
    fill: shaped && state.fill,
    move: state.moving,
    ink: making,
    light: converting?.light === true,
    guides: state.guides,
    grid: state.grid,
    "flat-ends": state.canEndFlat && state.flatEnds,
    zoom: state.zoomed,
  };
  brushSizes.forEach((_, index) => {
    pressed[`size-${String(index)}`] = state.sizeIndex === index;
  });
  const still = making || state.empty;
  return {
    pressed,
    disabled: {
      fill: !shaped,
      move: !state.picture,
      remove: !state.picture,
      ink: !state.picture,
      apply: state.applying,
      "flat-ends": !state.canEndFlat,
      undo: !state.canUndo && !state.placing,
      redo: !state.canRedo,
      "move-up": still,
      "move-down": still,
      save: state.saving,
      next: state.saving,
    },
    convertBar: making,
    threshold: converting?.threshold,
    hint: making
      ? pictureHints.making
      : state.picture
        ? pictureHints.tracing
        : pictureHints.none,
  };
}
