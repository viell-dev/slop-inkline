// The editor's status line says what the editor did last (#302): whatever the
// person does replaces it, with what that did or with nothing, and a message
// about something still under way or still wrong stays while it holds. A
// message that grows or empties while the pointer is pressed on the drawing
// area moves nothing under it (#427).

import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import { loadModules } from "../support/browser.ts";
import { insert } from "../support/editing.ts";
import {
  draw,
  fillStorage,
  freeStorage,
  hold,
  letGo,
  settledSurface,
  startOver,
  storedDrafts,
  waitForHeld,
  waitForStatus,
} from "../support/editor.ts";
import { boxOf, type Point } from "../support/pointer.ts";
import { pastePicture, pictureHint } from "../support/tracing.ts";
import { framesDrawn } from "../support/waits.ts";

const making = "Making ink of the picture: set the threshold, then Apply.";

/** What the status line says now. */
async function status(): Promise<string> {
  return browser.$(".inkline-editor .inkline-status").getText();
}

/** What the status line says once what was just done has been drawn. */
async function settledStatus(): Promise<string> {
  await framesDrawn();
  return status();
}

/** Draws a short stroke, and waits for the draft that keeps it. */
async function stroke(y: number): Promise<void> {
  const before = (await storedDrafts())[0]?.strokes.length ?? 0;
  await draw([
    [0.3, y],
    [0.6, y],
  ]);
  await browser.waitUntil(
    async () => ((await storedDrafts())[0]?.strokes.length ?? 0) > before,
  );
}

/**
 * Starts a polygon at two corners, with Polygon chosen, and drops it with
 * Esc. Clicking the surface puts the focus back there for Esc.
 */
async function dropPolygon(): Promise<void> {
  await draw([[0.3, 0.3]]);
  await draw([[0.6, 0.6]]);
  await browser.keys("Escape");
  await waitForStatus("Polygon dropped");
}

/** A place in the window, at fractions of the drawing area's box now. */
async function inWindow(x: number, y: number): Promise<Point> {
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
 * there, pressing each of `keys` in turn, and lets go there: one WebDriver
 * command, as a press held into the next command ends as a lost capture
 * (#391). The places are the window's, where a hand stays, rather than the
 * drawing area's, which the mouse would follow if the area moved.
 */
async function dragInWindow(
  from: Point,
  to: Point,
  keys: readonly string[] = [],
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
    keyboard.down(key).up(key);
    pointer.pause(10).pause(10);
  }
  keyboard.pause(300);
  pointer.pause(300).up();
  await browser.actions([keyboard, pointer]);
}

/** The strokes the editor keeps, from its draft. */
async function keptStrokes(): Promise<number[][]> {
  return ((await storedDrafts())[0]?.strokes ?? []).map((stroke) => [
    ...stroke.points,
  ]);
}

/** Waits for the draft to hold `count` strokes, and gives the last. */
async function strokeAt(count: number): Promise<number[]> {
  await browser.waitUntil(async () => (await keptStrokes()).length === count, {
    timeoutMsg: `the draft never held ${String(count)} strokes`,
  });
  return (await keptStrokes()).at(-1) ?? [];
}

/**
 * Records, in the page, where the drawing area's top is at each press, move,
 * and release on it, before the editor takes each.
 */
async function watchTops(): Promise<void> {
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
async function tops(): Promise<{ type: string; top: number }[]> {
  return browser.execute(() => {
    const tops: unknown = Reflect.get(window, "inklineTestTops");
    return Array.isArray(tops) ? (tops as { type: string; top: number }[]) : [];
  });
}

/** How many lines the status line takes now. */
async function statusLines(): Promise<number> {
  return browser.execute(() => {
    const line = document.querySelector(".inkline-editor .inkline-status");
    if (!(line instanceof HTMLElement)) throw new Error("no status line");
    const style = getComputedStyle(line);
    return Math.round(
      line.getBoundingClientRect().height / Number.parseFloat(style.lineHeight),
    );
  });
}

/** Makes the editor narrow, as a narrow window does, so that long messages wrap. */
async function narrow(): Promise<void> {
  await browser.execute(() => {
    const editor = document.querySelector(".inkline-editor");
    if (editor instanceof HTMLElement) editor.style.width = "420px";
  });
  await settledSurface();
}

describe("The editor's status line", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
  });

  it("says nothing after Fit, rather than keep saying Zoomed out", async function () {
    await insert();
    await stroke(0.5);
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    await browser.keys("z");
    await waitForStatus("Zoomed out");
    await browser.keys("f");
    expect(await settledStatus()).toBe("");
    // The button as its key, zoomed in this time.
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    await browser.$('[data-inkline-button="fit"]').click();
    expect(await settledStatus()).toBe("");
  });

  it("drops Polygon dropped for Make ink, and for what is done in it", async function () {
    await insert();
    await pastePicture("red");
    await waitForStatus("Tracing over the picture");
    // As reported: a polygon dropped, then Make ink.
    await browser.keys("y");
    await dropPolygon();
    await browser.keys("i");
    expect(await settledStatus()).toBe(making);
    // A polygon dropped while Make ink is open says so, and the threshold
    // moved after it leaves nothing standing; the bar still says what to do.
    await dropPolygon();
    await browser.execute(() => {
      const slider = activeDocument.querySelector(
        ".inkline-convert input[type=range]",
      );
      if (slider?.instanceOf(HTMLInputElement) !== true) {
        throw new Error("no slider");
      }
      slider.value = String(Number(slider.value) + 10);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(await settledStatus()).toBe("");
    expect(await pictureHint()).toBe(making);
    await browser.$('[data-inkline-button="cancel"]').click();
    await waitForStatus("No ink made");
  });

  it("empties for each thing done that has nothing to say, and keeps what something says", async function () {
    await insert();
    await stroke(0.4);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    // A stroke drawn after a save: "Saved" is no longer so.
    await stroke(0.6);
    expect(await settledStatus()).toBe("");
    // Keys and buttons that say nothing, after one that says something.
    for (const act of [
      async () => browser.keys("g"),
      async () => browser.keys([Key.Shift, "g"]),
      async () => browser.keys("e"),
      async () => browser.keys("3"),
      async () => browser.keys(["Control", "z"]),
      async () => browser.$('[data-inkline-button="redo"]').click(),
      async () => browser.keys("ArrowUp"),
      async () => browser.$('[data-inkline-button="pen"]').click(),
    ]) {
      await browser.keys("b");
      await waitForStatus("Toggle fill is for Ellipse, Polygon, and Path");
      await act();
      expect(await settledStatus()).toBe("");
    }
    // Something that says something replaces the message before it, and
    // a key that does nothing here leaves the line as it is. Flat ends
    // refuses with the grid off.
    await browser.keys([Key.Shift, "g"]);
    await browser.keys("t");
    await waitForStatus(
      "Flat ends is for freehand strokes and paths on the grid",
    );
    await browser.keys("ArrowLeft");
    expect(await settledStatus()).toBe(
      "Flat ends is for freehand strokes and paths on the grid; turn on Grid first, without Ellipse or Polygon",
    );
    // Typing a name is something done too.
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    await browser.$(".inkline-editor .inkline-name").click();
    await browser.keys("a");
    expect(await settledStatus()).toBe("");
  });

  it("keeps saying Saving… through what is done meanwhile, until the save ends", async function () {
    await insert();
    await stroke(0.4);
    await hold("create");
    try {
      await browser.keys(["Control", "s"]);
      await waitForHeld();
      await waitForStatus("Saving…");
      await stroke(0.6);
      await browser.keys("g");
      expect(await settledStatus()).toBe("Saving…");
    } finally {
      await letGo();
    }
    await waitForStatus("Saved");
  });

  it("keeps saying Draft not kept through what is done meanwhile, until one is kept", async function () {
    await insert();
    await stroke(0.3);
    try {
      await fillStorage();
      await draw([
        [0.3, 0.5],
        [0.6, 0.5],
      ]);
      await browser.$(".notice*=could not keep a draft").waitForExist();
      expect(await status()).toBe("Draft not kept");
      // Storage still refuses each draft after it.
      await draw([
        [0.3, 0.6],
        [0.6, 0.6],
      ]);
      await browser.keys("g");
      expect(await settledStatus()).toBe("Draft not kept");
      expect((await storedDrafts())[0]?.strokes).toHaveLength(1);
    } finally {
      await freeStorage();
    }
    await stroke(0.8);
    expect(await status()).toBe("Draft kept");
  });

  // Obsidian keeps the editor in the middle of the window, so a status line
  // that grew or shrank during a press moved the drawing under the pointer
  // (#427). Each drag stays at one place in the window, as a hand does.
  it("keeps the drawing still under a press that empties a message of two lines", async function () {
    await insert();
    await narrow();
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    await settledSurface();
    expect(await statusLines()).toBe(2);
    const from = await inWindow(0.3, 0.65);
    const to = await inWindow(0.6, 0.35);
    await watchTops();
    await dragInWindow(from, to);
    const first = await strokeAt(1);
    const seen = await tops();
    expect(seen.map(({ type }) => type)).toContain("pointerdown");
    expect(seen.at(-1)?.type).toBe("pointerup");
    // Where it was at the press, until the release.
    expect(new Set(seen.map(({ top }) => top)).size).toBe(1);
    // Once it is let go, the emptied line takes its one line again, and the
    // same drag lands in the drawing as moved by that, at both ends alike:
    // the first stroke was taken in one place throughout.
    await settledSurface();
    expect(await statusLines()).toBe(1);
    await dragInWindow(from, to);
    const second = await strokeAt(2);
    const shift = (index: number): number =>
      (first.at(index) ?? 0) - (second.at(index) ?? 0);
    for (const axis of [0, 1]) {
      expect(
        Math.abs(shift(axis) - shift(first.length - 2 + axis)),
      ).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the drawing still when a message of two lines comes during a press", async function () {
    await insert();
    await narrow();
    expect(await statusLines()).toBe(1);
    await watchTops();
    // T, for Flat ends, without the grid says why it does nothing, at length.
    await dragInWindow(await inWindow(0.3, 0.65), await inWindow(0.6, 0.35), [
      "t",
    ]);
    await strokeAt(1);
    const seen = await tops();
    expect(seen.at(-1)?.type).toBe("pointerup");
    expect(new Set(seen.map(({ top }) => top)).size).toBe(1);
    // It shows whole once the pointer is let go.
    await waitForStatus("Flat ends is for freehand strokes");
    await settledSurface();
    expect(await statusLines()).toBe(2);
  });
});
