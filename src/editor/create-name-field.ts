import { INK_EXTENSION } from "../constants";

/**
 * The header row with the name label, input, and joined `.ink.png` suffix.
 * Enter in the input triggers `onSubmit` (a save) instead of anything modal.
 */
export function createNameField(
  parent: HTMLElement,
  initialName: string,
  onSubmit: () => void,
): HTMLInputElement {
  const headerEl = parent.createDiv({ cls: "inkline-editor-header" });
  headerEl.createEl("label", {
    cls: "inkline-name-label",
    text: "Name:",
    attr: { for: "inkline-name-input" },
  });

  const nameFieldEl = headerEl.createDiv({ cls: "inkline-name-field" });
  const inputWrapEl = nameFieldEl.createDiv({ cls: "inkline-name-input-wrap" });
  const inputEl = inputWrapEl.createEl("input", {
    cls: "inkline-name-input",
    attr: {
      id: "inkline-name-input",
      type: "text",
      value: initialName,
      "aria-label": "Ink name",
    },
  });
  nameFieldEl.createSpan({ cls: "inkline-name-suffix", text: INK_EXTENSION });

  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit();
    }
  });

  return inputEl;
}
