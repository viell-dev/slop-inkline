import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
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
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
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
          overlap:
            Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
        };
      }, theme);
      await saveScreenshot(`editor-feedback-${theme}`);
      expect(layout.overlap).toBe(0);
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
    const cursor = browser.$(".inkline-brush-cursor");
    await cursor.waitForDisplayed();
    const small = await cursor.getSize();
    await browser.keys("4");
    await browser.waitUntil(
      async () => (await cursor.getSize()).width > small.width,
    );
    const large = await cursor.getSize();
    expect(large.width / small.width).toBeCloseTo(2, 1);
    await browser.keys("e");
    await cursor.waitForDisplayed();
    await browser.$('[data-inkline-button="pen"]').moveTo();
    await cursor.waitForDisplayed({ reverse: true });
    await browser.keys(["Control", "Enter"]);
    await surface().waitForExist({ reverse: true });
    const saved: unknown = JSON.parse(await recordOf("001.ink.png"));
    expect(saved).toMatchObject({ strokes: [] });
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
    const cursor = browser.$(".inkline-brush-cursor");
    await cursor.waitForDisplayed();
    const before = {
      brush: (await cursor.getSize()).width,
      surface: (await surface().getSize()).width,
    };
    await browser.execute(() => {
      const modal = document.querySelector(".inkline-editor");
      if (modal instanceof HTMLElement) modal.setCssProps({ width: "480px" });
    });
    await browser.waitUntil(
      async () => (await surface().getSize()).width < before.surface,
    );
    await surface().moveTo();
    await browser.waitUntil(
      async () => (await cursor.getSize()).width < before.brush,
    );
    const after = {
      brush: (await cursor.getSize()).width,
      surface: (await surface().getSize()).width,
    };
    expect(after.brush / before.brush).toBeCloseTo(
      after.surface / before.surface,
      2,
    );
    await draw([
      [0.4, 0.3],
      [0.5, 0.7],
    ]);
    await cursor.waitForDisplayed();
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
});
