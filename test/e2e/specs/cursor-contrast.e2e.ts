import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { setPageZoom } from "../support/cursor.ts";
import {
  openAtMarker,
  startOver,
  surface,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

async function bitmap() {
  return browser.execute(() => {
    const cursor = document.querySelector(".inkline-brush-cursor");
    if (!(cursor instanceof HTMLCanvasElement)) throw new Error("no cursor");
    const context = cursor.getContext("2d");
    if (context === null) throw new Error("no cursor context");
    return {
      width: cursor.width,
      height: cursor.height,
      ratio: devicePixelRatio,
      pixels: Array.from(
        context.getImageData(0, 0, cursor.width, cursor.height).data,
      ),
    };
  });
}

describe("Brush cursor contrast", function () {
  let originalTheme: string[] = [];
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
    originalTheme = await browser.execute(() =>
      [...document.body.classList].filter(
        (name) => name === "theme-light" || name === "theme-dark",
      ),
    );
    await openAtMarker("Editor.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await browser.keys("4");
    await surface().moveTo();
  });
  afterEach(async function () {
    await startOver();
    await setPageZoom(1);
    await browser.execute((themes) => {
      document.body.removeClass("theme-light", "theme-dark");
      for (const theme of themes) document.body.addClass(theme);
    }, originalTheme);
  });

  it("keeps one thin outline with contrasting pixels on light, dark and grey", async function () {
    let alpha: number[] | undefined;
    // Expected black/white choices use relative luminance, not RGB average.
    for (const [background, colour] of [
      ["#ffffff", 0],
      ["#000000", 255],
      ["#1e1e1e", 255],
      ["#808080", 0],
      ["#747474", 255],
      ["#767676", 0],
      ["#ff0000", 0],
      ["#0000ff", 255],
    ] as const) {
      await browser.execute((value) => {
        const canvas = document.querySelector(".inkline-surface");
        if (!(canvas instanceof HTMLCanvasElement))
          throw new Error("no surface");
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("no surface context");
        context.resetTransform();
        context.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.backgroundColor = value;
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new PointerEvent("pointermove", {
            pointerType: "mouse",
            pointerId: 61,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
          }),
        );
      }, background);
      const image = await bitmap();
      const coverage = image.pixels.filter((_value, index) => index % 4 === 3);
      if (alpha === undefined) alpha = coverage;
      else expect(coverage).toEqual(alpha);
      for (let at = 0; at < image.pixels.length; at += 4) {
        if ((image.pixels[at + 3] ?? 0) === 0) continue;
        expect(image.pixels.slice(at, at + 3)).toEqual([
          colour,
          colour,
          colour,
        ]);
      }
      // The right half of the centre row crosses one ring edge, not its dot.
      let weight = 0;
      for (
        let x = image.width / 2 + Math.ceil(3 * image.ratio);
        x < image.width;
        x++
      ) {
        const at = ((image.height / 2) * image.width + x) * 4;
        weight += (image.pixels[at + 3] ?? 0) / 255;
      }
      expect(Math.abs(weight / image.ratio - 1)).toBeLessThan(0.08);
    }
  });

  it("changes colour across an ink edge without changing the ring geometry", async function () {
    const before = await bitmap();
    await browser.execute((background) => {
      const canvas = document.querySelector(".inkline-surface");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no surface context");
      canvas.style.backgroundColor = background;
      context.resetTransform();
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#000000";
      context.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerType: "mouse",
          pointerId: 62,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
        }),
      );
    }, "#ffffff");
    const after = await bitmap();
    expect(after.pixels.filter((_value, index) => index % 4 === 3)).toEqual(
      before.pixels.filter((_value, index) => index % 4 === 3),
    );
    for (let y = 0; y < after.height; y++) {
      for (let x = 0; x < after.width; x++) {
        const at = (y * after.width + x) * 4;
        if ((after.pixels[at + 3] ?? 0) < 128) continue;
        // Skip the two pixels straddling the sampled boundary.
        if (Math.abs(x - after.width / 2) < 2) continue;
        const colour = x < after.width / 2 ? 0 : 255;
        expect(after.pixels.slice(at, at + 3)).toEqual([
          colour,
          colour,
          colour,
        ]);
      }
    }
    await saveScreenshot("cursor-adaptive-ink-edge");
  });

  it("composes a translucent tracing picture over the dark surface", async function () {
    await browser.execute(async (background) => {
      const canvas = document.querySelector(".inkline-surface");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
      canvas.style.backgroundColor = background;
      const pictures = window.inklineTest.pictures;
      pictures.drop(
        canvas,
        new File([await pictures.picture(100, 100, "white")], "white.png", {
          type: "image/png",
        }),
      );
    }, "#1e1e1e");
    await browser.$('[data-inkline-button="move"]').waitForEnabled();
    const point = await browser.execute(() => {
      const canvas = document.querySelector(".inkline-surface");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no surface context");
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      // Find the middle of the actual 35%-opaque white reference, away from
      // guide lines; the cursor must see its composited grey, not white.
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = 0;
      let maxY = 0;
      let referencePixels = 0;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const at = (y * canvas.width + x) * 4;
          if ((data[at] ?? 0) > 250 && Math.abs((data[at + 3] ?? 0) - 89) < 2) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            referencePixels++;
          }
        }
      }
      if (referencePixels === 0)
        throw new Error("no translucent reference pixels");
      const x = (minX + maxX) / 2;
      const y = (minY + maxY) / 2;
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerType: "mouse",
          pointerId: 63,
          clientX:
            rect.left +
            canvas.clientLeft +
            (x / canvas.width) * canvas.clientWidth,
          clientY:
            rect.top +
            canvas.clientTop +
            (y / canvas.height) * canvas.clientHeight,
          bubbles: true,
        }),
      );
      return { referencePixels };
    });
    expect(point.referencePixels).toBeGreaterThan(100);
    const image = await bitmap();
    const centre = ((image.height / 2) * image.width + image.width / 2) * 4;
    expect(image.pixels.slice(centre, centre + 3)).toEqual([255, 255, 255]);
    await saveScreenshot("cursor-translucent-reference");
  });

  it("refreshes contrast after a theme redraw without pointer movement", async function () {
    const before = await bitmap();
    for (const [theme, colour] of [
      ["theme-dark", 255],
      ["theme-light", 0],
    ] as const) {
      await browser.executeObsidian(({ app }, name) => {
        document.body.removeClass("theme-light", "theme-dark");
        document.body.addClass(name);
        app.workspace.trigger("css-change");
      }, theme);
      await browser.waitUntil(async () => {
        const image = await bitmap();
        const at = ((image.height / 2) * image.width + image.width / 2) * 4;
        return image.pixels[at] === colour;
      });
      const after = await bitmap();
      expect(after.pixels.filter((_value, index) => index % 4 === 3)).toEqual(
        before.pixels.filter((_value, index) => index % 4 === 3),
      );
      await saveScreenshot(`cursor-contrast-${theme}`);
    }
  });

  it("shows the crosshair on readback failure and recovers on the next move", async function () {
    const result = await browser.execute((transparentBackground) => {
      const canvas = document.querySelector(".inkline-surface");
      const cursor = document.querySelector(".inkline-brush-cursor");
      if (
        !(canvas instanceof HTMLCanvasElement) ||
        !(cursor instanceof HTMLCanvasElement)
      )
        throw new Error("no canvases");
      const rect = canvas.getBoundingClientRect();
      const move = (): void => {
        canvas.dispatchEvent(
          new PointerEvent("pointermove", {
            pointerType: "mouse",
            pointerId: 64,
            clientX: rect.left + 80,
            clientY: rect.top + 80,
            bubbles: true,
          }),
        );
      };
      const state = () => ({
        native: getComputedStyle(canvas).cursor,
        display: getComputedStyle(cursor).display,
      });
      // Preserve the prototype method for restoration; call it with .apply.
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Preserve the method for .apply and restoration.
      const original = CanvasRenderingContext2D.prototype.getImageData;
      const background = canvas.style.backgroundColor;
      canvas.style.backgroundColor = transparentBackground;
      move();
      const transparent = state();
      canvas.style.backgroundColor = background;
      let failed;
      try {
        CanvasRenderingContext2D.prototype.getImageData = function (...args) {
          if (this.canvas !== canvas && this.canvas !== cursor)
            throw new DOMException(
              "synthetic readback failure",
              "SecurityError",
            );
          return original.apply(this, args);
        };
        move();
        failed = state();
      } finally {
        CanvasRenderingContext2D.prototype.getImageData = original;
      }
      move();
      return { transparent, failed, recovered: state() };
    }, "transparent");
    expect(result.transparent).toEqual({
      native: "crosshair",
      display: "none",
    });
    expect(result.failed).toEqual({ native: "crosshair", display: "none" });
    expect(result.recovered.native).toBe("none");
    expect(result.recovered.display).not.toBe("none");
  });

  it("bounds the cost of repeated updates while preserving the fixed coverage", async function () {
    await setPageZoom(2);
    await surface().moveTo();
    const before = await bitmap();
    const timing = await browser.execute(() => {
      const canvas = document.querySelector(".inkline-surface");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no context");
      const cursor = document.querySelector(".inkline-brush-cursor");
      if (!(cursor instanceof HTMLCanvasElement)) throw new Error("no cursor");
      const rect = canvas.getBoundingClientRect();
      const rounds: number[] = [];
      for (let round = 0; round < 3; round++) {
        const started = performance.now();
        for (let index = 0; index < 300; index++) {
          // Dirty the source each time, outside the cursor's sampled region.
          context.fillRect(index % canvas.width, 0, 1, 1);
          canvas.dispatchEvent(
            new PointerEvent("pointermove", {
              pointerType: "mouse",
              pointerId: 65,
              clientX: rect.left + 80 + (index % 150),
              clientY: rect.top + 80 + (index % 31),
              bubbles: true,
            }),
          );
        }
        rounds.push(performance.now() - started);
      }
      return {
        rounds,
        source: [canvas.width, canvas.height],
        ratio: devicePixelRatio,
        native: getComputedStyle(canvas).cursor,
        display: getComputedStyle(cursor).display,
      };
    });
    console.log("Cursor updates: 300 events per round", JSON.stringify(timing));
    const median = [...timing.rounds].sort((a, b) => a - b)[1];
    // 5 ms per update leaves most of a 60 Hz frame for drawing and UI work.
    // Use three fixed-input rounds to reduce one-off host scheduling noise.
    expect(median).toBeLessThan(1500);
    expect(timing.native).toBe("none");
    expect(timing.display).not.toBe("none");
    const after = await bitmap();
    expect(after.pixels.filter((_value, index) => index % 4 === 3)).toEqual(
      before.pixels.filter((_value, index) => index % 4 === 3),
    );
    expect(
      after.pixels.some((value, index) => index % 4 === 3 && value > 0),
    ).toBe(true);
  });
});
