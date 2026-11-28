// The drawing area: the surface the drawing shows on and the pointer draws
// on, with the brush cursor over it, and the line of text below it that shows
// the symbol at its size. It holds the view, draws it in one frame however
// often asked, measures the note's font for the guides and lays the grid out
// on them, follows the window's and the editor's size, and magnifies and fits
// the view, waiting while the pointer is pressed, with a scroll bar along a
// magnified one. It routes the pointer, the wheel, and drops to drawing or to
// the picture to trace over.

import { unitsPerPixel } from "../format/record.ts";
import { documentSpan, type InkDocument } from "../ink/document.ts";
import { lineBox } from "../ink/geometry.ts";
import type { DrawableBase } from "../ink/render.ts";
import {
  contrastBrushCursor,
  paintBrushCursor,
  type BrushCursor,
} from "./cursor.ts";
import { keepsArrows } from "./focus.ts";
import {
  defaultGridCells,
  finerGrid,
  fontGrid,
  fontGuides,
  type FontMetrics,
  type Guide,
  type GuideName,
} from "./guides.ts";
import { dragsPicture, type PictureTracing } from "./picture.ts";
import { PointerGate } from "./pointer.ts";
import { wheelFactor } from "./reference.ts";
import { EditorScrollBar } from "./scroll.ts";
import type { DrawingSession, InputPoint } from "./session.ts";
import type { StatusLine } from "./status.ts";
import { InkView, measureFont } from "./view.ts";

/** What the drawing area reads of the picture to trace over, and moves of it. */
export type SurfacePicture = Pick<
  PictureTracing,
  | "picture"
  | "moving"
  | "dragging"
  | "startDrag"
  | "dragTo"
  | "endDrag"
  | "scaleBy"
>;

/** Changes to the view that waited for the pointer to be let go. */
export interface ViewWaits {
  /** Zoom, as a switch: asked for twice, the view stays as it is. */
  readonly zoom: boolean;
  readonly fit: boolean;
}

/** What the drawing area is given by the editor around it. */
export interface SurfaceHost {
  /** Says `text` in the status line, for as long as `holds` says, if given. */
  say(text: string, holds?: () => boolean): void;
  updateControls(): void;
  /** After a committed change: update the controls, the surface, the draft. */
  changed(): void;
  /**
   * What to show, as `view` shows it: the drawing, or while making ink, the
   * drawing with the picture's ink at the threshold as its base layer.
   */
  shown(view: InkView): {
    document: InkDocument;
    base: DrawableBase | undefined;
  };
  /** Whether the guides show. */
  guidesShown(): boolean;
  /**
   * The pointer pressed on the drawing area was let go, with what waited for
   * that meanwhile.
   */
  released(waits: ViewWaits): void;
  /**
   * A path has ended or closed, or a press beside one that has took hold of
   * nothing, and it waits to be adjusted and made ink.
   */
  pathWaits(): void;
  /** Something dropped on the drawing area that could be a picture. */
  drop(data: DataTransfer | null): void;
  /** Whether the editor has closed, or Inkline was disabled. */
  ended(): boolean;
  /** How much taller the editor is than it shows, so that it would scroll. */
  overflow(): number;
  /**
   * What changes height with what it says, above the drawing area and below
   * the line of text under it.
   */
  around(): {
    readonly above: readonly HTMLElement[];
    readonly below: readonly HTMLElement[];
  };
  /** Whether Make ink's row shows. */
  convertBarShown(): boolean | undefined;
  /**
   * Calls `change` whenever the theme or a CSS snippet changes, until the
   * function it returns is called.
   */
  watchCss(change: () => void): () => void;
}

/** What the drawing area is made with. */
export interface SurfaceOptions {
  readonly host: SurfaceHost;
  /** The drawing, which the pointer draws on. */
  readonly session: DrawingSession;
  /** The status line, which each action the person takes goes through. */
  readonly line: StatusLine;
  readonly picture: SurfacePicture;
  /** The id of the drawing area's hidden label, its accessible name. */
  readonly labelId: string;
  /** How wide the surface shows the drawing, in document pixels. */
  readonly width: number;
  /** Where in the drawing the surface's middle is. */
  readonly center: number;
  readonly magnified: boolean;
  /** The guides the settings choose, or all of them when undefined. */
  readonly guideLines: (() => ReadonlySet<GuideName>) | undefined;
  /** How many grid cells span the x-height, as the settings choose. */
  readonly gridCells: (() => number) | undefined;
}

/**
 * The drawing area. The editor makes it as it opens, in the order its parts
 * show, calls {@link watchSize} once what is below it is laid out, and
 * {@link dispose} as it closes, which can be called twice: the area then
 * stops following the window, the font, and the theme, and draws no frame it
 * had asked for, nor any it is asked for afterwards.
 */
export class EditorSurface {
  readonly #options: SurfaceOptions;
  readonly #view: InkView;
  readonly #gate = new PointerGate();
  readonly #cursor: HTMLCanvasElement;
  readonly #scroll: EditorScrollBar;
  #cursorSize:
    | { diameter: number; ratio: number; brush: BrushCursor | undefined }
    | undefined;
  readonly #previewLine: HTMLElement;
  readonly #preview: HTMLCanvasElement;
  readonly #fonts: FontFaceSet;
  readonly #unwatchCss: () => void;
  #frame: number | undefined;
  /** Whether {@link dispose} ran, after which nothing more is drawn. */
  #disposed = false;
  #resize: ResizeObserver | undefined;
  /** The note font's metrics and lines, measured when the editor opens. */
  #fontMetrics: FontMetrics | undefined;
  #fontGuides: readonly Guide[] = [];
  /**
   * Changes to the view asked for while the pointer was pressed on the
   * surface, to draw or to drag the picture, for when it is let go: Zoom as a
   * switch, so that asking twice leaves the view as it is, and Fit. Make ink
   * waits in the same way ({@link PictureTracing.takeInkWait}).
   */
  #waits: { zoom: boolean; fit: boolean } = { zoom: false, fit: false };
  /**
   * Whether Make ink's row showed at the press, which it keeps doing until
   * the release, or undefined while the pointer is not pressed. A picture
   * pasted in place of the one it was open for, ink made by Apply, or Cancel
   * closes it meanwhile, which would move the drawing under the pointer.
   */
  #barHeld: boolean | undefined;
  /**
   * Where the pointer pressed to draw last was in the window, while it is,
   * and where that was in the drawing as what is drawn took it.
   */
  #pressedAt:
    { clientX: number; clientY: number; x: number; y: number } | undefined;
  #hover: { pointerId: number; clientX: number; clientY: number } | undefined;
  readonly #resizeCursor = (): void => {
    this.#updateCursor();
  };
  /**
   * Shift pressed or let go, as any key's event says, with the pointer
   * still: a stroke being drawn can end otherwise for it, as the eraser's
   * preview shows.
   */
  readonly #shiftKey = (event: KeyboardEvent): void => {
    if (this.#options.session.holdShift(event.shiftKey)) this.render();
  };

  /** Adds the drawing area and the line of text below it to `parent`. */
  constructor(parent: HTMLElement, options: SurfaceOptions) {
    this.#options = options;
    const drawing = parent.createDiv({ cls: "inkline-drawing" });
    drawing.createSpan({
      text: "Drawing area",
      attr: { id: options.labelId, hidden: "" },
    });
    const surfaceId = `${options.labelId}-surface`;
    const canvas = drawing.createEl("canvas", {
      cls: "inkline-surface",
      attr: {
        id: surfaceId,
        tabindex: "0",
        role: "img",
        // Obsidian turns aria-label into a tooltip. A separate label keeps
        // the accessible name without covering the drawing on hover.
        "aria-labelledby": options.labelId,
      },
    });
    this.#cursor = drawing.createEl("canvas", {
      cls: "inkline-brush-cursor",
      attr: { "aria-hidden": "true" },
    });
    this.#cursor.hide();
    this.#scroll = new EditorScrollBar(
      drawing,
      { controls: surfaceId, label: options.labelId },
      {
        visible: () => this.#view.visible,
        image: () => this.#view.inkedImage,
        moveTo: (center) => {
          options.line.act(() => {
            this.#moveAlong(center - this.#view.center);
          });
        },
      },
    );
    // The wheel moves along the drawing over the bar too, as over the area.
    this.#scroll.element.addEventListener(
      "wheel",
      (event) => {
        if (this.#view.magnified) this.#wheelAlong(event);
      },
      { passive: false },
    );
    canvas.win.addEventListener("resize", this.#resizeCursor);
    // Before the editor's shortcuts, which can stop a key's event.
    canvas.win.addEventListener("keydown", this.#shiftKey, true);
    canvas.win.addEventListener("keyup", this.#shiftKey, true);
    // A line in the vault's text font and size, with the symbol at its size
    // there. Its font gives the guides.
    const line = parent.createDiv({
      cls: "inkline-preview",
      attr: { "aria-hidden": "true" },
    });
    line.createSpan({ text: "A line of text with " });
    this.#preview = line.createEl("canvas", { cls: "inkline-preview-ink" });
    line.createSpan({ text: " in it." });
    this.#previewLine = line;
    // Not yet magnified, so that the grid is first laid out as usual.
    this.#view = new InkView(canvas, options.width);
    this.#measure();
    // The font can arrive later, as a theme's web font, or change with the
    // theme or a CSS snippet; then the guides are measured again.
    line.doc.fonts.addEventListener("loadingdone", this.#remeasure);
    this.#fonts = line.doc.fonts;
    void line.doc.fonts.ready.then(this.#remeasure);
    this.#unwatchCss = options.host.watchCss(this.#remeasure);
    this.#view.centerOn(options.center);
    this.#view.magnified = options.magnified;
    this.#scroll.zoomed(options.magnified);
    this.#listen(canvas);
  }

  /** The view of the drawing that the surface shows. */
  get view(): InkView {
    return this.#view;
  }

  /**
   * Follows the drawing area's size and the window's from now on, and fits
   * the surface to its width now, once what is below it is laid out.
   */
  watchSize(): void {
    const { canvas } = this.#view;
    // The drawing area's own window's observer, which reports as that window
    // draws, as a popout's does (#498).
    const view = canvas.doc.defaultView ?? window;
    this.#resize = new view.ResizeObserver(() => {
      this.resized(() => {
        this.resizeView();
      });
      this.render();
    });
    this.#resize.observe(canvas);
    // A magnified surface's height follows the window's.
    canvas.win.addEventListener("resize", this.#windowResized);
    this.resizeView();
  }

  /**
   * Stops following the window, the font, and the theme, and draws no frame
   * it had asked for, nor any it is asked for afterwards.
   */
  dispose(): void {
    const { win } = this.#view.canvas;
    this.#disposed = true;
    this.#resize?.disconnect();
    this.#scroll.dispose();
    win.removeEventListener("resize", this.#windowResized);
    win.removeEventListener("resize", this.#resizeCursor);
    win.removeEventListener("keydown", this.#shiftKey, true);
    win.removeEventListener("keyup", this.#shiftKey, true);
    this.#fonts.removeEventListener("loadingdone", this.#remeasure);
    this.#unwatchCss();
    if (this.#frame !== undefined) win.cancelAnimationFrame(this.#frame);
  }

  /** Puts the focus on the drawing area, as `options` say. */
  focus(options?: FocusOptions): void {
    this.#view.canvas.focus(options);
  }

  /** Where the note font's cap height is in the line box, once measured. */
  capHeight(): number | undefined {
    return this.#fontGuides.find((guide) => guide.name === "cap height")?.y;
  }

  /**
   * Whether Make ink's row showed at the press, while the pointer is pressed,
   * as it goes on showing until the release.
   */
  get barHeld(): boolean | undefined {
    return this.#barHeld;
  }

  #listen(canvas: HTMLCanvasElement): void {
    const { session, picture, line, host } = this.#options;
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
      return this.#view.toDocument(event.clientX, event.clientY);
    };
    const finish = (event: PointerEvent): void => {
      if (!this.#gate.release(event)) return;
      if (picture.dragging) {
        // The picture stays where the drag left it, or where a release says.
        if (event.type === "pointerup" || event.type === "pointermove") {
          this.#drag(event);
        }
        picture.endDrag();
        canvas.removeClass("is-dragging");
        this.#letGoAround();
        this.#afterPress();
        return;
      }
      this.#pressedAt = undefined;
      const placingPath = session.pathState === "placing";
      // A cancelled press loses only what it did, never a shape it was
      // placing or adjusting.
      if (event.type === "pointercancel") session.cancelPress();
      // A release, unlike a lost capture, says where the pointer ended.
      else if (event.type === "lostpointercapture") session.end();
      else session.end(point(event), event.shiftKey);
      // Once the release has been taken where the drawing was.
      this.#letGoAround();
      host.changed();
      // A click on a path's first or last point ended it.
      if (placingPath && session.adjustingPath) host.pathWaits();
      this.#afterPress();
    };
    /** Keeps where the pointer pressed to draw is, as it reports it. */
    const pressedAt = (event: PointerEvent): void => {
      const { clientX, clientY } = event;
      this.#pressedAt = { clientX, clientY, ...point(event) };
    };
    canvas.addEventListener("pointerdown", (event) => {
      if (!this.#gate.down(event)) return;
      // Before the press empties the status line, which would move the
      // drawing under it.
      this.#holdAround();
      event.preventDefault();
      // Drawing takes the focus, which the default action would have, so
      // that the shortcuts are the editor's again after typing elsewhere.
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      line.act(() => {
        if (picture.moving) {
          picture.startDrag(point(event));
          canvas.addClass("is-dragging");
          return;
        }
        // A press that takes hold of nothing on a path that has ended does
        // nothing, and says how to make it ink.
        if (!session.begin(point(event), event.shiftKey)) host.pathWaits();
        pressedAt(event);
        hover(event);
        this.render();
      });
    });
    canvas.addEventListener("pointermove", (event) => {
      hover(event);
      if (!this.#gate.owns(event)) {
        // Between clicks, a polygon's next side, or a path's next curve,
        // follows the pointer, to the grid while Shift is held.
        if (this.#gate.active === undefined && session.placing) {
          session.extend([point(event)], event.shiftKey);
          this.render();
        }
        return;
      }
      // Releasing the drawing button while another is held is a move.
      if (!this.#gate.holds(event)) {
        finish(event);
        return;
      }
      if (picture.dragging) {
        this.#drag(event);
        return;
      }
      const events =
        typeof event.getCoalescedEvents === "function"
          ? event.getCoalescedEvents()
          : [];
      // Shift draws a straight segment, or a circle, while it is held, and
      // what it places goes on the grid while that is on.
      session.extend(
        (events.length > 0 ? events : [event]).map(point),
        event.shiftKey,
      );
      pressedAt(event);
      this.render();
    });
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("lostpointercapture", finish);
    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });
    // While moving the picture, the wheel scales it about its middle.
    canvas.addEventListener(
      "wheel",
      (event) => {
        const view = this.#view;
        const moving = picture.moving;
        // Magnified, and not moving the picture, the wheel moves along the
        // drawing.
        if (!moving && view.magnified) {
          this.#wheelAlong(event);
          return;
        }
        if (!moving || picture.picture === undefined) return;
        event.preventDefault();
        line.act(() => {
          picture.scaleBy(wheelFactor(event.deltaY, event.deltaMode));
        });
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
      line.act(() => {
        host.drop(event.dataTransfer);
      });
    });
  }

  /** Moves the picture being dragged to where the pointer is in the drawing. */
  #drag(event: PointerEvent): void {
    const { picture } = this.#options;
    if (!picture.dragging) return;
    picture.dragTo(this.#view.toDocument(event.clientX, event.clientY));
  }

  /** Hands what waited for the release to the editor, and waits for nothing. */
  #afterPress(): void {
    const waits = this.#waits;
    this.#waits = { zoom: false, fit: false };
    this.#options.host.released(waits);
  }

  /** Fits the surface to the whole drawing, as one restored from a draft. */
  fitView(): void {
    const view = this.#view;
    // What the surface shows: the drawing, or the ink being made.
    const { document } = this.#options.host.shown(view);
    const span = documentSpan(document);
    if (span === undefined) return;
    view.fit(span.left, span.right);
    this.resizeView();
  }

  /**
   * Fits the surface to its width, with a magnified surface no taller than
   * a little over half the window, and less if the editor would then have to
   * scroll, so that the controls stay in view and the width stays what it was.
   */
  resizeView(): void {
    const view = this.#view;
    const { canvas } = view;
    const { width } = view.contentBox();
    const ratio = canvas.win.devicePixelRatio;
    view.heightLimit = canvas.win.innerHeight * 0.55;
    view.resize(width, ratio);
    if (!view.magnified) return;
    const over = this.#options.host.overflow();
    if (over <= 0) return;
    view.heightLimit = canvas.clientHeight - over;
    view.resize(width, ratio);
  }

  readonly #windowResized = (): void => {
    if (this.#options.host.ended()) return;
    this.resized(() => {
      if (this.#view.magnified) this.resizeView();
    });
    this.render();
  };

  /**
   * Runs `change`, which follows or makes a change to the window's, the
   * editor's, or the drawing area's size, and then ends what is being drawn
   * where it was shown, as a lost capture does, if the drawing has moved under
   * the pointer pressed to draw since it last reported. The window may have
   * moved with it, so where the pointer is in the drawing is not known until
   * it reports again, and its release would end the stroke in a segment never
   * shown (#393). A polygon's corner, or a path's point or handle, being
   * pressed is left as it is: its release places it where the release says,
   * as ever. A picture being dragged needs nothing here: it rejoins the
   * pointer at its next report ({@link PictureTracing.dragTo}), as moving it
   * makes no ink.
   */
  resized(change: () => void): void {
    change();
    const { session, host } = this.#options;
    const at = this.#pressedAt;
    if (!this.#pressed || at === undefined) return;
    const now = this.#view.toDocument(at.clientX, at.clientY);
    if (now.x === at.x && now.y === at.y) return;
    if (!session.drawing || session.placing) return;
    session.end();
    host.changed();
    host.say("Ended the stroke where it showed: the drawing area moved");
  }

  /**
   * Moves a magnified view along the drawing by a quarter of what the surface
   * shows, for the left or right arrow key, unless a field has the focus.
   * Returns whether it did.
   */
  panKey(name: string): boolean {
    const view = this.#view;
    const direction =
      name === "ArrowLeft" ? -1 : name === "ArrowRight" ? 1 : undefined;
    if (direction === undefined || !view.magnified) return false;
    if (keepsArrows(activeDocument.activeElement)) return false;
    const { left, right } = view.visible;
    this.#moveAlong((direction * (right - left)) / 4);
    return true;
  }

  /**
   * Moves the view `dx` document pixels along the drawing, as the wheel, the
   * left and right arrow keys, and the scroll bar move a magnified one, with
   * what is being drawn going on to the pointer ({@link #followPointer}).
   */
  #moveAlong(dx: number): void {
    this.#view.pan(dx);
    this.#followPointer();
    this.render();
  }

  /**
   * Moves a magnified view along the drawing as far as the wheel's `event`
   * turns, its way across, or else its way down, in proportion to the
   * surface's width.
   */
  #wheelAlong(event: WheelEvent): void {
    const view = this.#view;
    event.preventDefault();
    const delta = event.deltaX === 0 ? event.deltaY : event.deltaX;
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    const { left, right } = view.visible;
    this.#options.line.act(() => {
      this.#moveAlong(
        ((delta * lines) / view.contentBox().width) * (right - left),
      );
    });
  }

  /**
   * After the view moves along the drawing, as the wheel, the left and right
   * arrow keys, and the scroll bar move a magnified one, carries what is
   * being drawn on to where the pointer pressed to draw now is in the
   * drawing, as a move there would: the drawing moved under it, like paper
   * under a pen, and what is drawn stays under the pointer and shows what
   * letting go saves (#393). Moving along while drawing can be meant, to take
   * a long stroke past the edge of the view. A polygon's corner, or a path's
   * point or handle, being pressed goes on to the pointer in the same way.
   * The caller draws again.
   */
  #followPointer(): void {
    const at = this.#pressedAt;
    if (!this.#pressed || at === undefined) return;
    const now = this.#view.toDocument(at.clientX, at.clientY);
    this.#pressedAt = { ...at, ...now };
    this.#options.session.follow(now);
  }

  /**
   * What changes height with what it says, around the drawing area: the
   * picture's row above it, whose hint can wrap otherwise, and the line of
   * text, the status line, and the save's waiting message below it.
   */
  get #heldAround(): HTMLElement[] {
    const { above, below } = this.#options.host.around();
    return [...above, this.#previewLine, ...below];
  }

  /**
   * Keeps what is around the drawing area at the height it has while the
   * pointer is pressed on it, until {@link #letGoAround}. Obsidian keeps the
   * editor in the middle of the window, so a line that grew or shrank, as
   * the status line does when the press empties a message of two lines, or
   * a message said meanwhile wraps, moved the drawing under the pointer in
   * the middle of a stroke (#427). What does not fit shows once the pointer
   * is let go, and a screen reader hears it at once, as before. Make ink's
   * row, which opens or closes whole, shows or not as it did at the press
   * ({@link #barHeld}).
   */
  #holdAround(): void {
    for (const element of this.#heldAround) {
      // As laid out, to the fraction of a pixel, as the pointer is mapped by
      // the same measure; the computed style's height can differ from it by
      // that fraction, enough to move the drawing by as much.
      const { height } = element.getBoundingClientRect();
      element.style.setProperty("--inkline-held-height", `${String(height)}px`);
      element.addClass("inkline-held");
    }
    this.#barHeld = this.#options.host.convertBarShown();
  }

  /** Lets what {@link #holdAround} held take its own height again. */
  #letGoAround(): void {
    for (const element of this.#heldAround) {
      element.removeClass("inkline-held");
      element.style.removeProperty("--inkline-held-height");
    }
    if (this.#barHeld === undefined) return;
    this.#barHeld = undefined;
    this.#options.host.updateControls();
  }

  /** Whether the pointer is pressed on the surface to draw, not to drag. */
  get #pressed(): boolean {
    return this.#gate.active !== undefined && !this.#options.picture.dragging;
  }

  /**
   * Whether the pointer is pressed on the surface, to draw or to drag the
   * picture: what moves the drawing under it waits for the release then.
   */
  get held(): boolean {
    return this.#gate.active !== undefined;
  }

  /** Whether the view is magnified, or will be once the pointer is let go. */
  get zoomed(): boolean {
    return this.#view.magnified !== this.#waits.zoom;
  }

  /**
   * Magnifies the drawing, or shows it as usual again. While the pointer is
   * pressed on the surface, that waits until it is let go: zooming moves what
   * the pointer is over, so a stroke, a shape, a polygon's corner, or a path's
   * point or handle being drawn would end somewhere other than it shows, as
   * the release then lands elsewhere in the drawing (#382), and a picture
   * being dragged would leave the pointer (#444). So it keeps the view it
   * started in, as it keeps its grid ({@link DrawingSession.grid}), its tool,
   * and its size.
   */
  toggleZoom(): void {
    const { host } = this.#options;
    if (!this.held) {
      this.zoom();
      return;
    }
    this.#waits.zoom = !this.#waits.zoom;
    host.updateControls();
    if (this.#waits.zoom) {
      host.say(
        this.zoomed
          ? "Zooming in once you let go"
          : "Zooming out once you let go",
      );
    }
  }

  /**
   * Fits the view to the drawing, or once the pointer is let go if it is
   * pressed on the surface, for the same reason as Zoom waits (#393, #444).
   */
  fit(): void {
    if (!this.held) {
      this.fitView();
      this.render();
      return;
    }
    this.#waits.fit = true;
    this.#options.host.say("Fitting once you let go");
  }

  /** Magnifies the drawing, or shows it as usual again, now. */
  zoom(): void {
    const view = this.#view;
    const { host } = this.#options;
    view.magnified = !view.magnified;
    // Its row first, as fitting the drawing area to the window counts it.
    this.#scroll.zoomed(view.magnified);
    this.#layOutGrid(this.#chosenLines());
    this.resizeView();
    host.updateControls();
    this.render();
    host.say(
      view.magnified
        ? "Zoomed in: the wheel or the left and right arrow keys move along the drawing"
        : "Zoomed out",
    );
  }

  /** Draws the surface and the line of text again, in the next frame. */
  render(): void {
    const view = this.#view;
    const { session, picture, host } = this.#options;
    if (this.#disposed || this.#frame !== undefined) return;
    // The surface's own window, which differs from the main one in a popout.
    this.#frame = view.canvas.win.requestAnimationFrame(() => {
      this.#frame = undefined;
      const chosen = this.#chosenLines();
      view.lines = host.guidesShown() ? chosen : undefined;
      this.#layOutGrid(chosen);
      view.grid = session.snap
        ? { ...session.grid, originX: session.gridOrigin }
        : undefined;
      view.reference = picture.picture;
      view.path = session.pathMarks;
      // A press takes hold of a path's marks as near as they show.
      session.markReach = view.markReach;
      const { document, base } = host.shown(view);
      const { activeStrokes, shape, tool } = session;
      view.render(
        document,
        base,
        activeStrokes,
        tool === "eraser" && shape !== "free",
      );
      this.#scroll.update();
      this.#updateCursor();
      view.drawPreview(
        this.#preview,
        Number.parseFloat(getComputedStyle(this.#previewLine).fontSize),
      );
    });
  }

  /** Measures the preview line's font for the guides. */
  #measure(): void {
    const line = this.#previewLine;
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
   * x-height that they choose, and twice as many each way in a magnified view.
   */
  #layOutGrid(lines: readonly Guide[]): void {
    const { pxPerEm } = lineBox;
    const xHeight = this.#fontMetrics?.xHeight;
    const grid = fontGrid(
      lines,
      xHeight === undefined ? Number.NaN : xHeight * pxPerEm,
      this.#options.gridCells?.() ?? defaultGridCells,
    );
    this.#options.session.grid = this.#view.magnified ? finerGrid(grid) : grid;
  }

  /** Measures the font again and redraws, as after a font loads. */
  readonly #remeasure = (): void => {
    if (this.#options.host.ended()) return;
    this.#measure();
    this.render();
  };

  /**
   * Shows whether dragging moves the picture, rather than drawing, and the
   * brush cursor as the tool now draws.
   */
  showPointer(): void {
    this.#view.canvas.toggleClass("is-moving", this.#options.picture.moving);
    this.#updateCursor();
  }

  /**
   * Forgets where the pointer is over the drawing area, and hides the brush
   * cursor, as when Help opens over it.
   */
  forgetPointer(): void {
    this.#hover = undefined;
    this.#updateCursor();
  }

  /** A fixed pointer bitmap only: never part of the preview or saved ink. */
  #updateCursor(): void {
    const cursor = this.#cursor;
    const view = this.#view;
    const hover = this.#hover;
    const { session, picture } = this.#options;
    const canvas = view.canvas;
    if (hover === undefined || picture.moving) {
      cursor.hide();
      canvas.removeClass("has-brush-cursor");
      return;
    }
    // Shown over the drawing alone, not over a border or padding round it.
    const box = view.contentBox();
    const x = hover.clientX - box.left;
    const y = hover.clientY - box.top;
    const inside = x >= 0 && y >= 0 && x < box.width && y < box.height;
    if (!inside) {
      cursor.hide();
      canvas.removeClass("has-brush-cursor");
      return;
    }
    const size = session.activeSize ?? session.size;
    const diameter =
      ((size / unitsPerPixel) * box.width) /
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
    const cursorX = (Math.round(hover.clientX * ratio) - hotspot) / ratio;
    const cursorY = (Math.round(hover.clientY * ratio) - hotspot) / ratio;
    const visible = contrastBrushCursor(
      brush,
      canvas,
      box,
      cursorX - box.left,
      cursorY - box.top,
      ratio,
    );
    cursor.toggle(visible);
    canvas.toggleClass("has-brush-cursor", visible);
    if (!visible) return;
    // From the corner of the box it is placed in, inside the border of the
    // element it is positioned by, rather than from the surface, which a
    // margin round it moves away from that corner (#394). The border is as
    // wide as the computed style says, as for the surface's.
    const holder = cursor.offsetParent ?? canvas.parentElement ?? canvas;
    const rect = holder.getBoundingClientRect();
    const { borderLeftWidth, borderTopWidth } = getComputedStyle(holder);
    const left =
      cursorX - rect.left - (Number.parseFloat(borderLeftWidth) || 0);
    const top = cursorY - rect.top - (Number.parseFloat(borderTopWidth) || 0);
    cursor.style.transform = `translate(${String(left)}px, ${String(top)}px) scale(${String(1 / ratio)})`;
  }
}
