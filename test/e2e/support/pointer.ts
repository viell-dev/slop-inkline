// Where things are in Obsidian's window, and the mouse's clicks there, in
// end-to-end tests.

import { browser } from "@wdio/globals";

/** A place in the window, in its own pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A box's edges: an element's, in the window's pixels, or one read elsewhere. */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The box of the first element `selector` finds. */
export async function boxOf(selector: string): Promise<Box> {
  return browser.execute((wanted) => {
    const found = document.querySelector(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const { left, right, top, bottom } = found.getBoundingClientRect();
    return { left, right, top, bottom };
  }, selector);
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

/** A place in the window, at fractions of the drawing area's box now. */
export async function inWindow(x: number, y: number): Promise<Point> {
  const { left, right, top, bottom } = await boxOf(
    ".inkline-editor .inkline-surface",
  );
  return {
    x: Math.round(left + x * (right - left)),
    y: Math.round(top + y * (bottom - top)),
  };
}

/**
 * Presses the mouse at `from`, moves it to `to` in one report, holds it
 * there, pressing each of `keys` in turn, a list being keys held together,
 * and lets go there: one WebDriver command, as a press held into the next
 * command ends as a lost capture (#391). The places are the window's, where
 * a hand stays, rather than the drawing area's, which the mouse would follow
 * if the area moved.
 */
export async function dragInWindow(
  from: Point,
  to: Point,
  keys: readonly (string | readonly string[])[] = [],
): Promise<void> {
  const keyboard = browser.action("key");
  const pointer = browser.action("pointer", {
    parameters: { pointerType: "mouse" },
  });
  pointer
    .move({ origin: "viewport", ...from, duration: 0 })
    .down()
    .move({ origin: "viewport", ...to, duration: 0 })
    .pause(300);
  keyboard.pause(0).pause(0).pause(0).pause(300);
  for (const key of keys) {
    const together = typeof key === "string" ? [key] : key;
    for (const each of together) keyboard.down(each);
    for (const each of [...together].reverse()) keyboard.up(each);
    // The pointer holds still for each of them.
    for (let tick = 0; tick < 2 * together.length; tick += 1) {
      pointer.pause(10);
    }
  }
  keyboard.pause(300);
  pointer.pause(300).up();
  await browser.actions([keyboard, pointer]);
}

/**
 * Records, in the page, where the drawing area's top is at each press, move,
 * and release on it, before the editor takes each, for {@link tops}.
 */
export async function watchTops(): Promise<void> {
  await browser.execute(() => {
    const surface = document.querySelector(".inkline-editor .inkline-surface");
    if (!(surface instanceof HTMLElement)) throw new Error("no surface");
    const tops: { type: string; top: number }[] = [];
    Reflect.set(window, "inklineTestTops", tops);
    for (const type of ["pointerdown", "pointermove", "pointerup"]) {
      window.addEventListener(
        type,
        () => {
          tops.push({ type, top: surface.getBoundingClientRect().top });
        },
        { capture: true },
      );
    }
  });
}

/** What {@link watchTops} recorded. */
export async function tops(): Promise<{ type: string; top: number }[]> {
  return browser.execute(() => {
    const tops: unknown = Reflect.get(window, "inklineTestTops");
    return Array.isArray(tops) ? (tops as { type: string; top: number }[]) : [];
  });
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
