import { browser, expect } from "@wdio/globals";
import { unitsPerPixel } from "../../../src/format/record.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  editorGrid,
  openAtMarker,
  recordOf,
  settledSurface,
  startOver,
  storedDrafts,
  waitForEditor,
} from "../support/editor.ts";

async function openEditor(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await settledSurface();
}

/** The y of the first point of the draft's first stroke, once it has one. */
async function firstY(): Promise<number> {
  await browser.waitUntil(
    async () => ((await storedDrafts())[0]?.strokes.length ?? 0) > 0,
  );
  const [draft] = await storedDrafts();
  return draft?.strokes[0]?.points[1] ?? Number.NaN;
}

/** Waits for the first stroke's first point to be at `y`. */
async function waitForY(y: number): Promise<void> {
  await browser.waitUntil(async () => (await firstY()) === y, {
    timeoutMsg: `the drawing did not reach ${String(y)}`,
  });
}

const stroke: readonly [number, number][] = [
  [0.4, 0.4],
  [0.6, 0.6],
];

describe("Moving the drawing", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
  });
  after(async function () {
    await startOver();
  });

  it("moves it a pixel with the arrow keys and a cell with Shift, and undoes them together", async function () {
    await openEditor();
    await draw(stroke);
    const start = await firstY();
    await browser.keys(["ArrowUp"]);
    await browser.keys(["ArrowUp"]);
    await browser.keys(["ArrowUp"]);
    await waitForY(start - 3 * unitsPerPixel);
    await browser.keys(["ArrowDown"]);
    await waitForY(start - 2 * unitsPerPixel);
    const { spacing } = await editorGrid();
    await browser.keys(["Shift", "ArrowDown"]);
    await waitForY(start - 2 * unitsPerPixel + spacing * unitsPerPixel);
    await browser.keys(["Control", "z"]);
    await waitForY(start);
  });

  it("moves it with the buttons, and keeps it there through a save", async function () {
    await openEditor();
    const up = browser.$('[data-inkline-button="move-up"]');
    expect(await up.isEnabled()).toBe(false);
    await draw(stroke);
    const start = await firstY();
    await browser.waitUntil(async () => await up.isEnabled());
    await up.click();
    await up.click();
    await waitForY(start - 2 * unitsPerPixel);
    await browser.$('[data-inkline-button="move-down"]').click();
    await waitForY(start - unitsPerPixel);
    await browser.keys(["Control", "Enter"]);
    await browser.waitUntil(async () =>
      (await recordOf("001.ink.png")).includes('"strokes"'),
    );
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: { points: number[] }[];
    };
    expect(record.strokes[0]?.points[1]).toBe(start - unitsPerPixel);
  });

  it("leaves the arrow keys to the name field", async function () {
    await openEditor();
    await draw(stroke);
    const start = await firstY();
    await browser.$(".inkline-name").click();
    await browser.keys(["ArrowUp"]);
    await browser.keys(["ArrowUp"]);
    // Back on the drawing, one more press shows where it is: had the field
    // not kept those two, this would be three pixels up.
    await browser.keys(["Enter"]);
    await browser.keys(["ArrowUp"]);
    await waitForY(start - unitsPerPixel);
  });
});
