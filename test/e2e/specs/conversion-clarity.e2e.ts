import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { openAtMarker, startOver, waitForEditor } from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

describe("Enlarged picture conversion", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
    await openAtMarker("Editor.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
  });

  it("keeps enlarged sharp edges narrow through Apply, save and reopen", async function () {
    await browser.execute(async () => {
      const surface = document.querySelector(".inkline-surface");
      if (!(surface instanceof HTMLCanvasElement))
        throw new Error("no surface");
      const { pictures } = window.inklineTest;
      const picture = await pictures.picture(16, 16, "white", [
        { x: 4, y: 2, width: 2, height: 12, colour: "black" },
        { x: 10, y: 2, width: 2, height: 12, colour: "black" },
        { x: 4, y: 7, width: 8, height: 2, colour: "black" },
      ]);
      pictures.drop(
        surface,
        new File([picture], "small-h.png", { type: "image/png" }),
      );
    });
    await browser.$('[data-inkline-button="ink"]').waitForEnabled();
    await browser.$('[data-inkline-button="ink"]').click();
    await browser.$('[data-inkline-button="apply"]').waitForEnabled();
    await saveScreenshot("enlarged-conversion-preview");
    await browser.$('[data-inkline-button="apply"]').click();
    await browser
      .$('[data-inkline-button="apply"]')
      .waitForDisplayed({ reverse: true });
    await browser.keys(["Control", "Enter"]);
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
    const result = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no saved ink");
      const bytes = new Uint8Array(await app.vault.readBinary(file));
      const { canvas, render } = window.inklineTest;
      const opened = await canvas.openInk(bytes);
      if (opened.kind !== "editable" || opened.base === undefined)
        throw new Error("no base");
      const saved = await canvas.decodePng(bytes);
      const pixels = canvas.readPixels(saved);
      saved.close();
      const y = Math.floor(
        opened.base.y / 16 + (opened.base.height * opened.base.scale) / 4,
      );
      const profile = (data: Uint8ClampedArray, width: number) => {
        const row = [];
        for (let x = 0; x < width; x++)
          row.push(data[(y * width + x) * 4 + 3] ?? 0);
        return row;
      };
      const surface = new OffscreenCanvas(pixels.width, pixels.height);
      const context = surface.getContext("2d");
      if (context === null) throw new Error("no context");
      render.drawInk(context, opened.document.strokes, opened.base);
      const reopened = context.getImageData(0, 0, pixels.width, pixels.height);
      const row = profile(pixels.data, pixels.width);
      return {
        row,
        reopened: profile(reopened.data, pixels.width),
        partial: row.filter((v) => v > 0 && v < 255).length,
        scale: opened.base.scale,
        width: opened.base.width,
      };
    });
    console.log("Converted small H", JSON.stringify(result));
    expect(result.reopened).toEqual(result.row);
    // Four vertical edges, at most two antialiased document pixels each.
    const edges = result.row
      .map((value) => (value > 0 && value < 255 ? "p" : " "))
      .join("")
      .split(" ")
      .filter((run) => run !== "");
    expect(edges.length).toBeLessThanOrEqual(4);
    expect(Math.max(...edges.map((run) => run.length))).toBeLessThanOrEqual(2);
    expect(result.partial).toBeLessThanOrEqual(8);
    expect(result.row.filter((value) => value === 255).length).toBeGreaterThan(
      8,
    );
  });
});
