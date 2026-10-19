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
import type { BaseLayer, InkRecord } from "../format/record.ts";
import { drawableBase, saveInk } from "../ink/canvas.ts";
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
import { PointerGate, reportsPressure } from "./pointer.ts";
import { brushSizes, DrawingSession, type InputPoint } from "./session.ts";
import { cropSpan, fontGuides, joinSpans, type Guide } from "./guides.ts";
import { InkView, measureFont, surfaceWidth } from "./view.ts";

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
   * draft must name, and returns whether it was kept.
   */
  readonly write: (
    bytes: Uint8Array,
    record: InkRecord,
    keepDraft: () => boolean,
  ) => Promise<void>;
  /** Where unsaved strokes are kept, and which symbol they belong to. */
  readonly drafts?: {
    readonly store: DraftStore;
    /** The symbol now: a new one is its file once the first save made it. */
    readonly target: () => DraftTarget;
    /** A fingerprint of the file as opened, for an existing symbol. */
    readonly fingerprint?: string;
    /**
     * Told when another editor's draft is restored, before this editor keeps
     * its own, so that a new symbol can finish with the file that draft's
     * first save made.
     */
    readonly restored?: (draft: Draft) => void;
  };
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
  /** This editor's own draft, which no other editor writes. */
  readonly #draftId = crypto.randomUUID();
  /** A fingerprint of the file as last opened or saved. */
  #fingerprint: string | undefined;
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
  #spanOf:
    | {
        document: InkDocument;
        baseWidth: number | undefined;
        span: { left: number; right: number } | undefined;
      }
    | undefined;
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
    this.#fingerprint = options.drafts?.fingerprint;
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
    this.#addButton(toolbar, "clear", "Clear", undefined, () => {
      this.#clear();
    });
    this.#addButton(toolbar, "guides", "Guides", "G", () => {
      this.#toggleGuides();
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
    // A line in the note's font, with the symbol at its size there. Its
    // font gives the guides.
    const line = this.contentEl.createDiv({
      cls: "inkline-preview markdown-rendered",
      attr: { "aria-hidden": "true" },
    });
    line.createSpan({ text: "A line of text with " });
    this.#preview = line.createEl("canvas", { cls: "inkline-preview-ink" });
    line.createSpan({ text: " in it." });
    this.#previewLine = line;
    const font = getComputedStyle(line);
    this.#fontGuides = fontGuides(
      measureFont({
        style: font.fontStyle,
        weight: font.fontWeight,
        family: font.fontFamily,
      }),
    );
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
  }

  override onClose(): void {
    this.#resize?.disconnect();
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
    key([], "g", () => {
      this.#toggleGuides();
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
      // A release, unlike a lost capture, says where the pointer ended.
      else if (event.type === "lostpointercapture") this.#session.end();
      else this.#session.end(point(event));
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
      const { document } = this.#session;
      const active = this.#session.activeStroke;
      const image = cropSpan(
        joinSpans(
          this.#span(document),
          active === undefined
            ? undefined
            : documentSpan({ strokes: [active] }),
        ),
      );
      view.guides = this.#guidesShown
        ? { lines: this.#fontGuides, image }
        : undefined;
      view.render(document, this.#base, active);
      const line = this.#previewLine;
      if (this.#preview !== undefined && line !== undefined) {
        view.drawPreview(
          this.#preview,
          image.left,
          image.right,
          Number.parseFloat(getComputedStyle(line).fontSize),
        );
      }
    });
  }

  /** The extent of a committed document, remembered while it is current. */
  #span(document: InkDocument): { left: number; right: number } | undefined {
    const baseWidth = this.#base?.width;
    const known = this.#spanOf;
    if (known?.document === document && known.baseWidth === baseWidth) {
      return known.span;
    }
    const span = documentSpan(document, baseWidth);
    this.#spanOf = { document, baseWidth, span };
    return span;
  }

  #toggleGuides(): void {
    this.#guidesShown = !this.#guidesShown;
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
      ...(this.#fingerprint === undefined
        ? {}
        : { fingerprint: this.#fingerprint }),
      savedAt: Date.now(),
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
      draft.fingerprint !== undefined && draft.fingerprint !== this.#fingerprint
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
            this.#session.replace(restoreDraft(this.#options.document, draft));
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
   * unsaved. After a save, the session moves into the saved file's
   * coordinates. A failed save says why and keeps the editor open. Returns
   * whether the drawing was saved.
   */
  #save(): Promise<boolean> {
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
          this.#options.carried ?? [],
        );
        if (this.#retired) throw new Error("Inkline was disabled");
        // Kept before the file can change, with its own base layer, so that
        // the draft does not depend on which version the file holds.
        this.#keepDraft();
        await this.#options.write(bytes, record, () => this.#keepDraft());
        this.#fingerprint = await fingerprintOf(bytes);
        this.#session.markSaved(document);
        this.#session.rebase(-left);
        this.#view?.shift(-left);
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
        this.#render();
        this.#keepDraft();
      }
    })();
    this.#updateButtons();
    return this.#saving;
  }
}
