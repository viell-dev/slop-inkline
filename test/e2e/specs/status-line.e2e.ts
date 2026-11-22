// The editor's status line says what the editor did last (#302): whatever the
// person does replaces it, with what that did or with nothing, and a message
// about something still under way or still wrong stays while it holds. A
// message that grows or empties while the pointer is pressed on the drawing
// area moves nothing under it (#427).

import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import { loadModules } from "../support/browser.ts";
import { insert, strokeCount, waitClosed } from "../support/editing.ts";
import {
  clickTop,
  draw,
  fillStorage,
  freeStorage,
  hold,
  letGo,
  recordOf,
  settledSurface,
  startOver,
  storedDrafts,
  waitForHeld,
  waitForStatus,
  waitForTop,
} from "../support/editor.ts";
import { dragInWindow, inWindow, tops, watchTops } from "../support/pointer.ts";
import {
  inkShown,
  making,
  pastePicture,
  pictureHint,
} from "../support/tracing.ts";
import { framesDrawn } from "../support/waits.ts";

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

/** Pastes a picture a threshold makes ink of: a black square on white. */
async function pasteSquare(): Promise<void> {
  await browser.execute(async () => {
    await window.inklineTest.pictures.copyPicture(40, 40, "white", [
      { x: 10, y: 10, width: 20, height: 20, colour: "black" },
    ]);
  });
  await browser.keys(["Control", "v"]);
  await waitForStatus("Tracing over the picture");
}

/** Whether the new symbol saved has a base layer, as Make ink makes. */
async function savedInk(): Promise<boolean> {
  const record = JSON.parse(await recordOf("001.ink.png")) as {
    base?: unknown;
  };
  return record.base !== undefined;
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

  it("keeps the drawing still when Make ink is pressed during a press, and opens it once let go", async function () {
    await insert();
    await narrow();
    await pastePicture("blue");
    await browser.waitUntil(async () =>
      (await pictureHint()).startsWith("Tracing over a picture"),
    );
    await settledSurface();
    await watchTops();
    // Make ink's row would open above the drawing area.
    await dragInWindow(await inWindow(0.3, 0.65), await inWindow(0.6, 0.35), [
      "i",
    ]);
    await strokeAt(1);
    const seen = await tops();
    expect(seen.at(-1)?.type).toBe("pointerup");
    expect(new Set(seen.map(({ top }) => top)).size).toBe(1);
    // Then it opens, as it would have at once.
    await waitForStatus(making);
    expect(await inkShown()).toBe(true);
  });

  // What waits for the release is what a save, and the question before
  // closing, go by meanwhile: Make ink as it will be, and its ink once seen.
  it("makes no ink on a save during a press after Make ink is asked to close", async function () {
    await insert();
    await pasteSquare();
    await browser.keys("i");
    await waitForStatus(making);
    await dragInWindow(await inWindow(0.3, 0.65), await inWindow(0.6, 0.35), [
      "i",
      [Key.Ctrl, Key.Enter],
    ]);
    await waitClosed();
    expect(await savedInk()).toBe(false);
    expect(await strokeCount("001.ink.png")).toBe(1);
  });

  it("does not open Make ink behind a question that comes during a press", async function () {
    await insert();
    await pasteSquare();
    await stroke(0.3);
    // Esc asks about the stroke before closing.
    await dragInWindow(await inWindow(0.3, 0.65), await inWindow(0.6, 0.35), [
      "i",
      Key.Escape,
    ]);
    await waitForTop("Save");
    await waitForStatus("Not making ink while a question is open");
    expect(await inkShown()).toBe(false);
    await clickTop("Save");
    await waitClosed();
    expect(await savedInk()).toBe(false);
    expect(await strokeCount("001.ink.png")).toBe(2);
  });

  // Closing makes no ink, as asked, so it does not wait for the question.
  it("closes Make ink behind a question that comes during a press, leaving it the focus", async function () {
    await insert();
    await pasteSquare();
    await stroke(0.3);
    await browser.keys("i");
    await waitForStatus(making);
    await dragInWindow(await inWindow(0.3, 0.65), await inWindow(0.6, 0.35), [
      "i",
      Key.Escape,
    ]);
    await waitForTop("Save");
    await waitForStatus("No ink made");
    expect(await inkShown()).toBe(false);
    // The question still has the keys: Enter answers it.
    expect(
      await browser.execute(() => {
        const questions = activeDocument.querySelectorAll(".modal-container");
        const top = questions.item(questions.length - 1);
        return top.contains(activeDocument.activeElement);
      }),
    ).toBe(true);
    await browser.keys("Enter");
    await waitClosed();
    expect(await savedInk()).toBe(false);
    expect(await strokeCount("001.ink.png")).toBe(2);
  });
});
