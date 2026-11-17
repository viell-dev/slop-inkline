import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import { obsidianPage } from "wdio-obsidian-service";
import { unitsPerPixel } from "../../../src/format/record.ts";
import { loadModules } from "../support/browser.ts";
import {
  editFile,
  inklineOn,
  insert,
  nameField,
  nameSymbol,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  draw,
  editorGrid,
  openAtMarker,
  recordOf,
  settledSurface,
  storedDrafts,
  undoStubs,
  waitForEditor,
  shiftClick,
  startOver,
  surface,
  clickTop,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/**
 * Where the surface's drawing starts on the screen, inside its border, and
 * how many CSS pixels a new symbol's document pixel takes.
 */
async function surfaceOrigin(): Promise<{
  left: number;
  top: number;
  scale: number;
  border: number;
}> {
  return browser.execute(() => {
    const canvas = document.querySelector(".inkline-editor .inkline-surface");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
    const rect = canvas.getBoundingClientRect();
    return {
      left: rect.left + canvas.clientLeft,
      top: rect.top + canvas.clientTop,
      scale: canvas.clientWidth / 576,
      border: canvas.clientLeft,
    };
  });
}

/** Clicks the mouse at a point in the window, in CSS pixels. */
async function clickAt(x: number, y: number): Promise<void> {
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ origin: "viewport", x: Math.round(x), y: Math.round(y) })
    .down()
    .up()
    .perform();
}

describe("The editor", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
  });

  // A test that fails midway can leave a file operation held or replaced, or
  // Inkline off, which every test after it would then fail on.
  afterEach(async function () {
    await undoStubs();
    if (!(await inklineOn())) {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
  });

  it("takes shortcut focus before the first frame, without stealing later name typing", async function () {
    await openAtMarker("Editor.md", "HERE");
    await browser.execute(() => {
      const frames = window.requestAnimationFrame.bind(window);
      const held: FrameRequestCallback[] = [];
      window.requestAnimationFrame = (callback) => {
        held.push(callback);
        return held.length;
      };
      Reflect.set(window, "inklineReleaseFrames", () => {
        window.requestAnimationFrame = frames;
        for (const callback of held) frames(callback);
      });
    });
    try {
      await browser.executeObsidianCommand("inkline:insert-symbol");
      // Deliberately bypass waitForEditor: no animation frame has run yet.
      await browser.keys(["e"]);
      expect(await nameField()).toMatchObject({ value: "" });
      expect(
        await browser
          .$('[data-inkline-button="eraser"]')
          .getAttribute("aria-pressed"),
      ).toBe("true");
      // Choosing the name field before that first frame must stay a choice.
      await nameSymbol("gate");
    } finally {
      await browser.execute(() => {
        const release: unknown = Reflect.get(window, "inklineReleaseFrames");
        if (typeof release === "function") Reflect.apply(release, window, []);
        Reflect.deleteProperty(window, "inklineReleaseFrames");
      });
    }
    await waitForEditor();
    await browser.keys(["p"]);
    expect(await nameField()).toMatchObject({ value: "gatep" });
    expect(
      await browser
        .$('[data-inkline-button="eraser"]')
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("undoes, redoes, and erases", async function () {
    await insert();
    await draw([
      [0.3, 0.5],
      [0.7, 0.5],
    ]);
    await draw([
      [0.3, 0.3],
      [0.7, 0.3],
    ]);
    await browser.keys(["Control", "z"]);
    await browser.keys(["Control", "Shift", "z"]);
    await browser.keys(["Control", "z"]);
    await browser.keys(["e"]);
    await draw([
      [0.5, 0.4],
      [0.5, 0.6],
    ]);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: { tool: string }[];
    };
    expect(record.strokes.map((stroke) => stroke.tool)).toEqual([
      "pen",
      "eraser",
    ]);
  });

  it("names each button with its text and shortcut, shows that on hover, and marks the current tool", async function () {
    await insert();
    const state = await browser.execute(() => {
      const button = (id: string): HTMLElement | null =>
        document.querySelector(`[data-inkline-button="${id}"]`);
      return {
        pen: button("pen")?.getAttribute("aria-pressed"),
        eraser: button("eraser")?.getAttribute("aria-pressed"),
        undo: button("undo")?.hasAttribute("disabled"),
        focused: document.activeElement?.classList.contains("inkline-surface"),
      };
    });
    expect(state).toEqual({
      pen: "true",
      eraser: "false",
      undo: true,
      focused: true,
    });
    const buttons = await browser.execute(() =>
      [...document.querySelectorAll("[data-inkline-button]")].map((button) => ({
        id: button.getAttribute("data-inkline-button") ?? "",
        text: button.textContent,
        name: button.getAttribute("aria-label") ?? "",
      })),
    );
    expect(buttons.length).toBeGreaterThan(10);
    for (const { text, name } of buttons) {
      expect(name.toLowerCase()).toContain(text.toLowerCase());
    }
    // A button's name is its tooltip, which Obsidian shows from it: with a
    // description, a label of its own, or neither, and the shortcut after.
    const names = Object.fromEntries(buttons.map(({ id, name }) => [id, name]));
    expect(names).toMatchObject({
      copy: "Copy from: start from a copy of another symbol (V)",
      "size-0": "Brush size S (1)",
      pen: "Pen (P)",
      next: "Next: save and draw the next one (Mod+Shift+Enter)",
      grid: "Grid: show a grid of dots as a guide; hold Shift while drawing to snap to it (Shift+G)",
      fit: "Fit: centre the drawing in the view, and show all of it if it is wider; the drawing itself stays as it is (F)",
    });
    const tooltip = async (id: string, text: string): Promise<void> => {
      const button = await browser
        .$(`[data-inkline-button="${id}"]`)
        .getElement();
      let step = 0;
      await browser.waitUntil(
        async () => {
          // Obsidian shows a mouse no tooltip until it has seen it move twice
          // (#270), so each look moves it again, within the button.
          step++;
          await browser
            .action("pointer", { parameters: { pointerType: "mouse" } })
            .move({ origin: button, x: step % 2 === 0 ? -2 : 2, y: 0 })
            .perform();
          return (
            (await browser.execute(
              () => document.querySelector(".tooltip")?.textContent ?? "",
            )) === text
          );
        },
        { timeoutMsg: `no tooltip "${text}"` },
      );
      await surface().moveTo();
    };
    await tooltip("copy", "Copy from: start from a copy of another symbol (V)");
    await tooltip("size-0", "Brush size S (1)");
    // Both save, so both look it.
    for (const id of ["save", "next"]) {
      expect(
        await browser.$(`[data-inkline-button="${id}"]`).getAttribute("class"),
      ).toContain("mod-cta");
    }
    await browser.keys(["e"]);
    const eraser = browser.$('[data-inkline-button="eraser"]');
    expect(await eraser.getAttribute("aria-pressed")).toBe("true");
  });

  it("maps the pointer to the drawing inside the surface's border", async function () {
    await insert();
    await settledSurface();
    const origin = await surfaceOrigin();
    expect(origin.border).toBeGreaterThan(0);
    const x = Math.round(origin.left + 100);
    const y = Math.round(origin.top + 40);
    await clickAt(x, y);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const [draft] = await storedDrafts();
    const [pointX, pointY] = draft?.strokes[0]?.points ?? [];
    expect(
      Math.abs(
        (pointX ?? Number.NaN) - ((x - origin.left) / origin.scale) * 16,
      ),
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs((pointY ?? Number.NaN) - ((y - origin.top) / origin.scale) * 16),
    ).toBeLessThanOrEqual(0.5);
  });

  it("shows a symbol wider than the usual view whole", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const { canvas } = window.inklineTest;
      const stroke = (x: number) =>
        ({
          tool: "pen",
          size: 256,
          points: [x * 16, 1600, x * 16, 1920],
        }) as const;
      const { bytes } = await canvas.saveInk(
        { strokes: [stroke(100), stroke(1100)] },
        undefined,
      );
      await app.vault.createBinary("wide.ink.png", bytes.slice().buffer);
    });
    await editFile("wide.ink.png");
    await settledSurface();
    const origin = await surfaceOrigin();
    await clickAt(origin.left + 2, origin.top + 40);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 3,
    );
    const [draft] = await storedDrafts();
    // Left of the symbol's first stroke, at 8 pixels: the view starts before.
    expect(draft?.strokes[2]?.points[0]).toBeLessThan(0);
  });

  it("lets only the pointer already drawing draw, whatever kind each is", async function () {
    await insert();
    const { width, height } = await settledSurface();
    // Actions run together take a found element, not a query.
    const canvas = await surface().getElement();
    const at = (x: number, y: number) => ({
      origin: canvas,
      x: Math.round((x - 0.5) * width),
      y: Math.round((y - 0.5) * height),
    });
    await browser.actions([
      browser
        .action("pointer", { id: "palm", parameters: { pointerType: "touch" } })
        .move(at(0.2, 0.8))
        .down()
        .move({ ...at(0.25, 0.8), duration: 50 })
        .pause(200)
        .move({ ...at(0.3, 0.8), duration: 50 })
        .up(),
      browser
        .action("pointer", { id: "stylus", parameters: { pointerType: "pen" } })
        .pause(100)
        .move(at(0.5, 0.2))
        .down()
        .move({ ...at(0.6, 0.3), duration: 100 })
        .up(),
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const [draft] = await storedDrafts();
    expect(draft?.strokes).toHaveLength(1);
    // The touch's stroke, near the bottom: a pen coming down meanwhile is a
    // second pointer, and pens have no special place since #101.
    expect(draft?.strokes[0]?.points[1]).toBeGreaterThan(96 * 16);
  });

  it("shows a restored drawing whole, even one wider than its file", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const { canvas } = window.inklineTest;
      const stroke = (x: number) =>
        ({
          tool: "pen",
          size: 256,
          points: [x * 16, 1600, x * 16, 1920],
        }) as const;
      const { bytes } = await canvas.saveInk(
        { strokes: [stroke(100), stroke(1100)] },
        undefined,
      );
      await app.vault.createBinary("wide.ink.png", bytes.slice().buffer);
    });
    await editFile("wide.ink.png");
    await browser.$('[data-inkline-button="clear"]').click();
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await browser.keys(["Control", "z"]);
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    // The file now holds the cleared drawing, narrow.
    await editFile("wide.ink.png");
    await clickTop("Restore");
    await settledSurface();
    const origin = await surfaceOrigin();
    const width = await surface().getSize("width");
    await clickAt(origin.left + 2, origin.top + 40);
    await clickAt(origin.left + width - 4, origin.top + 40);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 4,
    );
    const [draft] = await storedDrafts();
    const xs = (draft?.strokes ?? []).map(
      (stroke) => stroke.points[0] ?? Number.NaN,
    );
    // Clicks at both edges land outside both restored strokes.
    expect(xs[2]).toBeLessThan(xs[0] ?? Number.NaN);
    expect(xs[3]).toBeGreaterThan(xs[1] ?? Number.NaN);
  });

  it("draws a straight segment while Shift is held", async function () {
    await insert();
    const { width, height } = await settledSurface();
    const canvas = await surface().getElement();
    const at = (x: number, y: number) => ({
      origin: canvas,
      x: Math.round((x - 0.5) * width),
      y: Math.round((y - 0.5) * height),
    });
    // The pointer wanders, but Shift keeps the stroke straight.
    await browser.actions([
      browser
        .action("key")
        .down(Key.Shift)
        .pause(10)
        .pause(10)
        .pause(10)
        .pause(10)
        .up(Key.Shift),
      browser
        .action("pointer", { parameters: { pointerType: "mouse" } })
        .move(at(0.3, 0.3))
        .down()
        .move({ ...at(0.5, 0.8), duration: 50 })
        .move({ ...at(0.7, 0.4), duration: 50 })
        .up(),
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const [draft] = await storedDrafts();
    const points = draft?.strokes[0]?.points ?? [];
    const x0 = points[0] ?? 0;
    const y0 = points[1] ?? 0;
    const x1 = points.at(-2) ?? 0;
    const y1 = points.at(-1) ?? 0;
    const length = Math.hypot(x1 - x0, y1 - y0);
    expect(length).toBeGreaterThan(16 * 50);
    // Every point within a pixel (16 units) of the line from end to end.
    for (let index = 0; index < points.length; index += 2) {
      const x = points[index] ?? 0;
      const y = points[index + 1] ?? 0;
      const off =
        Math.abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / length;
      expect(off).toBeLessThan(16);
    }
  });

  // Shift+G's dots, and strokes' ends snapped to them with Shift, are
  // grid.e2e.ts's, shift-grid.e2e.ts's, and shortcuts.e2e.ts's.
  it("keeps a tap on the grid a dot, and the grid in place through a save", async function () {
    await insert();
    await settledSurface();
    await browser.keys(["Shift", "g"]);
    await shiftClick([0.31, 0.27]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    // One point: no spur out to where the pointer was and back.
    expect((await storedDrafts())[0]?.strokes[0]?.points).toHaveLength(2);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    // The same place on screen, after the save moved the drawing.
    await shiftClick([0.31, 0.27]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    const [first, second] = (await storedDrafts())[0]?.strokes ?? [];
    expect(second?.points).toEqual(first?.points);
  });

  it("lines the grid up with a reopened symbol's strokes", async function () {
    await insert();
    // Drawn before the grid is shown, so off it.
    await draw(zigzag);
    await settledSurface();
    await browser.keys(["Shift", "g"]);
    await shiftClick([0.62, 0.27]);
    await shiftClick([0.7, 0.6]);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    await editFile("001.ink.png");
    await settledSurface();
    await browser.keys(["Shift", "g"]);
    await shiftClick([0.33, 0.45]);
    await saveScreenshot("editor-grid");
    const spacing = Math.round((await editorGrid()).spacing * unitsPerPixel);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const { strokes } = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: { points: number[] }[];
    };
    // Where each stroke drawn on the grid lies within a spacing, in units.
    const columns = strokes
      .slice(1)
      .map(
        (stroke) => (((stroke.points[0] ?? 0) % spacing) + spacing) % spacing,
      );
    expect(columns).toHaveLength(3);
    expect(new Set(columns).size).toBe(1);
  });

  it("restores a draft with the grid it was drawn on, and undoes that too", async function () {
    await insert();
    // Freehand, and saved: the file alone suggests another grid.
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await browser.keys(["Shift", "g"]);
    // One tap, which the zigzag's two ends outvote.
    await shiftClick([0.62, 0.27]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await editFile("001.ink.png");
    await clickTop("Restore");
    await settledSurface();
    await browser.keys(["Shift", "g"]);
    await shiftClick([0.33, 0.45]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 3,
    );
    // Where a stroke starts within a spacing, in units.
    const spacing = Math.round((await editorGrid()).spacing * unitsPerPixel);
    const column = (stroke: { points: readonly number[] } | undefined) =>
      (((stroke?.points[0] ?? 0) % spacing) + spacing) % spacing;
    const restored = (await storedDrafts())[0]?.strokes ?? [];
    expect(column(restored[2])).toBe(column(restored[1]));
    // Undoing the tap and the restore leaves the file, and the grid its
    // strokes suggest: through the zigzag's start.
    await browser.keys(["Control", "z"]);
    await browser.keys(["Control", "z"]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 0);
    await shiftClick([0.33, 0.45]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    const [start, tap] = (await storedDrafts())[0]?.strokes ?? [];
    expect(column(tap)).toBe(column(start));
    expect(column(tap)).not.toBe(column(restored[1]));
  });

  // Clearing with Delete and Backspace is shortcuts.e2e.ts's, and Fit while
  // zoomed in zoom.e2e.ts's.
  it("fits the drawing in view with F", async function () {
    await insert();
    await draw([
      [0.05, 0.4],
      [0.1, 0.6],
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const before = (await storedDrafts())[0]?.strokes[0]?.points ?? [];
    const centre = ((before[0] ?? 0) + (before.at(-2) ?? 0)) / 2 / 16;
    await browser.keys(["f"]);
    // The surface shows the drawing in its middle now.
    await browser.waitUntil(async () =>
      browser.execute(() => {
        const canvas = activeDocument.querySelector(
          ".inkline-editor .inkline-surface",
        );
        if (canvas?.instanceOf(HTMLCanvasElement) !== true) {
          throw new Error("no surface");
        }
        const y = Math.round(canvas.height / 2);
        for (let x = canvas.width * 0.4; x < canvas.width * 0.6; x++) {
          if (window.inklineTest.pictures.inkAt(canvas, Math.round(x), y).ink) {
            return true;
          }
        }
        return false;
      }),
    );
    // A dot there lands near its centre.
    await draw([[0.5, 0.2]]);
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    const dot = (await storedDrafts())[0]?.strokes[1]?.points ?? [];
    expect(Math.abs((dot[0] ?? 0) / 16 - centre)).toBeLessThan(16);
  });

  it("lets a text field have the keys it types", async function () {
    await insert();
    await draw(zigzag);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    await browser.execute(() => {
      const content = document.querySelector(".inkline-editor .modal-content");
      if (content === null) throw new Error("no editor");
      const field = content.createEl("input", { type: "text" });
      field.addClass("inkline-test-field");
      field.focus();
    });
    await browser.keys(["e", "2", "3", "Backspace"]);
    const eraser = browser.$('[data-inkline-button="eraser"]');
    expect(await eraser.getAttribute("aria-pressed")).toBe("false");
    expect(
      await browser.execute(() => {
        const field = document.querySelector(".inkline-test-field");
        return field instanceof HTMLInputElement ? field.value : "";
      }),
    ).toBe("e2");
    // Away from the field, the keys are the editor's again. Backspace left
    // the drawing alone, so the click's dot is its second stroke.
    await surface().click();
    await browser.waitUntil(
      async () => (await storedDrafts())[0]?.strokes.length === 2,
    );
    await browser.keys(["e"]);
    await browser.waitUntil(
      async () => (await eraser.getAttribute("aria-pressed")) === "true",
    );
  });
});
