// Ink shows under the pointer that draws it, at the top and the bottom of the
// drawing area as at its sides, in the usual view and after Fit in Zoom, at
// whole and fractional page zoom (#359). Where the ink shows on the screen is
// the subject, and the canvas's own pixels cannot give it, as the browser
// stretches them into the element's box: so this measures a screenshot.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { setPageZoom } from "../support/cursor.ts";
import { insert } from "../support/editing.ts";
import {
  draw,
  settledSurface,
  startOver,
  storedDrafts,
  surface,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshotData } from "../support/screenshots.ts";
import { framesDrawn } from "../support/waits.ts";

/**
 * How far the ink's middle may be from the pointer, in CSS pixels: the
 * pointer and strokes are on whole pixels and the ink's edges are smoothed,
 * which spread the measurement by about 0.4 px. The border took 1.4 to 2.1 px
 * from the bottom.
 */
const tolerance = 0.8;

/** Where a pointer went down and came up, in CSS pixels of the viewport. */
interface Pressed {
  readonly down: { x: number; y: number };
  readonly up: { x: number; y: number };
}

/**
 * Shows the ink in pure blue on white and the guides hidden, so that only
 * the ink is blue, and records where each pointer goes down and comes up.
 */
async function prepare(): Promise<void> {
  await browser.execute(() => {
    if (document.getElementById("inkline-test-pointer") === null) {
      const style = document.createElement("style");
      style.id = "inkline-test-pointer";
      style.textContent = `body .inkline-editor .inkline-surface {
        color: rgb(0, 0, 255) !important;
        background-color: rgb(255, 255, 255) !important;
      }`;
      document.head.append(style);
    }
    const presses: { x: number; y: number }[] = [];
    Reflect.set(window, "inklineTestPresses", presses);
    const surface = document.querySelector(".inkline-editor .inkline-surface");
    for (const type of ["pointerdown", "pointerup"] as const) {
      surface?.addEventListener(type, (event) => {
        if (event instanceof PointerEvent) {
          presses.push({ x: event.clientX, y: event.clientY });
        }
      });
    }
  });
  await browser.keys("g");
}

/** Draws a straight stroke between fractions of the surface. */
async function stroke(
  from: readonly [number, number],
  to: readonly [number, number],
): Promise<Pressed> {
  const before = (await storedDrafts())[0]?.strokes.length ?? 0;
  await draw([from, to]);
  await browser.waitUntil(
    async () => ((await storedDrafts())[0]?.strokes.length ?? 0) > before,
  );
  const [down, up] = await browser.execute(() => {
    const presses: unknown = Reflect.get(window, "inklineTestPresses");
    return Array.isArray(presses)
      ? (presses.slice(-2) as { x: number; y: number }[])
      : [];
  });
  if (down === undefined || up === undefined) throw new Error("no presses");
  return { down, up };
}

/**
 * The middle of the blue ink across a stroke on the screen, in CSS pixels of
 * the viewport, from a screenshot: across each device pixel of the middle
 * half of the stroke, the centre of its ink within 20 CSS pixels of the
 * pointer's line, averaged along it.
 */
async function inkMiddle(
  png: string,
  pressed: Pressed,
  horizontal: boolean,
): Promise<number> {
  const across = horizontal ? pressed.down.y : pressed.down.x;
  const [start, end] = horizontal
    ? [pressed.down.x, pressed.up.x]
    : [pressed.down.y, pressed.up.y];
  const quarter = Math.abs(end - start) / 4;
  return browser.execute(
    async (data, isHorizontal, line, from, to) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no context");
      context.drawImage(bitmap, 0, 0);
      const ratio = bitmap.width / window.innerWidth;
      const { width } = bitmap;
      const pixels = context.getImageData(0, 0, width, bitmap.height).data;
      // Blue ink smoothed over white keeps red and green equal, which the
      // focus outline's colour does not.
      const ink = (x: number, y: number): number => {
        const index = (y * width + x) * 4;
        const red = pixels[index] ?? 255;
        const green = pixels[index + 1] ?? 255;
        const blue = pixels[index + 2] ?? 255;
        if (Math.abs(red - green) > 12) return 0;
        const amount = (blue - Math.max(red, green)) / 255;
        return amount > 0.04 ? amount : 0;
      };
      const middle = Math.round(line * ratio);
      const reach = Math.round(20 * ratio);
      let sum = 0;
      let count = 0;
      for (let along = Math.round(from * ratio); along <= to * ratio; along++) {
        let weighted = 0;
        let total = 0;
        for (let at = middle - reach; at <= middle + reach; at++) {
          const amount = isHorizontal ? ink(along, at) : ink(at, along);
          weighted += (at + 0.5) * amount;
          total += amount;
        }
        if (total === 0) continue;
        sum += weighted / total;
        count++;
      }
      if (count === 0) throw new Error("no ink on the screen");
      return sum / count / ratio;
    },
    png,
    horizontal,
    across,
    Math.min(start, end) + quarter,
    Math.max(start, end) - quarter,
  );
}

/**
 * The surface's content box against the line box it shows, in CSS pixels:
 * the border box less the borders and padding the computed style gives.
 */
async function boxes(): Promise<{ content: number; lineBox: number }> {
  return browser.execute(() => {
    const canvas = document.querySelector(".inkline-editor .inkline-surface");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
    const style = getComputedStyle(canvas);
    const frame = [
      style.borderTopWidth,
      style.borderBottomWidth,
      style.paddingTop,
      style.paddingBottom,
    ].reduce((sum, value) => sum + Number.parseFloat(value), 0);
    return {
      content: canvas.getBoundingClientRect().height - frame,
      lineBox: Number.parseFloat(
        canvas.style.getPropertyValue("--inkline-surface-height"),
      ),
    };
  });
}

describe("Drawing under the pointer", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
  });
  afterEach(async function () {
    await setPageZoom(1);
  });

  for (const zoom of [1, 1.25]) {
    for (const zoomed of [false, true]) {
      const name = `${String(zoom * 100)}%${zoomed ? ", zoomed and fitted" : ""}`;
      it(`shows ink under the pointer at every edge, at ${name}`, async function () {
        await setPageZoom(zoom);
        await insert();
        await prepare();
        if (zoomed) {
          // Off the middle, moved along, then fitted, as #359 was found.
          await stroke([0.2, 0.5], [0.3, 0.5]);
          await browser.keys("z");
          await waitForStatus("Zoomed in");
          for (let step = 0; step < 3; step++) await browser.keys("ArrowRight");
          await browser
            .action("wheel")
            .scroll({ origin: await surface().getElement(), deltaY: 150 })
            .perform();
          await browser.keys("f");
        }
        await settledSurface();
        const strokes = {
          top: { pressed: await stroke([0.3, 0.1], [0.7, 0.1]), across: true },
          bottom: {
            pressed: await stroke([0.3, 0.9], [0.7, 0.9]),
            across: true,
          },
          left: {
            pressed: await stroke([0.1, 0.3], [0.1, 0.7]),
            across: false,
          },
          right: {
            pressed: await stroke([0.9, 0.3], [0.9, 0.7]),
            across: false,
          },
        };
        // The brush circle shows over the surface where the pointer is.
        await browser
          .action("pointer", { parameters: { pointerType: "mouse" } })
          .move({ x: 5, y: 5 })
          .perform();
        await framesDrawn();
        const png = await browser.takeScreenshot();
        await saveScreenshotData(
          `pointer-alignment-${String(zoom * 100)}${zoomed ? "-zoomed" : ""}`,
          png,
        );
        const errors: Record<string, number> = {};
        for (const [edge, { pressed, across }] of Object.entries(strokes)) {
          const pointer = across ? pressed.down.y : pressed.down.x;
          errors[edge] = (await inkMiddle(png, pressed, across)) - pointer;
        }
        // Each edge with its error, so that a failure says which and by how
        // much.
        for (const [edge, error] of Object.entries(errors)) {
          expect({ edge, error, within: Math.abs(error) <= tolerance }).toEqual(
            { edge, error, within: true },
          );
        }
        // The bitmap and the pointer go by the line box: the content box,
        // which the browser draws the bitmap into, is as tall.
        const { content, lineBox: shown } = await boxes();
        expect(Math.abs(content - shown)).toBeLessThan(0.05);
      });
    }
  }
});
