import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { cursorImage, hasBrushCursor } from "../support/cursor.ts";
import {
  openAtMarker,
  startOver,
  surface,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

describe("Native brush cursor", function () {
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

  it("uses one fixed image and hotspot while the pointer moves", async function () {
    await surface().moveTo();
    const cursors = await browser.execute(() => {
      const canvas = document.querySelector(".inkline-surface");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
      const rect = canvas.getBoundingClientRect();
      return [0.125, 0.375, 0.625, 0.875].map((offset) => {
        canvas.dispatchEvent(
          new PointerEvent("pointermove", {
            pointerType: "mouse",
            pointerId: 51,
            clientX: rect.left + 80 + offset,
            clientY: rect.top + 80 + offset,
            bubbles: true,
          }),
        );
        return getComputedStyle(canvas).cursor;
      });
    });
    await saveScreenshot("native-brush-cursor");
    expect(cursors[0]).toContain("data:image/png;base64,");
    expect(new Set(cursors).size).toBe(1);
    expect(cursors[0]).toMatch(/\d+ \d+, crosshair$/);
    expect(await browser.$(".inkline-brush-cursor").isExisting()).toBe(false);
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

  it("supplies decoded 1x and 2x images and a visible bounded fallback", async function () {
    const results = await browser.execute(async () => {
      const { brushCursor } = window.inklineTest.cursor;
      const values = [];
      for (const diameter of [1, 7.125, 25.5, 124]) {
        const css = brushCursor(diameter, document);
        const sources = [
          ...css.matchAll(/data:image\/png;base64,[A-Za-z0-9+/=]+/g),
        ];
        const sizes = [];
        for (const match of sources) {
          const image = new Image();
          image.src = match[0];
          await image.decode();
          sizes.push([image.naturalWidth, image.naturalHeight]);
        }
        values.push({ supported: CSS.supports("cursor", css), sizes });
      }
      return {
        values,
        fallback: [0, -1, 125, NaN, Infinity].map((diameter) =>
          brushCursor(diameter, document),
        ),
      };
    });
    for (const value of results.values) {
      expect(value.supported).toBe(true);
      expect(value.sizes).toHaveLength(2);
      const one = value.sizes[0];
      const two = value.sizes[1];
      expect(one?.[0]).toBe(one?.[1]);
      expect(one?.[0]).toBeLessThanOrEqual(128);
      expect(two?.[0]).toBe((one?.[0] ?? 0) * 2);
      expect(two?.[1]).toBe((one?.[1] ?? 0) * 2);
    }
    expect(results.fallback).toEqual(Array<string>(5).fill("crosshair"));
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
    expect((await cursorImage()).css).toBe(eraser.css);
    await dispatch(0);
    expect((await cursorImage()).css).toBe(pen.css);
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
