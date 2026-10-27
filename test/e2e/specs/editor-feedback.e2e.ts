import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { cursorImage, hasBrushCursor } from "../support/cursor.ts";
import {
  draw,
  openAtMarker,
  recordOf,
  startOver,
  surface,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

async function insert(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
}

describe("Editor feedback", function () {
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
  });

  afterEach(async function () {
    await browser.execute((themes) => {
      document.body.removeClass("theme-light", "theme-dark");
      for (const theme of themes) document.body.addClass(theme);
    }, originalTheme);
  });

  after(async function () {
    await startOver();
  });

  for (const theme of ["theme-light", "theme-dark"]) {
    it(`keeps the close control clear of the name in ${theme}`, async function () {
      await insert();
      const layout = await browser.execute((wanted) => {
        document.body.removeClass("theme-light", "theme-dark");
        document.body.addClass(wanted);
        const name = document.querySelector(".inkline-name");
        const close = document.querySelector(
          ".inkline-editor .modal-header-button",
        );
        if (name === null || close === null) throw new Error("no controls");
        const a = name.getBoundingClientRect();
        const b = close.getBoundingClientRect();
        return {
          nameWidth: a.width,
          overlap:
            Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
        };
      }, theme);
      await saveScreenshot(`editor-feedback-${theme}`);
      expect(layout.overlap).toBe(0);
      expect(layout.nameWidth).toBeGreaterThan(300);
    });

    it(`keeps a fixed brush bitmap at fractional positions in ${theme}`, async function () {
      await insert();
      for (const width of [721.5, 480.25]) {
        await browser.execute(
          (wanted, pixels) => {
            document.body.removeClass("theme-light", "theme-dark");
            document.body.addClass(wanted);
            const modal = document.querySelector(".inkline-editor");
            if (modal instanceof HTMLElement)
              modal.style.width = `${String(pixels)}px`;
          },
          theme,
          width,
        );
        await surface().moveTo();
        const measurements = await browser.execute(() => {
          const canvas = document.querySelector(".inkline-surface");
          if (!(canvas instanceof HTMLCanvasElement))
            throw new Error("no drawing controls");
          const rect = canvas.getBoundingClientRect();
          const offsets = [0.125, 0.375, 0.625, 0.875];
          const cursors = offsets.map((fraction) => {
            const clientX = rect.left + 80 + fraction;
            const clientY = rect.top + 80 + fraction;
            canvas.dispatchEvent(
              new PointerEvent("pointermove", {
                pointerType: "mouse",
                pointerId: 51,
                clientX,
                clientY,
                bubbles: true,
              }),
            );
            return getComputedStyle(canvas).cursor;
          });
          return cursors;
        });
        expect(new Set(measurements).size).toBe(1);
        const image = await cursorImage();
        expect(image.width).toBe(image.height);
        expect(image.hotspot).toEqual([image.width / 2, image.height / 2]);
        expect(image.diameter).toBeGreaterThan(0);
      }
      await saveScreenshot(`editor-centred-cursor-${theme}`);
    });
  }

  it("names the drawing area without showing a hover tooltip", async function () {
    await insert();
    expect(await surface().getComputedLabel()).toBe("Drawing area");
    await browser.$('[data-inkline-button="pen"]').moveTo();
    await browser.pause(500);
    await surface().moveTo();
    // Obsidian creates aria-label tooltips after the hover delay.
    await browser.pause(1200);
    expect(await browser.$(".tooltip=Drawing area").isExisting()).toBe(false);
  });

  it("shows the brush footprint without adding it to the drawing", async function () {
    await insert();
    await surface().moveTo();
    await browser.waitUntil(hasBrushCursor);
    const small = await cursorImage();
    await browser.keys("4");
    await browser.waitUntil(
      async () => (await cursorImage()).diameter > small.diameter,
    );
    const large = await cursorImage();
    expect(large.diameter / small.diameter).toBeCloseTo(2, 1);
    await browser.keys("e");
    await browser.waitUntil(hasBrushCursor);
    expect((await cursorImage()).bitmap).toBe(small.bitmap);
    await browser.$('[data-inkline-button="pen"]').moveTo();
    await browser.waitUntil(async () => !(await hasBrushCursor()));
    expect(await surface().getCSSProperty("cursor")).toMatchObject({
      value: "crosshair",
    });
    await browser.keys(["Control", "Enter"]);
    await surface().waitForExist({ reverse: true });
    const saved: unknown = JSON.parse(await recordOf("001.ink.png"));
    expect(saved).toMatchObject({ strokes: [] });
  });

  it("restores the fallback cursor on cancellation and Help", async function () {
    await insert();
    await surface().moveTo();
    const cancelled = await browser.execute(() => {
      const canvas = document.querySelector(".inkline-surface");
      if (!(canvas instanceof HTMLCanvasElement))
        throw new Error("no drawing controls");
      const rect = canvas.getBoundingClientRect();
      const sample = {
        pointerType: "pen",
        pointerId: 52,
        clientX: rect.left + 80.25,
        clientY: rect.top + 80.25,
        bubbles: true,
      };
      canvas.dispatchEvent(new PointerEvent("pointermove", sample));
      canvas.dispatchEvent(new PointerEvent("pointercancel", sample));
      return {
        native: getComputedStyle(canvas).cursor,
        replacement: canvas.classList.contains("has-brush-cursor"),
      };
    });
    expect(cancelled).toEqual({ native: "crosshair", replacement: false });
    await surface().moveTo({ xOffset: 20 });
    await browser.waitUntil(hasBrushCursor);
    // Keyboard activation opens Help without a pointerleave hiding the ring.
    await browser.execute(() => {
      const help = document.querySelector('[data-inkline-button="help"]');
      if (!(help instanceof HTMLButtonElement)) throw new Error("no Help");
      help.focus();
    });
    await browser.keys("Enter");
    await browser.$(".inkline-help").waitForDisplayed();
    expect(await surface().getCSSProperty("cursor")).toMatchObject({
      value: "crosshair",
    });
    expect(await hasBrushCursor()).toBe(false);
    await browser.keys("Escape");
    await browser.$(".inkline-help").waitForExist({ reverse: true });
    await surface().moveTo({ xOffset: -20 });
    await browser.waitUntil(hasBrushCursor);
  });

  it("keeps pen and eraser sizes separately through tool switches and Next", async function () {
    await insert();
    await browser.keys("1");
    await browser.keys("e");
    await browser.keys("4");
    await browser.keys("p");
    expect(
      await browser
        .$('[data-inkline-button="size-0"]')
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await draw([
      [0.4, 0.3],
      [0.5, 0.7],
    ]);
    await browser.execute(() => {
      document
        .querySelector(".inkline-editor")
        ?.setAttribute("data-first-editor", "true");
    });
    await browser.keys(["Control", "Shift", "Enter"]);
    await browser
      .$('[data-first-editor="true"]')
      .waitForExist({ reverse: true });
    await waitForEditor();
    expect(
      await browser
        .$('[data-inkline-button="size-0"]')
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await browser.keys("e");
    expect(
      await browser
        .$('[data-inkline-button="size-3"]')
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("scales the brush circle with the surface and keeps it after a stroke", async function () {
    await insert();
    await surface().moveTo();
    await browser.waitUntil(hasBrushCursor);
    // Measure the actual cursor image, excluding its transparent padding.
    const measure = async () => ({
      brush: (await cursorImage()).diameter,
      surface: await browser.execute(() => {
        const canvas = document.querySelector(".inkline-surface");
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error("no drawing controls");
        }
        return canvas.clientWidth;
      }),
    });
    const before = await measure();
    await browser.execute(() => {
      const modal = document.querySelector(".inkline-editor");
      if (modal instanceof HTMLElement) modal.setCssProps({ width: "480px" });
    });
    await browser.waitUntil(
      async () => (await surface().getSize()).width < before.surface,
    );
    await surface().moveTo();
    await browser.waitUntil(
      async () => (await cursorImage()).diameter < before.brush,
    );
    const after = await measure();
    expect(after.brush / before.brush).toBeCloseTo(
      after.surface / before.surface,
      2,
    );
    await draw([
      [0.4, 0.3],
      [0.5, 0.7],
    ]);
    await browser.waitUntil(hasBrushCursor);
    await saveScreenshot("editor-brush-circle");
  });

  it("explains the guides and returns from Help without changing the drawing", async function () {
    await insert();
    await draw([
      [0.4, 0.3],
      [0.5, 0.7],
    ]);
    await browser.$('[data-inkline-button="help"]').click();
    const help = browser.$(".inkline-help");
    await help.waitForDisplayed();
    const text = await help.getText();
    for (const name of [
      "Ascender",
      "Cap height",
      "x-height",
      "Baseline",
      "Descender",
      "Vertical dashed",
      "Grid",
      "Next",
    ]) {
      expect(text).toContain(name);
    }
    await saveScreenshot("editor-quick-start");
    await browser.keys("Escape");
    await help.waitForExist({ reverse: true });
    expect(await surface().isFocused()).toBe(true);
    await browser.keys(["Control", "Enter"]);
    await surface().waitForExist({ reverse: true });
    const saved: unknown = JSON.parse(await recordOf("001.ink.png"));
    expect(saved).toMatchObject({
      strokes: [expect.objectContaining({ tool: "pen" })],
    });
  });

  it("keeps the picture drop outline inside the surface without keyboard focus", async function () {
    await insert();
    await browser.$(".inkline-name").click();
    const outline = await browser.execute(() => {
      const canvas = document.querySelector(".inkline-surface");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
      const data = new DataTransfer();
      data.items.add(
        new File(["synthetic"], "trace.png", { type: "image/png" }),
      );
      canvas.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: data,
        }),
      );
      const style = getComputedStyle(canvas);
      return {
        style: style.outlineStyle,
        outside:
          Number.parseFloat(style.outlineOffset) +
          Number.parseFloat(style.outlineWidth),
      };
    });
    expect(outline.style).toBe("dashed");
    expect(outline.outside).toBeLessThanOrEqual(0);
    await saveScreenshot("editor-drop-outline");
  });

  it("keeps a pen's circle when an unrelated palm pointer moves or leaves", async function () {
    await insert();
    const state = await browser.execute(() => {
      const canvas = document.querySelector(".inkline-surface");
      if (!(canvas instanceof HTMLCanvasElement))
        throw new Error("no controls");
      const rect = canvas.getBoundingClientRect();
      const pen = {
        pointerType: "pen",
        pointerId: 41,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
      };
      canvas.dispatchEvent(new PointerEvent("pointermove", pen));
      const visible = () => getComputedStyle(canvas).cursor === "none";
      const before = visible();
      for (const type of ["pointermove", "pointerleave", "pointercancel"]) {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            ...pen,
            pointerId: 42,
            pointerType: "touch",
          }),
        );
      }
      const afterPalm = visible();
      canvas.dispatchEvent(new PointerEvent("pointerleave", pen));
      return { before, afterPalm, afterPen: visible() };
    });
    expect(state).toEqual({ before: true, afterPalm: true, afterPen: false });
  });
});
