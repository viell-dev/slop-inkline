// Where things are in Obsidian's window, and the mouse's clicks there, in
// end-to-end tests.

import { browser } from "@wdio/globals";

/** A place in the window, in its own pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The middle of the first element `selector` finds that has a size. */
async function middleOf(selector: string): Promise<Point | null> {
  return browser.execute((wanted) => {
    for (const found of Array.from(document.querySelectorAll(wanted))) {
      const box = found.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      return {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
      };
    }
    return null;
  }, selector);
}

/** Waits until `read` gives a place that stays there, and gives it. */
export async function settled(
  read: () => Promise<Point | null>,
  what: string,
): Promise<Point> {
  let last: Point | null = null;
  let held = 0;
  return browser.waitUntil(
    async () => {
      const now = await read();
      held =
        now !== null && now.x === last?.x && now.y === last.y ? held + 1 : 0;
      last = now;
      return held >= 2 ? now : false;
    },
    { interval: 150, timeoutMsg: `${what} did not settle` },
  );
}

/** The settled middle of the first of `selector` with a size. */
export async function placeOf(selector: string): Promise<Point> {
  return settled(() => middleOf(selector), selector);
}

/** Presses the right button at `point`. */
export async function rightClick(point: Point): Promise<void> {
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move(point)
    .down({ button: 2 })
    .up({ button: 2 })
    .perform();
}

/** Presses the left button at `point`. */
export async function click(point: Point): Promise<void> {
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move(point)
    .down({ button: 0 })
    .up({ button: 0 })
    .perform();
}

/**
 * Presses the left button twice at `point`, quickly enough to be a
 * double-click: the second click's `detail` is 2, and a `dblclick` follows it.
 */
export async function doubleClick(point: Point): Promise<void> {
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move(point)
    .down({ button: 0 })
    .up({ button: 0 })
    .pause(50)
    .down({ button: 0 })
    .up({ button: 0 })
    .perform();
}
