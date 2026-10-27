// Which pointer events draw: one pointer at a time, and only the primary
// button. Every kind of pointer draws alike: a pen or a finger as a mouse
// does. Pen pressure, a pen's eraser end and palm rejection were removed with
// the decision in #101; the `pen-input` branch keeps them.

/** The fields of a `PointerEvent` that decide whether it draws. */
export interface PointerSample {
  readonly pointerId: number;
  readonly button: number;
  readonly buttons: number;
}

export class PointerGate {
  #active: number | undefined;

  /** The pointer that is drawing, if any. */
  get active(): number | undefined {
    return this.#active;
  }

  /**
   * Whether a `pointerdown` starts a stroke: the primary button of a pointer
   * while no other is drawing.
   */
  down(event: PointerSample): boolean {
    if (event.button !== 0 || this.#active !== undefined) return false;
    this.#active = event.pointerId;
    return true;
  }

  /**
   * Whether the drawing pointer still holds the primary button. Pointer
   * Events report pressing and releasing another button as a move, and
   * `pointerup` only when the last button goes, so a stroke must end when
   * its own button is released, even with another still held.
   */
  holds(event: Pick<PointerSample, "pointerId" | "buttons">): boolean {
    return this.owns(event) && (event.buttons & 1) !== 0;
  }

  /** Whether an event belongs to the pointer that is drawing. */
  owns(event: Pick<PointerSample, "pointerId">): boolean {
    return event.pointerId === this.#active;
  }

  /** Ends the drawing pointer on `pointerup` or `pointercancel`; returns whether it was. */
  release(event: Pick<PointerSample, "pointerId">): boolean {
    if (!this.owns(event)) return false;
    this.#active = undefined;
    return true;
  }
}
