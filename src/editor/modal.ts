// The editor: a modal around a drawing session and its surface, with its
// controls, saving, drafts, and the question before unsaved work is closed.
// controls.ts makes the buttons and keys, which run the commands this
// implements, surface.ts holds the drawing area, which the pointer draws on,
// and picture.ts holds the picture to trace over and Make ink.

import {
  ConfirmationModal,
  Modal,
  Notice,
  type App,
  type EventRef,
  type TAbstractFile,
} from "obsidian";
import { carriedChunks, type CarriedChunk } from "../format/ink-file.ts";
import {
  parseRecord,
  serializeRecord,
  type BaseLayer,
  type InkRecord,
  type Tool,
} from "../format/record.ts";
import {
  drawableBase,
  nextTask,
  openInk,
  saveInk,
  type EditableInk,
} from "../ink/canvas.ts";
import { toUnits, type InkDocument } from "../ink/document.ts";
import type { DrawableBase } from "../ink/render.ts";
import { readText, writeText, type SymbolText } from "../format/text.ts";
import { savingWaits, type RenameWait } from "../notes/file-writes.ts";
import { chooseRename, symbolStem } from "../notes/names.ts";
import {
  isBlank,
  noText,
  showValues,
  TextFields,
  textFields,
} from "../notes/text-fields.ts";
import {
  draftBase,
  draftOffer,
  drawingOf,
  fingerprintOf,
  offerQuestion,
  restoreDraft,
  sameTarget,
  unshownBase,
  type Draft,
  type DraftBase,
  type DraftStore,
  type DraftTarget,
} from "./drafts.ts";
import {
  buttonStates,
  type ButtonLabels,
  type EditorCommands,
} from "./buttons.ts";
import { EditorControls, openHelp } from "./controls.ts";
import { keepsArrows, typing } from "./focus.ts";
import { FileWatch, type FileReading, type Reading } from "./disk.ts";
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

/** How the vault's notes use a symbol: how many links, in how many notes. */
export interface SymbolUses {
  readonly links: number;
  readonly notes: number;
}

/** How a question about saving says that the symbol `name` is used. */
function usedText(name: string, { links, notes }: SymbolUses): string {
  return `${name} is used ${String(links)} times, in ${String(notes)} ${notes === 1 ? "note" : "notes"}.`;
}

/** The symbol's file, as the editor reads it again to see if it changed. */
export interface SymbolFile {
  /** Where it is, following renames, or where it was once deleted. */
  readonly path: string;
  /** What it holds now, or undefined when no file is there. */
  read(): Promise<Uint8Array | undefined>;
}

/** A symbol opened to start another from, and the name it goes by. */
export interface SymbolCopy {
  readonly name: string;
  readonly ink: EditableInk;
  /** Whether the symbol has text, which stays with it. */
  readonly hasText: boolean;
}

/** A file opened again, and what it says about its symbol. */
type OpenedFile = EditableInk & { readonly text: SymbolText };

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

export interface EditorOptions {
  /** What the editor calls the symbol until it has a name: "New symbol". */
  readonly title: string;
  /**
   * The symbol's name, which its name field starts with, or undefined for a
   * new one, whose field starts empty.
   */
  readonly name?: string;
  readonly document: InkDocument;
  readonly base?: DrawableBase;
  readonly carried?: readonly CarriedChunk[];
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
   * Writes a saved symbol: the first save of a new symbol creates its file
   * and inserts it. Rejects when anything could not be done, which keeps the
   * editor open with the drawing, so that the next save tries again.
   * `keepDraft` keeps the editor's draft at once, as before a step that a
   * draft must name, and returns whether it was kept. `holds` tells the
   * editor what the file holds as soon as the host has adopted or written
   * it, before any later step that can fail, such as inserting an embed, so
   * that the editor goes on comparing the file with that. `name` is what the
   * name field holds, as typed, for the file to take as its name.
   * `check` looks at the file once more: the host calls it just before it
   * writes over a file, where no other save can come between them, and again
   * if another file took that one's place meanwhile. It writes nothing if
   * `check` rejects, which it does to ask about a change or refuse one.
   * `wait` hears when a step that writes takes too long, or a rename stops,
   * and says whether a person is being asked something above this editor.
   * Resolves to whether that name was kept or applied. False means only the
   * rename failed: the drawing is saved, and the name stays for a retry.
   */
  readonly write: (
    bytes: Uint8Array,
    record: InkRecord,
    keepDraft: () => boolean,
    holds: (fingerprint: string) => void,
    name: string,
    check: () => Promise<void>,
    wait: RenameWait,
  ) => Promise<boolean>;
  /**
   * For an existing symbol, which other notes may show: how the vault's
   * notes use it, asked before the first save of a changed drawing, so that
   * the editor can ask first, when it is used more than once, whether to
   * change it everywhere. Undefined for a new symbol.
   */
  readonly uses?: () => SymbolUses;
  /**
   * The symbol's file: an existing symbol's, or a new one's once its first
   * save made it, and undefined before then. The editor reads it again when
   * the vault says it changed and before each save, so that a change made
   * elsewhere is never written over unasked.
   */
  readonly file?: () => SymbolFile | undefined;
  /** A fingerprint of the file as opened, for an existing symbol. */
  readonly fingerprint?: string;
  /** The same of all but its text, as `drawingOf` gives it. */
  readonly drawing?: string;
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
    /**
     * A draft to open with, restored as Restore would restore it, without
     * asking, as the person chose it already: one whose symbol's file is gone
     * or does not open, which this editor makes a new symbol of. No other
     * draft is offered then.
     */
    readonly recover?: Draft;
  };
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

/** A save that stopped to ask a question, which says why without a notice. */
class Unsaved extends Error {}

/**
 * A save that found the file's text changed, took it in, and is to start again,
 * as what it was about to write held the text as it was. It need say nothing.
 */
class SaveAgain extends Error {
  /** Starts the save again, once this one has ended. */
  readonly again: () => void;

  constructor(again: () => void) {
    super("the file's text changed");
    this.again = again;
  }
}

const unreadable =
  "the file changed on disk, and this version of Inkline cannot read it";

const textReplaced =
  "the file changed text you typed, so look at what it now says and save again";

export class InkEditorModal extends Modal {
  readonly #options: EditorOptions;
  readonly #session: DrawingSession;
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
  /** The field for the symbol's name, in the title's place. */
  #nameField: HTMLInputElement | undefined;
  /** The symbol's readings and translations, and what shows or hides them. */
  #textFields: TextFields | undefined;
  #textToggle: HTMLButtonElement | undefined;
  #textStrip: HTMLElement | undefined;
  /** The symbol's name as last opened or saved, or empty before it has one. */
  #savedName: string;
  /** Whether the last save kept the drawing but could not rename the file. */
  #notRenamed = false;
  /**
   * Whether the question about a change on disk is open, and the save it
   * goes on with if the drawing is kept.
   */
  #askingChanged = false;
  #resume: (() => void) | undefined;
  /**
   * Whether this editor need not ask again before saving over a symbol used
   * more than once, as Replace was chosen.
   */
  #choseReplace = false;
  /** The question whether to replace a shared symbol, while it is open. */
  #askingReplace: Promise<boolean> | undefined;
  /** Whether Next is under way, so that it opens one editor however asked. */
  #advancing = false;
  /** The choice of a symbol to copy while it is open, to close with this. */
  #choosing: AbortController | undefined;
  /** The drawing area, once the editor has opened. */
  #surface: EditorSurface | undefined;
  #saving: Promise<boolean> | undefined;
  #closing = false;
  /**
   * Set when disposed: nothing more is saved or written as a draft, but for
   * {@link #settleDraft} once a save that was running then ends.
   */
  #retired = false;
  /** Whether a save was running when the editor was disposed, until it ends. */
  #settling = false;
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
  /**
   * Base layer images decoded for drawing, by their PNG, each kept while
   * something holds that PNG: a state that Undo or Redo can reach, the
   * drawing as opened or saved, or a draft. One that only abandoned states
   * held, after a new change past an Undo or past the history's limit, goes.
   */
  readonly #decoded = new WeakMap<Uint8Array, DrawableBase>();
  /** The base layer placed where the document puts it, for drawing. */
  #placed: { layer: BaseLayer; drawable: DrawableBase } | undefined;
  /** Whether the last draft written was kept; storage can refuse one. */
  #draftKept = true;
  #guidesShown = true;
  /**
   * The draft this editor restored, until its own draft or a save takes its
   * place: storage may refuse the editor's own at first.
   */
  #replacing: string | undefined;
  /** The draft this editor is offering back, held while it asks. */
  #offered: string | undefined;
  /**
   * The draft this editor opened as a new symbol, as `drafts.recover` gives
   * it, once restored: its own draft stands in for it until a first save
   * makes a file of its own, as {@link #draft} says.
   */
  #recovered: Draft | undefined;
  /**
   * The base layer of {@link #recovered} that this editor could not show: one
   * it took from its file, or one it kept itself that cannot be decoded. Its
   * own draft goes on naming it while it stands in for that draft, so that
   * nothing of it is dropped before the first save starts writing: names the
   * file it makes, or takes over the file a first save made.
   */
  #unshownBase: DraftBase | undefined;
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
    this.#watch = new FileWatch(options.fingerprint, options.drawing);
    this.#carried = options.carried ?? [];
    this.#opened = options.document;
    this.#savedName = options.name ?? "";
    const { base } = options.document;
    if (base !== undefined && options.base !== undefined) {
      this.#decoded.set(base.png, options.base);
    }
  }

  /** The decoded base layer, where the document now puts it. */
  get #base(): DrawableBase | undefined {
    const layer = this.#session.document.base;
    const drawable =
      layer === undefined ? undefined : this.#decoded.get(layer.png);
    if (layer === undefined || drawable === undefined) {
      // The last one placed would otherwise keep its image after the
      // drawing let it go.
      this.#placed = undefined;
      return undefined;
    }
    if (this.#placed?.layer !== layer) {
      this.#placed = {
        layer,
        drawable: {
          ...drawable,
          x: layer.x,
          y: layer.y,
          width: layer.width,
          height: layer.height,
        },
      };
    }
    return this.#placed.drawable;
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
      labelId: `inkline-drawing-${this.#draftId}`,
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
    this.#options.drafts?.store.hold(this.#draftId);
    this.#options.lifecycle?.opened(this);
    void this.#offerDraft();
    // The file may have changed since it was read for opening.
    this.#checkFile();
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
      saveAndClose: () => void this.#saveAndClose(),
      saveOnly: () => void this.#saveOnly(),
      saveAndNext: () => void this.#saveAndNext(),
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
      endShape: () => {
        const canvas = this.#surface?.view.canvas;
        if (!this.#session.placing || activeDocument.activeElement !== canvas) {
          return false;
        }
        this.#endPlacing();
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
      focusApply: () => {
        this.#controls?.focusButton("apply");
      },
      document: () => this.modalEl.doc,
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
    if (this.#saving !== undefined) {
      this.#announceSaving();
      return;
    }
    // Ink being previewed is unsaved too: Save makes it, as saving does.
    if (!this.#unsaved && !this.#tracing.previewing()) {
      this.#forgetDraft();
      this.#finish();
      return;
    }
    // One question for a symbol used more than once, rather than two.
    const uses = this.#sharedUses();
    const name = this.#displayName;
    this.#ask(
      uses === undefined ? "Save this symbol?" : `Save the changes to ${name}?`,
      uses === undefined
        ? "The drawing has changes that are not saved."
        : `The drawing has changes that are not saved. ${usedText(name, uses)} Replace changes it in all of them. For a variant that leaves them as they are, start a new symbol with Copy from instead.`,
      [
        {
          text: uses === undefined ? "Save" : "Replace",
          primary: true,
          // The question closes at once; a failed save then leaves the editor
          // open and says why.
          act: () => {
            if (uses !== undefined) this.#choseReplace = true;
            void this.#saveAndClose();
          },
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
   * saved or written as a draft, even by a save still running, which only
   * settles that draft as it ends ({@link #settleDraft}).
   */
  dispose(): void {
    if (this.#retired) return;
    this.#session.end();
    if (!this.#keepDraft()) this.#sayNotKept();
    this.#settling = this.#saving !== undefined;
    this.#retired = true;
    this.#finish();
  }

  /** Says that the latest changes are in no draft, once the editor is gone. */
  #sayNotKept(): void {
    markNotice(
      new Notice(
        `Inkline could not keep a draft of the latest changes to ${this.#displayName}.`,
      ),
    );
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
          if (!this.#retired && !this.#closing) this.#line.act(answer.act);
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

  /** What the name field holds, as typed. */
  get #typedName(): string {
    return this.#nameField?.value ?? this.#savedName;
  }

  /**
   * Whether saving would give the symbol another name than it has: the name
   * field, as saving reads it, holds another, or one that saving would
   * refuse. Left empty, or holding the name the symbol has, the field keeps
   * it, or takes a number for a new one.
   */
  get #nameChanged(): boolean {
    const choice = chooseRename(this.#typedName, this.#savedName);
    if (choice.kind === "number") return false;
    return choice.kind === "refused" || choice.name !== this.#savedName;
  }

  /** Whether anything is unsaved: strokes, a new name, or text typed. */
  get #unsaved(): boolean {
    return (
      this.#session.dirty ||
      this.#nameChanged ||
      this.#textFields?.touched === true
    );
  }

  /** What notices call the symbol: its name, or "New symbol" until it has one. */
  get #displayName(): string {
    return this.#savedName === "" ? this.#options.title : this.#savedName;
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
      value: this.#savedName,
      attr: {
        "aria-label": "Symbol name",
        placeholder:
          this.#savedName === "" ? this.#unnamedPlaceholder : this.#savedName,
        spellcheck: "false",
        autocomplete: "off",
      },
    });
    field.addEventListener("input", () => {
      this.#line.act(() => {
        this.#keepDraft();
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
    const id = `inkline-text-${this.#draftId}`;
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
          this.#keepDraft();
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

  /** Whether text typed would replace a change that `opened` holds. */
  #textClashes(opened: OpenedFile | undefined): boolean {
    return (
      opened !== undefined &&
      this.#textFields !== undefined &&
      this.#textFields.conflicts(opened.text).length > 0
    );
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

  /** The name of the file the editor saves to, or undefined before it has one. */
  #fileName(): string | undefined {
    const path = this.#options.file?.()?.path;
    const file = path?.slice(path.lastIndexOf("/") + 1);
    return file === undefined ? undefined : symbolStem(file);
  }

  /** What the name field says while the symbol has no name yet. */
  get #unnamedPlaceholder(): string {
    return `${this.#options.title}: name it, or leave it ${this.#options.unnamed?.() ?? "for the next number"}`;
  }

  /** Shows what leaving the name empty does now, while it has none. */
  #showUnnamed(): void {
    if (this.#savedName !== "" || this.#nameField === undefined) return;
    this.#nameField.placeholder = this.#unnamedPlaceholder;
  }

  /**
   * After a save that sent `typed` as the name, or a rename made elsewhere,
   * takes the name the file now has, and shows it in the field if the field
   * still holds `typed`. Undefined leaves the field as it is, as after a
   * rename that failed.
   */
  #named(typed: string | undefined): void {
    const name = this.#fileName();
    if (name === undefined) return;
    this.#savedName = name;
    const field = this.#nameField;
    if (field === undefined) return;
    field.placeholder = name;
    if (typed !== undefined && field.value === typed) field.value = name;
  }

  /** What a save says when something is still unsaved after it. */
  get #partlySaved(): string {
    if (!this.#notRenamed) return "Saved, except for what changed while saving";
    return this.#session.dirty
      ? "Saved, except for the name and what changed while saving"
      : "Saved, but not renamed";
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
    if (this.#closing || this.#retired || this.#questions.size > 0) return;
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
    return this.#closing || this.#retired;
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
    if (this.#tracing.converting !== undefined || this.#saving !== undefined) {
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
   * one.
   */
  #endPlacing(): void {
    if (!this.#session.placing) return;
    this.#session.end();
    this.#changed();
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
    this.#keepDraft();
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
      empty: strokes.length === 0 && base === undefined,
      saving: this.#saving !== undefined,
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
        if (!this.#closing && !this.#retired) this.#surface?.focus();
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

  /** Says that a save is running, which stays said until it ends. */
  #announceSaving(): void {
    this.#announce("Saving…", () => this.#saving !== undefined);
  }

  /**
   * Says that a save is waiting for Obsidian, until it no longer is, and how to
   * get the strokes back if it never ends. This has a line of its own, as the
   * status line goes on saying other things meanwhile.
   */
  #sayWaiting(waiting: boolean): void {
    if (!waiting) {
      this.#saveWait?.setText("");
      return;
    }
    const again =
      this.#options.drafts?.target().kind === "file"
        ? "open this symbol again"
        : "start a new symbol in this note";
    this.#saveWait?.setText(
      `${savingWaits} ${
        this.#keepDraft()
          ? `Your strokes are safe in a draft, so if nothing changes, restart Obsidian and ${again}.`
          : "If nothing changes, restart Obsidian, but your latest strokes could not be kept in a draft."
      }`,
    );
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
    // writes it, so the draft is kept, and keeps its own base layer, but for
    // one that stands in for a draft opened as a new symbol, as #draft says.
    const pending = this.#saving !== undefined;
    if (!pending && !this.#unsaved) {
      this.#forgetDraft();
      return true;
    }
    const { document } = this.#session;
    const kept = drafts.store.put(this.#draft(drafts.target(), pending));
    if (!kept && this.#draftKept) {
      // The latest changes stay unkept until a draft is kept again.
      this.#announce("Draft not kept", () => !this.#draftKept);
      markNotice(
        new Notice(
          parseRecord(serializeRecord(document)).ok
            ? "Inkline could not keep a draft of the latest changes, because the vault's local storage refused it. Save the symbol to keep them."
            : "Inkline could not keep a draft of the latest changes, because they take the drawing past what a symbol can hold. Undo them to save it.",
        ),
      );
    } else if (
      kept &&
      !this.#draftKept &&
      this.#line.text === "Draft not kept"
    ) {
      this.#announce("Draft kept");
    }
    this.#draftKept = kept;
    if (kept) this.#replaced();
    return kept;
  }

  /**
   * This editor's drawing as its draft for `target`. While the file may hold
   * the drawing as it was or as a save writes it, the draft is `pending`, and
   * keeps its own base layer, so that it does not depend on which version the
   * file holds. A draft that stands in for one opened as a new symbol, as
   * below, names instead the base layer that one named and this editor could
   * not show, until the first save starts writing.
   */
  #draft(target: DraftTarget, pending: boolean): Draft {
    const { document, saved } = this.#session;
    // A draft opened as a new symbol is still for its old symbol until the
    // first save gives it a file of its own, as the editor then holds that
    // file, or names another path: this one takes its place there, during a
    // save too, as one cut short by Inkline's unloading keeps its draft. It
    // goes on naming a base layer it could not show, one taken from that
    // symbol's file or one that cannot be decoded, with that file's
    // fingerprints, so that restoring it on the file, should it open again,
    // brings the base layer back, as the draft found would have. Where the
    // save makes a file at that same path, as for a symbol deleted, a draft
    // kept meanwhile restored on it gives the same drawing, as that file
    // holds no base layer.
    const standIn =
      this.#recovered !== undefined &&
      this.#watch.fingerprint === undefined &&
      sameTarget(target, this.#recovered.target)
        ? this.#recovered
        : undefined;
    const fingerprint = this.#watch.fingerprint ?? standIn?.fingerprint;
    const drawing = this.#watch.drawing ?? standIn?.drawing;
    const unshown = standIn === undefined ? undefined : this.#unshownBase;
    return {
      id: this.#draftId,
      target,
      strokes: document.strokes,
      base:
        unshown !== undefined && document.base === undefined
          ? unshown
          : draftBase(document, pending ? undefined : saved),
      ...(fingerprint === undefined ? {} : { fingerprint }),
      ...(drawing === undefined ? {} : { drawing }),
      savedAt: Date.now(),
      gridOrigin: this.#session.gridOrigin,
      ...(this.#nameChanged ? { name: this.#typedName } : {}),
      ...(this.#textFields?.touched === true
        ? { text: this.#textFields.typed() }
        : {}),
    };
  }

  /**
   * Settles the draft that {@link dispose} kept while a save ran, once that
   * save ends, which can be after Inkline is off: Obsidian finishes a rename
   * it has begun, which nothing takes back, and the draft names the file's
   * path from before it. The draft is kept again for the file where it is now,
   * on its own base layer and with the time it was kept, so that it depends on
   * nothing the file holds and expires as it would have; or, standing in for a
   * draft opened as a new symbol, on the base layer that draft named, as
   * {@link #draft} says. Whether the file
   * holds everything it does is for the next editor of the file to tell, as it
   * offers drafts ({@link draftOffer}): the file can change at any time
   * after the save, and this editor follows it no more.
   *
   * This touches only this editor's own draft, once, and only while a list
   * would keep it: another load may have restored, discarded, or dropped it
   * meanwhile, as one that expired, and nothing brings it back. It reads no
   * file, removes no draft, and writes no file and no note.
   */
  #settleDraft(): void {
    if (!this.#settling) return;
    this.#settling = false;
    const drafts = this.#options.drafts;
    const keptAt = drafts?.store.keptAt(this.#draftId);
    if (drafts === undefined || keptAt === undefined) return;
    const draft = { ...this.#draft(drafts.target(), true), savedAt: keptAt };
    if (!drafts.store.put(draft)) this.#sayNotKept();
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
    const { recover } = drafts;
    const offers =
      recover === undefined
        ? drafts.store.offers(drafts.target())
        : { drafts: [], newer: false };
    // A draft for the file that would bring back nothing is dropped. The
    // editor follows the file from its opening, so a change to it after that
    // is taken in or asked about as any other is.
    const { offer, drop } = draftOffer(
      drafts.target(),
      offers.drafts,
      this.#opened,
      this.#savedName,
    );
    for (const id of drop) drafts.store.remove(id);
    const found = recover ?? offer;
    // A later version's draft cannot be read here, so it stays for that
    // version to offer, and this says so, as the changes would seem lost.
    if (offers.newer) {
      markNotice(
        new Notice(
          "This symbol has unsaved changes from a newer version of Inkline, which this version cannot restore. Update Inkline to get them back.",
        ),
      );
    }
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
      // waits for another time, which a draft opened as a new symbol says,
      // as nothing else would show that it was not. Such an editor stays
      // open, as what was drawn, saved, or asked in it meanwhile is the
      // person's; anything drawn there is kept as its own draft, and the
      // draft found stays as it was, to be opened again.
      if (
        this.#retired ||
        this.#closing ||
        this.#saving !== undefined ||
        this.#questions.size > 0 ||
        !sameTarget(drafts.target(), found.target)
      ) {
        letGo();
        if (recover !== undefined && !this.#retired) {
          markNotice(
            new Notice(
              "The unsaved drawing was not opened, as the editor was in use while it was read. It is still kept: run Inkline: Recover drafts to open it.",
            ),
          );
        }
        return;
      }
    }
    const draft: Draft = readable
      ? found
      : { ...found, base: { kind: "none" } };
    if (recover !== undefined) {
      this.#recovered = found;
      this.#unshownBase = unshownBase(found, readable);
      this.#restore(drafts, draft);
      if (readable) {
        this.#announce("Opened the unsaved drawing as a new symbol");
      } else {
        markNotice(
          new Notice(
            "The unsaved drawing's base layer cannot be read, so only its strokes came back.",
          ),
        );
      }
      return;
    }
    const { title, content } = offerQuestion(
      draft,
      readable,
      this.#watch,
      new Date(draft.savedAt).toLocaleString(),
    );
    this.#ask(
      title,
      content,
      [
        {
          text: "Restore",
          primary: true,
          act: () => {
            this.#restore(drafts, draft);
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
   * Restores `draft`, which this editor holds, in place of the drawing, with
   * any name and text it kept, and keeps this editor's own draft in its place.
   */
  #restore(drafts: NonNullable<EditorOptions["drafts"]>, draft: Draft): void {
    // A stroke begun while the draft was read is committed first, so that
    // undoing the restore brings it back.
    this.#session.end();
    this.#session.replace(restoreDraft(this.#opened, draft), draft.gridOrigin);
    if (draft.name !== undefined && this.#nameField !== undefined) {
      this.#nameField.value = draft.name;
    }
    if (draft.text !== undefined) {
      this.#textFields?.restore(draft.text);
      this.#showTextSummary();
      this.#showText(true);
    }
    drafts.restored?.(draft);
    // Restoring can change what an empty name keeps.
    this.#showUnnamed();
    // Still held: offered to no other editor until this one's own replaces it.
    this.#offered = undefined;
    this.#replacing = draft.id;
    this.#surface?.fitView();
    this.#updateButtons();
    this.#render();
    this.#keepDraft();
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
    if (copy === undefined || this.#retired || this.#closing) return;
    // A large symbol takes a moment to read. A save or a question that came up
    // meanwhile is about the drawing as it stands: a copy taking its place now
    // would be saved, or asked about, in the drawing's stead.
    if (this.#saving !== undefined || this.#questions.size > 0) {
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
        // Renamed elsewhere, as in the file explorer or by sync, the symbol
        // keeps its new name: a later save does not rename it back.
        if (file.path === this.#options.file?.()?.path) {
          this.#named(this.#savedName);
        }
        // So does a file a first save made, which an empty name keeps.
        this.#showUnnamed();
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
   * for editing when it changed and can be, with its text. Undefined while
   * there is no file, as before a new symbol's first save.
   */
  async #readFile(): Promise<
    { reading: Reading; opened?: OpenedFile } | undefined
  > {
    const file = this.#options.file?.();
    if (file === undefined) return undefined;
    const bytes = await file.read();
    if (bytes === undefined) return { reading: { kind: "gone" } };
    const fingerprint = await fingerprintOf(bytes);
    if (!this.#watch.differs(fingerprint)) {
      return { reading: { kind: "file", fingerprint, readable: true } };
    }
    let opened: OpenedFile | undefined;
    try {
      const ink = await openInk(bytes);
      if (ink.kind === "editable") {
        const text = await readText(ink.carried.map(({ chunk }) => chunk));
        opened = { ...ink, text };
      }
    } catch {
      // Not a PNG that decodes, so not readable.
    }
    return {
      reading: {
        kind: "file",
        fingerprint,
        drawing: await drawingOf(bytes),
        readable: opened !== undefined,
      },
      ...(opened === undefined ? {} : { opened }),
    };
  }

  /**
   * Responds to the file as read while editing. Text typed that a change to
   * the file would be lost to, or replace, is as much to ask about as strokes.
   */
  #respond(reading: Reading, opened: OpenedFile | undefined): void {
    const action = this.#watch.noticed(
      reading,
      this.#session.dirty || this.#textClashes(opened),
    );
    if (action === "gone") {
      this.#announce("The file was deleted; saving makes it again");
      return;
    }
    if (reading.kind !== "file") return;
    if (action === "unreadable") {
      this.#announce(`Not reloaded: ${unreadable}`);
      markNotice(
        new Notice(
          `${this.#displayName} changed on disk, and this version of Inkline cannot read it, so the editor will not save over it.`,
        ),
      );
    } else if (action === "reload" && opened !== undefined) {
      this.#reload(reading, opened);
    } else if (action === "text" && opened !== undefined) {
      // A question open is about another change, and has what that change read
      // to go on with. The file is looked at again once it is answered.
      if (!this.#askingChanged) this.#takeText(reading, opened);
    } else if (action === "ask") {
      this.#askChanged(reading, opened);
    }
  }

  /**
   * Takes in a change to the file's text alone. Nothing about the drawing
   * changed, so the strokes, unsaved or not, and Undo stay as they are, and there
   * is nothing to ask. A field someone typed in keeps what they typed, as nothing
   * else could bring that back, while the file's value stays in the file; the
   * fields say what saving would replace, as the library's do, and open to say
   * it. Returns whether that is so of any field.
   */
  #takeText(reading: FileReading, opened: OpenedFile): boolean {
    this.#carried = opened.carried;
    this.#watch.tookText(reading);
    const clashing = (this.#textFields?.take(opened.text) ?? []).length > 0;
    this.#showTextSummary();
    if (clashing) this.#showText(true);
    this.#announce(
      clashing
        ? "The file changed text you typed: saving replaces what it now says"
        : "Readings and translations updated: the file changed on disk",
    );
    this.#keepDraft();
    return clashing;
  }

  /**
   * Asks what to do about a change made to the file elsewhere: reload it, or
   * keep the drawing, so that saving replaces the change. Keeping the drawing
   * replaces only the drawing, and the fields a person typed in: the chunks a
   * save carries become those of `opened`, the changed file, as the question
   * says nothing of any text the change added, and the other field follows
   * it. `resume` goes on with a save that stopped to ask. One such question is
   * open at a time; a save that stops while it is open goes on once it is
   * answered.
   */
  #askChanged(
    reading: FileReading,
    opened: OpenedFile | undefined,
    resume?: () => void,
  ): void {
    if (resume !== undefined) this.#resume = resume;
    if (this.#askingChanged) return;
    this.#askingChanged = true;
    const answered = (): (() => void) | undefined => {
      const then = this.#resume;
      this.#askingChanged = false;
      this.#resume = undefined;
      return then;
    };
    const clash = this.#textClashes(opened);
    this.#ask(
      "The symbol changed on disk",
      `${this.#displayName} was changed outside this editor. Reload it to take that change in; Undo then brings your drawing back while the editor is open${clash ? ", but not the readings or translations you typed, which the file changed too" : ""}. Or keep your drawing, and saving it replaces the change.`,
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
            this.#watch.keep(reading.fingerprint, reading.drawing);
            if (opened !== undefined) {
              this.#carried = opened.carried;
              this.#textFields?.take(opened.text);
              this.#showTextSummary();
            }
            then?.();
            this.#checkFile();
          },
        },
      ],
      "Not now",
      () => {
        answered();
        this.#checkFile();
      },
    );
  }

  /** Reads the file again and takes in what it now holds, as Reload asks. */
  async #reloadFile(): Promise<void> {
    const known = this.#watch.version;
    const drawn = this.#session.document;
    const typed = JSON.stringify(this.#textFields?.typed());
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
    } else if (
      // A large file takes a moment. Reload was the answer about the drawing as
      // it stood then, and says nothing of what was added to it since.
      this.#session.drawing ||
      this.#session.document !== drawn ||
      JSON.stringify(this.#textFields?.typed()) !== typed
    ) {
      this.#askChanged(reading, opened);
    } else {
      this.#reload(reading, opened);
    }
  }

  /**
   * Takes in what the file now holds, as one step that Undo takes back, so
   * that the drawing it replaces is not lost while the editor is open.
   */
  #reload(reading: FileReading, opened: OpenedFile): void {
    // A stroke being drawn is committed first, so that Undo brings it back.
    this.#session.end();
    const { document, base, carried, text } = opened;
    if (document.base !== undefined && base !== undefined) {
      this.#decoded.set(document.base.png, base);
    }
    this.#carried = carried;
    // A field the file changed too takes the file's values, as Reload said;
    // any other keeps what was typed, which the change had nothing to do with.
    const fields = this.#textFields;
    if (fields !== undefined) {
      const clashing = fields.conflicts(text);
      fields.take(text);
      fields.drop(clashing);
    }
    this.#showTextSummary();
    this.#opened = document;
    this.#session.replace(document);
    this.#session.markSaved(document);
    this.#watch.took(reading.fingerprint, reading.drawing);
    this.#surface?.fitView();
    this.#changed();
    this.#announce("Reloaded: the file changed on disk");
  }

  /**
   * How the vault's notes use this symbol, when saving over it must ask
   * first: for an existing symbol used more than once, whose drawing changed,
   * before Replace was chosen in this editor. Undefined when a save goes over
   * it without asking, as for one used once, where the editor most likely
   * opened it, or a save that only renames it, as links follow a rename.
   */
  #sharedUses(): SymbolUses | undefined {
    const uses = this.#options.uses;
    if (uses === undefined || this.#choseReplace) return undefined;
    if (!this.#session.dirty && !this.#tracing.previewing()) return undefined;
    const found = uses();
    return found.links > 1 ? found : undefined;
  }

  /**
   * Whether to go on with a save: at once, unless {@link #sharedUses} says
   * to ask first whether to change the symbol everywhere, when the answer
   * says. A question already open answers for every save that waits on it.
   */
  #mayReplace(): Promise<boolean> {
    const uses = this.#sharedUses();
    if (uses === undefined) return Promise.resolve(true);
    if (this.#askingReplace !== undefined) return this.#askingReplace;
    const name = this.#displayName;
    const asking = new Promise<boolean>((resolve) => {
      this.#ask(
        `Change ${name} everywhere?`,
        `${usedText(name, uses)} Replace changes it in all of them. For a variant that leaves them as they are, start a new symbol with Copy from instead.`,
        [
          {
            text: "Replace",
            primary: true,
            act: () => {
              this.#choseReplace = true;
              resolve(true);
            },
          },
        ],
        "Keep editing",
        () => {
          if (!this.#ended()) {
            this.#announce("Not saved: kept editing");
            this.#refocus();
          }
          resolve(false);
        },
      );
    }).finally(() => {
      this.#askingReplace = undefined;
    });
    this.#askingReplace = asking;
    return asking;
  }

  /** Saves, keeping the editor open. */
  async #saveOnly(): Promise<void> {
    if (!(await this.#mayReplace())) return;
    if (!(await this.#tracing.applyBeforeSave())) return;
    // Ink made just now is a change too, if the preview had not shown it yet.
    if (await this.#mayReplace()) await this.#save();
  }

  /**
   * Saves, then opens the editor for the next symbol, whose embed follows
   * this one's, with the same tools. As with Save and close, strokes drawn
   * while the save ran keep this editor open instead.
   */
  async #saveAndNext(): Promise<void> {
    const next = this.#options.next;
    if (next === undefined || this.#advancing) return;
    this.#advancing = true;
    try {
      if (!(await this.#tracing.applyBeforeSave())) return;
      if (!(await this.#save(() => void this.#saveAndNext()))) return;
      // Closed meanwhile, as by Save and close or by Inkline being disabled.
      if (this.#closing || this.#retired) return;
      if (this.#unsaved) {
        this.#announce(this.#partlySaved);
        return;
      }
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
    } finally {
      this.#advancing = false;
    }
  }

  /**
   * Saves, then closes if nothing changed during the save. Strokes drawn
   * while it ran keep the editor open, since they are not saved yet.
   */
  async #saveAndClose(): Promise<void> {
    if (!(await this.#mayReplace())) return;
    if (!(await this.#tracing.applyBeforeSave())) return;
    if (!(await this.#mayReplace())) return;
    if (!(await this.#save(() => void this.#saveAndClose()))) return;
    if (this.#unsaved) {
      this.#announce(this.#partlySaved);
      return;
    }
    this.#finish();
  }

  /**
   * Reads the file again just before a save writes over it, and throws if the
   * save must not go on: it asks first about a change made elsewhere, and
   * `resume` saves again if the answer is to; a file it cannot read is never
   * written over. It only starts the question, as the host calls this in the
   * save's turn, which every other save waits for.
   *
   * A change to the text alone asks nothing, but what the save was about to
   * write holds the text as it was, so that it stops and `resume` starts it
   * again with the change. Unless the change is to a field someone typed in:
   * then nothing is written until they have seen what the file now says, as the
   * library's fields do, and the next save is theirs to make.
   */
  async #checkBeforeWriting(resume: () => void): Promise<void> {
    const found = await this.#readFile();
    if (this.#retired) throw new Error("Inkline was disabled");
    if (found === undefined) return;
    const { reading, opened } = found;
    const action = this.#watch.saving(reading);
    if (action === "unreadable") throw new Error(unreadable);
    if (action === "write" || reading.kind !== "file") return;
    if (action === "text" && opened !== undefined && !this.#askingChanged) {
      if (this.#takeText(reading, opened)) throw new Unsaved(textReplaced);
      throw new SaveAgain(resume);
    }
    this.#askChanged(reading, opened, resume);
    throw new Unsaved("the file changed on disk");
  }

  /**
   * Whether this is a new symbol, with no file yet, that holds nothing to
   * show: no stroke of the pen and no base layer. Saving it would make an
   * empty file and put its embed in the note, as a second click on Next did
   * in the editor that the first opened. A symbol that has a file still saves
   * when it is erased to nothing.
   */
  #nothingToMake(): boolean {
    if (this.#options.file?.() !== undefined) return false;
    const { strokes, base } = this.#session.document;
    return base === undefined && !strokes.some(({ tool }) => tool === "pen");
  }

  /**
   * Saves the drawing as it is now, with a stroke still being drawn ended
   * first. Only one save runs at a time; strokes drawn meanwhile stay
   * unsaved. After a save, the session moves into the saved file's
   * coordinates. A failed save says why and keeps the editor open. Returns
   * whether the drawing was saved. `resume` saves again, if a change to the
   * file stops this one and the answer is to go on.
   */
  #save(resume: () => void = () => void this.#save()): Promise<boolean> {
    if (this.#saving !== undefined) return this.#saving;
    if (this.#retired) return Promise.resolve(false);
    if (this.#session.drawing) {
      this.#session.end();
      this.#changed();
    }
    if (this.#nothingToMake()) {
      this.#announce("Not saved: nothing drawn yet");
      return Promise.resolve(false);
    }
    // Before anything is written, as text that cannot be saved is a reason not
    // to save what goes with it: the strokes wait, in the draft.
    const problem = this.#textFields?.problem();
    if (problem !== undefined) {
      this.#showText(true);
      this.#textFields?.focus();
      this.#announce(`Not saved: ${problem}`);
      return Promise.resolve(false);
    }
    const document = this.#session.document;
    const base = this.#base;
    const changes = this.#textFields?.changes() ?? {};
    const typedText = this.#textFields?.typed() ?? {};
    this.#announceSaving();
    /** Starts this save again once it has ended, if it is to. */
    let again: (() => void) | undefined;
    this.#saving = (async () => {
      try {
        // Ready for the draft that goes with the write below, which can't pause.
        if (document.base !== undefined) {
          await this.#options.drafts?.store.keepBase(document.base.png, {
            pause: nextTask,
          });
        }
        const {
          bytes: inked,
          record,
          left,
        } = await saveInk(document, base, this.#carried);
        // Only a field that changed: the rest stay as the chunks that `saveInk`
        // carried, byte for byte, whatever they hold.
        let bytes = inked;
        for (const field of textFields) {
          const values = changes[field];
          if (values !== undefined) {
            bytes = await writeText(bytes, field, values);
          }
        }
        // Kept before the file can change, with its own base layer, so that
        // the draft does not depend on which version the file holds.
        const written = await fingerprintOf(bytes);
        const drawn = await drawingOf(bytes);
        this.#keepDraft();
        const typed = this.#typedName;
        const named = await this.#options.write(
          bytes,
          record,
          () => this.#keepDraft(),
          (fingerprint) => {
            this.#watch.took(
              fingerprint,
              fingerprint === written ? drawn : undefined,
            );
          },
          typed,
          () => this.#checkBeforeWriting(resume),
          {
            told: (waiting) => {
              this.#sayWaiting(waiting);
            },
            asked: () => !this.#onTop(),
          },
        );
        // A rename that failed leaves the name typed in the field, unsaved,
        // for the next save to try again.
        this.#notRenamed = !named;
        this.#named(this.#notRenamed ? undefined : typed);
        // The next save starts from what this one wrote, which may be more
        // than the chunks it carried.
        this.#carried = carriedChunks(bytes);
        this.#textFields?.saved(changes, typedText);
        this.#showTextSummary();
        this.#watch.took(written, drawn);
        this.#session.markSaved(document);
        this.#session.rebase(-left);
        this.#surface?.view.shift(-left);
        // The picture moves with the drawing, so it stays where it was, and
        // so does where a drag of it holds it.
        this.#tracing.moveWithDrawing(-left);
        this.#announce(this.#notRenamed ? "Saved, but not renamed" : "Saved");
        return true;
      } catch (error) {
        if (error instanceof SaveAgain) {
          again = error.again;
          return false;
        }
        const reason = error instanceof Error ? error.message : String(error);
        this.#announce(`Not saved: ${reason}`);
        if (!(error instanceof Unsaved)) {
          markNotice(new Notice(`Could not save the symbol: ${reason}`));
        }
        return false;
      } finally {
        this.#saving = undefined;
        this.#updateButtons();
        this.#render();
        this.#keepDraft();
        // Or, if the editor was disposed while this ran, the draft it kept.
        this.#settleDraft();
        // Changes reported while it ran, its own write among them.
        this.#checkFile();
        // Not yet, as what waits on this save must hear that it stopped first:
        // Next, for one, goes by whether it is still under way.
        if (again !== undefined) this.modalEl.win.setTimeout(again);
      }
    })();
    this.#updateButtons();
    return this.#saving;
  }
}
