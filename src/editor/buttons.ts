// The editor's buttons and keys: the table of its commands, which gives each
// button its row, its words, and its keys, and says what the button and the
// keys do; the icon from Obsidian's own set (Lucide) that each button has, and
// the setting that shows icons, text, or both; which buttons are pressed and
// which can be used, from what the editor holds; and the quick start that Help
// shows, which names them. A plain module, so that unit tests can check it;
// controls.ts makes the buttons and keys from it, and modal.ts implements the
// commands.

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
 * What the editor's buttons and keys do, which the modal implements by
 * calling what holds each part of the editor. The controls call nothing else.
 */
export interface EditorCommands {
  setTool(tool: Tool): void;
  toggleEllipse(): void;
  togglePolygon(): void;
  togglePath(): void;
  /** Makes a path being placed or adjusted ink, with the points it has. */
  finishPath(): void;
  toggleFill(): void;
  setSize(index: number): void;
  undo(): void;
  redo(): void;
  clear(): void;
  /** Moves the drawing up or down, by a pixel or with `byCell` a cell. */
  moveDrawing(direction: -1 | 1, byCell: boolean): void;
  toggleGuides(): void;
  toggleGrid(): void;
  toggleFlatEnds(): void;
  copy(): void;
  fit(): void;
  toggleZoom(): void;
  saveAndClose(): void;
  saveOnly(): void;
  saveAndNext(): void;
  help(): void;
  /** Opens the system's file dialog, for a picture to trace over. */
  choosePicture(): void;
  /** Traces over `file`, as chosen there. */
  trace(file: Blob): void;
  toggleMove(): void;
  toggleConvert(): void;
  removePicture(): void;
  /** Sets Make ink's threshold, as its slider moves. */
  setThreshold(value: number): void;
  toggleLight(): void;
  applyInk(): void;
  /** Closes Make ink, making no ink. */
  cancelInk(): void;
  /**
   * Ends a polygon or a path being placed where it is, or makes a path that
   * has ended ink, as Finish path does, for Enter on the drawing area.
   * Returns false, doing nothing, while none is being placed or the focus is
   * elsewhere, as on a button that Enter presses.
   */
  endShape(): boolean;
  /**
   * What `name`, an arrow key or + or −, does while no picture is moving, with
   * Shift held or not. Returns whether it did anything.
   */
  arrowKey(name: PictureKey, shift: boolean): boolean;
  /** Whether Move is on, with a picture to move. */
  movingPicture(): boolean;
  /** Moves the picture a pixel, or with `byCell` a cell, each way asked. */
  nudgePicture(dx: -1 | 0 | 1, dy: -1 | 0 | 1, byCell: boolean): void;
  /** Scales the picture a step, `larger` or smaller, about its middle. */
  scalePictureStep(larger: boolean): void;
  /** Puts the focus back on the drawing area. */
  refocus(): void;
}

/** The keys that move and scale the picture while Move is on. */
export type PictureKey =
  "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "+" | "=" | "-";

/** A key, and the modifiers held with it, as Obsidian's `Scope` takes them. */
export interface Chord {
  readonly modifiers: readonly ("Mod" | "Shift")[];
  readonly key: string;
}

const chord = (key: string, ...modifiers: ("Mod" | "Shift")[]): Chord => ({
  modifiers,
  key,
});

/** How a tooltip and the guide write `chord`: P, Shift+G, or Mod+Shift+Z. */
export function keyText({ modifiers, key }: Chord): string {
  return [...modifiers, key.length === 1 ? key.toUpperCase() : key].join("+");
}

/**
 * The rows of the editor's buttons, from the top: what draws; its size and
 * the history; the view and what ends the editor; the picture to trace over;
 * and what makes ink of it, while Make ink is on.
 */
export type ControlRow = "tools" | "history" | "view" | "picture" | "convert";

/** One of the editor's buttons, with its keys and what both do. */
export interface Control {
  /** What `data-inkline-button`, {@link buttonIcons}, and the states call it. */
  readonly id: string;
  readonly row: ControlRow;
  /** What the button says. */
  readonly text: string;
  /** Its name in its tooltip, when that is not its text. */
  readonly label?: string;
  /** What it does, after its name in its tooltip. */
  readonly description?: string;
  /** Its keys, as the guide lists them; the tooltip shows the first. */
  readonly keys: readonly Chord[];
  /** Whether its keys work while a text field has the focus, as saving's do. */
  readonly anywhere?: true;
  /**
   * Whether its keys do more than the button, so that the controls give
   * each of them one handler of its own and do not register them as this
   * control's: the arrow keys also move the picture while Move is on and a
   * magnified view along the drawing, and Enter also ends a shape being
   * placed.
   */
  readonly keysApart?: true;
  /** What the editor needs to offer it, as only a new symbol's offers these. */
  readonly needs?: "copyFrom" | "next";
  /** Whether it is the one to press in its row, as Save and Apply are. */
  readonly cta?: true;
  /** What the button and the keys do, with Shift held or not. */
  readonly run: (editor: EditorCommands, shift: boolean) => void;
}

/**
 * The editor's buttons, in their order in each row, with their keys. A button
 * and its keys run the same command, so they cannot drift apart.
 */
export const controls: readonly Control[] = [
  {
    id: "pen",
    row: "tools",
    text: "Pen",
    keys: [chord("p")],
    run: (editor) => {
      editor.setTool("pen");
    },
  },
  {
    id: "eraser",
    row: "tools",
    text: "Eraser",
    keys: [chord("e")],
    run: (editor) => {
      editor.setTool("eraser");
    },
  },
  {
    id: "ellipse",
    row: "tools",
    text: "Ellipse",
    description:
      "drag across a box to draw an ellipse with the pen or the eraser; hold Shift for a circle, or with the grid on to snap to it",
    keys: [chord("o")],
    run: (editor) => {
      editor.toggleEllipse();
    },
  },
  {
    id: "polygon",
    row: "tools",
    text: "Polygon",
    description:
      "click each corner of a shape with straight sides; click the first corner again to close it, or the last to end it; hold Shift to snap a corner to the grid",
    keys: [chord("y")],
    run: (editor) => {
      editor.togglePolygon();
    },
  },
  {
    id: "path",
    row: "tools",
    text: "Path",
    description:
      "place a curve by its points: click for a corner, or drag for a smooth point and its handles; drag a point or a handle's end to move it; click the first point to close the path, or the last to end it, and Finish path makes it ink; hold Shift to snap to the grid",
    keys: [chord("a")],
    run: (editor) => {
      editor.togglePath();
    },
  },
  {
    id: "fill",
    row: "tools",
    text: "Toggle fill",
    description:
      "while on, Ellipse, and Polygon or Path closed on its first point, draw solid shapes, with the pen or the eraser; it doesn't fill what is already drawn",
    keys: [chord("b")],
    run: (editor) => {
      editor.toggleFill();
    },
  },
  {
    id: "finish",
    row: "tools",
    text: "Finish path",
    description:
      "make the path ink as it is, ended or still being placed; Enter first ends a path being placed, for adjusting",
    keys: [chord("Enter")],
    keysApart: true,
    run: (editor) => {
      editor.finishPath();
    },
  },
  ...brushSizes.map((size, index): Control => ({
    id: `size-${String(index)}`,
    row: "history",
    text: size.label,
    label: `Brush size ${size.label}`,
    keys: [chord(String(index + 1))],
    run: (editor) => {
      editor.setSize(index);
    },
  })),
  {
    id: "undo",
    row: "history",
    text: "Undo",
    keys: [chord("z", "Mod")],
    run: (editor) => {
      editor.undo();
    },
  },
  {
    id: "redo",
    row: "history",
    text: "Redo",
    keys: [chord("z", "Mod", "Shift"), chord("y", "Mod")],
    run: (editor) => {
      editor.redo();
    },
  },
  {
    id: "clear",
    row: "history",
    text: "Clear",
    // A Mac's key labelled Delete sends Backspace.
    keys: [chord("Delete"), chord("Backspace")],
    run: (editor) => {
      editor.clear();
    },
  },
  {
    id: "move-up",
    row: "history",
    text: "Up",
    description:
      "move the whole drawing up a pixel, or with Shift a grid cell's width",
    keys: [chord("ArrowUp")],
    keysApart: true,
    run: (editor, shift) => {
      editor.moveDrawing(-1, shift);
    },
  },
  {
    id: "move-down",
    row: "history",
    text: "Down",
    description:
      "move the whole drawing down a pixel, or with Shift a grid cell's width",
    keys: [chord("ArrowDown")],
    keysApart: true,
    run: (editor, shift) => {
      editor.moveDrawing(1, shift);
    },
  },
  {
    id: "guides",
    row: "view",
    text: "Guides",
    keys: [chord("g")],
    run: (editor) => {
      editor.toggleGuides();
    },
  },
  {
    id: "grid",
    row: "view",
    text: "Grid",
    description:
      "show a grid of dots as a guide; hold Shift while drawing to snap to it",
    keys: [chord("g", "Shift")],
    run: (editor) => {
      editor.toggleGrid();
    },
  },
  {
    id: "flat-ends",
    row: "view",
    text: "Flat ends",
    description:
      "with the grid on, ends of freehand strokes and paths that Shift puts on a row, coming in at 45° or steeper, stop flush with it, rather than rounding past it",
    keys: [chord("t")],
    run: (editor) => {
      editor.toggleFlatEnds();
    },
  },
  {
    id: "copy",
    row: "view",
    text: "Copy from",
    description: "start from a copy of another symbol",
    keys: [chord("v")],
    needs: "copyFrom",
    run: (editor) => {
      editor.copy();
    },
  },
  {
    id: "fit",
    row: "view",
    text: "Fit",
    description:
      "centre the drawing in the view, and out of Zoom show all of it if it is wider; the drawing itself stays as it is",
    keys: [chord("f")],
    run: (editor) => {
      editor.fit();
    },
  },
  {
    id: "zoom",
    row: "view",
    text: "Zoom",
    description:
      "a taller view of the drawing, twice as large, with twice as many grid cells each way; the wheel or the left and right arrow keys move along it",
    keys: [chord("z")],
    run: (editor) => {
      editor.toggleZoom();
    },
  },
  {
    id: "save",
    row: "view",
    text: "Save",
    keys: [chord("Enter", "Mod")],
    anywhere: true,
    cta: true,
    run: (editor) => {
      editor.saveAndClose();
    },
  },
  {
    id: "next",
    row: "view",
    text: "Next",
    description: "save and draw the next one",
    keys: [chord("Enter", "Mod", "Shift")],
    anywhere: true,
    needs: "next",
    cta: true,
    run: (editor) => {
      editor.saveAndNext();
    },
  },
  {
    id: "help",
    row: "view",
    text: "Help",
    keys: [],
    run: (editor) => {
      editor.help();
    },
  },
  {
    id: "choose",
    row: "picture",
    text: "Choose picture…",
    description: "open a picture file to trace over",
    keys: [],
    run: (editor) => {
      editor.choosePicture();
    },
  },
  {
    id: "move",
    row: "picture",
    text: "Move",
    description:
      "drag the picture or use the arrow keys; the wheel or + and − scale it",
    keys: [chord("m")],
    run: (editor) => {
      editor.toggleMove();
    },
  },
  {
    id: "ink",
    row: "picture",
    text: "Make ink",
    description: "turn the picture into the symbol's ink, by a threshold",
    keys: [chord("i")],
    run: (editor) => {
      editor.toggleConvert();
    },
  },
  {
    id: "remove",
    row: "picture",
    text: "Remove picture",
    keys: [],
    run: (editor) => {
      editor.removePicture();
    },
  },
  {
    id: "light",
    row: "convert",
    text: "Light ink",
    description: "the ink is lighter than the ground around it",
    keys: [],
    run: (editor) => {
      editor.toggleLight();
    },
  },
  {
    id: "apply",
    row: "convert",
    text: "Apply",
    keys: [],
    cta: true,
    run: (editor) => {
      editor.applyInk();
    },
  },
  {
    id: "cancel",
    row: "convert",
    text: "Cancel",
    keys: [],
    run: (editor) => {
      editor.cancelInk();
    },
  },
];

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
  finish: "check",
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
  /**
   * Whether Make ink is open, or will be once the pointer is let go, as its
   * button shows; its bar shows while it is open, as `converting` says.
   */
  readonly inkOpen: boolean;
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
  /** Whether a polygon or a path is being placed, or a path adjusted. */
  readonly placing: boolean;
  /** Whether a path is being placed, or has ended and waits to be ink. */
  readonly placingPath: boolean;
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
 * that can end flat; Finish path is for a path being placed or adjusted; the
 * picture's buttons need a picture; Undo is on while there is a step or a
 * corner to take back; Up and Down need something to move, and not while
 * making ink; and Save and Next wait for a save.
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
    ink: state.inkOpen,
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
      finish: !state.placingPath,
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

/**
 * What Help says: how to draw, with the buttons' keys as {@link controls}
 * gives them, and what each guide means.
 */
export const quickStart = {
  title: "Drawing quick start",
  intro:
    "Draw a symbol once, then reuse it in your notes. The preview below the drawing shows its size beside text.",
  steps: [
    "Pen (P) adds ink; Eraser (E) removes it. Sizes S–XL (1–4) are remembered separately until you close the editor, including through Next. The circle shows the brush's diameter.",
    "Ellipse (O) draws an ellipse with the pen or the eraser: drag across the box it fills, and hold Shift for a circle, or with the grid on to put the box's corners on the grid. Press it again to draw freehand. A shape drawn with the eraser is tinted until it is done.",
    "Polygon (Y) draws a shape with straight sides and sharp corners: click each corner, then click the first corner again to close it, or the last corner, or press Enter, to leave it open. With the grid on, hold Shift as you click to put that corner on the grid. Undo takes back a corner, and Esc drops the shape.",
    "Path (A) places a curve by its points, as the pen or the eraser would draw along it: click for a corner, or press and drag for a smooth point, whose handle follows the pointer and sets the curve's direction there. Drag any point or handle's end to move it; a handle dragged back onto its point leaves a corner. Click the first point to close the path, or the last point, or press Enter, to leave it open. It then waits for you to adjust its points and handles, with no curve following the pointer and nothing else drawn, until Finish path, or Enter again, makes it ink; Finish path also does while you place it. With the grid on, hold Shift to put a point, or a handle's end, on the grid. Undo takes back the last point, move, or ending, and Esc drops the path. Once it is ink, it is like any other stroke.",
    "Toggle fill (B) is a switch, not a tool to click a shape with: while it is on, Ellipse and a closed Polygon or Path draw solid shapes, with their line at the brush size as without fill and everything inside it filled. The pen makes a solid shape, and the eraser a hole of its shape.",
    "Hold Shift while drawing for a straight segment. Grid (Shift+G) shows dots as a guide, and nothing goes to them unless you hold Shift: then each stroke end or corner you place goes to the nearest dot. Its rows pass through each guide line the settings choose, and divide the space between lines evenly; the settings also set how many cells span the x-height.",
    "Flat ends (T), with the grid on, stops an end of a freehand stroke or a path that Shift put on a row flush with that row, rather than rounding past it, if it comes in at 45° or steeper; one running along the row stays round. It is off until you turn it on, and ellipses and polygons are never cut.",
    "Undo (Mod+Z) and Redo (Mod+Shift+Z) step through changes. Clear removes the drawing and can be undone.",
    "Up and Down, or the up and down arrow keys, move the whole drawing a pixel at a time, or a grid cell's width with Shift, as to sit a shape on a line. One Undo takes back moves made in a row.",
    "Zoom (Z) shows the drawing up to twice as large in a taller view, for fine detail; the wheel or the left and right arrow keys move along it, and Fit (F) centres it. Pressed while you draw, Zoom and Fit wait until you let go, so that what you draw ends where it shows, and moving along carries what you draw with the view. While zoomed, the grid has twice as many cells each way, and keeps every point of the usual grid. Saved symbols stay the same size in notes.",
    "Paste, drop, or choose (Choose picture…) a picture to trace. Move positions it; the wheel scales it. Make ink converts the visible picture into editable ink. The tracing picture itself is not saved.",
    "Name the symbol, then Save (Mod+Enter). For a new symbol, Next (Mod+Shift+Enter) saves it and starts another. Mod is Ctrl on Windows/Linux, Cmd on macOS.",
    "Readings and translations, beside the name, say how the symbol is read and what it means, apart from its name: one per line, the main one first. Saving keeps them with the symbol, and the lists find a symbol by them. The library changes them without opening the editor.",
    "Saving a changed symbol that your notes use more than once first asks whether to Replace it everywhere. For a variant, start a new symbol with Copy from instead.",
  ],
  guidesTitle: "What the guides mean",
  guidesIntro:
    "The horizontal guides follow your note font, from top to bottom, each in its own colour; a font may put some at the same height or outside the drawing area. Toggle them together with the guide button or its shortcut; the plugin's settings choose which lines show.",
  guides: [
    "Ascender (purple): the font's upper extent.",
    "Cap height (blue): the top of a capital such as H.",
    "x-height (green): the top of a lowercase letter such as x.",
    "Baseline (orange, solid): where letters sit.",
    "Descender (pink): the font's lower extent, for parts below the baseline.",
    "Vertical dashed lines: the saved image's left and right edges, including spacing. They follow the ink as you draw.",
  ],
} as const;
