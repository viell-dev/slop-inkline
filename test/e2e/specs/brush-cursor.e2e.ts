import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { cursorImage, hasBrushCursor, setPageZoom } from "../support/cursor.ts";
import {
  openAtMarker,
  startOver,
  surface,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

describe("Fixed brush bitmap", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
    await openAtMarker("Editor.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
  });

  after(async function () {
    await startOver();
  });

  afterEach(async function () {
    await setPageZoom(1);
  });

  it("keeps fixed pixels and an aligned footprint through movement and zoom", async function () {
    for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
      await setPageZoom(zoom);
      for (const width of [721.5, 480.25]) {
        await browser.execute((value) => {
          const modal = document.querySelector(".inkline-editor");
          if (modal instanceof HTMLElement)
            modal.style.width = `${String(value)}px`;
        }, width);
        await surface().moveTo();
        const states = await browser.execute(() => {
          const surface = document.querySelector(".inkline-surface");
          const cursor = document.querySelector(".inkline-brush-cursor");
          if (
            !(surface instanceof HTMLCanvasElement) ||
            !(cursor instanceof HTMLCanvasElement)
          )
            throw new Error("no brush bitmap");
          const bounds = surface.getBoundingClientRect();
          const ratio = devicePixelRatio;
          return [0.125, 0.375, 0.625, 0.875].map((fraction) => {
            const x = bounds.left + 80 + fraction;
            const y = bounds.top + 80 + fraction;
            surface.dispatchEvent(
              new PointerEvent("pointermove", {
                pointerType: "mouse",
                pointerId: 51,
                clientX: x,
                clientY: y,
                bubbles: true,
              }),
            );
            const rect = cursor.getBoundingClientRect();
            return {
              bitmap: cursor.toDataURL(),
              scaleError: Math.max(
                Math.abs(rect.width * ratio - cursor.width),
                Math.abs(rect.height * ratio - cursor.height),
              ),
              pixelError: Math.max(
                Math.abs(rect.left * ratio - Math.round(rect.left * ratio)),
                Math.abs(rect.top * ratio - Math.round(rect.top * ratio)),
              ),
              centreError: Math.max(
                Math.abs((rect.left + rect.width / 2 - x) * ratio),
                Math.abs((rect.top + rect.height / 2 - y) * ratio),
              ),
              native: getComputedStyle(surface).cursor,
              visible: getComputedStyle(cursor).display !== "none",
              expectedDiameter: surface.clientWidth / 36,
            };
          });
        });
        expect(new Set(states.map((state) => state.bitmap)).size).toBe(1);
        for (const state of states) {
          expect(state.scaleError).toBeLessThan(0.02);
          expect(state.pixelError).toBeLessThan(0.02);
          expect(state.centreError).toBeLessThanOrEqual(0.51);
          expect(state.native).toBe("none");
          expect(state.visible).toBe(true);
        }
        expect(
          Math.abs(
            (await cursorImage()).diameter - (states[0]?.expectedDiameter ?? 0),
          ),
        ).toBeLessThan(0.3);
      }
    }
    await saveScreenshot("fixed-brush-cursor");
  });
  it("draws a circular footprint with a centred dot at every preset", async function () {
    await surface().moveTo();
    const width = await browser.execute(() => {
      const canvas = document.querySelector(".inkline-surface");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
      return canvas.clientWidth;
    });
    for (const preset of [1, 2, 3, 4]) {
      await browser.keys(String(preset));
      const image = await cursorImage();
      // A new editor shows 4.5 em; the presets are 1/16 to 4/16 em.
      expect(Math.abs(image.diameter - (width * preset) / 72)).toBeLessThan(
        0.3,
      );
      expect(image.width).toBe(image.height);
      expect(image.hotspot).toEqual([image.width / 2, image.height / 2]);
      const centre = ((image.height / 2) * image.width + image.width / 2) * 4;
      expect(image.pixels[centre]).toBeLessThan(100);
      expect(image.pixels[centre + 3]).toBe(255);
      // Compare the alpha footprint's horizontal/vertical span, including
      // its contrast halo; a stretched oval must fail even if centred.
      const xs: number[] = [];
      const ys: number[] = [];
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if ((image.pixels[(y * image.width + x) * 4 + 3] ?? 0) > 32) {
            xs.push(x);
            ys.push(y);
          }
        }
      }
      expect(Math.max(...xs) - Math.min(...xs)).toBe(
        Math.max(...ys) - Math.min(...ys),
      );
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    }
  });

  it("paints bounded symmetric bitmaps at fractional display densities", async function () {
    const results = await browser.execute(() => {
      const { paintBrushCursor } = window.inklineTest.cursor;
      const canvas = createEl("canvas");
      const values = [];
      for (const ratio of [0.8, 1, 1.25, 1.5, 2, 3]) {
        for (const diameter of [1, 7.125, 25.5, 124]) {
          const hotspot = paintBrushCursor(canvas, diameter, ratio);
          const context = canvas.getContext("2d");
          if (context === null) throw new Error("no context");
          const pixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          const symmetric = pixels.every((value, index) => {
            const channel = index % 4;
            const pixel = Math.floor(index / 4);
            const x = pixel % canvas.width;
            const y = Math.floor(pixel / canvas.width);
            return value === pixels[(x * canvas.width + y) * 4 + channel];
          });
          values.push({
            hotspot,
            width: canvas.width,
            height: canvas.height,
            symmetric,
          });
        }
      }
      return {
        values,
        fallback: [0, -1, 10000, NaN, Infinity].map(
          (diameter) => paintBrushCursor(canvas, diameter, 1) === undefined,
        ),
        invalidDensity: [0, -1, NaN, Infinity].map(
          (ratio) => paintBrushCursor(canvas, 20, ratio) === undefined,
        ),
      };
    });
    for (const value of results.values) {
      expect(value.width).toBe(value.height);
      expect(value.width).toBeLessThanOrEqual(1024);
      expect(value.hotspot).toBe(value.width / 2);
      expect(value.symmetric).toBe(true);
    }
    expect(results.fallback).toEqual(Array<boolean>(5).fill(true));
    expect(results.invalidDensity).toEqual(Array<boolean>(4).fill(true));
  });
  it("uses the eraser footprint for eraser contact and restores Pen on hover", async function () {
    await surface().moveTo();
    await browser.keys("1");
    const pen = await cursorImage();
    await browser.keys("e");
    await browser.keys("4");
    const eraser = await cursorImage();
    await browser.keys("p");
    const dispatch = async (buttons: number): Promise<void> => {
      await browser.execute((pressed) => {
        const canvas = document.querySelector(".inkline-surface");
        if (canvas === null) throw new Error("no surface");
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new PointerEvent("pointermove", {
            pointerType: "pen",
            pointerId: 53,
            buttons: pressed,
            clientX: rect.left + 80,
            clientY: rect.top + 80,
            bubbles: true,
          }),
        );
      }, buttons);
    };
    await dispatch(32);
    expect((await cursorImage()).bitmap).toBe(eraser.bitmap);
    await dispatch(0);
    expect((await cursorImage()).bitmap).toBe(pen.bitmap);
  });

  it("retains grab and grabbing for tracing and restores the brush", async function () {
    await browser.execute(async () => {
      const canvas = document.querySelector(".inkline-surface");
      if (canvas === null) throw new Error("no surface");
      const pictures = window.inklineTest.pictures;
      pictures.drop(
        canvas,
        new File([await pictures.picture(20, 60, "blue")], "synthetic.png", {
          type: "image/png",
        }),
      );
    });
    const move = browser.$('[data-inkline-button="move"]');
    await move.waitForEnabled();
    await move.click();
    await surface().moveTo();
    expect((await surface().getCSSProperty("cursor")).value).toBe("grab");
    await browser
      .action("pointer")
      .move({ origin: await surface().getElement(), x: 0, y: 0 })
      .down()
      .perform(true);
    try {
      expect((await surface().getCSSProperty("cursor")).value).toBe("grabbing");
    } finally {
      await browser.action("pointer").up().perform();
    }
    await browser.keys("p");
    await surface().moveTo();
    await browser.waitUntil(hasBrushCursor);
  });
});
