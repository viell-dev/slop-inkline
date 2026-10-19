// The editor: a modal around a drawing session and its surface, with the
// tools, keyboard shortcuts, saving, drafts, and the question before unsaved
// work is closed.

import {
  ButtonComponent,
  ConfirmationModal,
  Modal,
  Notice,
  type App,
  type EventRef,
  type TAbstractFile,
} from "obsidian";
import type { CarriedChunk } from "../format/ink-file.ts";
import type { BaseLayer, InkRecord, Tool } from "../format/record.ts";
import {
  drawableBase,
  openInk,
  saveInk,
  type EditableInk,
} from "../ink/canvas.ts";
import { documentSpan, type InkDocument } from "../ink/document.ts";
import type { DrawableBase } from "../ink/render.ts";
import {
  draftBase,
  fingerprintOf,
  restoreDraft,
  sameTarget,
  type Draft,
  type DraftStore,
  type DraftTarget,
} from "./drafts.ts";
import { FileWatch, type Reading } from "./disk.ts";
import { PointerGate, reportsPressure } from "./pointer.ts";
import {
  brushSizes,
  DrawingSession,
  gridSpacing,
  type InputPoint,
} from "./session.ts";
import { fontGuides, type Guide } from "./guides.ts";
import { InkView, measureFont, surfaceWidth } from "./view.ts";

/** The symbol's file, as the editor reads it again to see if it changed. */
export interface SymbolFile {
  /** Where it is, following renames, or where it was once deleted. */
  readonly path: string;
  /** What it holds now, or undefined when no file is there. */
  read(): Promise<Uint8Array | undefined>;
}

/** The tools chosen in an editor, which the next one starts with. */
export interface EditorTools {
  readonly tool: Tool;
  readonly sizeIndex: number;
  readonly grid: boolean;
  readonly guides: boolean;
}

export interface EditorOptions {
  readonly title: string;
  readonly document: InkDocument;
  readonly base?: DrawableBase;
  readonly carried?: readonly CarriedChunk[];
  /** The document x to centre the surface on, in pixels. */
  readonly center: number;
  /** How wide the drawing is, in pixels, so that the surface shows it all. */
  readonly width?: number;
  /**
   * Writes a saved symbol: the first save of a new symbol creates its file
   * and inserts it. Rejects when anything could not be done, which keeps the
   * editor open with the drawing, so that the next save tries again.
   * `keepDraft` keeps the editor's draft at once, as before a step that a
   * draft must name, and returns whether it was kept. `holds` tells the
   * editor what the file holds as soon as the host has adopted or written
   * it, before any later step that can fail, such as inserting an embed, so
   * that the editor goes on comparing the file with that.
   */
  readonly write: (
    bytes: Uint8Array,
    record: InkRecord,
    keepDraft: () => boolean,
    holds: (fingerprint: string) => void,
  ) => Promise<void>;
  /**
   * The symbol's file: an existing symbol's, or a new one's once its first
   * save made it, and undefined before then. The editor reads it again when
   * the vault says it changed and before each save, so that a change made
   * elsewhere is never written over unasked.
   */
  readonly file?: () => SymbolFile | undefined;
  /** A fingerprint of the file as opened, for an existing symbol. */
  readonly fingerprint?: string;
  /** Where unsaved strokes are kept, and which symbol they belong to. */
  readonly drafts?: {
    readonly store: DraftStore;
    /** The symbol now: a new one is its file once the first save made it. */
    readonly target: () => DraftTarget;
    /**
     * Told when another editor's draft is restored, before this editor keeps
     * its own, so that a new symbol can finish with the file that draft's
     * first save made.
     */
    readonly restored?: (draft: Draft) => void;
  };
  /**
   * Opens the editor for the next symbol, whose embed follows this one's,
   * once this one is saved and inserted, with this editor's tools; undefined
   * where nothing follows, as for a symbol file opened from its menu.
   */
  readonly next?: (tools: EditorTools) => void;
  /** The tools to start with, as the editor before this one left them. */
  readonly tools?: EditorTools;
  /** Told when the editor opens and closes, so that its owner can track it. */
  readonly lifecycle?: {
    opened(editor: InkEditorModal): void;
    closed(editor: InkEditorModal): void;
  };
}

/** Whether `element` takes typing: a text field or editable content. */
function typing(element: Element | null): boolean {
  if (element?.instanceOf(HTMLElement) !== true) return false;
  return (
    element.isContentEditable ||
    element.instanceOf(HTMLTextAreaElement) ||
    element.instanceOf(HTMLSelectElement) ||
    (element.instanceOf(HTMLInputElement) &&
      !["button", "checkbox", "radio", "range", "submit"].includes(
        element.type,
      ))
  );
}

/** A save that stopped to ask a question, which says why without a notice. */
class Unsaved extends Error {}

const unreadable =
  "the file changed on disk, and this version of Inkline cannot read it";

export class InkEditorModal extends Modal {
  readonly #options: EditorOptions;
  readonly #session: DrawingSession;
  readonly #gate = new PointerGate();
  /** This editor's own draft, which no other editor writes. */
  readonly #draftId = crypto.randomUUID();
  /** The symbol's file as last opened, reloaded, or saved, and changes to it. */
  readonly #watch: FileWatch;
  /** The vault's reports of changes to files, while the editor is open. */
  #vaultEvents: EventRef[] = [];
  /** Whether the file is being read again, and whether to read it once more. */
  #checking = false;
  #recheck = false;
  /** The file's chunks to keep when it is saved, from the file last read. */
  #carried: readonly CarriedChunk[];
  /** The document the file held as opened or last reloaded. */
  #opened: InkDocument;
  /**
   * Whether the question about a change on disk is open, and the save it
   * goes on with if the drawing is kept.
   */
  #askingChanged = false;
  #resume: (() => void) | undefined;
  #view: InkView | undefined;
  #saving: Promise<boolean> | undefined;
  #closing = false;
  /** Set when disposed: nothing more is saved or written as a draft. */
  #retired = false;
  #frame: number | undefined;
  #resize: ResizeObserver | undefined;
  #status: HTMLElement | undefined;
  /** Base layer images decoded for drawing, by their PNG. */
  readonly #decoded = new Map<Uint8Array, DrawableBase>();
  /** The base layer placed where the document puts it, for drawing. */
  #placed: { layer: BaseLayer; drawable: DrawableBase } | undefined;
  /** Whether the last draft written was kept; storage can refuse one. */
  #draftKept = true;
  #guidesShown = true;
  /** The note font's lines, measured when the editor opens. */
  #fontGuides: readonly Guide[] = [];
  #previewLine: HTMLElement | undefined;
  #preview: HTMLCanvasElement | undefined;
  #fonts: FontFaceSet | undefined;
  #cssChange: EventRef | undefined;
  /**
   * The draft this editor restored, until its own draft or a save takes its
   * place: storage may refuse the editor's own at first.
   */
  #replacing: string | undefined;
  /** The draft this editor is offering back, held while it asks. */
  #offered: string | undefined;
  readonly #questions = new Set<Modal>();
  readonly #buttons = new Map<string, ButtonComponent>();

  constructor(app: App, options: EditorOptions) {
    super(app);
    this.#options = options;
    this.#session = new DrawingSession(options.document);
    if (options.tools !== undefined) {
      const { tool, sizeIndex, grid, guides } = options.tools;
      this.#session.tool = tool;
      this.#session.sizeIndex = sizeIndex;
      this.#session.snap = grid;
      this.#guidesShown = guides;
    }
    this.#watch = new FileWatch(options.fingerprint);
    this.#carried = options.carried ?? [];
    this.#opened = options.document;
    const { base } = options.document;
    if (base !== undefined && options.base !== undefined) {
      this.#decoded.set(base.png, options.base);
    }
  }

  /** The decoded base layer, where the document now puts it. */
  get #base(): DrawableBase | undefined {
    const layer = this.#session.document.base;
    if (layer === undefined) return undefined;
    const drawable = this.#decoded.get(layer.png);
    if (drawable === undefined) return undefined;
    if (this.#placed?.layer !== layer) {
      this.#placed = {
        layer,
        drawable: { ...drawable, x: layer.x, y: layer.y, scale: layer.scale },
      };
    }
    return this.#placed.drawable;
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
    this.#addButton(toolbar, "clear", "Clear", "Delete", () => {
      this.#clear();
    });
    this.#addButton(toolbar, "guides", "Guides", "G", () => {
      this.#toggleGuides();
    });
    this.#addButton(toolbar, "grid", "Grid", "Shift+G", () => {
      this.#toggleGrid();
    });
    this.#addButton(toolbar, "fit", "Fit", "F", () => {
      this.#fitView();
      this.#render();
    });
    this.#addButton(toolbar, "save", "Save", "Mod+Enter", () => {
      void this.#saveAndClose();
    });
    this.#buttons.get("save")?.setCta();
    if (this.#options.next !== undefined) {
      this.#addButton(
        toolbar,
        "next",
        "Next",
        "Mod+Shift+Enter",
        () => {
          void this.#saveAndNext();
        },
        "Save and draw the next one",
      );
    }

    const canvas = this.contentEl.createEl("canvas", {
      cls: "inkline-surface",
      attr: {
        tabindex: "0",
        role: "img",
        "aria-label": "Drawing area",
      },
    });
    // A line in the vault's text font and size, with the symbol at its size
    // there. Its font gives the guides.
    const line = this.contentEl.createDiv({
      cls: "inkline-preview",
      attr: { "aria-hidden": "true" },
    });
    line.createSpan({ text: "A line of text with " });
    this.#preview = line.createEl("canvas", { cls: "inkline-preview-ink" });
    line.createSpan({ text: " in it." });
    this.#previewLine = line;
    this.#measure();
    // The font can arrive later, as a theme's web font, or change with the
    // theme or a CSS snippet; then the guides are measured again.
    line.doc.fonts.addEventListener("loadingdone", this.#remeasure);
    this.#fonts = line.doc.fonts;
    void line.doc.fonts.ready.then(this.#remeasure);
    this.#cssChange = this.app.workspace.on("css-change", this.#remeasure);
    this.#watchFile();
    this.#status = this.contentEl.createDiv({
      cls: "inkline-status",
      attr: { "aria-live": "polite" },
    });
    const view = new InkView(canvas, surfaceWidth(this.#options.width ?? 0));
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
    this.#options.drafts?.store.hold(this.#draftId);
    this.#options.lifecycle?.opened(this);
    // Obsidian moves the focus once the modal is open; take it back after.
    canvas.win.requestAnimationFrame(() => {
      canvas.focus();
    });
    void this.#offerDraft();
    // The file may have changed since it was read for opening.
    this.#checkFile();
  }

  override onClose(): void {
    for (const ref of this.#vaultEvents) this.app.vault.offref(ref);
    this.#vaultEvents = [];
    this.#resize?.disconnect();
    this.#fonts?.removeEventListener("loadingdone", this.#remeasure);
    if (this.#cssChange !== undefined) {
      this.app.workspace.offref(this.#cssChange);
    }
    if (this.#frame !== undefined) {
      this.#view?.canvas.win.cancelAnimationFrame(this.#frame);
    }
    for (const question of [...this.#questions]) question.close();
    this.contentEl.empty();
    const store = this.#options.drafts?.store;
    store?.release(this.#draftId);
    if (this.#replacing !== undefined) store?.release(this.#replacing);
    if (this.#offered !== undefined) store?.release(this.#offered);
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
    this.#ask(
      "Save this symbol?",
      "The drawing has changes that are not saved.",
      [
        {
          text: "Save",
          primary: true,
          // The question closes at once; a failed save then leaves the editor
          // open and says why.
          act: () => void this.#saveAndClose(),
        },
        {
          text: "Discard",
          destructive: true,
          act: () => {
            this.#forgetDraft();
            this.#finish();
          },
        },
      ],
      "Keep drawing",
    );
  }

  /**
   * Closes the editor without asking, as when the plugin unloads: unsaved
   * strokes are kept as a draft, its questions close, and nothing more is
   * saved or written as a draft, even by a save still running.
   */
  dispose(): void {
    if (this.#retired) return;
    this.#session.end();
    if (!this.#keepDraft()) {
      new Notice(
        `Inkline could not keep a draft of the latest changes to ${this.#options.title}.`,
      );
    }
    this.#retired = true;
    this.#finish();
  }

  #finish(): void {
    this.#closing = true;
    this.close();
  }

  /**
   * Asks a question in a modal of its own, which closes with the editor. Its
   * answers do nothing once the editor has closed. `dismissed` runs when it
   * closes without an answer.
   */
  #ask(
    title: string,
    content: string,
    answers: readonly {
      text: string;
      primary?: boolean;
      destructive?: boolean;
      act: () => void;
    }[],
    cancel: string,
    dismissed?: () => void,
  ): void {
    const question = new ConfirmationModal(this.app);
    question.setTitle(title);
    question.setContent(content);
    let answered = false;
    for (const answer of answers) {
      question.addButton((button) => {
        button.setButtonText(answer.text).onClick(() => {
          answered = true;
          if (!this.#retired && !this.#closing) answer.act();
        });
        if (answer.primary === true) button.setCta().setInitialFocus();
        if (answer.destructive === true) button.setDestructive();
        return button;
      });
    }
    question.addCancelButton(cancel);
    question.setCloseCallback(() => {
      this.#questions.delete(question);
      if (!answered) dismissed?.();
    });
    this.#questions.add(question);
    question.open();
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

  /**
   * The editor's shortcuts. Those that would also edit text, the single keys
   * and undo and redo, yield to a text field that has the focus; saving
   * does not.
   */
  #registerKeys(): void {
    const key = (
      modifiers: ("Mod" | "Shift")[],
      name: string,
      action: () => void,
      yields = true,
    ): void => {
      this.scope.register(modifiers, name, () => {
        if (yields && typing(activeDocument.activeElement)) return true;
        action();
        return false;
      });
    };
    key(["Mod"], "Enter", () => void this.#saveAndClose(), false);
    if (this.#options.next !== undefined) {
      key(["Mod", "Shift"], "Enter", () => void this.#saveAndNext(), false);
    }
    key(["Mod"], "s", () => void this.#save(), false);
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
    key([], "g", () => {
      this.#toggleGuides();
    });
    key(["Shift"], "g", () => {
      this.#toggleGrid();
    });
    key([], "f", () => {
      this.#fitView();
      this.#render();
    });
    // A Mac's key labelled Delete sends Backspace.
    for (const name of ["Delete", "Backspace"]) {
      key([], name, () => {
        this.#clear();
      });
    }
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
      // A release, unlike a lost capture, says where the pointer ended.
      else if (event.type === "lostpointercapture") this.#session.end();
      else this.#session.end(point(event));
      this.#changed();
    };
    canvas.addEventListener("pointerdown", (event) => {
      const tool = this.#gate.down(event);
      if (tool === undefined) return;
      event.preventDefault();
      // Drawing takes the focus, which the default action would have, so
      // that the shortcuts are the editor's again after typing elsewhere.
      canvas.focus({ preventScroll: true });
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
      // Shift draws a straight segment while it is held.
      this.#session.extend(
        (events.length > 0 ? events : [event]).map(point),
        event.shiftKey,
      );
      this.#render();
    });
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("lostpointercapture", finish);
    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
  }

  /** Fits the surface to the whole drawing, as one restored from a draft. */
  #fitView(): void {
    const view = this.#view;
    if (view === undefined) return;
    const span = documentSpan(this.#session.document, this.#base?.width);
    if (span === undefined) return;
    view.fit(span.left, span.right);
    view.resize(view.canvas.clientWidth, view.canvas.win.devicePixelRatio);
  }

  #render(): void {
    const view = this.#view;
    if (this.#frame !== undefined || view === undefined) return;
    // The surface's own window, which differs from the main one in a popout.
    this.#frame = view.canvas.win.requestAnimationFrame(() => {
      this.#frame = undefined;
      view.lines = this.#guidesShown ? this.#fontGuides : undefined;
      view.grid = this.#session.snap
        ? { spacing: gridSpacing, originX: this.#session.gridOrigin }
        : undefined;
      view.render(
        this.#session.document,
        this.#base,
        this.#session.activeStroke,
      );
      const line = this.#previewLine;
      if (this.#preview !== undefined && line !== undefined) {
        view.drawPreview(
          this.#preview,
          Number.parseFloat(getComputedStyle(line).fontSize),
        );
      }
    });
  }

  /** Measures the preview line's font for the guides. */
  #measure(): void {
    const line = this.#previewLine;
    if (line === undefined) return;
    const font = getComputedStyle(line);
    this.#fontGuides = fontGuides(
      measureFont(
        {
          style: font.fontStyle,
          weight: font.fontWeight,
          family: font.fontFamily,
        },
        line.doc,
      ),
    );
  }

  /** Measures the font again and redraws, as after a font loads. */
  readonly #remeasure = (): void => {
    if (this.#closing || this.#retired) return;
    this.#measure();
    this.#render();
  };

  #toggleGuides(): void {
    this.#guidesShown = !this.#guidesShown;
    this.#updateButtons();
    this.#render();
  }

  /** Shows the grid, and snaps strokes' ends to it, or neither. */
  #toggleGrid(): void {
    this.#session.snap = !this.#session.snap;
    this.#updateButtons();
    this.#render();
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
    pressed("guides", this.#guidesShown);
    pressed("grid", this.#session.snap);
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

  /**
   * Keeps this editor's unsaved drawing as its draft, or drops it once saved,
   * and returns whether the drawing is safe: saved, or kept. When storage
   * refuses a draft, the last one kept stays, and a notice says so once.
   */
  #keepDraft(): boolean {
    const drafts = this.#options.drafts;
    if (drafts === undefined || this.#retired) return true;
    // While a save runs, the file holds the drawing as it was or as the save
    // writes it, so the draft is kept, and keeps its own base layer.
    const pending = this.#saving !== undefined;
    if (!pending && !this.#session.dirty) {
      this.#forgetDraft();
      return true;
    }
    const { document, saved } = this.#session;
    const kept = drafts.store.put({
      id: this.#draftId,
      target: drafts.target(),
      strokes: document.strokes,
      base: draftBase(document, pending ? undefined : saved),
      ...(this.#watch.fingerprint === undefined
        ? {}
        : { fingerprint: this.#watch.fingerprint }),
      savedAt: Date.now(),
      gridOrigin: this.#session.gridOrigin,
    });
    if (!kept && this.#draftKept) {
      this.#announce("Draft not kept");
      new Notice(
        "Inkline could not keep a draft of the latest changes, because the vault's local storage refused it. Save the symbol to keep them.",
      );
    } else if (
      kept &&
      !this.#draftKept &&
      this.#status?.getText() === "Draft not kept"
    ) {
      this.#announce("Draft kept");
    }
    this.#draftKept = kept;
    if (kept) this.#replaced();
    return kept;
  }

  /**
   * Drops this editor's own draft, and the one it restored, which its
   * drawing has taken the place of; never another's.
   */
  #forgetDraft(): void {
    if (this.#retired) return;
    this.#options.drafts?.store.remove(this.#draftId);
    this.#draftKept = true;
    this.#replaced();
  }

  /** Drops the draft this editor restored, once nothing needs it. */
  #replaced(): void {
    const replacing = this.#replacing;
    if (replacing === undefined) return;
    this.#replacing = undefined;
    this.#options.drafts?.store.remove(replacing);
    this.#options.drafts?.store.release(replacing);
  }

  /**
   * Offers back the newest draft another editor left for this symbol, once
   * any base layer it keeps is decoded, holding it meanwhile so that no other
   * editor offers it too. Dismissing the question keeps the draft for next
   * time; only Restore or Discard use it up, and Restore only once this
   * editor's own draft has taken its place.
   */
  async #offerDraft(): Promise<void> {
    const drafts = this.#options.drafts;
    if (drafts === undefined) return;
    const [found] = drafts.store.forTarget(drafts.target());
    if (found === undefined) return;
    drafts.store.hold(found.id);
    this.#offered = found.id;
    const letGo = (): void => {
      drafts.store.release(found.id);
      this.#offered = undefined;
    };
    let readable = found.base.kind !== "lost";
    if (found.base.kind === "kept") {
      const { layer } = found.base;
      try {
        this.#decoded.set(layer.png, await drawableBase(layer));
      } catch {
        readable = false;
      }
      // Meanwhile the editor may have closed, saved a new symbol into its
      // own file, started a save, or asked before closing: then the draft
      // waits for another time.
      if (
        this.#retired ||
        this.#closing ||
        this.#saving !== undefined ||
        this.#questions.size > 0 ||
        !sameTarget(drafts.target(), found.target)
      ) {
        letGo();
        return;
      }
    }
    const draft: Draft = readable
      ? found
      : { ...found, base: { kind: "none" } };
    const unreadable = readable
      ? ""
      : " Its base layer cannot be read, so only its strokes would come back.";
    const moved =
      // A new symbol's editor has no file yet to compare the draft's with.
      draft.fingerprint !== undefined &&
      this.#watch.fingerprint !== undefined &&
      draft.fingerprint !== this.#watch.fingerprint
        ? " The symbol was saved again since then, so its strokes may not line up."
        : "";
    this.#ask(
      "Restore the unsaved drawing?",
      `This symbol has unsaved changes from ${new Date(draft.savedAt).toLocaleString()}.${moved}${unreadable}`,
      [
        {
          text: "Restore",
          primary: true,
          act: () => {
            // A stroke begun while the draft was read is committed first, so
            // that undoing the restore brings it back.
            this.#session.end();
            this.#session.replace(
              restoreDraft(this.#opened, draft),
              draft.gridOrigin,
            );
            drafts.restored?.(draft);
            // Still held: offered to no other editor until this one's own
            // replaces it.
            this.#offered = undefined;
            this.#replacing = draft.id;
            this.#fitView();
            this.#updateButtons();
            this.#render();
            this.#keepDraft();
          },
        },
        {
          text: "Discard",
          destructive: true,
          act: () => {
            drafts.store.remove(draft.id);
            letGo();
          },
        },
      ],
      "Not now",
      letGo,
    );
  }

  /** Follows the vault's reports of changes to the symbol's file. */
  #watchFile(): void {
    const vault = this.app.vault;
    const touched = (file: TAbstractFile, oldPath?: string): void => {
      const path = this.#options.file?.()?.path;
      if (path !== undefined && (file.path === path || oldPath === path)) {
        this.#checkFile();
      }
    };
    this.#vaultEvents = [
      vault.on("modify", (file) => {
        touched(file);
      }),
      vault.on("delete", (file) => {
        touched(file);
      }),
      vault.on("create", (file) => {
        touched(file);
      }),
      vault.on("rename", (file, oldPath) => {
        touched(file, oldPath);
      }),
    ];
  }

  /**
   * Reads the symbol's file again, as after the vault reports a change to
   * it, and responds to what changed. A save reads it itself, so a check
   * waits for a running save, and one asked for meanwhile runs after it.
   */
  #checkFile(): void {
    if (this.#retired || this.#closing) return;
    if (this.#checking || this.#saving !== undefined) {
      this.#recheck = true;
      return;
    }
    this.#checking = true;
    const known = this.#watch.version;
    void this.#readFile()
      .then((found) => {
        if (found === undefined || this.#retired || this.#closing) return;
        // A save that ran meanwhile, or a reload, makes the read stale.
        if (this.#saving !== undefined || this.#watch.version !== known) {
          this.#recheck = true;
          return;
        }
        this.#respond(found.reading, found.opened);
      })
      // A file that cannot be read now is read again at the next report, and
      // a save reads it itself.
      .catch(() => undefined)
      .finally(() => {
        this.#checking = false;
        if (this.#recheck) {
          this.#recheck = false;
          this.#checkFile();
        }
      });
  }

  /**
   * The symbol's file read again: a reading to compare, and the file opened
   * for editing when it changed and can be. Undefined while there is no file,
   * as before a new symbol's first save.
   */
  async #readFile(): Promise<
    { reading: Reading; opened?: EditableInk } | undefined
  > {
    const file = this.#options.file?.();
    if (file === undefined) return undefined;
    const bytes = await file.read();
    if (bytes === undefined) return { reading: { kind: "gone" } };
    const fingerprint = await fingerprintOf(bytes);
    if (!this.#watch.differs(fingerprint)) {
      return { reading: { kind: "file", fingerprint, readable: true } };
    }
    let opened: EditableInk | undefined;
    try {
      const ink = await openInk(bytes);
      if (ink.kind === "editable") opened = ink;
    } catch {
      // Not a PNG that decodes, so not readable.
    }
    return {
      reading: { kind: "file", fingerprint, readable: opened !== undefined },
      ...(opened === undefined ? {} : { opened }),
    };
  }

  /** Responds to the file as read while editing. */
  #respond(reading: Reading, opened: EditableInk | undefined): void {
    const action = this.#watch.noticed(reading, this.#session.dirty);
    if (action === "gone") {
      this.#announce("The file was deleted; saving makes it again");
      return;
    }
    if (reading.kind !== "file") return;
    if (action === "unreadable") {
      this.#announce(`Not reloaded: ${unreadable}`);
      new Notice(
        `${this.#options.title} changed on disk, and this version of Inkline cannot read it, so the editor will not save over it.`,
      );
    } else if (action === "reload" && opened !== undefined) {
      this.#reload(reading.fingerprint, opened);
    } else if (action === "ask") {
      this.#askChanged(reading.fingerprint);
    }
  }

  /**
   * Asks what to do about a change made to the file elsewhere: reload it, or
   * keep the drawing, so that saving replaces the change. `resume` goes on
   * with a save that stopped to ask. One such question is open at a time; a
   * save that stops while it is open goes on once it is answered.
   */
  #askChanged(fingerprint: string, resume?: () => void): void {
    if (resume !== undefined) this.#resume = resume;
    if (this.#askingChanged) return;
    this.#askingChanged = true;
    const answered = (): (() => void) | undefined => {
      const then = this.#resume;
      this.#askingChanged = false;
      this.#resume = undefined;
      return then;
    };
    this.#ask(
      "The symbol changed on disk",
      `${this.#options.title} was changed outside this editor. Reload it to take that change in; Undo then brings your drawing back while the editor is open. Or keep your drawing, and saving it replaces the change.`,
      [
        {
          text: "Reload",
          primary: true,
          act: () => {
            answered();
            void this.#reloadFile();
          },
        },
        {
          text: "Keep mine",
          act: () => {
            const then = answered();
            this.#watch.keep(fingerprint);
            then?.();
          },
        },
      ],
      "Not now",
      () => void answered(),
    );
  }

  /** Reads the file again and takes in what it now holds, as Reload asks. */
  async #reloadFile(): Promise<void> {
    const known = this.#watch.version;
    const found = await this.#readFile();
    if (found === undefined || this.#retired || this.#closing) return;
    // A save or reload meanwhile makes the read stale: a fresh check decides.
    if (this.#saving !== undefined || this.#watch.version !== known) {
      this.#checkFile();
      return;
    }
    const { reading, opened } = found;
    if (reading.kind === "gone") {
      this.#announce("The file was deleted; saving makes it again");
    } else if (!this.#watch.differs(reading.fingerprint)) {
      // Changed back meanwhile: the drawing already follows it.
    } else if (opened === undefined) {
      this.#announce(`Not reloaded: ${unreadable}`);
    } else {
      this.#reload(reading.fingerprint, opened);
    }
  }

  /**
   * Takes in what the file now holds, as one step that Undo takes back, so
   * that the drawing it replaces is not lost while the editor is open.
   */
  #reload(fingerprint: string, opened: EditableInk): void {
    // A stroke being drawn is committed first, so that Undo brings it back.
    this.#session.end();
    const { document, base, carried } = opened;
    if (document.base !== undefined && base !== undefined) {
      this.#decoded.set(document.base.png, base);
    }
    this.#carried = carried;
    this.#opened = document;
    this.#session.replace(document);
    this.#session.markSaved(document);
    this.#watch.took(fingerprint);
    this.#fitView();
    this.#changed();
    this.#announce("Reloaded: the file changed on disk");
  }

  /**
   * Saves, then opens the editor for the next symbol, whose embed follows
   * this one's, with the same tools. As with Save and close, strokes drawn
   * while the save ran keep this editor open instead.
   */
  async #saveAndNext(): Promise<void> {
    const next = this.#options.next;
    if (next === undefined) return;
    if (!(await this.#save(() => void this.#saveAndNext()))) return;
    if (this.#session.dirty) {
      this.#announce("Saved, except for the strokes drawn while saving");
      return;
    }
    const { tool, sizeIndex, snap } = this.#session;
    this.#finish();
    next({ tool, sizeIndex, grid: snap, guides: this.#guidesShown });
  }

  /**
   * Saves, then closes if nothing changed during the save. Strokes drawn
   * while it ran keep the editor open, since they are not saved yet.
   */
  async #saveAndClose(): Promise<void> {
    if (!(await this.#save(() => void this.#saveAndClose()))) return;
    if (this.#session.dirty) {
      this.#announce("Saved, except for the strokes drawn while saving");
      return;
    }
    this.#finish();
  }

  /**
   * Saves the drawing as it is now, with a stroke still being drawn ended
   * first. Only one save runs at a time; strokes drawn meanwhile stay
   * unsaved. After a save, the session moves into the saved file's
   * coordinates. A failed save says why and keeps the editor open. Returns
   * whether the drawing was saved.
   *
   * The file is read again first. If something else changed it, the editor
   * asks before writing over the change, and `resume` saves again if the
   * answer is to; a file it cannot read is never written over.
   */
  #save(resume: () => void = () => void this.#save()): Promise<boolean> {
    if (this.#saving !== undefined) return this.#saving;
    if (this.#retired) return Promise.resolve(false);
    if (this.#session.drawing) {
      this.#session.end();
      this.#changed();
    }
    const document = this.#session.document;
    const base = this.#base;
    this.#announce("Saving…");
    this.#saving = (async () => {
      try {
        const { bytes, record, left } = await saveInk(
          document,
          base,
          this.#carried,
        );
        const found = await this.#readFile();
        if (this.#retired) throw new Error("Inkline was disabled");
        if (found !== undefined) {
          const action = this.#watch.saving(found.reading);
          if (action === "unreadable") throw new Error(unreadable);
          if (action === "ask" && found.reading.kind === "file") {
            this.#askChanged(found.reading.fingerprint, resume);
            throw new Unsaved("the file changed on disk");
          }
        }
        // Kept before the file can change, with its own base layer, so that
        // the draft does not depend on which version the file holds.
        const written = await fingerprintOf(bytes);
        this.#keepDraft();
        await this.#options.write(
          bytes,
          record,
          () => this.#keepDraft(),
          (fingerprint) => {
            this.#watch.took(fingerprint);
          },
        );
        this.#watch.took(written);
        this.#session.markSaved(document);
        this.#session.rebase(-left);
        this.#view?.shift(-left);
        this.#announce("Saved");
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.#announce(`Not saved: ${reason}`);
        if (!(error instanceof Unsaved)) {
          new Notice(`Could not save the symbol: ${reason}`);
        }
        return false;
      } finally {
        this.#saving = undefined;
        this.#updateButtons();
        this.#render();
        this.#keepDraft();
        // Changes reported while it ran, its own write among them.
        this.#checkFile();
      }
    })();
    this.#updateButtons();
    return this.#saving;
  }
}
