// The editor's status line says what the editor did last (#302): whatever the
// person does replaces it, with what that did or with nothing, and a message
// about something still under way or still wrong stays while it holds.

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
  startOver,
  storedDrafts,
  waitForHeld,
  waitForStatus,
} from "../support/editor.ts";
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
});
