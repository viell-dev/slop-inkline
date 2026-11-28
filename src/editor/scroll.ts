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
   * Moves the view along the drawing until its middle is at document x
   * `center`, as the wheel and the arrow keys move it.
   */
  moveTo(center: number): void;
}

/**
 * The scroll bar's element, in a row of its own below the drawing area, which
 * {@link EditorScrollBar.zoomed} keeps for as long as the view is magnified,
 * so that the bar coming and going never changes a height. It is a pointer
 * control: the left and right arrow keys are the keyboard's way along, so it
 * takes no focus, and a press on it leaves the focus where it was.
 */
export class EditorScrollBar {
  readonly #host: ScrollHost;
  readonly #bar: HTMLElement;
  readonly #thumb: HTMLElement;
  /** What the bar spans as last shown, or undefined while it is hidden. */
  #span: Span | undefined;
  /**
   * While the thumb is dragged: the pointer's id, what the bar spanned at the
   * press, which the drag keeps to, and how far from the thumb's left end it
   * was taken.
   */
  #drag:
    | { readonly pointerId: number; readonly span: Span; readonly grip: number }
    | undefined;

  /** Adds the bar to `parent`, for the drawing area whose id `controls` is. */
  constructor(parent: HTMLElement, controls: string, host: ScrollHost) {
    this.#host = host;
    this.#bar = parent.createDiv({
      cls: "inkline-scroll",
      attr: {
        role: "scrollbar",
        "aria-orientation": "horizontal",
        "aria-controls": controls,
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": "0",
        "aria-hidden": "true",
      },
    });
    this.#thumb = this.#bar.createDiv({ cls: "inkline-scroll-thumb" });
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
    this.#bar.toggleClass("is-zoomed", magnified);
    if (magnified) return;
    // A drag of the thumb ends with it: a hidden bar keeps the pointer it
    // captured, and would go on moving the view.
    this.#endDrag();
    this.show(false, undefined);
  }

  /**
   * Shows the bar for a view of `visible` while `magnified`, with the
   * symbol's `image`, or undefined while there is no ink: only while the
   * drawing reaches past the view ({@link scrollSpan}).
   */
  show(
    magnified: boolean,
    image: Span | undefined,
    visible: Span = this.#host.visible(),
  ): void {
    const span = magnified ? scrollSpan(visible, image) : undefined;
    this.#span = span;
    this.#bar.toggleClass("is-shown", span !== undefined);
    this.#bar.setAttr("aria-hidden", span === undefined ? "true" : null);
    if (span === undefined) return;
    const thumb = thumbOf(span, visible, this.#track());
    // As the stylesheet places it, as the drawing area's height is.
    const { style } = this.#thumb;
    style.setProperty("--inkline-scroll-thumb-left", `${String(thumb.left)}px`);
    style.setProperty(
      "--inkline-scroll-thumb-width",
      `${String(thumb.width)}px`,
    );
    this.#bar.setAttr("aria-valuenow", String(scrollValue(span, visible)));
  }

  /** The track's length, in CSS pixels: the bar's, which has no padding. */
  #track(): number {
    return this.#bar.getBoundingClientRect().width;
  }

  /** How far along the track the pointer is, in CSS pixels. */
  #along(event: PointerEvent): number {
    return event.clientX - this.#bar.getBoundingClientRect().left;
  }

  /** Ends any drag of the thumb, letting go of the pointer it captured. */
  #endDrag(): void {
    const drag = this.#drag;
    if (drag === undefined) return;
    this.#drag = undefined;
    this.#bar.removeClass("is-dragging");
    if (this.#bar.hasPointerCapture(drag.pointerId)) {
      this.#bar.releasePointerCapture(drag.pointerId);
    }
  }

  #listen(): void {
    const bar = this.#bar;
    bar.addEventListener("pointerdown", (event) => {
      const span = this.#span;
      if (event.button !== 0 || span === undefined || this.#drag) return;
      // The focus stays where it was, so that the editor's keys go on
      // working, and the press neither selects nor drags anything else.
      event.preventDefault();
      const visible = this.#host.visible();
      const track = this.#track();
      const thumb = thumbOf(span, visible, track);
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
    const track = this.#track();
    const { width } = thumbOf(drag.span, visible, track);
    this.#host.moveTo(
      viewAt(drag.span, across, track, {
        left: this.#along(event) - drag.grip,
        width,
      }),
    );
  }
}
