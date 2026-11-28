// The scroll bar of a zoomed drawing area: it shows where the view is in the
// drawing, and moves the view along it when its thumb is dragged or its track
// pressed. What the bar spans and where its thumb goes are plain arithmetic,
// so that unit tests can check them; the drawing area owns the bar's element
// and moves the view as the bar asks.

import { lineBox } from "../ink/geometry.ts";
import type { Span } from "./guides.ts";

/**
 * How much the bar spans past the symbol's image on each side, in document
 * pixels: half an em, as Fit leaves.
 */
export const scrollSpare = lineBox.pxPerEm / 2;

/** The narrowest the thumb gets, in CSS pixels, so that it stays easy to take. */
export const minThumb = 24;

/**
 * What the bar spans, in document pixels: the `visible` part of the drawing,
 * and the symbol's `image`, where a save would crop it, with
 * {@link scrollSpare} on each side, or nothing while there is no ink. It is
 * undefined while the view shows all of that, as there is then nowhere to
 * move to; a part past the view of less than a pixel counts as none.
 */
export function scrollSpan(
  visible: Span,
  image: Span | undefined,
): Span | undefined {
  if (image === undefined) return undefined;
  const left = Math.min(visible.left, image.left - scrollSpare);
  const right = Math.max(visible.right, image.right + scrollSpare);
  return visible.left - left >= 1 || right - visible.right >= 1
    ? { left, right }
    : undefined;
}

/** The thumb on a track, in CSS pixels from the track's left end. */
export interface Thumb {
  readonly left: number;
  readonly width: number;
}

/**
 * The thumb for a view of `visible` within `span`, on a track `track` CSS
 * pixels long: as much of the track as the view is of the span, but no less
 * than {@link minThumb}, and as far along the rest of the track as the view
 * is along the rest of the span.
 */
export function thumbOf(span: Span, visible: Span, track: number): Thumb {
  const whole = span.right - span.left;
  const across = visible.right - visible.left;
  const width = Math.min(
    track,
    Math.max(minThumb, (track * across) / Math.max(1, whole)),
  );
  const room = whole - across;
  const along = room <= 0 ? 0 : (visible.left - span.left) / room;
  return { left: Math.min(1, Math.max(0, along)) * (track - width), width };
}

/**
 * Where the middle of the view goes, in document pixels, for the thumb at
 * `left` CSS pixels along a track `track` long, `width` wide, within `span`
 * for a view `across` document pixels wide: the inverse of
 * {@link thumbOf}, kept within the span.
 */
export function viewAt(
  span: Span,
  across: number,
  track: number,
  { left, width }: Thumb,
): number {
  const room = span.right - span.left - across;
  const free = track - width;
  const along = free <= 0 ? 0 : Math.min(1, Math.max(0, left / free));
  return span.left + along * Math.max(0, room) + across / 2;
}

/**
 * How far along the span the view is, from 0 at its left end to 100 at its
 * right, in whole numbers, as the bar's `aria-valuenow` says.
 */
export function scrollValue(span: Span, visible: Span): number {
  const room = span.right - span.left - (visible.right - visible.left);
  if (room <= 0) return 0;
  return Math.round(
    Math.min(1, Math.max(0, (visible.left - span.left) / room)) * 100,
  );
}

/** What the bar asks of the drawing area. */
export interface ScrollHost {
  /** What the surface shows across now, in document pixels. */
  visible(): Span;
  /**
   * Where the saved image would start and end, in document pixels, or
   * undefined while there is no ink, as of the drawing area's last frame.
   */
  image(): Span | undefined;
  /**
   * Moves the view along the drawing until its middle is at document x
   * `center`, as the wheel and the arrow keys move it.
   */
  moveTo(center: number): void;
}

/** The ids of the elements the bar refers to. */
export interface ScrollIds {
  /** The drawing area's, which the bar controls. */
  readonly controls: string;
  /** The drawing area's hidden label's, which names the bar too. */
  readonly label: string;
}

/** The thumb as the bar shows it, with its value. */
type Shown = Thumb & { readonly value: number };

/**
 * The scroll bar's element, in a row of its own below the drawing area, which
 * {@link EditorScrollBar.zoomed} keeps for as long as the view is magnified,
 * so that the bar coming and going never changes a height. It is a pointer
 * control: the left and right arrow keys are the keyboard's way along, so it
 * takes no focus, and a press on it leaves the focus where it was. The
 * drawing area's label names it, as the drawing area's scroll bar.
 *
 * {@link update} runs in every frame the drawing area draws, so the bar
 * measures its track only as its size changes, and writes to its elements
 * only in a frame that changes the thumb or the value: one that leaves them
 * as they were, as most frames of a stroke do, neither measures nor writes
 * anything (#491).
 */
export class EditorScrollBar {
  readonly #host: ScrollHost;
  readonly #bar: HTMLElement;
  readonly #thumb: HTMLElement;
  /** Follows the track's length, for {@link #track}. */
  readonly #resize: ResizeObserver;
  /** Whether the view is magnified, as {@link zoomed} last said. */
  #zoomed = false;
  /**
   * The track's length, in CSS pixels: the bar's, which has no padding, as
   * last laid out, and none while it has no row.
   */
  #track = 0;
  /** What the bar spans as last shown, or undefined while it is hidden. */
  #span: Span | undefined;
  /** The thumb and the value as last written, or undefined while hidden. */
  #shown: Shown | undefined;
  /**
   * While the thumb is dragged: the pointer's id, what the bar spanned at the
   * press, which the drag keeps to, and how far from the thumb's left end it
   * was taken.
   */
  #drag:
    | { readonly pointerId: number; readonly span: Span; readonly grip: number }
    | undefined;

  /** Adds the bar to `parent`, for the drawing area that `ids` name. */
  constructor(parent: HTMLElement, ids: ScrollIds, host: ScrollHost) {
    this.#host = host;
    this.#bar = parent.createDiv({
      cls: "inkline-scroll",
      attr: {
        role: "scrollbar",
        // Not aria-label, which Obsidian turns into a tooltip, as the drawing
        // area's label says.
        "aria-labelledby": ids.label,
        "aria-orientation": "horizontal",
        "aria-controls": ids.controls,
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": "0",
        "aria-hidden": "true",
      },
    });
    this.#thumb = this.#bar.createDiv({ cls: "inkline-scroll-thumb" });
    // The bar's own window's observer: one of the main window's reports only
    // as the main window draws, so the thumb of an editor in a popout stayed
    // without a width (#498).
    const view = this.#bar.doc.defaultView ?? window;
    this.#resize = new view.ResizeObserver((entries) => {
      this.#track = entries.at(-1)?.borderBoxSize[0]?.inlineSize ?? 0;
      this.update();
    });
    this.#resize.observe(this.#bar);
    this.#listen();
  }

  /** The bar's element, for the wheel to move along over it too. */
  get element(): HTMLElement {
    return this.#bar;
  }

  /**
   * Keeps the bar's row below the drawing area while `magnified`, and none
   * otherwise. Call it before the drawing area is fitted to the window, as
   * the row's height counts there.
   */
  zoomed(magnified: boolean): void {
    this.#zoomed = magnified;
    this.#bar.toggleClass("is-zoomed", magnified);
    if (magnified) return;
    // A drag of the thumb ends with it: a hidden bar keeps the pointer it
    // captured, and would go on moving the view.
    this.#endDrag();
    this.update();
  }

  /**
   * Shows the bar for the view and the symbol's image as they are now, while
   * zoomed, and only while the drawing reaches past the view
   * ({@link scrollSpan}). While the thumb is dragged, it spans what it did
   * at the press, as the drag keeps the view within that, so that the thumb
   * stays under the pointer wherever the view was then (#490).
   */
  update(): void {
    const visible = this.#host.visible();
    const span = this.#zoomed
      ? (this.#drag?.span ?? scrollSpan(visible, this.#host.image()))
      : undefined;
    this.#span = span;
    this.#show(
      span === undefined
        ? undefined
        : {
            ...thumbOf(span, visible, this.#track),
            value: scrollValue(span, visible),
          },
    );
  }

  /** Stops following the track's length, as the editor closes. */
  dispose(): void {
    this.#resize.disconnect();
  }

  /** Shows `shown`, or hides the bar for undefined, unless it is so already. */
  #show(shown: Shown | undefined): void {
    const last = this.#shown;
    if (
      shown?.left === last?.left &&
      shown?.width === last?.width &&
      shown?.value === last?.value
    ) {
      return;
    }
    this.#shown = shown;
    this.#bar.toggleClass("is-shown", shown !== undefined);
    this.#bar.setAttr("aria-hidden", shown === undefined ? "true" : null);
    if (shown === undefined) return;
    // As the stylesheet places it, as the drawing area's height is.
    const { style } = this.#thumb;
    style.setProperty("--inkline-scroll-thumb-left", `${String(shown.left)}px`);
    style.setProperty(
      "--inkline-scroll-thumb-width",
      `${String(shown.width)}px`,
    );
    this.#bar.setAttr("aria-valuenow", String(shown.value));
  }

  /** How far along the track the pointer is, in CSS pixels. */
  #along(event: PointerEvent): number {
    return event.clientX - this.#bar.getBoundingClientRect().left;
  }

  /**
   * Ends any drag of the thumb, letting go of the pointer it captured, and
   * shows the bar for what it spans without the drag, which can move the
   * thumb or hide the bar.
   */
  #endDrag(): void {
    const drag = this.#drag;
    if (drag === undefined) return;
    this.#drag = undefined;
    this.#bar.removeClass("is-dragging");
    if (this.#bar.hasPointerCapture(drag.pointerId)) {
      this.#bar.releasePointerCapture(drag.pointerId);
    }
    this.update();
  }

  #listen(): void {
    const bar = this.#bar;
    bar.addEventListener("pointerdown", (event) => {
      const span = this.#span;
      if (event.button !== 0 || span === undefined || this.#drag) return;
      // The focus stays where it was, so that the editor's keys go on
      // working, and the press neither selects nor drags anything else.
      event.preventDefault();
      const thumb = thumbOf(span, this.#host.visible(), this.#track);
      const at = this.#along(event);
      const onThumb = at >= thumb.left && at <= thumb.left + thumb.width;
      // A press on the track brings the thumb's middle to it, and the drag
      // goes on from there, as a press on the thumb does.
      const grip = onThumb ? at - thumb.left : thumb.width / 2;
      this.#drag = { pointerId: event.pointerId, span, grip };
      bar.setPointerCapture(event.pointerId);
      bar.addClass("is-dragging");
      if (!onThumb) this.#dragTo(event);
    });
    bar.addEventListener("pointermove", (event) => {
      if (event.pointerId !== this.#drag?.pointerId) return;
      this.#dragTo(event);
    });
    const end = (event: PointerEvent): void => {
      if (event.pointerId === this.#drag?.pointerId) this.#endDrag();
    };
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
    bar.addEventListener("lostpointercapture", end);
  }

  /** Moves the view for the thumb dragged to where the pointer is now. */
  #dragTo(event: PointerEvent): void {
    const drag = this.#drag;
    if (drag === undefined) return;
    const visible = this.#host.visible();
    const across = visible.right - visible.left;
    const { width } = thumbOf(drag.span, visible, this.#track);
    this.#host.moveTo(
      viewAt(drag.span, across, this.#track, {
        left: this.#along(event) - drag.grip,
        width,
      }),
    );
  }
}
