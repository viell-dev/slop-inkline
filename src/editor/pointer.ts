// Which pointer events draw: one pointer at a time, only the primary button,
// a pen's eraser as the eraser, and no touch once a pen has been seen, so
// that a palm resting on a tablet draws nothing.

import type { Tool } from "../format/record.ts";

/** The fields of a `PointerEvent` that decide whether it draws. */
export interface PointerSample {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;
}

/** The `button` and `buttons` bit of a pen's eraser, in Pointer Events. */
const eraserButton = 5;
const eraserButtons = 32;

export class PointerGate {
  #active: number | undefined;
  #penSeen = false;

  /** The pointer that is drawing, if any. */
  get active(): number | undefined {
    return this.#active;
  }

  /**
   * Decides whether a `pointerdown` starts a stroke. Returns the tool the
   * device asks for (`"eraser"` for a pen's eraser end), `"brush"` to use the
   * current brush, or undefined to ignore the event.
   */
  down(event: PointerSample): Tool | "brush" | undefined {
    if (event.pointerType === "pen") this.#penSeen = true;
    if (this.#active !== undefined) return undefined;
    if (event.pointerType === "touch" && this.#penSeen) return undefined;
    const erasing =
      event.pointerType === "pen" &&
      (event.button === eraserButton || (event.buttons & eraserButtons) !== 0);
    if (!erasing && event.button !== 0) return undefined;
    this.#active = event.pointerId;
    return erasing ? "eraser" : "brush";
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

/** Whether a pointer type reports real pressure. */
export function reportsPressure(pointerType: string): boolean {
  return pointerType === "pen";
}
