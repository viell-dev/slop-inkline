// The editor: a modal around a drawing session and its surface, with the
// tools, keyboard shortcuts, saving, drafts, and the question before unsaved
// work is closed.

import {
  ButtonComponent,
  ConfirmationModal,
  Modal,
  Notice,
  setIcon,
  type App,
  type EventRef,
  type TAbstractFile,
} from "obsidian";
import { inkExtension, type CarriedChunk } from "../format/ink-file.ts";
import {
  unitsPerPixel,
  type BaseLayer,
  type InkRecord,
  type Tool,
} from "../format/record.ts";
import {
  baseFromInk,
  drawableBase,
  openInk,
  previewInk,
  readPixels,
  saveInk,
  type EditableInk,
} from "../ink/canvas.ts";
import { documentSpan, type InkDocument } from "../ink/document.ts";
import { lineBox, type Bounds } from "../ink/geometry.ts";
import {
  enlargeFactor,
  enlargedRegion,
  inkDefaults,
  pictureLuminance,
  previewShrink,
  regionValues,
  shrinkLuminance,
  thresholdEdge,
  thresholdRange,
  traceRegion,
  type Luminance,
  type PicturePlace,
  type Region,
} from "../ink/pixels.ts";
import type { DrawableBase } from "../ink/render.ts";
import { chooseRename } from "../notes/names.ts";
import {
  draftBase,
  fingerprintOf,
  restoreDraft,
  sameTarget,
  type Draft,
  type DraftStore,
  type DraftTarget,
} from "./drafts.ts";
import { buttonFace, type ButtonLabels } from "./buttons.ts";
import { FileWatch, type Reading } from "./disk.ts";
import {
  contrastBrushCursor,
  paintBrushCursor,
  type BrushCursor,
} from "./cursor.ts";
import { PointerGate } from "./pointer.ts";
import {
  brushSizes,
  DrawingSession,
  type InputPoint,
  type Shape,
} from "./session.ts";
import {
  defaultGridCells,
  fontGrid,
  fontGuides,
  type FontMetrics,
  type Guide,
  type GuideName,
} from "./guides.ts";
import {
  decodePicture,
  isPicturePath,
  movePicture,
  openLinkPath,
  placePicture,
  scalePicture,
  wheelFactor,
  type Placement,
} from "./reference.ts";
import { InkView, measureFont, surfaceWidth } from "./view.ts";

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
}

/** A picture to trace over, shown faintly under the drawing, never saved. */
export interface TracedPicture {
  readonly image: ImageBitmap;
  readonly width: number;
  readonly height: number;
  readonly placement: Placement;
}

/** The tools chosen in an editor, which the next one starts with. */
export interface EditorTools {
  readonly tool: Tool;
  readonly sizeIndex: number;
  /** Both tools' sizes when continuing with Next. */
  readonly sizes?: Readonly<Record<Tool, number>>;
  readonly grid: boolean;
  readonly guides: boolean;
  /** Whether the drawing is magnified; Next keeps it so. */
  readonly magnified?: boolean;
  /** What dragging draws; Next keeps it, and a new editor draws freehand. */
  readonly shape?: Shape;
  /**
   * The picture being traced over, which the next editor takes over and
   * closes, with its x measured from the middle of the surface, so that it
   * stays where it was on the surface.
   */
  readonly picture?: TracedPicture;
}

/** The first picture file that `data` holds, as pasted or dropped. */
function pictureIn(data: DataTransfer | null): File | undefined {
  if (data === null) return undefined;
  const found = [...data.files].find((file) => file.type.startsWith("image/"));
  if (found !== undefined) return found;
  for (const item of data.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file !== null) return file;
  }
  return undefined;
}

/**
 * Whether a drag could carry a picture: files, or links, as Obsidian's file
 * explorer drags a vault file.
 */
function dragsPicture(event: DragEvent): boolean {
  const types = event.dataTransfer?.types ?? [];
  return types.includes("Files") || types.includes("text/uri-list");
}

/**
 * How far the arrow keys move a picture, in document pixels; with Shift
 * held, they move it one grid spacing.
 */
const nudge = 1;
/** How much + and − scale a picture: as much as a notch of the wheel. */
const keyScale = wheelFactor(-100);

const noPicture = "Paste, drop, or choose a picture to trace over it.";
const tracing = "Tracing over a picture, which is not saved.";
const making = "Making ink of the picture: set the threshold, then Apply.";

/**
 * The part of the picture that would become ink, as the preview last traced
 * it: kept while the picture and the surface stay put, as the threshold
 * changes.
 */
interface PartShown {
  readonly placement: Placement;
  readonly region: Bounds;
  /**
   * Where the pixels traced sit: the picture's place, at the scale of the
   * copy or of the finer samples traced.
   */
  readonly place: PicturePlace;
  /** Undefined when no part of the picture is there. */
  readonly part: Region | undefined;
  /** The threshold's ramp for those pixels. */
  readonly edge: number;
}

/**
 * The ink that a threshold gives that part, as last shown, with the
 * documents shown with it as their base layer, one per drawing.
 */
interface InkShown {
  readonly part: Region | undefined;
  readonly threshold: number;
  readonly light: boolean;
  /** Undefined when the threshold leaves no ink. */
  readonly base: DrawableBase | undefined;
  readonly documents: WeakMap<InkDocument, InkDocument>;
}

/**
 * The copy of a picture `factor` times smaller, from `copies`, which holds
 * the picture itself at 1; made and kept there when first needed.
 */
function copyOf(copies: Map<number, Luminance>, factor: number): Luminance {
  let copy = copies.get(factor);
  if (copy === undefined) {
    const picture = copies.get(1);
    if (picture === undefined) throw new Error("no picture to copy");
    copy = shrinkLuminance(picture, factor);
    copies.set(factor, copy);
  }
  return copy;
}

/** `placement` for a copy of its picture `factor` times smaller. */
function shrunkPlace(placement: Placement, factor: number): PicturePlace {
  return { ...placement, scale: placement.scale * factor };
}

/**
 * The part of the picture whose copies `copies` holds, at `placement`, that
 * becomes ink within `region`, with where its pixels are and the threshold's
 * ramp for them. An enlarged picture is sampled more finely, as
 * `enlargeFactor` says, so that its ink's edges are as sharp as the document
 * shows; any other is the copy `shrink` times smaller.
 */
function inkPart(
  copies: Map<number, Luminance>,
  placement: Placement,
  region: Bounds,
  shrink: number,
): { part: Region | undefined; place: PicturePlace; edge: number } {
  const picture = copyOf(copies, 1);
  const factor = enlargeFactor(
    picture.width,
    picture.height,
    placement,
    region,
  );
  const enlarged =
    factor > 1 ? enlargedRegion(picture, placement, region, factor) : undefined;
  if (enlarged !== undefined) return enlarged;
  const place = shrunkPlace(placement, shrink);
  return {
    part: regionValues(copyOf(copies, shrink), place, region),
    place,
    edge: thresholdEdge,
  };
}

function sameBounds(a: Bounds, b: Bounds): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom
  );
}

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
   * Resolves to whether that name was kept or applied. False means only the
   * rename failed: the drawing is saved, and the name stays for a retry.
   */
  readonly write: (
    bytes: Uint8Array,
    record: InkRecord,
    keepDraft: () => boolean,
    holds: (fingerprint: string) => void,
    name: string,
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
  /** The field for the symbol's name, in the title's place. */
  #nameField: HTMLInputElement | undefined;
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
  #view: InkView | undefined;
  #cursor: HTMLCanvasElement | undefined;
  #cursorSize:
    | { diameter: number; ratio: number; brush: BrushCursor | undefined }
    | undefined;
  readonly #resizeCursor = (): void => {
    this.#updateCursor();
  };
  #hover: { pointerId: number; clientX: number; clientY: number } | undefined;
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
  /** The note font's metrics and lines, measured when the editor opens. */
  #fontMetrics: FontMetrics | undefined;
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
  /** The picture to trace over, which this editor closes when done with it. */
  #picture: TracedPicture | undefined;
  /** Counts pictures asked for, so that only the latest is taken. */
  #pictureRequests = 0;
  /** Whether dragging and the wheel move the picture, rather than drawing. */
  #moving = false;
  /**
   * Where the pointer dragging the picture last was, on the screen: the view
   * can move under it, as a save or Fit does, so each move maps both ends.
   */
  #dragged: { clientX: number; clientY: number } | undefined;
  #pictureHint: HTMLElement | undefined;
  /**
   * Making ink of the picture, while its controls are open: the picture's
   * luminance, found once, the threshold, and whether the ink is lighter
   * than its ground.
   */
  #converting:
    | {
        readonly image: ImageBitmap;
        readonly luma: Luminance;
        /**
         * What the preview traces, by how many times smaller than the
         * picture: the picture itself, at 1, or a smaller copy, made when
         * first needed, so that each step stays quick however much of a
         * large picture is in view.
         */
        readonly copies: Map<number, Luminance>;
        threshold: number;
        light: boolean;
      }
    | undefined;
  /** The part and ink last shown while making ink, kept while unchanged. */
  #partShown: PartShown | undefined;
  #inkShown: InkShown | undefined;
  /** Making ink of the picture, while its encoding runs. */
  #applying: Promise<void> | undefined;
  #convertBar: HTMLElement | undefined;
  #thresholdInput: HTMLInputElement | undefined;
  /** The document whose pastes the editor takes, while it is open. */
  #pasteDocument: Document | undefined;
  readonly #questions = new Set<Modal>();
  readonly #buttons = new Map<string, ButtonComponent>();

  constructor(app: App, options: EditorOptions) {
    super(app);
    this.#options = options;
    this.#session = new DrawingSession(options.document);
    if (options.tools !== undefined) {
      const { tool, sizeIndex, grid, guides } = options.tools;
      this.#session.tool = tool;
      this.#session.shape = options.tools.shape ?? "free";
      Object.assign(
        this.#session.sizes,
        options.tools.sizes ?? {
          pen: sizeIndex,
          eraser: sizeIndex,
        },
      );
      this.#session.snap = grid;
      this.#guidesShown = guides;
    }
    this.#watch = new FileWatch(options.fingerprint);
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

  override open(): void {
    super.open();
    // Obsidian chooses its initial focus after onOpen. Take the drawing's
    // focus immediately, before a shortcut can type in the name field.
    this.#view?.canvas.focus();
  }

  override onOpen(): void {
    this.modalEl.addClass("inkline-editor");
    this.#addNameField();
    const toolbar = this.contentEl.createDiv({ cls: "inkline-toolbar" });
    this.#addButton(toolbar, "pen", "Pen", "P", () => {
      this.#setTool("pen");
    });
    this.#addButton(toolbar, "eraser", "Eraser", "E", () => {
      this.#setTool("eraser");
    });
    this.#addButton(
      toolbar,
      "ellipse",
      "Ellipse",
      "O",
      () => {
        this.#toggleEllipse();
      },
      "Ellipse",
      "drag across a box to draw an ellipse with the pen or the eraser; hold Shift for a circle",
    );
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
    if (this.#options.copyFrom !== undefined) {
      this.#addButton(
        toolbar,
        "copy",
        "Copy from",
        "V",
        () => {
          void this.#copy();
        },
        "Copy from",
        "start from a copy of another symbol",
      );
    }
    this.#addButton(toolbar, "fit", "Fit", "F", () => {
      this.#fitView();
      this.#render();
    });
    this.#addButton(
      toolbar,
      "zoom",
      "Zoom",
      "Z",
      () => {
        this.#toggleZoom();
      },
      "Zoom",
      "a taller view of the drawing, twice as large; the wheel or the arrow keys move along it",
    );
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
        "Next",
        "save and draw the next one",
      );
    }
    this.#addButton(toolbar, "help", "Help", undefined, () => {
      this.#help();
    });
    // A picture to trace over, what chooses it, and what moves or removes it.
    const pictureBar = this.contentEl.createDiv({ cls: "inkline-picture" });
    // The system's file dialog, which reaches files in the vault and out of
    // it; the picture chosen is traced as a pasted one is.
    const chooser = pictureBar.createEl("input", {
      type: "file",
      attr: { accept: "image/*", tabindex: "-1", "aria-hidden": "true" },
    });
    chooser.hide();
    chooser.addEventListener("change", () => {
      const [file] = chooser.files ?? [];
      // So that choosing the same file again is a change too.
      chooser.value = "";
      if (file !== undefined) void this.#trace(file);
      this.#refocus();
    });
    chooser.addEventListener("cancel", () => {
      this.#refocus();
    });
    this.#addButton(
      pictureBar,
      "choose",
      "Choose picture…",
      undefined,
      () => {
        chooser.click();
      },
      "Choose picture…",
      "open a picture file to trace over",
    );
    this.#addButton(
      pictureBar,
      "move",
      "Move",
      "M",
      () => {
        this.#toggleMove();
      },
      "Move",
      "drag the picture or use the arrow keys; the wheel or + and − scale it",
    );
    this.#addButton(
      pictureBar,
      "ink",
      "Make ink",
      "I",
      () => {
        this.#toggleConvert();
      },
      "Make ink",
      "turn the picture into the symbol's ink, by a threshold",
    );
    this.#addButton(pictureBar, "remove", "Remove picture", undefined, () => {
      this.#setPicture(undefined);
      this.#announce("Picture removed");
      this.#refocus();
    });
    this.#pictureHint = pictureBar.createSpan({ cls: "inkline-picture-hint" });
    // What turns the picture into ink, while Make ink is on.
    const convertBar = this.contentEl.createDiv({ cls: "inkline-convert" });
    convertBar.hide();
    const threshold = convertBar
      .createEl("label", { text: "Threshold" })
      .createEl("input", {
        type: "range",
        attr: {
          min: String(thresholdRange.min),
          max: String(thresholdRange.max),
          step: "1",
        },
      });
    threshold.addEventListener("input", () => {
      this.#setThreshold(Number(threshold.value));
    });
    this.#thresholdInput = threshold;
    this.#addButton(
      convertBar,
      "light",
      "Light ink",
      undefined,
      () => {
        this.#toggleLight();
      },
      "Light ink",
      "the ink is lighter than the ground around it",
    );
    this.#addButton(convertBar, "apply", "Apply", undefined, () => {
      void this.#applyInk();
    });
    this.#buttons.get("apply")?.setCta();
    this.#addButton(convertBar, "cancel", "Cancel", undefined, () => {
      this.#stopConverting();
      this.#announce("No ink made");
    });
    this.#convertBar = convertBar;
    this.#pasteDocument = this.modalEl.doc;
    this.#pasteDocument.addEventListener("paste", this.#paste);

    const drawing = this.contentEl.createDiv({ cls: "inkline-drawing" });
    const labelId = `inkline-drawing-${this.#draftId}`;
    drawing.createSpan({
      text: "Drawing area",
      attr: { id: labelId, hidden: "" },
    });
    const canvas = drawing.createEl("canvas", {
      cls: "inkline-surface",
      attr: {
        tabindex: "0",
        role: "img",
        // Obsidian turns aria-label into a tooltip. A separate label keeps
        // the accessible name without covering the drawing on hover.
        "aria-labelledby": labelId,
      },
    });
    this.#cursor = drawing.createEl("canvas", {
      cls: "inkline-brush-cursor",
      attr: { "aria-hidden": "true" },
    });
    this.#cursorSize = undefined;
    this.#cursor.hide();
    canvas.win.addEventListener("resize", this.#resizeCursor);
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
    view.magnified = this.#options.tools?.magnified === true;
    // The editor before this one's picture, where it was on the surface.
    const carried = this.#options.tools?.picture;
    if (carried !== undefined) {
      this.#picture = {
        ...carried,
        placement: movePicture(carried.placement, view.center, 0),
      };
    }
    this.#listen(canvas);
    this.#registerKeys();

    this.#resize = new ResizeObserver(() => {
      this.#resizeView();
      this.#render();
    });
    this.#resize.observe(canvas);
    // A magnified surface's height follows the window's.
    canvas.win.addEventListener("resize", this.#windowResized);
    this.#resizeView();
    this.#updateButtons();
    this.#render();
    this.#options.drafts?.store.hold(this.#draftId);
    this.#options.lifecycle?.opened(this);
    void this.#offerDraft();
    // The file may have changed since it was read for opening.
    this.#checkFile();
  }

  override onClose(): void {
    // A choice of symbol to copy goes with the editor that asked for it.
    this.#choosing?.abort();
    for (const ref of this.#vaultEvents) this.app.vault.offref(ref);
    this.#vaultEvents = [];
    this.#resize?.disconnect();
    this.#view?.canvas.win.removeEventListener("resize", this.#windowResized);
    this.#view?.canvas.win.removeEventListener("resize", this.#resizeCursor);
    this.#fonts?.removeEventListener("loadingdone", this.#remeasure);
    if (this.#cssChange !== undefined) {
      this.app.workspace.offref(this.#cssChange);
    }
    if (this.#frame !== undefined) {
      this.#view?.canvas.win.cancelAnimationFrame(this.#frame);
    }
    for (const question of [...this.#questions]) question.close();
    this.#pasteDocument?.removeEventListener("paste", this.#paste);
    // Pictures still being decoded are closed as they arrive.
    this.#pictureRequests++;
    this.#picture?.image.close();
    this.#picture = undefined;
    this.#forgetConverting();
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
    // Ink being previewed is unsaved too: Save makes it, as saving does.
    if (!this.#unsaved && !this.#previewing()) {
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
   * saved or written as a draft, even by a save still running.
   */
  dispose(): void {
    if (this.#retired) return;
    this.#session.end();
    if (!this.#keepDraft()) {
      new Notice(
        `Inkline could not keep a draft of the latest changes to ${this.#displayName}.`,
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

  /** Whether anything is unsaved: strokes, or a new name. */
  get #unsaved(): boolean {
    return this.#session.dirty || this.#nameChanged;
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
          this.#savedName === ""
            ? `${this.#options.title}: name it, or leave it for the next number`
            : this.#savedName,
        spellcheck: "false",
        autocomplete: "off",
      },
    });
    field.addEventListener("input", () => {
      this.#keepDraft();
    });
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      this.#view?.canvas.focus({ preventScroll: true });
    });
    this.#nameField = field;
  }

  /** The name of the file the editor saves to, or undefined before it has one. */
  #fileName(): string | undefined {
    const path = this.#options.file?.()?.path;
    const file = path?.slice(path.lastIndexOf("/") + 1);
    return file?.toLowerCase().endsWith(inkExtension) === true
      ? file.slice(0, -inkExtension.length)
      : undefined;
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

  /**
   * Adds a toolbar button, showing its icon, its `text`, or both, as the
   * settings choose. Obsidian shows a button's `aria-label` as its tooltip,
   * so that one attribute is its name and its tooltip under every choice:
   * `label`, which holds the `text`, then any `description`, then the
   * shortcut.
   */
  #addButton(
    parent: HTMLElement,
    id: string,
    text: string,
    shortcut: string | undefined,
    action: () => void,
    label = text,
    description?: string,
  ): void {
    const name = description === undefined ? label : `${label}: ${description}`;
    const button = new ButtonComponent(parent)
      .setTooltip(shortcut === undefined ? name : `${name} (${shortcut})`)
      .onClick(action);
    const face = buttonFace(id, this.#options.buttonLabels ?? "both");
    if (face.icon === undefined) {
      button.setButtonText(text);
    } else {
      button.buttonEl.addClass(
        face.text ? "inkline-with-icon" : "inkline-icon-only",
      );
      const icon = button.buttonEl.createSpan({
        cls: "inkline-button-icon",
        attr: { "aria-hidden": "true" },
      });
      setIcon(icon, face.icon);
      if (face.text) button.buttonEl.createSpan({ text });
    }
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
    key(["Mod"], "s", () => void this.#saveOnly(), false);
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
    key([], "o", () => {
      this.#toggleEllipse();
    });
    key([], "g", () => {
      this.#toggleGuides();
    });
    key(["Shift"], "g", () => {
      this.#toggleGrid();
    });
    if (this.#options.copyFrom !== undefined) {
      key([], "v", () => {
        void this.#copy();
      });
    }
    key([], "f", () => {
      this.#fitView();
      this.#render();
    });
    key([], "m", () => {
      this.#toggleMove();
    });
    key([], "z", () => {
      this.#toggleZoom();
    });
    key([], "i", () => {
      this.#toggleConvert();
    });
    // While moving the picture, the arrow keys move it and + and − scale
    // it; otherwise they keep what they do.
    const moving = (
      modifiers: "Shift"[],
      name: string,
      action: (picture: TracedPicture) => Placement,
    ): void => {
      this.scope.register(modifiers, name, () => {
        const picture = this.#picture;
        // Otherwise a magnified view moves along the drawing, as Obsidian's
        // scope runs only the first handler for a key.
        if (!this.#moving || picture === undefined) {
          return modifiers.length > 0 || !this.#panKey(name);
        }
        const focused = activeDocument.activeElement;
        // A text field, or the threshold's slider, keeps its own keys.
        if (typing(focused) || focused?.instanceOf(HTMLInputElement) === true) {
          return true;
        }
        this.#placePicture(action(picture));
        return false;
      });
    };
    for (const [modifiers, step] of [
      [[], () => nudge],
      // One grid spacing, as the grid is laid out now.
      [["Shift"], () => this.#session.grid.spacing],
    ] as const) {
      const by = (dx: number, dy: number) => (picture: TracedPicture) =>
        movePicture(picture.placement, dx * step(), dy * step());
      moving([...modifiers], "ArrowLeft", by(-1, 0));
      moving([...modifiers], "ArrowRight", by(1, 0));
      moving([...modifiers], "ArrowUp", by(0, -1));
      moving([...modifiers], "ArrowDown", by(0, 1));
    }
    const scaled = (factor: number) => (picture: TracedPicture) => {
      const { x, y, scale } = picture.placement;
      return scalePicture(
        picture.placement,
        factor,
        x + (picture.width * scale) / 2,
        y + (picture.height * scale) / 2,
      );
    };
    // + takes Shift on many keyboards, and = is the same key without it.
    moving([], "+", scaled(keyScale));
    moving(["Shift"], "+", scaled(keyScale));
    moving([], "=", scaled(keyScale));
    moving([], "-", scaled(1 / keyScale));
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
    const hover = (event: PointerEvent): void => {
      if (this.#gate.active !== undefined && !this.#gate.owns(event)) return;
      this.#hover = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      this.#updateCursor();
    };
    const hideCursor = (event: PointerEvent): void => {
      if (event.pointerId !== this.#hover?.pointerId) return;
      this.#hover = undefined;
      this.#updateCursor();
    };
    canvas.addEventListener("pointerenter", hover);
    canvas.addEventListener("pointerleave", hideCursor);
    canvas.addEventListener("pointercancel", hideCursor);
    const point = (event: PointerEvent): InputPoint => {
      return (
        this.#view?.toDocument(event.clientX, event.clientY) ?? { x: 0, y: 0 }
      );
    };
    const finish = (event: PointerEvent): void => {
      if (!this.#gate.release(event)) return;
      if (this.#dragged !== undefined) {
        // The picture stays where the drag left it, or where a release says.
        if (event.type === "pointerup" || event.type === "pointermove") {
          this.#drag(event);
        }
        this.#dragged = undefined;
        canvas.removeClass("is-dragging");
        return;
      }
      if (event.type === "pointercancel") this.#session.cancel();
      // A release, unlike a lost capture, says where the pointer ended.
      else if (event.type === "lostpointercapture") this.#session.end();
      else this.#session.end(point(event));
      this.#changed();
    };
    canvas.addEventListener("pointerdown", (event) => {
      if (!this.#gate.down(event)) return;
      event.preventDefault();
      // Drawing takes the focus, which the default action would have, so
      // that the shortcuts are the editor's again after typing elsewhere.
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      if (this.#moving) {
        this.#dragged = { clientX: event.clientX, clientY: event.clientY };
        canvas.addClass("is-dragging");
        return;
      }
      this.#session.begin(point(event));
      hover(event);
      this.#render();
    });
    canvas.addEventListener("pointermove", (event) => {
      hover(event);
      if (!this.#gate.owns(event)) return;
      // Releasing the drawing button while another is held is a move.
      if (!this.#gate.holds(event)) {
        finish(event);
        return;
      }
      if (this.#dragged !== undefined) {
        this.#drag(event);
        return;
      }
      const events =
        typeof event.getCoalescedEvents === "function"
          ? event.getCoalescedEvents()
          : [];
      // Shift draws a straight segment, or a circle, while it is held.
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
    // While moving the picture, the wheel scales it about the pointer.
    canvas.addEventListener(
      "wheel",
      (event) => {
        const picture = this.#picture;
        const view = this.#view;
        if (view === undefined) return;
        // Magnified, and not moving the picture, the wheel moves along the
        // drawing.
        if (!this.#moving && view.magnified) {
          event.preventDefault();
          const delta = event.deltaX === 0 ? event.deltaY : event.deltaX;
          const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
          const { left, right } = view.visible;
          view.pan(
            ((delta * lines) / view.canvas.clientWidth) * (right - left),
          );
          this.#render();
          return;
        }
        if (!this.#moving || picture === undefined) return;
        event.preventDefault();
        const { x, y } = view.toDocument(event.clientX, event.clientY);
        this.#placePicture(
          scalePicture(
            picture.placement,
            wheelFactor(event.deltaY, event.deltaMode),
            x,
            y,
          ),
        );
      },
      { passive: false },
    );
    // A picture dropped on the surface.
    canvas.addEventListener("dragover", (event) => {
      if (!dragsPicture(event)) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
      canvas.addClass("is-drop-target");
    });
    canvas.addEventListener("dragleave", () => {
      canvas.removeClass("is-drop-target");
    });
    canvas.addEventListener("drop", (event) => {
      canvas.removeClass("is-drop-target");
      if (!dragsPicture(event)) return;
      // Neither the browser nor Obsidian does anything else with it.
      event.preventDefault();
      event.stopPropagation();
      const picture = pictureIn(event.dataTransfer);
      if (picture !== undefined) {
        void this.#trace(picture);
        return;
      }
      // A picture in the vault, dragged from Obsidian's file explorer.
      const { vault } = this.app;
      const path = openLinkPath(
        event.dataTransfer?.getData("text/uri-list") ?? "",
        vault.getName(),
      );
      const file = path === undefined ? null : vault.getFileByPath(path);
      if (file === null || !isPicturePath(file.path)) {
        this.#announce("Not traced: only a picture can be traced over");
        return;
      }
      void this.#trace(
        vault.readBinary(file).then((bytes) => new Blob([bytes])),
      );
    });
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
    if (picture === undefined) {
      this.#announce("The clipboard holds no picture to trace over");
      return;
    }
    void this.#trace(picture);
  };

  /**
   * Whether this editor is the modal on top: not under a question, a choice,
   * or another editor.
   */
  #onTop(): boolean {
    const modals = this.modalEl.doc.querySelectorAll(".modal-container");
    return modals.item(modals.length - 1) === this.containerEl;
  }

  /** Moves the picture with the pointer dragging it. */
  #drag(event: PointerEvent): void {
    const last = this.#dragged;
    const picture = this.#picture;
    const view = this.#view;
    if (last === undefined || view === undefined) return;
    this.#dragged = { clientX: event.clientX, clientY: event.clientY };
    if (picture === undefined) return;
    const from = view.toDocument(last.clientX, last.clientY);
    const to = view.toDocument(event.clientX, event.clientY);
    this.#placePicture(
      movePicture(picture.placement, to.x - from.x, to.y - from.y),
    );
  }

  /** Puts the picture where `placement` says, and shows it there. */
  #placePicture(placement: Placement): void {
    const picture = this.#picture;
    if (picture === undefined) return;
    this.#picture = { ...picture, placement };
    this.#render();
  }

  /**
   * Reads and decodes a pasted or dropped picture and traces over it, in
   * place of any other, as tall as a capital letter between the guides and
   * in the middle of the surface. Only the picture asked for last is taken.
   */
  async #trace(file: Blob | Promise<Blob>): Promise<void> {
    const request = ++this.#pictureRequests;
    let image: ImageBitmap;
    try {
      image = await decodePicture(await file);
    } catch {
      if (request === this.#pictureRequests) {
        this.#announce("Not traced: Inkline cannot read this picture");
      }
      return;
    }
    const view = this.#view;
    if (
      request !== this.#pictureRequests ||
      this.#closing ||
      this.#retired ||
      view === undefined
    ) {
      image.close();
      return;
    }
    const top =
      this.#fontGuides.find((guide) => guide.name === "cap height")?.y ??
      lineBox.baseline - 0.7 * lineBox.pxPerEm;
    const { width, height } = image;
    this.#setPicture({
      image,
      width,
      height,
      placement: placePicture(
        width,
        height,
        top,
        lineBox.baseline,
        view.center,
      ),
    });
    this.#announce(
      "Tracing over the picture. Move (M), then drag it or use the arrow keys; the wheel or + and − scale it",
    );
  }

  /** Traces over `picture`, or over none, closing the one it replaces. */
  #setPicture(picture: TracedPicture | undefined): void {
    if (this.#picture?.image !== picture?.image) this.#picture?.image.close();
    this.#picture = picture;
    if (picture === undefined) this.#moving = false;
    if (this.#converting?.image !== picture?.image) this.#forgetConverting();
    this.#updateButtons();
    this.#render();
  }

  /** Opens or closes what turns the picture into ink. */
  #toggleConvert(): void {
    if (this.#converting !== undefined) {
      this.#stopConverting();
      this.#announce("No ink made");
      return;
    }
    const picture = this.#picture;
    const view = this.#view;
    if (picture === undefined || view === undefined) {
      this.#announce(
        "Paste, drop, or choose a picture first, to make ink of it",
      );
      return;
    }
    const luma = pictureLuminance(readPixels(picture.image));
    const copies = new Map([[1, luma]]);
    // The defaults come from the part that would become ink, as finely as
    // the preview traces it.
    const region = this.#inkRegion(view);
    const shrink = previewShrink(
      luma.width,
      luma.height,
      picture.placement,
      region,
    );
    // From the picture's own pixels, even where the ink comes from finer
    // samples: those add values between its own, not more of its tones.
    const source = copyOf(copies, shrink);
    const part = regionValues(
      source,
      shrunkPlace(picture.placement, shrink),
      region,
    );
    const { threshold, light } = inkDefaults(part ?? source);
    this.#converting = {
      image: picture.image,
      luma,
      copies,
      threshold,
      light,
    };
    this.#updateButtons();
    this.#render();
    this.#announce(making);
    this.#thresholdInput?.focus();
  }

  /** Closes what turns the picture into ink, making none. */
  #stopConverting(): void {
    this.#forgetConverting();
    this.#updateButtons();
    this.#render();
    this.#refocus();
  }

  /**
   * Puts the focus on the surface, as after a control that had it hides or
   * is disabled, which would leave it nowhere.
   */
  #refocus(): void {
    this.#view?.canvas.focus({ preventScroll: true });
  }

  #setThreshold(value: number): void {
    const converting = this.#converting;
    if (converting === undefined || !Number.isFinite(value)) return;
    converting.threshold = Math.min(
      thresholdRange.max,
      Math.max(thresholdRange.min, Math.round(value)),
    );
    this.#render();
  }

  #toggleLight(): void {
    const converting = this.#converting;
    if (converting === undefined) return;
    converting.light = !converting.light;
    this.#updateButtons();
    this.#render();
  }

  /**
   * Where the picture becomes ink: the part the surface shows across, within
   * the line box's height, so that the rest of a screenshot of several
   * symbols stays out.
   */
  #inkRegion(view: InkView): Bounds {
    const { left, right } = view.visible;
    return { left, top: 0, right, bottom: lineBox.height };
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
    const converting = this.#converting;
    const picture = this.#picture;
    if (converting === undefined || picture === undefined) {
      return { document, base: this.#base };
    }
    const region = this.#inkRegion(view);
    let area = this.#partShown;
    if (
      area?.placement !== picture.placement ||
      !sameBounds(area.region, region)
    ) {
      const { luma, copies } = converting;
      // As finely as the picture itself, unless too much of it is in view.
      const shrink = previewShrink(
        luma.width,
        luma.height,
        picture.placement,
        region,
      );
      const { part, place, edge } = inkPart(
        copies,
        picture.placement,
        region,
        shrink,
      );
      area = { placement: picture.placement, region, place, part, edge };
      this.#partShown = area;
    }
    const { place, edge } = area;
    let shown = this.#inkShown;
    if (
      shown === undefined ||
      shown.part !== area.part ||
      shown.threshold !== converting.threshold ||
      shown.light !== converting.light
    ) {
      const ink =
        area.part &&
        traceRegion(
          area.part,
          place,
          converting.threshold,
          converting.light,
          edge,
        );
      shown = {
        part: area.part,
        threshold: converting.threshold,
        light: converting.light,
        base: ink && previewInk(ink, place.scale),
        documents: new WeakMap(),
      };
      this.#inkShown = shown;
    }
    const { base } = shown;
    // One document per drawing, so that the surface redraws only on a change.
    let previewed = shown.documents.get(document);
    if (previewed === undefined) {
      previewed =
        base === undefined
          ? { strokes: document.strokes }
          : {
              strokes: document.strokes,
              // Only where it goes; the view draws the preview's own pixels.
              base: {
                x: base.x,
                y: base.y,
                scale: base.scale,
                png: new Uint8Array(),
              },
            };
      shown.documents.set(document, previewed);
    }
    return { document: previewed, base };
  }

  /**
   * Makes the picture's ink at the threshold the drawing's base layer, in
   * place of any it had, as one step that Undo takes back. The picture stays,
   * to trace over or to make ink of again.
   */
  #applyInk(): Promise<void> {
    if (this.#applying === undefined) {
      this.#applying = this.#makeInk().finally(() => {
        this.#applying = undefined;
        this.#updateButtons();
        // Disabling Apply while it ran let go of the focus; with no ink
        // made, the row stays open, and the focus goes back to Apply.
        const focused = this.modalEl.doc.activeElement;
        if (focused === null || focused === this.modalEl.doc.body) {
          if (this.#converting === undefined) this.#refocus();
          else this.#buttons.get("apply")?.buttonEl.focus();
        }
      });
      this.#updateButtons();
    }
    return this.#applying;
  }

  /**
   * Makes the ink {@link #applyInk} describes, from the picture at its own
   * resolution, or finer where it is enlarged. If the threshold, Light ink,
   * the picture, or the surface changed while the ink was encoded, it makes
   * the ink again, so that what it makes is what the surface shows.
   */
  async #makeInk(): Promise<void> {
    for (;;) {
      const converting = this.#converting;
      const picture = this.#picture;
      const view = this.#view;
      if (converting === undefined || picture === undefined || !view) return;
      const { threshold, light } = converting;
      const { placement } = picture;
      const region = this.#inkRegion(view);
      const { part, place, edge } = inkPart(
        converting.copies,
        placement,
        region,
        1,
      );
      if (part === undefined) {
        this.#announce("No ink made: no part of the picture is on the surface");
        return;
      }
      const ink = traceRegion(part, place, threshold, light, edge);
      if (ink === undefined) {
        this.#announce("No ink at this threshold: try another");
        return;
      }
      let made: Awaited<ReturnType<typeof baseFromInk>>;
      this.#announce("Making ink…");
      try {
        made = await baseFromInk(ink, place.scale);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.#announce(`No ink made: ${reason}`);
        return;
      }
      // Closed, or made ink of meanwhile, or put off.
      if (this.#ended() || this.#converting !== converting) return;
      if (
        converting.threshold !== threshold ||
        converting.light !== light ||
        this.#picture?.placement !== placement ||
        !sameBounds(this.#inkRegion(view), region)
      ) {
        continue;
      }
      this.#keepInk(made);
      return;
    }
  }

  /** Makes `made` the drawing's base layer, closing what made it. */
  #keepInk(made: Awaited<ReturnType<typeof baseFromInk>>): void {
    // A stroke being drawn is committed first, so that Undo keeps it apart.
    this.#session.end();
    this.#decoded.set(made.layer.png, made.drawable);
    const { strokes, base } = this.#session.document;
    this.#session.replace(
      { strokes, base: made.layer },
      this.#session.gridOrigin,
    );
    this.#forgetConverting();
    this.#changed();
    this.#refocus();
    this.#announce(
      base === undefined
        ? "Made ink of the picture; Undo takes it back"
        : "Made ink of the picture, in place of the base layer before; Undo takes it back",
    );
  }

  /** Lets go of what made ink of the picture, and what it showed. */
  #forgetConverting(): void {
    this.#converting = undefined;
    this.#partShown = undefined;
    this.#inkShown = undefined;
  }

  /** Whether the surface shows ink being made of the picture. */
  #previewing(): boolean {
    return this.#converting !== undefined && this.#inkShown?.base !== undefined;
  }

  /** Whether the editor has closed, or Inkline was disabled. */
  #ended(): boolean {
    return this.#closing || this.#retired;
  }

  /** Switches between moving the picture and drawing. */
  #toggleMove(): void {
    if (this.#picture === undefined) {
      this.#announce("Paste, drop, or choose a picture first, to move it");
      return;
    }
    this.#moving = !this.#moving;
    this.#updateButtons();
  }

  /**
   * Lets go of the picture, for the editor after this one to take over, with
   * its x measured from the middle of the surface.
   */
  #handOverPicture(): TracedPicture | undefined {
    const picture = this.#picture;
    const view = this.#view;
    this.#picture = undefined;
    if (picture === undefined || view === undefined) {
      picture?.image.close();
      return undefined;
    }
    return {
      ...picture,
      placement: movePicture(picture.placement, -view.center, 0),
    };
  }

  /** Fits the surface to the whole drawing, as one restored from a draft. */
  #fitView(): void {
    const view = this.#view;
    if (view === undefined) return;
    // What the surface shows: the drawing, or the ink being made.
    const { document, base } = this.#shown(view);
    const span = documentSpan(document, base?.width);
    if (span === undefined) return;
    view.fit(span.left, span.right);
    this.#resizeView();
  }

  /**
   * Fits the surface to its width, with a magnified surface no taller than
   * a little over half the window, so that the controls stay in view.
   */
  #resizeView(): void {
    const view = this.#view;
    if (view === undefined) return;
    const { canvas } = view;
    view.heightLimit = canvas.win.innerHeight * 0.55;
    view.resize(canvas.clientWidth, canvas.win.devicePixelRatio);
  }

  readonly #windowResized = (): void => {
    if (this.#closing || this.#retired || this.#view?.magnified !== true) {
      return;
    }
    this.#resizeView();
    this.#render();
  };

  /**
   * Moves a magnified view along the drawing by a quarter of what the surface
   * shows, for the left or right arrow key, unless a field has the focus.
   * Returns whether it did.
   */
  #panKey(name: string): boolean {
    const view = this.#view;
    const direction =
      name === "ArrowLeft" ? -1 : name === "ArrowRight" ? 1 : undefined;
    if (direction === undefined || view?.magnified !== true) return false;
    const focused = activeDocument.activeElement;
    if (typing(focused) || focused?.instanceOf(HTMLInputElement) === true) {
      return false;
    }
    const { left, right } = view.visible;
    view.pan((direction * (right - left)) / 4);
    this.#render();
    return true;
  }

  /** Magnifies the drawing, or shows it as usual again. */
  #toggleZoom(): void {
    const view = this.#view;
    if (view === undefined) return;
    view.magnified = !view.magnified;
    this.#resizeView();
    this.#updateButtons();
    this.#render();
    this.#announce(
      view.magnified
        ? "Zoomed in: the wheel or the arrow keys move along the drawing"
        : "Zoomed out",
    );
  }

  #render(): void {
    const view = this.#view;
    if (this.#frame !== undefined || view === undefined) return;
    // The surface's own window, which differs from the main one in a popout.
    this.#frame = view.canvas.win.requestAnimationFrame(() => {
      this.#frame = undefined;
      const chosen = this.#chosenLines();
      view.lines = this.#guidesShown ? chosen : undefined;
      this.#layOutGrid(chosen);
      view.grid = this.#session.snap
        ? { ...this.#session.grid, originX: this.#session.gridOrigin }
        : undefined;
      view.reference = this.#picture;
      const { document, base } = this.#shown(view);
      view.render(document, base, this.#session.activeStroke);
      this.#updateCursor();
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
    const metrics = measureFont(
      {
        style: font.fontStyle,
        weight: font.fontWeight,
        family: font.fontFamily,
      },
      line.doc,
    );
    this.#fontMetrics = metrics;
    this.#fontGuides = fontGuides(metrics);
    this.#layOutGrid(this.#chosenLines());
  }

  /** The font's lines that the settings choose to show, whether shown now or not. */
  #chosenLines(): readonly Guide[] {
    const chosen = this.#options.guideLines?.();
    return this.#fontGuides.filter((guide) => chosen?.has(guide.name) ?? true);
  }

  /**
   * Lays the grid out on the font's `lines` that the settings choose, shown
   * or not, so that the guides' key never moves it, with the cells across the
   * x-height that they choose.
   */
  #layOutGrid(lines: readonly Guide[]): void {
    const { pxPerEm } = lineBox;
    const xHeight = this.#fontMetrics?.xHeight;
    this.#session.grid = fontGrid(
      lines,
      xHeight === undefined ? Number.NaN : xHeight * pxPerEm,
      this.#options.gridCells?.() ?? defaultGridCells,
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

  /** Switches between drawing ellipses and drawing as the pointer goes. */
  #toggleEllipse(): void {
    if (this.#session.drawing) return;
    this.#session.shape =
      this.#session.shape === "ellipse" ? "free" : "ellipse";
    this.#moving = false;
    this.#updateButtons();
  }

  #setTool(tool: "pen" | "eraser"): void {
    this.#session.tool = tool;
    this.#moving = false;
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
    const drawing = !this.#moving;
    pressed("pen", drawing && this.#session.tool === "pen");
    pressed("eraser", drawing && this.#session.tool === "eraser");
    pressed("ellipse", drawing && this.#session.shape === "ellipse");
    pressed("move", this.#moving);
    const picture = this.#picture !== undefined;
    this.#buttons.get("move")?.setDisabled(!picture);
    this.#buttons.get("remove")?.setDisabled(!picture);
    this.#buttons.get("ink")?.setDisabled(!picture);
    const converting = this.#converting;
    pressed("ink", converting !== undefined);
    this.#buttons.get("apply")?.setDisabled(this.#applying !== undefined);
    pressed("light", converting?.light === true);
    this.#convertBar?.toggle(converting !== undefined);
    if (converting !== undefined && this.#thresholdInput !== undefined) {
      this.#thresholdInput.value = String(converting.threshold);
    }
    this.#pictureHint?.setText(
      converting !== undefined ? making : picture ? tracing : noPicture,
    );
    this.#view?.canvas.toggleClass("is-moving", this.#moving);
    pressed("guides", this.#guidesShown);
    pressed("grid", this.#session.snap);
    pressed("zoom", this.#view?.magnified === true);
    brushSizes.forEach((_, index) => {
      pressed(`size-${String(index)}`, this.#session.sizeIndex === index);
    });
    this.#buttons.get("undo")?.setDisabled(!this.#session.canUndo);
    this.#buttons.get("redo")?.setDisabled(!this.#session.canRedo);
    this.#buttons.get("save")?.setDisabled(this.#saving !== undefined);
    this.#buttons.get("next")?.setDisabled(this.#saving !== undefined);
    this.#updateCursor();
  }

  /** A fixed pointer bitmap only: never part of the preview or saved ink. */
  #updateCursor(): void {
    const cursor = this.#cursor;
    const view = this.#view;
    const hover = this.#hover;
    if (view === undefined || cursor === undefined) return;
    const canvas = view.canvas;
    if (hover === undefined || this.#moving) {
      cursor.hide();
      canvas.removeClass("has-brush-cursor");
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = hover.clientX - rect.left;
    const y = hover.clientY - rect.top;
    const inside =
      x >= canvas.clientLeft &&
      y >= canvas.clientTop &&
      x < canvas.clientLeft + canvas.clientWidth &&
      y < canvas.clientTop + canvas.clientHeight;
    if (!inside) {
      cursor.hide();
      canvas.removeClass("has-brush-cursor");
      return;
    }
    const size = this.#session.activeSize ?? this.#session.size;
    const diameter =
      ((size / unitsPerPixel) * canvas.clientWidth) /
      (view.visible.right - view.visible.left);
    const ratio = canvas.win.devicePixelRatio;
    if (
      this.#cursorSize?.diameter !== diameter ||
      this.#cursorSize.ratio !== ratio
    ) {
      this.#cursorSize = {
        diameter,
        ratio,
        brush: paintBrushCursor(cursor, diameter, ratio),
      };
    }
    const brush = this.#cursorSize.brush;
    if (brush === undefined) {
      cursor.hide();
      canvas.removeClass("has-brush-cursor");
      return;
    }
    const { hotspot } = brush;
    // Align in viewport device pixels, not the fractional parent layout.
    // Scale the integer intrinsic dimensions to avoid CSS size rounding.
    // Each bitmap pixel maps to one display pixel even at fractional zoom;
    // the centre stays within half a device pixel of the pointer.
    const left =
      (Math.round(hover.clientX * ratio) - hotspot) / ratio - rect.left;
    const top =
      (Math.round(hover.clientY * ratio) - hotspot) / ratio - rect.top;
    const visible = contrastBrushCursor(
      brush,
      canvas,
      left - canvas.clientLeft,
      top - canvas.clientTop,
      ratio,
    );
    cursor.toggle(visible);
    canvas.toggleClass("has-brush-cursor", visible);
    if (!visible) return;
    cursor.style.transform = `translate(${String(left)}px, ${String(top)}px) scale(${String(1 / ratio)})`;
  }

  /** A short guide available without leaving a drawing. */
  #help(): void {
    this.#hover = undefined;
    this.#updateCursor();
    const help = new Modal(this.app);
    help.setTitle("Drawing quick start");
    help.modalEl.addClass("inkline-help");
    const content = help.contentEl;
    content.createEl("p", {
      text: "Draw a symbol once, then reuse it in your notes. The preview below the drawing shows its size beside text.",
    });
    const steps = content.createEl("ul");
    for (const text of [
      "Pen (P) adds ink; Eraser (E) removes it. Sizes S–XL (1–4) are remembered separately until you close the editor, including through Next. The circle shows the brush's diameter.",
      "Ellipse (O) draws an ellipse with the pen or the eraser: drag across the box it fills, and hold Shift for a circle. Press it again to draw freehand.",
      "Hold Shift while drawing for a straight segment. Grid (Shift+G) shows dots and snaps stroke ends to them. Its rows pass through each guide line the settings choose, and divide the space between lines evenly; the settings also set how many cells span the x-height.",
      "Undo (Mod+Z) and Redo (Mod+Shift+Z) step through changes. Clear removes the drawing and can be undone.",
      "Zoom (Z) shows the drawing twice as large in a taller view, for fine detail; the wheel or the arrow keys move along it, and Fit (F) centres it. Saved symbols stay the same size in notes.",
      "Paste, drop, or choose (Choose picture…) a picture to trace. Move positions it; the wheel scales it. Make ink converts the visible picture into editable ink. The tracing picture itself is not saved.",
      "Name the symbol, then Save (Mod+Enter). For a new symbol, Next (Mod+Shift+Enter) saves it and starts another. Mod is Ctrl on Windows/Linux, Cmd on macOS.",
      "Saving a changed symbol that your notes use more than once first asks whether to Replace it everywhere. For a variant, start a new symbol with Copy from instead.",
    ])
      steps.createEl("li", { text });
    content.createEl("h2", { text: "What the guides mean" });
    content.createEl("p", {
      text: "The horizontal guides follow your note font, from top to bottom, each in its own colour; a font may put some at the same height or outside the drawing area. Toggle them together with the guide button or its shortcut; the plugin's settings choose which lines show.",
    });
    const guides = content.createEl("ul");
    for (const text of [
      "Ascender (purple by default): the font's upper extent.",
      "Cap height (blue by default): the top of a capital such as H.",
      "x-height (green by default): the top of a lowercase letter such as x.",
      "Baseline (orange by default, solid): where letters sit.",
      "Descender (pink by default): the font's lower extent, for parts below the baseline.",
      "Vertical dashed lines: the saved image's left and right edges, including spacing. They follow the ink as you draw.",
    ])
      guides.createEl("li", { text });
    help.onClose = () => {
      this.#questions.delete(help);
    };
    // Obsidian restores the opener's focus after onClose; resume drawing
    // after that, so the next shortcut cannot activate the Help button.
    const close = help.close.bind(help);
    help.close = () => {
      close();
      if (!this.#closing && !this.#retired) this.#view?.canvas.focus();
    };
    this.#questions.add(help);
    help.open();
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
    if (!pending && !this.#unsaved) {
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
      ...(this.#nameChanged ? { name: this.#typedName } : {}),
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
            if (draft.name !== undefined && this.#nameField !== undefined) {
              this.#nameField.value = draft.name;
            }
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
   * Replaces the drawing with a copy of another symbol, its strokes and base
   * layer, as one step that Undo takes back, to draw a variant of it. The
   * other file's other chunks, such as text, stay with that file.
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
    // A stroke being drawn is committed first, so that Undo brings it back.
    this.#session.end();
    const { document, base } = copy.ink;
    if (document.base !== undefined && base !== undefined) {
      this.#decoded.set(document.base.png, base);
    }
    this.#session.replace(document);
    this.#fitView();
    this.#changed();
    this.#announce(`Started from a copy of ${copy.name}`);
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
        `${this.#displayName} changed on disk, and this version of Inkline cannot read it, so the editor will not save over it.`,
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
      `${this.#displayName} was changed outside this editor. Reload it to take that change in; Undo then brings your drawing back while the editor is open. Or keep your drawing, and saving it replaces the change.`,
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
   * How the vault's notes use this symbol, when saving over it must ask
   * first: for an existing symbol used more than once, whose drawing changed,
   * before Replace was chosen in this editor. Undefined when a save goes over
   * it without asking, as for one used once, where the editor most likely
   * opened it, or a save that only renames it, as links follow a rename.
   */
  #sharedUses(): SymbolUses | undefined {
    const uses = this.#options.uses;
    if (uses === undefined || this.#choseReplace) return undefined;
    if (!this.#session.dirty && !this.#previewing()) return undefined;
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
    if (!(await this.#applyPending())) return;
    // Ink made just now is a change too, if the preview had not shown it yet.
    if (await this.#mayReplace()) await this.#save();
  }

  /**
   * Makes the ink being previewed, before a save, so that the save keeps
   * what the surface shows. Returns whether the save may go on, which it may
   * not when the threshold leaves no ink or the editor closed meanwhile.
   */
  async #applyPending(): Promise<boolean> {
    if (!this.#makingInk()) return true;
    await this.#applyInk();
    return !this.#makingInk() && !this.#ended();
  }

  /** Whether what makes ink of the picture is open. */
  #makingInk(): boolean {
    return this.#converting !== undefined;
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
      if (!(await this.#applyPending())) return;
      if (!(await this.#save(() => void this.#saveAndNext()))) return;
      // Closed meanwhile, as by Save and close or by Inkline being disabled.
      if (this.#closing || this.#retired) return;
      if (this.#unsaved) {
        this.#announce(this.#partlySaved);
        return;
      }
      const { tool, sizeIndex, snap } = this.#session;
      const picture = this.#handOverPicture();
      this.#finish();
      next({
        tool,
        sizeIndex,
        sizes: { ...this.#session.sizes },
        grid: snap,
        guides: this.#guidesShown,
        magnified: this.#view?.magnified === true,
        shape: this.#session.shape,
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
    if (!(await this.#applyPending())) return;
    if (!(await this.#mayReplace())) return;
    if (!(await this.#save(() => void this.#saveAndClose()))) return;
    if (this.#unsaved) {
      this.#announce(this.#partlySaved);
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
        const typed = this.#typedName;
        const named = await this.#options.write(
          bytes,
          record,
          () => this.#keepDraft(),
          (fingerprint) => {
            this.#watch.took(fingerprint);
          },
          typed,
        );
        // A rename that failed leaves the name typed in the field, unsaved,
        // for the next save to try again.
        this.#notRenamed = !named;
        this.#named(this.#notRenamed ? undefined : typed);
        this.#watch.took(written);
        this.#session.markSaved(document);
        this.#session.rebase(-left);
        this.#view?.shift(-left);
        // The picture moves with the drawing, so it stays where it was.
        if (this.#picture !== undefined) {
          this.#placePicture(movePicture(this.#picture.placement, -left, 0));
        }
        this.#announce(this.#notRenamed ? "Saved, but not renamed" : "Saved");
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
