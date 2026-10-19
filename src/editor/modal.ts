// The editor: a modal around a drawing session and its surface, with the
// tools, keyboard shortcuts, saving, drafts, and the question before unsaved
// work is closed.

import {
  ButtonComponent,
  ConfirmationModal,
  Modal,
  Notice,
  type App,
} from "obsidian";
import type { CarriedChunk } from "../format/ink-file.ts";
import type { InkRecord } from "../format/record.ts";
import { saveInk } from "../ink/canvas.ts";
import type { InkDocument } from "../ink/document.ts";
import type { DrawableBase } from "../ink/render.ts";
import {
  decodeDraft,
  encodeDraft,
  restoreDraft,
  type DraftStore,
} from "./drafts.ts";
import { PointerGate, reportsPressure } from "./pointer.ts";
import { brushSizes, DrawingSession, type InputPoint } from "./session.ts";
import { InkView } from "./view.ts";

export interface EditorOptions {
  readonly title: string;
  readonly document: InkDocument;
  readonly base?: DrawableBase;
  readonly carried?: readonly CarriedChunk[];
  /** The document x to centre the surface on, in pixels. */
  readonly center: number;
  /**
   * Writes a saved symbol: the first save of a new symbol creates its file
   * and inserts it. Rejects when anything could not be done, which keeps the
   * editor open with the drawing, so that the next save tries again.
   */
  readonly write: (bytes: Uint8Array, record: InkRecord) => Promise<void>;
  /** Where unsaved strokes are kept, and under which key. */
  readonly draft?: { readonly store: DraftStore; readonly key: string };
  /** Told when the editor opens and closes, so that its owner can track it. */
  readonly lifecycle?: {
    opened(editor: InkEditorModal): void;
    closed(editor: InkEditorModal): void;
  };
}

export class InkEditorModal extends Modal {
  readonly #options: EditorOptions;
  readonly #session: DrawingSession;
  readonly #gate = new PointerGate();
  #view: InkView | undefined;
  #saving: Promise<boolean> | undefined;
  #closing = false;
  #disposed = false;
  #frame: number | undefined;
  #resize: ResizeObserver | undefined;
  #status: HTMLElement | undefined;
  readonly #buttons = new Map<string, ButtonComponent>();

  constructor(app: App, options: EditorOptions) {
    super(app);
    this.#options = options;
    this.#session = new DrawingSession(options.document);
  }

  /** The base layer to draw, while the document still has one. */
  get #base(): DrawableBase | undefined {
    return this.#session.document.base === undefined
      ? undefined
      : this.#options.base;
  }

  override onOpen(): void {
    this.modalEl.addClass("inkline-editor");
    this.setTitle(this.#options.title);
    const toolbar = this.contentEl.createDiv({ cls: "inkline-toolbar" });
    this.#addButton(toolbar, "pen", "Pen", "P", () => {
      this.#setTool("pen");
    });
    this.#addButton(toolbar, "eraser", "Eraser", "E", () => {
      this.#setTool("eraser");
    });
    brushSizes.forEach((size, index) => {
      this.#addButton(
        toolbar,
        `size-${String(index)}`,
        size.label,
        String(index + 1),
        () => {
          this.#setSize(index);
        },
        `Brush size ${size.label}`,
      );
    });
    this.#addButton(toolbar, "undo", "Undo", "Mod+Z", () => {
      this.#undo();
    });
    this.#addButton(toolbar, "redo", "Redo", "Mod+Shift+Z", () => {
      this.#redo();
    });
    this.#addButton(toolbar, "clear", "Clear", undefined, () => {
      this.#clear();
    });
    this.#addButton(toolbar, "save", "Save", "Mod+Enter", () => {
      void this.#saveAndClose();
    });
    this.#buttons.get("save")?.setCta();

    const canvas = this.contentEl.createEl("canvas", {
      cls: "inkline-surface",
      attr: {
        tabindex: "0",
        role: "img",
        "aria-label": "Drawing area",
      },
    });
    this.#status = this.contentEl.createDiv({
      cls: "inkline-status",
      attr: { "aria-live": "polite" },
    });
    const view = new InkView(canvas);
    this.#view = view;
    view.centerOn(this.#options.center);
    this.#listen(canvas);
    this.#registerKeys();

    this.#resize = new ResizeObserver(() => {
      view.resize(canvas.clientWidth, canvas.win.devicePixelRatio);
      this.#render();
    });
    this.#resize.observe(canvas);
    view.resize(canvas.clientWidth, canvas.win.devicePixelRatio);
    this.#updateButtons();
    this.#render();
    this.#options.lifecycle?.opened(this);
    // Obsidian moves the focus once the modal is open; take it back after.
    canvas.win.requestAnimationFrame(() => {
      canvas.focus();
    });
    this.#offerDraft();
  }

  override onClose(): void {
    this.#resize?.disconnect();
    if (this.#frame !== undefined) {
      this.#view?.canvas.win.cancelAnimationFrame(this.#frame);
    }
    this.contentEl.empty();
    this.#options.lifecycle?.closed(this);
  }

  /**
   * Closes the editor, asking first when the drawing has unsaved changes:
   * save, discard, or keep drawing. Esc, the close button, and a click
   * outside all come here, since Obsidian closes modals through this method.
   */
  override close(): void {
    if (this.#closing) {
      super.close();
      return;
    }
    if (this.#saving !== undefined) {
      this.#announce("Saving…");
      return;
    }
    if (!this.#session.dirty) {
      this.#forgetDraft();
      this.#finish();
      return;
    }
    const confirm = new ConfirmationModal(this.app);
    confirm.setTitle("Save this symbol?");
    confirm.setContent("The drawing has changes that are not saved.");
    confirm.addButton((button) =>
      button
        .setButtonText("Save")
        .setCta()
        .setInitialFocus()
        .onClick(() => {
          // Returning nothing lets the question close at once; a failed save
          // then leaves the editor open and says why.
          void this.#saveAndClose();
        }),
    );
    confirm.addButton((button) =>
      button
        .setButtonText("Discard")
        .setDestructive()
        .onClick(() => {
          this.#forgetDraft();
          this.#finish();
        }),
    );
    confirm.addCancelButton("Keep drawing");
    confirm.open();
  }

  /**
   * Closes the editor without asking, as when the plugin unloads: unsaved
   * strokes are kept as a draft, and nothing more is written.
   */
  dispose(): void {
    this.#disposed = true;
    this.#session.end();
    this.#keepDraft();
    this.#finish();
  }

  #finish(): void {
    this.#closing = true;
    this.close();
  }

  #addButton(
    parent: HTMLElement,
    id: string,
    text: string,
    shortcut: string | undefined,
    action: () => void,
    label = text,
  ): void {
    const button = new ButtonComponent(parent)
      .setButtonText(text)
      .setTooltip(shortcut === undefined ? label : `${label} (${shortcut})`)
      .onClick(action);
    button.buttonEl.setAttribute("aria-label", label);
    button.buttonEl.dataset.inklineButton = id;
    this.#buttons.set(id, button);
  }

  #registerKeys(): void {
    const key = (
      modifiers: ("Mod" | "Shift")[],
      name: string,
      action: () => void,
    ): void => {
      this.scope.register(modifiers, name, () => {
        action();
        return false;
      });
    };
    key(["Mod"], "Enter", () => void this.#saveAndClose());
    key(["Mod"], "s", () => void this.#save());
    key(["Mod"], "z", () => {
      this.#undo();
    });
    key(["Mod", "Shift"], "z", () => {
      this.#redo();
    });
    key(["Mod"], "y", () => {
      this.#redo();
    });
    key([], "p", () => {
      this.#setTool("pen");
    });
    key([], "e", () => {
      this.#setTool("eraser");
    });
    brushSizes.forEach((_, index) => {
      key([], String(index + 1), () => {
        this.#setSize(index);
      });
    });
  }

  #listen(canvas: HTMLCanvasElement): void {
    const point = (event: PointerEvent): InputPoint => {
      const { x, y } = this.#view?.toDocument(event.clientX, event.clientY) ?? {
        x: 0,
        y: 0,
      };
      return reportsPressure(event.pointerType)
        ? { x, y, pressure: event.pressure }
        : { x, y };
    };
    const finish = (event: PointerEvent): void => {
      if (!this.#gate.release(event)) return;
      if (event.type === "pointercancel") this.#session.cancel();
      else this.#session.end();
      this.#changed();
    };
    canvas.addEventListener("pointerdown", (event) => {
      const tool = this.#gate.down(event);
      if (tool === undefined) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      this.#session.begin(
        point(event),
        tool === "brush" ? this.#session.tool : tool,
      );
      this.#render();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.#gate.owns(event)) return;
      // Releasing the drawing button while another is held is a move.
      if (!this.#gate.holds(event)) {
        finish(event);
        return;
      }
      const events =
        typeof event.getCoalescedEvents === "function"
          ? event.getCoalescedEvents()
          : [];
      this.#session.extend((events.length > 0 ? events : [event]).map(point));
      this.#render();
    });
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("lostpointercapture", finish);
    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
  }

  #render(): void {
    const view = this.#view;
    if (this.#frame !== undefined || view === undefined) return;
    // The surface's own window, which differs from the main one in a popout.
    this.#frame = view.canvas.win.requestAnimationFrame(() => {
      this.#frame = undefined;
      view.render(
        this.#session.document,
        this.#base,
        this.#session.activeStroke,
      );
    });
  }

  #setTool(tool: "pen" | "eraser"): void {
    this.#session.tool = tool;
    this.#updateButtons();
  }

  #setSize(index: number): void {
    this.#session.sizeIndex = index;
    this.#updateButtons();
  }

  #undo(): void {
    if (this.#session.undo()) this.#changed();
  }

  #redo(): void {
    if (this.#session.redo()) this.#changed();
  }

  #clear(): void {
    this.#session.clear();
    this.#changed();
  }

  /** After a committed change: update the controls, the surface, the draft. */
  #changed(): void {
    this.#updateButtons();
    this.#render();
    this.#keepDraft();
  }

  #updateButtons(): void {
    const pressed = (id: string, value: boolean): void => {
      this.#buttons
        .get(id)
        ?.buttonEl.setAttribute("aria-pressed", String(value));
    };
    pressed("pen", this.#session.tool === "pen");
    pressed("eraser", this.#session.tool === "eraser");
    brushSizes.forEach((_, index) => {
      pressed(`size-${String(index)}`, this.#session.sizeIndex === index);
    });
    this.#buttons.get("undo")?.setDisabled(!this.#session.canUndo);
    this.#buttons.get("redo")?.setDisabled(!this.#session.canRedo);
    this.#buttons.get("save")?.setDisabled(this.#saving !== undefined);
  }

  #announce(text: string): void {
    this.#status?.setText(text);
  }

  /** Keeps the unsaved drawing as a draft, or forgets it once saved. */
  #keepDraft(): void {
    const draft = this.#options.draft;
    if (draft === undefined) return;
    if (!this.#session.dirty) {
      this.#forgetDraft();
      return;
    }
    draft.store.saveLocalStorage(
      draft.key,
      encodeDraft(this.#session.document, Date.now()),
    );
  }

  #forgetDraft(): void {
    const draft = this.#options.draft;
    if (draft !== undefined) draft.store.saveLocalStorage(draft.key, null);
  }

  /** Offers back a draft left by an editor that closed without saving. */
  #offerDraft(): void {
    const options = this.#options.draft;
    if (options === undefined) return;
    const draft = decodeDraft(options.store.loadLocalStorage(options.key));
    if (draft === undefined) {
      this.#forgetDraft();
      return;
    }
    const confirm = new ConfirmationModal(this.app);
    confirm.setTitle("Restore the unsaved drawing?");
    confirm.setContent(
      `This symbol has unsaved changes from ${new Date(draft.savedAt).toLocaleString()}.`,
    );
    confirm.addButton((button) =>
      button
        .setButtonText("Restore")
        .setCta()
        .setInitialFocus()
        .onClick(() => {
          this.#session.replace(restoreDraft(this.#options.document, draft));
          this.#changed();
        }),
    );
    confirm.addButton((button) =>
      button
        .setButtonText("Discard")
        .setDestructive()
        .onClick(() => {
          this.#forgetDraft();
        }),
    );
    confirm.open();
  }

  /**
   * Saves, then closes if nothing changed during the save. Strokes drawn
   * while it ran keep the editor open, since they are not saved yet.
   */
  async #saveAndClose(): Promise<void> {
    if (!(await this.#save())) return;
    if (this.#session.dirty) {
      this.#announce("Saved, except for the strokes drawn while saving");
      return;
    }
    this.#finish();
  }

  /**
   * Saves the drawing as it is now, with a stroke still being drawn ended
   * first. Only one save runs at a time; strokes drawn meanwhile stay
   * unsaved. A failed save says why and keeps the editor open. Returns
   * whether the drawing was saved.
   */
  #save(): Promise<boolean> {
    if (this.#saving !== undefined) return this.#saving;
    if (this.#disposed) return Promise.resolve(false);
    if (this.#session.drawing) {
      this.#session.end();
      this.#changed();
    }
    const document = this.#session.document;
    const base = this.#base;
    this.#announce("Saving…");
    this.#saving = (async () => {
      try {
        const { bytes, record } = await saveInk(
          document,
          base,
          this.#options.carried ?? [],
        );
        if (this.#disposed) throw new Error("Inkline was disabled");
        await this.#options.write(bytes, record);
        this.#session.markSaved(document);
        this.#announce("Saved");
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.#announce(`Not saved: ${reason}`);
        new Notice(`Could not save the symbol: ${reason}`);
        return false;
      } finally {
        this.#saving = undefined;
        this.#updateButtons();
        this.#keepDraft();
      }
    })();
    this.#updateButtons();
    return this.#saving;
  }
}
