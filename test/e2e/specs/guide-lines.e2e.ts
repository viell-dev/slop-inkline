import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { defaultSettings, type Settings } from "../../../src/settings.ts";
import { loadModules } from "../support/browser.ts";
import {
  openAtMarker,
  settledSurface,
  startOver,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** What the drawing area shows on one font line's row. */
interface LineShown {
  readonly name: string;
  /** The colour the theme gives the line, as `rgb(…)`. */
  readonly expected: readonly number[];
  /** The commonest colour on the row other than the background, if any. */
  readonly drawn: readonly number[] | undefined;
  /**
   * How many of the row's pixels are in the line's colour: the image's ends
   * and the grid cross every row in another.
   */
  readonly marked: number;
}

/**
 * Each font line's row on the drawing area, as guideRows finds it, with the
 * colour its CSS custom property gives and the colour drawn there.
 */
async function linesShown(): Promise<LineShown[]> {
  return browser.execute(() => {
    const doc = activeDocument;
    const view = doc.defaultView;
    if (view === null) throw new Error("no window");
    const canvas = doc.querySelector(".inkline-editor .inkline-surface");
    const line = doc.querySelector(".inkline-editor .inkline-preview");
    if (
      canvas?.instanceOf(HTMLCanvasElement) !== true ||
      line?.instanceOf(HTMLElement) !== true
    ) {
      throw new Error("no surface");
    }
    const font = view.getComputedStyle(line);
    const probe = new view.OffscreenCanvas(1, 1).getContext("2d");
    if (probe === null) throw new Error("no context");
    probe.font = `${font.fontStyle} ${font.fontWeight} 128px ${font.fontFamily}`;
    const capital = probe.measureText("H");
    const lowercase = probe.measureText("x");
    const rgb = (css: string): number[] => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = "#000";
      probe.fillStyle = css;
      probe.fillRect(0, 0, 1, 1);
      return [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const style = view.getComputedStyle(canvas);
    const ground = rgb(style.backgroundColor);
    const factor = canvas.width / 576;
    const pixels = canvas
      .getContext("2d")
      ?.getImageData(0, 0, canvas.width, canvas.height);
    if (pixels === undefined) throw new Error("no pixels");
    return (
      [
        ["ascender", 144 - capital.fontBoundingBoxAscent],
        ["cap-height", 144 - capital.actualBoundingBoxAscent],
        ["x-height", 144 - lowercase.actualBoundingBoxAscent],
        ["baseline", 144],
        ["descender", 144 + capital.fontBoundingBoxDescent],
      ] as const
    )
      .filter(([, y]) => y >= 0 && y <= 192)
      .map(([name, y]) => {
        const row = Math.round(y * factor);
        const expected = rgb(
          style.getPropertyValue(`--inkline-guide-${name}`).trim(),
        );
        const near = (colour: number[], to: readonly number[]): boolean =>
          colour.every(
            (value, channel) => Math.abs(value - (to[channel] ?? 0)) <= 8,
          );
        const counts = new Map<string, number>();
        let marked = 0;
        for (let x = 0; x < pixels.width; x++) {
          const at = (row * pixels.width + x) * 4;
          const colour = [...pixels.data.slice(at, at + 3)];
          if (near(colour, ground)) continue;
          if (near(colour, expected)) marked++;
          const key = colour.join(",");
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const commonest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
        return {
          name,
          expected,
          drawn: commonest?.[0].split(",").map(Number),
          marked,
        };
      });
  });
}

/** Starts Inkline again with its settings stored as `changes` say. */
async function storeSettings(changes: Partial<Settings>): Promise<void> {
  await obsidianPage.disablePlugin("inkline");
  await browser.executeObsidian(
    async ({ app }, settings) => {
      await app.vault.adapter.write(
        `${app.vault.configDir}/plugins/inkline/data.json`,
        JSON.stringify(settings),
      );
    },
    { ...defaultSettings, ...changes },
  );
  await obsidianPage.enablePlugin("inkline");
  await loadModules();
}

async function openEditor(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await settledSurface();
}

describe("Guide lines", function () {
  let themes: string[] = [];

  before(async function () {
    await loadModules();
    themes = await browser.execute(() =>
      [...document.body.classList].filter(
        (name) => name === "theme-light" || name === "theme-dark",
      ),
    );
  });
  beforeEach(async function () {
    await startOver();
    await storeSettings({});
  });
  after(async function () {
    await startOver();
    await browser.execute((original) => {
      document.body.classList.remove("theme-light", "theme-dark");
      document.body.classList.add(...original);
    }, themes);
    await storeSettings({});
  });

  for (const theme of ["theme-light", "theme-dark"]) {
    it(`draws each font line in its own colour from the theme, in ${theme}`, async function () {
      await browser.execute((name) => {
        document.body.classList.remove("theme-light", "theme-dark");
        document.body.classList.add(name);
      }, theme);
      await openEditor();
      // The surface redraws in the new theme's colours.
      let lines: LineShown[] = [];
      await browser.waitUntil(async () => {
        lines = await linesShown();
        return lines.every(
          (line) =>
            line.drawn?.every(
              (value, channel) =>
                Math.abs(value - (line.expected[channel] ?? 0)) <= 8,
            ) === true,
        );
      });
      await saveScreenshot(`guide-lines-${theme}`);
      console.log("Guide lines", theme, JSON.stringify(lines));
      expect(lines.length).toBeGreaterThanOrEqual(4);
      // Each line in a colour of its own.
      expect(new Set(lines.map((line) => line.expected.join(","))).size).toBe(
        lines.length,
      );
    });
  }

  it("shows only the font lines the settings turn on, and G hides them all", async function () {
    await storeSettings({ capHeightGuide: false, descenderGuide: false });
    await openEditor();
    const lines = await linesShown();
    const marked = (name: string): number =>
      lines.find((line) => line.name === name)?.marked ?? -1;
    expect(marked("cap-height")).toBe(0);
    expect(marked("x-height")).toBeGreaterThan(0);
    expect(marked("baseline")).toBeGreaterThan(0);
    const descender = lines.find((line) => line.name === "descender");
    if (descender !== undefined) expect(descender.marked).toBe(0);
    await browser.keys("g");
    await browser.waitUntil(async () =>
      (await linesShown()).every((line) => line.marked === 0),
    );
    await browser.keys("g");
    await browser.waitUntil(async () => {
      const again = await linesShown();
      return (
        (again.find((line) => line.name === "baseline")?.marked ?? 0) > 0 &&
        again.find((line) => line.name === "cap-height")?.marked === 0
      );
    });
  });
});
