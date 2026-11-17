// Moving the mouse over Obsidian's window as a person does, for tests of the
// tooltips Obsidian shows, in end-to-end tests.

import { browser, expect } from "@wdio/globals";

/** An element's edges, in pixels. */
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

/**
 * Moves the pointer to `x`, `y` in the window, as a person's mouse would, and
 * returns the classes of what the page heard the pointer move over there, so
 * that a check of what shows there knows the pointer reached it.
 */
export async function pointAt(x: number, y: number): Promise<string> {
  await browser.execute(() => {
    Reflect.deleteProperty(window, "inklinePointer");
    document.addEventListener(
      "mousemove",
      ({ target }) => {
        Reflect.set(
          window,
          "inklinePointer",
          target instanceof HTMLElement ? target.className : "",
        );
      },
      { capture: true, once: true },
    );
  });
  await browser
    .action("pointer")
    .move({ origin: "viewport", x: Math.round(x), y: Math.round(y) })
    .perform();
  return browser.execute(() => String(Reflect.get(window, "inklinePointer")));
}

/**
 * Moves the mouse a little in an empty part of the window, as a person has
 * before they rest it anywhere. Obsidian, 1.13 and 1.15 alike, counts the
 * mouse's moves so as to tell it from a touch, and shows no tooltip for a
 * pointer it has seen move fewer than twice. A test that waits for a tooltip
 * calls this first, so that it does not depend on the tests before it having
 * moved the mouse (#270).
 */
export async function warmUpPointer(): Promise<void> {
  const pane = await boxOf(".workspace-split.mod-root");
  for (const step of [0, 1, 2]) {
    expect(
      await pointAt(pane.left + 40 + 10 * step, pane.bottom - 40),
    ).not.toContain("inkline");
  }
}
