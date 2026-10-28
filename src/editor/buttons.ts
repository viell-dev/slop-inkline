// How the editor's buttons show what they do: the icon from Obsidian's own
// set (Lucide) that each one has, and the setting that shows icons, text, or
// both. A plain module, so that unit tests can check it; modal.ts makes the
// buttons.

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
  undo: "undo-2",
  redo: "redo-2",
  clear: "trash-2",
  guides: "baseline",
  grid: "grid",
  copy: "copy",
  fit: "scan",
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
