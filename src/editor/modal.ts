// The editor: a modal around a drawing session and its surface, with its
// controls, saving, drafts, and the question before unsaved work is closed.
// controls.ts makes the buttons and keys, which run the commands this
// implements, surface.ts holds the drawing area, which the pointer draws on,
// picture.ts holds the picture to trace over and Make ink, and keeping.ts
// keeps the drawing safe: drafts, the symbol's file, and saving.

import {
  ConfirmationModal,
  Modal,
  Notice,
  type App,
  type EventRef,
  type TAbstractFile,
} from "obsidian";
import type { Tool } from "../format/record.ts";
import type { SymbolText } from "../format/text.ts";
import {
  drawableBase,
  openInk,
  saveInk,
  type EditableInk,
} from "../ink/canvas.ts";
import { toUnits, type InkDocument } from "../ink/document.ts";
import type { DrawableBase } from "../ink/render.ts";
import {
  isBlank,
  noText,
  showValues,
  TextFields,
  textFields,
} from "../notes/text-fields.ts";
import {
  buttonStates,
  type ButtonLabels,
  type EditorCommands,
} from "./buttons.ts";
import { EditorControls, openHelp } from "./controls.ts";
import { keepsArrows, typing } from "./focus.ts";
import {
  DecodedBases,
  Keeping,
  usedText,
  type KeepingHost,
  type KeepingOptions,
  type Question,
} from "./keeping.ts";
import { StatusLine } from "./status.ts";
import { DrawingSession, type Shape } from "./session.ts";
import type { GuideName } from "./guides.ts";
import {
  pictureIn,
  PictureTracing,
  type TracedPicture,
  type TracingHost,
} from "./picture.ts";
import { isPicturePath, openLinkPath } from "./reference.ts";
import { EditorSurface, type SurfaceHost, type ViewWaits } from "./surface.ts";
import { surfaceWidth, type InkView } from "./view.ts";
import { markNotice } from "../notices.ts";

export type { SymbolFile, SymbolUses } from "./keeping.ts";

/** A symbol opened to start another from, and the name it goes by. */
export interface SymbolCopy {
  readonly name: string;
  readonly ink: EditableInk;
  /** Whether the symbol has text, which stays with it. */
  readonly hasText: boolean;
}

/** The tools chosen in an editor, which the next one starts with. */
export interface EditorTools {
  readonly tool: Tool;
  readonly sizeIndex: number;
  /** Both tools' sizes when continuing with Next. */
  readonly sizes?: Readonly<Record<Tool, number>>;
  readonly grid: boolean;
  /** Whether strokes end flat on the grid; a new editor's round ends. */
  readonly flatEnds?: boolean;
  readonly guides: boolean;
  /** Whether the drawing is magnified; Next keeps it so. */
  readonly magnified?: boolean;
  /** What the pointer draws; Next keeps it, and a new editor draws freehand. */
  readonly shape?: Shape;
  /** Whether shapes are filled; Next keeps it, and a new editor does not fill. */
  readonly fill?: boolean;
  /** Whether the text fields show; Next keeps them, and a new editor hides them. */
  readonly textShown?: boolean;
  /**
   * The picture being traced over, which the next editor takes over and
   * closes, with its x measured from the middle of the surface, so that it
   * stays where it was on the surface.
   */
  readonly picture?: TracedPicture;
}

/**
 * How far the arrow keys move a picture, in document pixels; with Shift
 * held, they move it one grid spacing.
 */
const nudge = 1;

/** What the status line says of a file opened from its pixels, and why. */
const noStrokes =
  "Opened as a picture to draw over, as this file holds no strokes: symbols saved before Inkline 0.9.2 open this way";

export interface EditorOptions extends KeepingOptions {
  readonly base?: DrawableBase;
  /** Whether its file held no strokes, so that its pixels opened instead. */
  readonly picture?: boolean;
  /**
   * What leaving a new symbol's name empty does now, as its field's
   * placeholder says after "leave it", or undefined for "for the next number".
   * Asked as the field is made, once a draft is restored, and as a file is
   * renamed, which can each change it.
   */
  readonly unnamed?: () => string | undefined;
  /** What its file says about the symbol; a new one says nothing. */
  readonly text?: SymbolText;
  /** The document x to centre the surface on, in pixels. */
  readonly center: number;
  /** How wide the drawing is, in pixels, so that the surface shows it all. */
  readonly width?: number;
  /**
   * Opens the editor for the next symbol, whose embed follows this one's,
   * once this one is saved and inserted, with this editor's tools; undefined
   * where nothing follows, as for a symbol file opened from its menu.
   */
  readonly next?: (tools: EditorTools) => void;
  /** The tools to start with, as the editor before this one left them. */
  readonly tools?: EditorTools;
  /**
   * Which of the font's lines the guides show, asked as they are drawn, so
   * that a change in the settings applies at once; all of them when undefined.
   */
  readonly guideLines?: () => ReadonlySet<GuideName>;
  /**
   * How many grid cells span the font's x-height, asked as the grid is laid
   * out; {@link defaultGridCells} when undefined.
   */
  readonly gridCells?: () => number;
  /** What the buttons show, as the editor opens; icons and text if undefined. */
  readonly buttonLabels?: ButtonLabels;
  /**
   * Asks which symbol to start from and opens it, for a new symbol drawn as
   * a variant of another; resolves to undefined when none is chosen or it
   * cannot be opened, and as soon as `closed` aborts, as when the editor
   * closes, with the choice closed too. Undefined where the editor has its
   * own symbol.
   */
  readonly copyFrom?: (closed: AbortSignal) => Promise<SymbolCopy | undefined>;
  /** Told when the editor opens and closes, so that its owner can track it. */
  readonly lifecycle?: {
    opened(editor: InkEditorModal): void;
    closed(editor: InkEditorModal): void;
  };
}

export class InkEditorModal extends Modal {
  readonly #options: EditorOptions;
  readonly #session: DrawingSession;
  /** Keeping the drawing safe: drafts, the file, and saving. */
  readonly #keeping: Keeping;
  /** The vault's reports of changes to files, while the editor is open. */
  #vaultEvents: EventRef[] = [];
  /** The field for the symbol's name, in the title's place. */
  #nameField: HTMLInputElement | undefined;
  /** The symbol's readings and translations, and what shows or hides them. */
  #textFields: TextFields | undefined;
  #textToggle: HTMLButtonElement | undefined;
  #textStrip: HTMLElement | undefined;
  /** The choice of a symbol to copy while it is open, to close with this. */
  #choosing: AbortController | undefined;
  /** The drawing area, once the editor has opened. */
  #surface: EditorSurface | undefined;
  /** Whether the editor is closing, as it does once asked to or done. */
  #closing = false;
  #status: HTMLElement | undefined;
  /**
   * What the status line says, which whatever the person does replaces, and
   * empties when it has nothing to say, as status.ts explains.
   */
  readonly #line = new StatusLine((text) => {
    this.#status?.setText(text);
  });
  /** Says that a save is waiting for Obsidian, which outlasts the status. */
  #saveWait: HTMLElement | undefined;
  /** Base layer images decoded for drawing, by their PNG. */
  readonly #decoded = new DecodedBases();
  #guidesShown = true;
  /** The picture to trace over, and Make ink. */
  readonly #tracing: PictureTracing;
  /** The document whose pastes the editor takes, while it is open. */
  #pasteDocument: Document | undefined;
  readonly #questions = new Set<Modal>();
  /** The buttons, the picture's and Make ink's bars, and the keys. */
  #controls: EditorControls | undefined;

  constructor(app: App, options: EditorOptions) {
    super(app);
    this.#options = options;
    this.#session = new DrawingSession(options.document);
    if (options.tools !== undefined) {
      const { tool, sizeIndex, grid, guides } = options.tools;
      this.#session.tool = tool;
      this.#session.shape = options.tools.shape ?? "free";
      this.#session.fill = options.tools.fill === true;
      Object.assign(
        this.#session.sizes,
        options.tools.sizes ?? {
          pen: sizeIndex,
          eraser: sizeIndex,
        },
      );
      this.#session.snap = grid;
      this.#session.flatEnds = options.tools.flatEnds === true;
      this.#guidesShown = guides;
    }
    this.#tracing = new PictureTracing(this.#tracingHost());
    this.#keeping = new Keeping(options, {
      host: this.#keepingHost(),
      session: this.#session,
      decoded: this.#decoded,
      line: this.#line,
      codec: { save: saveInk, open: openInk, drawableBase },
      picture: this.#tracing,
    });
    const { base } = options.document;
    if (base !== undefined && options.base !== undefined) {
      this.#decoded.set(base.png, options.base);
    }
  }

  /** The decoded base layer, where the document now puts it. */
  get #base(): DrawableBase | undefined {
    return this.#decoded.placed(this.#session.document.base);
  }

  override open(): void {
    super.open();
    // Obsidian chooses its initial focus after onOpen. Take the drawing's
    // focus immediately, before a shortcut can type in the name field.
    this.#surface?.focus();
  }

  override onOpen(): void {
    this.modalEl.addClass("inkline-editor");
    this.#addNameField();
    this.#addTextFields();
    const controls = new EditorControls(this.contentEl, {
      commands: this.#commands(),
      line: this.#line,
      labels: this.#options.buttonLabels ?? "both",
      offers: {
        copyFrom: this.#options.copyFrom !== undefined,
        next: this.#options.next !== undefined,
      },
    });
    this.#controls = controls;
    this.#pasteDocument = this.modalEl.doc;
    this.#pasteDocument.addEventListener("paste", this.#paste);

    const surface = new EditorSurface(this.contentEl, {
      host: this.#surfaceHost(),
      session: this.#session,
      line: this.#line,
      picture: this.#tracing,
      labelId: `inkline-drawing-${this.#keeping.draftId}`,
      width: surfaceWidth(this.#options.width ?? 0),
      center: this.#options.center,
      magnified: this.#options.tools?.magnified === true,
      guideLines: this.#options.guideLines,
      gridCells: this.#options.gridCells,
    });
    this.#surface = surface;
    this.#watchFile();
    this.#status = this.contentEl.createDiv({
      cls: "inkline-status",
      attr: { "aria-live": "polite" },
    });
    if (this.#options.picture === true) this.#announce(noStrokes);
    this.#saveWait = this.contentEl.createDiv({
      cls: "inkline-save-wait",
      attr: { role: "alert" },
    });
    // The editor before this one's picture, where it was on the surface.
    const carried = this.#options.tools?.picture;
    if (carried !== undefined) {
      this.#tracing.takeOver(carried, surface.view.center);
    }
    controls.registerKeys(this.scope);
    surface.watchSize();
    this.#updateButtons();
    this.#render();
    this.#keeping.holdDraft();
    this.#options.lifecycle?.opened(this);
    void this.#keeping.offerDraft();
    // The file may have changed since it was read for opening.
    this.#keeping.checkFile();
  }

  /** What the editor's buttons and keys do, for its controls to call. */
  #commands(): EditorCommands {
    return {
      setTool: (tool) => {
        this.#setTool(tool);
      },
      toggleEllipse: () => {
        this.#toggleEllipse();
      },
      togglePolygon: () => {
        this.#togglePolygon();
      },
      togglePath: () => {
        this.#togglePath();
      },
      finishPath: () => {
        this.#finishPath();
      },
      toggleFill: () => {
        this.#toggleFill();
      },
      setSize: (index) => {
        this.#setSize(index);
      },
      undo: () => {
        this.#undo();
      },
      redo: () => {
        this.#redo();
      },
      clear: () => {
        this.#clear();
      },
      moveDrawing: (direction, byCell) => {
        this.#moveDrawing(direction, byCell);
      },
      toggleGuides: () => {
        this.#toggleGuides();
      },
      toggleGrid: () => {
        this.#toggleGrid();
      },
      toggleFlatEnds: () => {
        this.#toggleFlatEnds();
      },
      copy: () => void this.#copy(),
      fit: () => {
        this.#surface?.fit();
      },
      toggleZoom: () => {
        this.#surface?.toggleZoom();
      },
      saveAndClose: () => void this.#keeping.saveAndClose(),
      saveOnly: () => void this.#keeping.saveOnly(),
      saveAndNext: () => {
        this.#saveAndNext();
      },
      help: () => {
        this.#help();
      },
      choosePicture: () => {
        this.#controls?.choosePicture();
      },
      trace: (file) => void this.#tracing.trace(file),
      toggleMove: () => {
        this.#tracing.toggleMove();
      },
      toggleConvert: () => {
        this.#tracing.toggleConvert();
      },
      removePicture: () => {
        this.#tracing.remove();
      },
      setThreshold: (value) => {
        this.#tracing.setThreshold(value);
      },
      toggleLight: () => {
        this.#tracing.toggleLight();
      },
      applyInk: () => void this.#tracing.applyInk(),
      cancelInk: () => {
        this.#tracing.cancelInk();
      },
      endShape: (repeats) => {
        const canvas = this.#surface?.view.canvas;
        if (!this.#session.placing || activeDocument.activeElement !== canvas) {
          return false;
        }
        // Only a fresh press ends a shape or makes a waiting path ink.
        if (repeats) return true;
        // A path being placed waits, once it ends, to be adjusted; a second
        // Enter makes it ink, as a polygon's one does.
        if (this.#session.endPath()) this.#pathWaits();
        else this.#endPlacing();
        return true;
      },
      arrowKey: (name, shift) => this.#arrowKey(name, shift),
      movingPicture: () =>
        this.#tracing.moving && this.#tracing.picture !== undefined,
      nudgePicture: (dx, dy, byCell) => {
        if (this.#tracing.picture === undefined) return;
        // One grid spacing, as the grid is laid out now.
        const step = byCell ? this.#session.grid.spacing : nudge;
        this.#tracing.move(dx * step, dy * step);
      },
      scalePictureStep: (larger) => {
        this.#tracing.scaleStep(larger);
      },
      refocus: () => {
        this.#refocus();
      },
    };
  }

  /** What keeping the drawing safe is given of the editor. */
  #keepingHost(): KeepingHost {
    return {
      closing: () => this.#closing,
      say: (text, holds) => {
        this.#announce(text, holds);
      },
      notice: (text) => {
        markNotice(new Notice(text));
      },
      ask: (question) => {
        this.#ask(question);
      },
      questionsOpen: () => this.#questions.size > 0,
      onTop: () => this.#onTop(),
      updateControls: () => {
        this.#updateButtons();
      },
      requestRender: () => {
        this.#render();
      },
      fitView: () => {
        this.#surface?.fitView();
      },
      shift: (dx) => {
        this.#surface?.view.shift(dx);
        this.#tracing.moveWithDrawing(dx);
      },
      refocus: () => {
        this.#refocus();
      },
      finish: () => {
        this.#finish();
      },
      typedName: () => this.#nameField?.value,
      showName: (name, typed) => {
        const field = this.#nameField;
        if (field === undefined) return;
        field.placeholder = name;
        if (typed !== undefined && field.value === typed) field.value = name;
      },
      restoreName: (name) => {
        if (this.#nameField !== undefined) this.#nameField.value = name;
      },
      showUnnamed: () => {
        this.#showUnnamed();
      },
      text: () => this.#textFields,
      showText: () => {
        this.#showText(true);
      },
      showTextSummary: () => {
        this.#showTextSummary();
      },
      showWaiting: (text) => {
        this.#saveWait?.setText(text);
      },
      later: (then) => {
        this.modalEl.win.setTimeout(then);
      },
    };
  }

  /** What the drawing area is given of the editor. */
  #surfaceHost(): SurfaceHost {
    return {
      say: (text, holds) => {
        this.#announce(text, holds);
      },
      updateControls: () => {
        this.#updateButtons();
      },
      changed: () => {
        this.#changed();
      },
      shown: (view) => this.#shown(view),
      guidesShown: () => this.#guidesShown,
      released: (waits) => {
        this.#viewAfterPress(waits);
      },
      pathWaits: () => {
        this.#pathWaits();
      },
      drop: (data) => {
        this.#dropped(data);
      },
      ended: () => this.#ended(),
      overflow: () => this.modalEl.scrollHeight - this.modalEl.clientHeight,
      around: () => ({
        above: [this.#controls?.pictureBar].filter(
          (element) => element !== undefined,
        ),
        below: [this.#status, this.#saveWait].filter(
          (element) => element !== undefined,
        ),
      }),
      convertBarShown: () => this.#controls?.convertBarShown(),
      watchCss: (change) => {
        const ref = this.app.workspace.on("css-change", change);
        return () => {
          this.app.workspace.offref(ref);
        };
      },
    };
  }

  /** What the picture and Make ink are given of the editor. */
  #tracingHost(): TracingHost {
    return {
      view: () => this.#surface?.view,
      capHeight: () => this.#surface?.capHeight(),
      held: () => this.#surface?.held === true,
      ended: () => this.#ended(),
      say: (text, holds) => {
        this.#announce(text, holds);
      },
      requestRender: () => {
        this.#render();
      },
      updateControls: () => {
        this.#updateButtons();
      },
      endPlacing: () => {
        this.#endPlacing();
      },
      refocus: () => {
        this.#refocus();
      },
      focusThreshold: () => {
        this.#controls?.focusThreshold();
      },
      focusAfterApply: (open) => {
        // Disabling Apply while it ran let go of the focus; with no ink
        // made, the row stays open, and the focus goes back to Apply.
        const doc = this.modalEl.doc;
        const focused = doc.activeElement;
        if (focused !== null && focused !== doc.body) return;
        if (open) this.#controls?.focusButton("apply");
        else this.#refocus();
      },
      useInk: (made) => {
        // A stroke being drawn is committed first, so that Undo keeps it apart.
        this.#session.end();
        this.#decoded.set(made.layer.png, made.drawable);
        const { strokes, base } = this.#session.document;
        this.#session.replace(
          { strokes, base: made.layer },
          this.#session.gridOrigin,
        );
        return base !== undefined;
      },
      changed: () => {
        this.#changed();
      },
    };
  }

  override onClose(): void {
    // A choice of symbol to copy goes with the editor that asked for it.
    this.#choosing?.abort();
    for (const ref of this.#vaultEvents) this.app.vault.offref(ref);
    this.#vaultEvents = [];
    this.#surface?.dispose();
    for (const question of [...this.#questions]) question.close();
    this.#pasteDocument?.removeEventListener("paste", this.#paste);
    // Pictures still being decoded are closed as they arrive.
    this.#tracing.dispose();
    this.contentEl.empty();
    this.#keeping.release();
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
    this.#line.act(() => {
      this.#closeAsked();
    });
  }

  /** What {@link close} does while the editor is open: Esc, for one. */
  #closeAsked(): void {
    // A polygon or path being placed is dropped first, and the editor stays
    // open.
    if (this.#session.placing) {
      const path = this.#session.placingPath;
      this.#session.cancel();
      this.#announce(path ? "Path dropped" : "Polygon dropped");
      this.#updateButtons();
      this.#render();
      return;
    }
    const keeping = this.#keeping;
    if (keeping.saving) {
      keeping.announceSaving();
      return;
    }
    // Ink being previewed is unsaved too: Save makes it, as saving does.
    if (!keeping.unsaved && !this.#tracing.previewing()) {
      keeping.forgetDraft();
      this.#finish();
      return;
    }
    // One question for a symbol used more than once, rather than two.
    const uses = keeping.sharedUses();
    const name = keeping.displayName;
    this.#ask({
      title:
        uses === undefined
          ? "Save this symbol?"
          : `Save the changes to ${name}?`,
      content:
        uses === undefined
          ? "The drawing has changes that are not saved."
          : `The drawing has changes that are not saved. ${usedText(name, uses)} Replace changes it in all of them. For a variant that leaves them as they are, start a new symbol with Copy from instead.`,
      answers: [
        {
          text: uses === undefined ? "Save" : "Replace",
          primary: true,
          // The question closes at once; a failed save then leaves the editor
          // open and says why.
          act: () => {
            if (uses !== undefined) keeping.chooseReplace();
            void keeping.saveAndClose();
          },
        },
        {
          text: "Discard",
          destructive: true,
          act: () => {
            keeping.forgetDraft();
            this.#finish();
          },
        },
      ],
      cancel: "Keep drawing",
    });
  }

  /**
   * Closes the editor without asking, as when the plugin unloads: unsaved
   * strokes are kept as a draft, its questions close, and nothing more is
   * saved or written as a draft, even by a save still running, which only
   * settles that draft as it ends ({@link Keeping.retire}).
   */
  dispose(): void {
    if (this.#keeping.retire()) this.#finish();
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
  #ask({ title, content, answers, cancel, dismissed }: Question): void {
    const question = new ConfirmationModal(this.app);
    question.setTitle(title);
    question.setContent(content);
    let answered = false;
    for (const answer of answers) {
      question.addButton((button) => {
        button.setButtonText(answer.text).onClick(() => {
          answered = true;
          if (!this.#ended()) this.#line.act(answer.act);
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

  /**
   * Puts a field for the symbol's name in the title's place. Enter goes back
   * to drawing; changing the name is a change to save, which drafts keep.
   */
  #addNameField(): void {
    this.titleEl.empty();
    const field = this.titleEl.createEl("input", {
      cls: "inkline-name",
      type: "text",
      value: this.#keeping.savedName,
      attr: {
        "aria-label": "Symbol name",
        placeholder:
          this.#keeping.savedName === ""
            ? this.#unnamedPlaceholder
            : this.#keeping.savedName,
        spellcheck: "false",
        autocomplete: "off",
      },
    });
    field.addEventListener("input", () => {
      this.#line.act(() => {
        this.#keeping.keepDraft();
      });
    });
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      this.#surface?.focus({ preventScroll: true });
    });
    this.#nameField = field;
  }

  /**
   * Puts the symbol's readings and translations behind a button beside its
   * name, which is no taller than the name, so that the editor gains no row for
   * a symbol nobody has said anything about. The button shows what they hold.
   */
  #addTextFields(): void {
    const id = `inkline-text-${this.#keeping.draftId}`;
    const toggle = this.titleEl.createEl("button", {
      cls: "inkline-text-toggle",
      attr: { type: "button", "aria-expanded": "false", "aria-controls": id },
    });
    const strip = this.contentEl.createDiv({
      cls: "inkline-text-strip",
      attr: { id },
    });
    strip.hide();
    this.#textToggle = toggle;
    this.#textStrip = strip;
    this.#textFields = new TextFields(
      strip,
      this.#options.text ?? noText,
      () => {
        this.#line.act(() => {
          this.#showTextSummary();
          this.#keeping.keepDraft();
        });
      },
    );
    toggle.addEventListener("click", () => {
      this.#line.act(() => {
        const open = !strip.isShown();
        this.#showText(open);
        if (open) this.#textFields?.focus();
        else this.#surface?.focus({ preventScroll: true });
      });
    });
    this.#showTextSummary();
    if (this.#options.tools?.textShown === true) this.#showText(true);
  }

  /**
   * Shows the fields, or leaves only the button, keeping what they hold. The
   * fields' row changes the editor's size, as the window's does, so a stroke
   * being drawn then ends where it showed if the drawing moved (#445).
   */
  #showText(open: boolean): void {
    this.#resized(() => {
      this.#textStrip?.toggle(open);
      this.#textToggle?.setAttribute("aria-expanded", String(open));
      this.#showTextSummary();
      this.#surface?.resizeView();
    });
    this.#render();
  }

  /**
   * Runs `change`, which changes the editor's size, as the drawing area
   * follows such a change ({@link EditorSurface.resized}), or alone while
   * the editor has not opened yet.
   */
  #resized(change: () => void): void {
    if (this.#surface === undefined) change();
    else this.#surface.resized(change);
  }

  /** Has the button say what the hidden fields hold, or what they are for. */
  #showTextSummary(): void {
    const toggle = this.#textToggle;
    if (toggle === undefined || this.#textFields === undefined) return;
    toggle.empty();
    const { values } = this.#textFields;
    // The fields show them themselves while they are open.
    if (isBlank(values) || toggle.getAttribute("aria-expanded") === "true") {
      toggle.setText("Readings and translations");
      return;
    }
    for (const field of textFields) {
      if (values[field].length > 0) showValues(toggle, field, values[field]);
    }
  }

  /** What the name field says while the symbol has no name yet. */
  get #unnamedPlaceholder(): string {
    return `${this.#options.title}: name it, or leave it ${this.#options.unnamed?.() ?? "for the next number"}`;
  }

  /** Shows what leaving the name empty does now, while it has none. */
  #showUnnamed(): void {
    if (this.#keeping.savedName !== "" || this.#nameField === undefined) {
      return;
    }
    this.#nameField.placeholder = this.#unnamedPlaceholder;
  }

  /** Traces over a picture dropped on the surface, or says why not. */
  #dropped(data: DataTransfer | null): void {
    const picture = pictureIn(data);
    if (picture !== undefined) {
      void this.#tracing.trace(picture);
      return;
    }
    // A picture in the vault, dragged from Obsidian's file explorer.
    const { vault } = this.app;
    const path = openLinkPath(
      data?.getData("text/uri-list") ?? "",
      vault.getName(),
    );
    const file = path === undefined ? null : vault.getFileByPath(path);
    if (file === null || !isPicturePath(file.path)) {
      this.#announce("Not traced: only a picture can be traced over");
      return;
    }
    void this.#tracing.trace(
      vault.readBinary(file).then((bytes) => new Blob([bytes])),
    );
  }

  /**
   * Takes a picture pasted into the editor while it is the modal on top and
   * asks nothing, unless a text field has the focus. Its questions open in
   * whichever window is active, so one can be open in another. Chromium
   * sends a paste to the focused element, or to the body when that cannot be
   * edited, as older versions do for the surface; a paste to the body is the
   * top editor's.
   */
  readonly #paste = (event: ClipboardEvent): void => {
    const doc = this.modalEl.doc;
    if (this.#ended() || this.#questions.size > 0) return;
    if (!this.#onTop()) return;
    if (
      !event.composedPath().includes(this.modalEl) &&
      event.target !== doc.body
    ) {
      return;
    }
    if (typing(doc.activeElement)) return;
    const picture = pictureIn(event.clipboardData);
    event.preventDefault();
    this.#line.act(() => {
      if (picture === undefined) {
        this.#announce("The clipboard holds no picture to trace over");
        return;
      }
      void this.#tracing.trace(picture);
    });
  };

  /**
   * Whether this editor is the modal on top: not under a question, a choice,
   * or another editor.
   */
  #onTop(): boolean {
    const modals = this.modalEl.doc.querySelectorAll(".modal-container");
    return modals.item(modals.length - 1) === this.containerEl;
  }

  /**
   * Puts the focus on the surface, as after a control that had it hides or
   * is disabled, which would leave it nowhere.
   */
  #refocus(): void {
    this.#surface?.focus({ preventScroll: true });
  }

  /**
   * The document and base layer to show: the drawing, or while making ink,
   * the drawing with the picture's ink at the threshold as its base layer.
   */
  #shown(view: InkView): {
    document: InkDocument;
    base: DrawableBase | undefined;
  } {
    const document = this.#session.document;
    return (
      this.#tracing.preview(view, document) ?? { document, base: this.#base }
    );
  }

  /** Whether the editor has closed, or Inkline was disabled. */
  #ended(): boolean {
    return this.#closing || this.#keeping.retired;
  }

  /**
   * What an arrow key does when no picture is being moved, unless a field
   * has the focus: the up and down keys move the drawing, by a grid cell's
   * width with `shift`, unless ink is being made of a picture; and the left
   * and right ones move a magnified view along it. Returns whether it did
   * anything.
   */
  #arrowKey(name: string, shift: boolean): boolean {
    const direction =
      name === "ArrowUp" ? -1 : name === "ArrowDown" ? 1 : undefined;
    if (direction === undefined) {
      return !shift && this.#surface?.panKey(name) === true;
    }
    if (
      this.#tracing.converting !== undefined ||
      keepsArrows(activeDocument.activeElement)
    ) {
      return false;
    }
    this.#moveDrawing(direction, shift);
    return true;
  }

  /**
   * Moves the whole drawing up or down by a pixel, or with `byCell` by a grid
   * cell's width, as Shift moves a picture. Not while a save is running: it
   * has read the drawing, and a move in the same undo step as that one would
   * leave no way back to what was saved.
   */
  #moveDrawing(direction: -1 | 1, byCell: boolean): void {
    if (this.#tracing.converting !== undefined || this.#keeping.saving) {
      return;
    }
    const step = byCell ? this.#session.grid.spacing : nudge;
    if (this.#session.moveDrawing(direction * toUnits(step))) this.#changed();
  }

  /**
   * Makes the changes to the view asked for while the pointer was pressed on
   * the surface, now that what was drawn has ended where the view put it, or
   * the picture dragged where the pointer left it, unless the editor has
   * closed meanwhile: Next takes a zoom asked for to the next symbol. They go
   * as one action, so that the status line says what they did, or nothing,
   * rather than what waited. Make ink opens or closes as asked, unless it
   * already is so, as when the picture it was open for was replaced, but does
   * not open behind a question that came meanwhile, as Save there would make
   * ink at a threshold never seen.
   */
  #viewAfterPress({ zoom, fit }: ViewWaits): void {
    const ink = this.#tracing.takeInkWait();
    const inkChanges =
      ink !== undefined && ink !== (this.#tracing.converting !== undefined);
    if (this.#ended()) return;
    // Make ink's button showed what was asked, and now shows what is.
    if (ink !== undefined) this.#updateButtons();
    if (!zoom && !fit && !inkChanges) return;
    this.#line.act(() => {
      if (zoom) this.#surface?.zoom();
      if (fit) {
        this.#surface?.fitView();
        this.#render();
      }
      if (!inkChanges) return;
      if (ink && this.#questions.size > 0) {
        this.#announce("Not making ink while a question is open");
        return;
      }
      this.#tracing.toggleConvert();
    });
  }

  /** Draws the drawing area again, in the next frame. */
  #render(): void {
    this.#surface?.render();
  }

  #toggleGuides(): void {
    this.#guidesShown = !this.#guidesShown;
    this.#updateButtons();
    this.#render();
  }

  /** Shows the grid, which is a guide until Shift snaps to it, or hides it. */
  #toggleGrid(): void {
    this.#session.snap = !this.#session.snap;
    this.#updateButtons();
    this.#render();
  }

  /**
   * Whether strokes drawn now can end flat: freehand strokes and paths, on
   * the grid.
   */
  get #canEndFlat(): boolean {
    const { shape } = this.#session;
    return this.#session.snap && (shape === "free" || shape === "path");
  }

  /**
   * Cuts the ends of strokes drawn from now on flat on the grid, or does not.
   * Only freehand strokes and paths on the grid are cut, so the button is off
   * otherwise, and the key says so. A path being placed shows its ends as
   * they are cut now.
   */
  #toggleFlatEnds(): void {
    if (!this.#canEndFlat) {
      this.#announce(
        "Flat ends is for freehand strokes and paths on the grid; turn on Grid first, without Ellipse or Polygon",
      );
      return;
    }
    this.#session.flatEnds = !this.#session.flatEnds;
    this.#updateButtons();
    this.#render();
  }

  /** Switches between drawing ellipses and drawing as the pointer goes. */
  #toggleEllipse(): void {
    this.#switchShape("ellipse");
  }

  /** Switches between placing polygons and drawing as the pointer goes. */
  #togglePolygon(): void {
    this.#switchShape("polygon");
  }

  /** Switches between placing paths and drawing as the pointer goes. */
  #togglePath(): void {
    this.#switchShape("path");
  }

  /**
   * Draws `shape`, or as the pointer goes if it is already chosen. A polygon
   * or path being placed ends where it is first; a stroke being dragged
   * keeps the shape it has.
   */
  #switchShape(shape: Shape): void {
    if (this.#session.drawing && !this.#session.placing) return;
    this.#endPlacing();
    this.#session.shape = this.#session.shape === shape ? "free" : shape;
    this.#tracing.stopMoving();
    this.#updateButtons();
  }

  /**
   * Fills the shapes drawn from now on, or does not. Only Ellipse, Polygon,
   * and Path fill, so the button is off while drawing freehand, and the key
   * says so.
   */
  #toggleFill(): void {
    if (this.#session.shape === "free") {
      this.#announce(
        "Toggle fill is for Ellipse, Polygon, and Path; choose one first",
      );
      return;
    }
    this.#session.fill = !this.#session.fill;
    this.#updateButtons();
    this.#render();
  }

  /**
   * Ends a polygon or path being placed with the points it has, if there is
   * one, and makes a path being adjusted ink as it is.
   */
  #endPlacing(): void {
    if (!this.#session.placing) return;
    this.#session.end();
    this.#changed();
  }

  /**
   * Makes a path being placed or adjusted ink, for Finish path, and gives the
   * drawing area back the focus that the button, now off, let go of.
   */
  #finishPath(): void {
    if (!this.#session.placingPath) return;
    this.#endPlacing();
    this.#refocus();
  }

  /**
   * Says how to make a path that has ended ink, for as long as it waits for
   * that, as it ends, and at a press beside it, which does nothing, and
   * shows that it waits.
   */
  #pathWaits(): void {
    const state = this.#session.pathState;
    if (state === undefined || state === "placing") return;
    this.#announce(
      `Path ${state}: adjust its points and handles; Enter or Finish path makes it ink`,
      () => this.#session.adjustingPath,
    );
    this.#updateButtons();
    this.#render();
  }

  #setTool(tool: "pen" | "eraser"): void {
    this.#session.tool = tool;
    this.#session.rebrush();
    this.#tracing.stopMoving();
    this.#updateButtons();
    this.#render();
  }

  #setSize(index: number): void {
    this.#session.sizeIndex = index;
    this.#session.rebrush();
    this.#updateButtons();
    this.#render();
  }

  /**
   * Undoes the last change, or the last corner of a polygon being placed, or
   * the last step of a path being placed.
   */
  #undo(): void {
    if (this.#session.undoCorner()) {
      this.#updateButtons();
      this.#render();
      return;
    }
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
    this.#keeping.keepDraft();
  }

  /** Shows on the buttons what they do now, as {@link buttonStates} says. */
  #updateButtons(): void {
    const tracing = this.#tracing;
    const { strokes, base } = this.#session.document;
    const states = buttonStates({
      tool: this.#session.tool,
      shape: this.#session.shape,
      fill: this.#session.fill,
      moving: tracing.moving,
      picture: tracing.picture !== undefined,
      converting: tracing.converting,
      inkOpen: tracing.inkOpen,
      applying: tracing.applying,
      guides: this.#guidesShown,
      grid: this.#session.snap,
      canEndFlat: this.#canEndFlat,
      flatEnds: this.#session.flatEnds,
      zoomed: this.#surface?.zoomed === true,
      sizeIndex: this.#session.sizeIndex,
      canUndo: this.#session.canUndo,
      canRedo: this.#session.canRedo,
      placing: this.#session.placing,
      placingPath: this.#session.placingPath,
      empty: strokes.length === 0 && base === undefined,
      saving: this.#keeping.saving,
    });
    this.#controls?.show({
      ...states,
      convertBar: this.#surface?.barHeld ?? states.convertBar,
    });
    this.#surface?.showPointer();
  }

  /** A short guide available without leaving a drawing. */
  #help(): void {
    this.#surface?.forgetPointer();
    openHelp(this.app, {
      opened: (help) => {
        this.#questions.add(help);
      },
      closed: (help) => {
        this.#questions.delete(help);
      },
      resume: () => {
        if (!this.#ended()) this.#surface?.focus();
      },
    });
  }

  /**
   * Says `text` in the status line. With `holds`, it stays through what the
   * person does meanwhile, for as long as `holds` returns true.
   */
  #announce(text: string, holds?: () => boolean): void {
    this.#line.say(text, holds);
  }

  /**
   * Replaces the drawing with a copy of another symbol, its strokes and base
   * layer, as one step that Undo takes back, to draw a variant of it. The
   * other file's other chunks stay with that file, its text among them: a
   * reading is what someone takes one symbol to be, a variant is another, and
   * a copy of a guess would go on being found after the guess was corrected.
   */
  async #copy(): Promise<void> {
    const copyFrom = this.#options.copyFrom;
    if (copyFrom === undefined || this.#choosing !== undefined) return;
    const choosing = new AbortController();
    this.#choosing = choosing;
    let copy: SymbolCopy | undefined;
    try {
      copy = await copyFrom(choosing.signal);
    } finally {
      this.#choosing = undefined;
    }
    if (copy === undefined || this.#ended()) return;
    // A large symbol takes a moment to read. A save or a question that came up
    // meanwhile is about the drawing as it stands: a copy taking its place now
    // would be saved, or asked about, in the drawing's stead.
    if (this.#keeping.saving || this.#questions.size > 0) {
      this.#announce(`Not copied: ${copy.name} was still being read`);
      return;
    }
    // A stroke being drawn is committed first, so that Undo brings it back.
    this.#session.end();
    const { document, base } = copy.ink;
    if (document.base !== undefined && base !== undefined) {
      this.#decoded.set(document.base.png, base);
    }
    this.#session.replace(document);
    this.#surface?.fitView();
    this.#changed();
    const started = copy.hasText
      ? `Started from a copy of ${copy.name}, without its readings and translations`
      : `Started from a copy of ${copy.name}`;
    this.#announce(
      copy.ink.picture === true ? `${started}. ${noStrokes}` : started,
    );
  }

  /** Follows the vault's reports of changes to the symbol's file. */
  #watchFile(): void {
    const vault = this.app.vault;
    const touched = (file: TAbstractFile, oldPath?: string): void => {
      this.#keeping.touched(file.path, oldPath);
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
        // Renamed elsewhere, as in the file explorer or by sync, the symbol
        // keeps its new name: a later save does not rename it back.
        this.#keeping.followRename(file.path);
        // So does a file a first save made, which an empty name keeps.
        this.#showUnnamed();
        touched(file, oldPath);
      }),
    ];
  }

  /**
   * Saves, then opens the editor for the next symbol, whose embed follows
   * this one's, with the same tools. As with Save and close, strokes drawn
   * while the save ran keep this editor open instead.
   */
  #saveAndNext(): void {
    const next = this.#options.next;
    if (next === undefined) return;
    void this.#keeping.saveAndNext(() => {
      const { tool, sizeIndex, snap } = this.#session;
      const picture = this.#tracing.handOver();
      const textShown = this.#textStrip?.isShown() === true;
      this.#finish();
      next({
        tool,
        sizeIndex,
        sizes: { ...this.#session.sizes },
        grid: snap,
        flatEnds: this.#session.flatEnds,
        guides: this.#guidesShown,
        magnified: this.#surface?.zoomed === true,
        shape: this.#session.shape,
        fill: this.#session.fill,
        textShown,
        ...(picture === undefined ? {} : { picture }),
      });
    });
  }
}
