// Prototype for #167 §4.1, not for release: the editor's Compose dialog.
// Choose one of eight layouts, then a symbol for each of its boxes from the
// list Copy from shows; the dialog shows the result large and at text size,
// with how its line widths follow, and puts it in the drawing in place of
// what is there, as Copy from does, for Undo to take back. The parts stay
// chosen by letter while the layout changes, and for the next time the
// dialog opens in the same editor.

import { App, ButtonComponent, DropdownComponent, Modal } from "obsidian";
import { lineBox } from "../ink/geometry.ts";
import { drawInk } from "../ink/render.ts";
import {
  compose,
  drawRecord,
  type Composed,
  type DrawnPart,
} from "./compose-draw.ts";
import {
  arrange,
  layoutNamed,
  layouts,
  type Arrangement,
  type LayoutName,
  type Slot,
  type Weight,
} from "./layouts.ts";
import type { SymbolCopy } from "./modal.ts";

export interface ComposeState {
  layout: LayoutName;
  /** The symbol chosen for each letter. */
  parts: Partial<Record<Slot["letter"], SymbolCopy>>;
  weight: Weight;
}

export function initialState(): ComposeState {
  return { layout: "point-up", parts: {}, weight: "scaled" };
}

export interface ComposeResult {
  readonly composed: Composed;
  readonly arrangement: Arrangement;
  readonly summary: string;
}

const weights: Readonly<Record<Weight, string>> = {
  scaled: "Thinner, as the part shrinks (½)",
  between: "Between (0.71)",
  kept: "As drawn (1)",
};

/** Where a letter sits in a layout's 2×2 diagram, in percent. */
function at(span: Slot["row"]): number {
  return span === "both" ? 50 : span === 0 ? 27 : 73;
}

function part(copy: SymbolCopy | undefined): DrawnPart | undefined {
  if (copy === undefined) return undefined;
  const { ink } = copy;
  return {
    record: ink.document,
    width: ink.width,
    ...(ink.base === undefined ? {} : { base: ink.base }),
  };
}

export class ComposeDialog extends Modal {
  readonly #state: ComposeState;
  readonly #choose: (closed: AbortSignal) => Promise<SymbolCopy | undefined>;
  readonly #done: (result: ComposeResult | undefined) => void;
  #choosing: AbortController | undefined;
  #result: ComposeResult | undefined;
  #generation = 0;
  #layoutButtons = new Map<LayoutName, HTMLButtonElement>();
  #slotsEl!: HTMLElement;
  #preview!: HTMLCanvasElement;
  #inline!: HTMLCanvasElement;
  #status!: HTMLElement;
  #put!: ButtonComponent;
  #finished = false;

  constructor(
    app: App,
    state: ComposeState,
    choose: (closed: AbortSignal) => Promise<SymbolCopy | undefined>,
    done: (result: ComposeResult | undefined) => void,
  ) {
    super(app);
    this.#state = state;
    this.#choose = choose;
    this.#done = done;
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("inkline-compose");
    this.setTitle("Compose a symbol");
    contentEl.createEl("p", {
      cls: "inkline-compose-hint",
      text: "Choose a layout, then a symbol for each box. Parts in a layout are half size.",
    });
    const picker = contentEl.createDiv({
      cls: "inkline-compose-layouts",
      attr: { role: "radiogroup", "aria-label": "Layout" },
    });
    for (const layout of layouts) {
      const button = picker.createEl("button", {
        cls: "inkline-compose-layout",
        attr: {
          role: "radio",
          "aria-label": layout.label,
          title: layout.label,
          "data-layout": layout.name,
        },
      });
      for (const slot of layout.slots) {
        button.createSpan({
          cls: `inkline-compose-letter${layout.slots.length === 1 ? " is-single" : ""}`,
          text: slot.letter,
          attr: {
            style: `left: ${String(at(slot.column))}%; top: ${String(at(slot.row))}%`,
          },
        });
      }
      button.addEventListener("click", () => {
        this.#state.layout = layout.name;
        this.#refresh();
      });
      this.#layoutButtons.set(layout.name, button);
    }
    this.#slotsEl = contentEl.createDiv({ cls: "inkline-compose-slots" });
    const options = contentEl.createDiv({ cls: "inkline-compose-options" });
    options.createSpan({ text: "Line width " });
    const dropdown = new DropdownComponent(options)
      .addOptions(weights)
      .setValue(this.#state.weight)
      .onChange((value) => {
        this.#state.weight = value as Weight;
        void this.#recompose();
      });
    dropdown.selectEl.addClass("inkline-compose-weight");
    const shown = contentEl.createDiv({ cls: "inkline-compose-shown" });
    this.#preview = shown.createEl("canvas", {
      cls: "inkline-compose-preview",
    });
    const line = shown.createEl("p", { cls: "inkline-compose-inline" });
    line.appendText("At text size: Text ");
    this.#inline = line.createEl("canvas", { cls: "inkline-compose-text" });
    line.appendText(" text.");
    this.#status = contentEl.createDiv({
      cls: "inkline-compose-status",
      attr: { "aria-live": "polite" },
    });
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    this.#put = new ButtonComponent(buttons)
      .setButtonText("Put in drawing")
      .setCta()
      .onClick(() => {
        this.#finish(this.#result);
      });
    this.#put.buttonEl.dataset.inklineCompose = "put";
    new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => {
      this.#finish(undefined);
    });
    this.scope.register([], "Enter", () => {
      if (this.#result !== undefined) this.#finish(this.#result);
      return false;
    });
    this.#refresh();
  }

  override onClose(): void {
    this.#choosing?.abort();
    this.contentEl.empty();
    if (!this.#finished) {
      this.#finished = true;
      this.#done(undefined);
    }
  }

  #finish(result: ComposeResult | undefined): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#done(result);
    this.close();
  }

  #refresh(): void {
    const layout = layoutNamed(this.#state.layout);
    for (const [name, button] of this.#layoutButtons) {
      const chosen = name === layout.name;
      button.toggleClass("is-chosen", chosen);
      button.setAttribute("aria-checked", String(chosen));
    }
    this.#slotsEl.empty();
    const letters = [...layout.slots].sort((a, b) =>
      a.letter.localeCompare(b.letter),
    );
    for (const slot of letters) {
      const copy = this.#state.parts[slot.letter];
      const button = new ButtonComponent(this.#slotsEl)
        .setButtonText(`${slot.letter}: ${copy?.name ?? "Choose…"}`)
        .onClick(() => {
          void this.#pick(slot.letter);
        });
      button.buttonEl.dataset.inklineSlot = slot.letter;
      button.buttonEl.addClass("inkline-compose-slot");
    }
    void this.#recompose();
  }

  async #pick(letter: Slot["letter"]): Promise<void> {
    if (this.#choosing !== undefined) return;
    const choosing = new AbortController();
    this.#choosing = choosing;
    let copy: SymbolCopy | undefined;
    try {
      copy = await this.#choose(choosing.signal);
    } finally {
      this.#choosing = undefined;
    }
    if (copy === undefined || this.#finished) return;
    this.#state.parts[letter] = copy;
    this.#refresh();
  }

  async #recompose(): Promise<void> {
    const generation = ++this.#generation;
    const layout = layoutNamed(this.#state.layout);
    const copies = layout.slots.map((slot) => this.#state.parts[slot.letter]);
    const parts = copies.map(part);
    const missing = layout.slots
      .filter((_, index) => copies[index] === undefined)
      .map((slot) => slot.letter);
    this.#result = undefined;
    this.#put.setDisabled(true);
    if (missing.length === layout.slots.length) {
      this.#status.setText("Choose a symbol for each box.");
      this.#draw(undefined, arrange(layout, []));
      return;
    }
    const arrangement = arrange(layout, parts);
    let composed: Composed;
    try {
      composed = await compose(parts, arrangement, this.#state.weight);
    } catch (error) {
      this.#status.setText(
        `Cannot compose: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (generation !== this.#generation || this.#finished) return;
    this.#draw(composed, arrangement);
    const said: string[] = [];
    if (missing.length > 0) said.push(`Box ${missing.join(", ")} is empty.`);
    const names = layout.slots
      .filter((_, index) => copies[index] !== undefined)
      .map((slot) => slot.letter);
    if (composed.natural.differing === 0) {
      said.push("No part's eraser reaches another part.");
    } else if (composed.chosen.differing === 0) {
      said.push(
        `An eraser reached another part in the usual order, so the parts go in as ${composed.order.map((index) => names[index] ?? "?").join(", ")}, where none does.`,
      );
    } else {
      said.push(
        `An eraser takes ${String(composed.chosen.lost)} pixels from another part in every order.`,
      );
    }
    if (composed.mergedBases > 1) {
      said.push(
        `${String(composed.mergedBases)} parts are traced pictures: they share one picture layer.`,
      );
    }
    const summary = `${layout.label} of ${layout.slots
      .map((slot) => this.#state.parts[slot.letter]?.name ?? "nothing")
      .join(", ")}`;
    this.#status.setText(said.join(" "));
    this.#result = { composed, arrangement, summary };
    this.#put.setDisabled(false);
  }

  #draw(composed: Composed | undefined, arrangement: Arrangement): void {
    const width = Math.max(96, Math.ceil(arrangement.width) + 32);
    const ratio = window.devicePixelRatio;
    for (const [canvas, cssHeight] of [
      [this.#preview, 192],
      [this.#inline, undefined],
    ] as const) {
      const scale = cssHeight === undefined ? 1 : ratio;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(lineBox.height * scale);
      if (cssHeight !== undefined) {
        canvas.style.width = `${String(width)}px`;
        canvas.style.height = `${String(cssHeight)}px`;
      } else {
        canvas.style.height = "1.5em";
        canvas.style.width = `${String((width / lineBox.height) * 1.5)}em`;
      }
      const context = canvas.getContext("2d");
      if (context === null) continue;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, lineBox.height);
      const colour = getComputedStyle(this.contentEl).color;
      if (cssHeight !== undefined) {
        // The boxes, faint, and the baseline.
        context.save();
        context.strokeStyle = colour;
        context.globalAlpha = 0.25;
        context.setLineDash([3, 3]);
        for (const placement of arrangement.placements) {
          const { box } = placement;
          context.strokeRect(box.left + 16, box.top, box.width, box.height);
        }
        context.setLineDash([]);
        context.globalAlpha = 0.5;
        context.beginPath();
        context.moveTo(0, lineBox.baseline + 0.5);
        context.lineTo(width, lineBox.baseline + 0.5);
        context.stroke();
        context.restore();
      }
      if (composed === undefined) continue;
      const layer = drawRecord(
        { strokes: [] },
        undefined,
        width,
      );
      const inkContext = layer.getContext("2d");
      if (inkContext === null) continue;
      drawInk(inkContext, composed.record.strokes, composed.base, 16);
      // The ink in the text's colour, as notes show symbols.
      inkContext.globalCompositeOperation = "source-in";
      inkContext.fillStyle = colour;
      inkContext.fillRect(0, 0, width, lineBox.height);
      context.drawImage(layer, 0, 0);
    }
  }
}
