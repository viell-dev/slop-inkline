import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  openAtMarker,
  settledSurface,
  startOver,
  storedDrafts,
  waitForEditor,
} from "../support/editor.ts";

/**
 * Every single key of the editor, pressed in real Obsidian, with what it
 * should change read back from the buttons. The owner's review of
 * 0.3.0-alpha.8 pointed out that a person shouldn't be asked to try these; the
 * keys that save or close have their own tests in `editor.e2e.ts`.
 */

async function openEditor(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await settledSurface();
}

/** A button's pressed state. */
async function pressed(id: string): Promise<string | null> {
  return browser
    .$(`[data-inkline-button="${id}"]`)
    .getAttribute("aria-pressed");
}

/** Presses `key`, and waits for the button `id` to show `state`. */
async function press(
  key: string | string[],
  id: string,
  state: boolean,
): Promise<void> {
  await browser.keys(key);
  await browser.waitUntil(async () => (await pressed(id)) === String(state), {
    timeoutMsg: `${String(key)} left ${id} not ${String(state)}`,
  });
}

/**
 * Waits for the editor's draft to hold `count` strokes, or none to be kept
 * for no strokes, as after Undo back to the start or Clear.
 */
async function waitForStrokes(count: number, problem?: string): Promise<void> {
  await browser.waitUntil(
    async () => ((await storedDrafts())[0]?.strokes.length ?? 0) === count,
    { timeoutMsg: problem ?? `the draft never held ${String(count)} strokes` },
  );
}

const stroke: readonly [number, number][] = [
  [0.4, 0.4],
  [0.6, 0.6],
];

describe("The editor's shortcuts", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
    await openEditor();
  });
  after(async function () {
    await startOver();
  });

  it("chooses the tools and the shapes", async function () {
    expect(await pressed("pen")).toBe("true");
    await press("e", "eraser", true);
    expect(await pressed("pen")).toBe("false");
    await press("p", "pen", true);
    await press("o", "ellipse", true);
    await press("o", "ellipse", false);
    await press("y", "polygon", true);
    await press("o", "ellipse", true);
    expect(await pressed("polygon")).toBe("false");
    await press("b", "fill", true);
    await press("b", "fill", false);
    await press("o", "ellipse", false);
  });

  it("chooses each brush size", async function () {
    for (const [key, id] of [
      ["1", "size-0"],
      ["2", "size-1"],
      ["3", "size-2"],
      ["4", "size-3"],
    ] as const) {
      await press(key, id, true);
    }
  });

  it("switches the guides, the grid, flat ends and zoom", async function () {
    await press("g", "guides", false);
    await press("g", "guides", true);
    await press(["Shift", "g"], "grid", true);
    await press("t", "flat-ends", true);
    await press("t", "flat-ends", false);
    await press(["Shift", "g"], "grid", false);
    await press("z", "zoom", true);
    await press("z", "zoom", false);
  });

  it("undoes, redoes, and clears", async function () {
    await draw(stroke);
    await waitForStrokes(1);
    await browser.keys(["Control", "z"]);
    await waitForStrokes(0, "Mod+Z left the stroke");
    await browser.keys(["Control", "Shift", "z"]);
    await waitForStrokes(1);
    await browser.keys(["Control", "z"]);
    await waitForStrokes(0);
    // Mod+Y is the other way to redo.
    await browser.keys(["Control", "y"]);
    await waitForStrokes(1);
    await browser.keys(["Delete"]);
    await waitForStrokes(0, "Delete left the drawing");
    await browser.keys(["Control", "z"]);
    await waitForStrokes(1);
    await browser.keys(["Backspace"]);
    await waitForStrokes(0, "Backspace left the drawing");
  });

  it("leaves the single keys to the name field while it has the focus", async function () {
    await browser.$(".inkline-name").click();
    await browser.keys(["e", "o", "z", "g"]);
    await browser.waitUntil(
      async () => (await browser.$(".inkline-name").getValue()) === "eozg",
      { timeoutMsg: "the name field didn't get the keys" },
    );
    expect(await pressed("pen")).toBe("true");
    expect(await pressed("ellipse")).toBe("false");
    expect(await pressed("zoom")).toBe("false");
    expect(await pressed("guides")).toBe("true");
  });
});
