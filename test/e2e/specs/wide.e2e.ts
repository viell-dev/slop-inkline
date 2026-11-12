// A symbol wider than the space it is in, as one near the format's 4,096
// pixels is at the larger symbol sizes, or in a hover preview at any, shrinks
// to fit it evenly (#241): its ink keeps the proportions it was drawn in, and
// its baseline stays on the text's, in every view that shows symbols as text,
// in the text colour and in its stored colour, in light and dark themes.
// Native PDF export is checked in pdf.e2e.ts.

import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import type { Block, Rgb } from "../../support/ink-block.ts";
import { loadModules, toBase64 } from "../support/browser.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import {
  drawnRatio,
  fullWidth,
  wide,
  widePng,
} from "../support/wide-symbol.ts";

/**
 * The Symbol size setting, as a factor: 200%, the largest there is, at
 * which the symbol would be 1,000 pixels wide in 16-pixel text, wider than
 * a note's line, and wider still than a hover preview.
 */
const scale = 2;

const wideNote = [
  "Top line.",
  "",
  "Before ![[Glyphs/wide.ink.png]] after.",
  "",
  "| Cell |",
  "| --- |",
  "| Before ![[Glyphs/wide.ink.png]] after. |",
  "",
  "Sized ![[Glyphs/wide.ink.png|300]] after.",
  "",
].join("\n");

const reading = ".workspace-leaf.mod-active .markdown-reading-view";
const source = ".workspace-leaf.mod-active .markdown-source-view";

/** A place a symbol shows in: the note that shows it, and the symbol. */
interface Place {
  readonly name: string;
  readonly note: string;
  readonly mode: "source" | "preview";
  readonly symbol: string;
  /** Whether it shows in a hover preview of the note's link. */
  readonly hover?: true;
}

const places: readonly Place[] = [
  {
    name: "Reading view",
    note: "Wide.md",
    mode: "preview",
    symbol: `${reading} p img.inkline-symbol:not([width])`,
  },
  {
    name: "Live Preview",
    note: "Wide.md",
    mode: "source",
    symbol: `${source} .cm-line img.inkline-symbol:not([width])`,
  },
  {
    name: "a table cell in Reading view",
    note: "Wide.md",
    mode: "preview",
    symbol: `${reading} td img.inkline-symbol`,
  },
  {
    name: "a table cell in Live Preview",
    note: "Wide.md",
    mode: "source",
    symbol: `${source} td img.inkline-symbol`,
  },
  {
    name: "an embedded note",
    note: "Host.md",
    mode: "preview",
    symbol: `${reading} .markdown-embed p img.inkline-symbol:not([width])`,
  },
  {
    name: "a hover preview",
    note: "Linked.md",
    mode: "preview",
    symbol: ".hover-popover p img.inkline-symbol:not([width])",
    hover: true,
  },
];

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** How a symbol shows, in CSS pixels of the window. */
interface Shown {
  /** The image's box, and the content box of the block it is in. */
  box: Box;
  space: Box;
  /** Where the text's baseline lies beside it. */
  baseline: number;
  fontSize: number;
  /** The ink seen on the screen, and the colour it should be. */
  ink: Block | null;
  expected: Rgb;
}

/** Opens `path` in the active leaf, in Live Preview or Reading view. */
async function open(path: string, mode: "source" | "preview"): Promise<void> {
  await browser.executeObsidian(
    async ({ app, obsidian }, file, viewMode) => {
      const found = app.vault.getFileByPath(file);
      if (found === null) throw new Error(`no ${file}`);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(found, {
        state: { mode: viewMode, source: false },
      });
      if (!(leaf.view instanceof obsidian.MarkdownView)) {
        throw new Error("not a Markdown view");
      }
      app.workspace.setActiveLeaf(leaf, { focus: true });
    },
    path,
    mode,
  );
}

/** Moves the pointer to the window's corner, off every note and preview. */
async function pointerAway(): Promise<void> {
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ x: 2, y: 2 })
    .perform();
}

/** Waits for the symbol at `selector` to be tagged and loaded, in view. */
async function waitForSymbol(selector: string, scroll: boolean): Promise<void> {
  await browser.waitUntil(async () =>
    browser.execute(
      (wanted, intoView) => {
        const image = activeDocument.querySelector(wanted);
        if (!image?.instanceOf(HTMLImageElement)) return false;
        if (!image.complete || image.naturalWidth === 0) return false;
        if (intoView) image.scrollIntoView({ block: "center" });
        return true;
      },
      selector,
      scroll,
    ),
  );
  // Long enough for the page to draw what scrolled into view.
  await browser.pause(300);
}

/**
 * How the symbol at `selector` shows: its box and its line's baseline, read
 * from the page, and its ink, measured in a screenshot of the window, as a
 * mask's ink can only be. The ground is the colour along the bottom of the
 * box, below the baseline, where the symbol has no ink.
 */
async function measure(selector: string, stored: boolean): Promise<Shown> {
  const shot = await browser.takeScreenshot();
  return browser.execute(
    async (wanted, png, storedColour) => {
      const image = activeDocument.querySelector(wanted);
      if (!image?.instanceOf(HTMLImageElement)) throw new Error("no symbol");
      const boxOf = (rect: DOMRect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
      const rect = image.getBoundingClientRect();
      // An empty inline block on the baseline next to the embed, which is
      // in the line itself, as the image is not in Live Preview.
      const probe = createSpan({
        attr: {
          style:
            "display: inline-block; width: 0; height: 0; vertical-align: baseline",
        },
      });
      (image.closest(".image-embed") ?? image).after(probe);
      const baseline = probe.getBoundingClientRect().bottom;
      probe.remove();
      // The block the symbol is in: its paragraph, line, or cell.
      let holder = (image.closest(".image-embed") ?? image).parentElement;
      while (
        holder !== null &&
        getComputedStyle(holder).display.startsWith("inline")
      ) {
        holder = holder.parentElement;
      }
      if (holder === null) throw new Error("no block around the symbol");
      const around = getComputedStyle(holder);
      const outer = holder.getBoundingClientRect();
      const inset = (side: "left" | "right" | "top" | "bottom") =>
        Number.parseFloat(around.getPropertyValue(`padding-${side}`)) +
        Number.parseFloat(around.getPropertyValue(`border-${side}-width`));
      const space = new DOMRect(
        outer.left + inset("left"),
        outer.top + inset("top"),
        outer.width - inset("left") - inset("right"),
        outer.height - inset("top") - inset("bottom"),
      );
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const pixels = window.inklineTest.canvas.readPixels(bitmap);
      bitmap.close();
      // Screen pixels for each CSS pixel, 1 in the tests' windows.
      const ratio = pixels.width / window.innerWidth;
      const region = {
        left: rect.left * ratio,
        top: rect.top * ratio,
        right: rect.right * ratio,
        bottom: rect.bottom * ratio,
      };
      const { inkBlock } = window.inklineTest;
      const row = Math.ceil(region.bottom) - 1;
      const ground = inkBlock.commonColour(pixels, {
        left: region.left,
        top: row,
        right: region.right,
        bottom: row + 1,
      });
      const paint = new OffscreenCanvas(1, 1).getContext("2d");
      if (paint === null) throw new Error("no 2D context");
      paint.fillStyle = getComputedStyle(image).color;
      paint.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0] = paint.getImageData(
        0,
        0,
        1,
        1,
      ).data;
      const expected: [number, number, number] = storedColour
        ? [126, 126, 126]
        : [red, green, blue];
      const found = inkBlock.measureBlock(pixels, region, ground, expected);
      const scaled = (ink: typeof found) =>
        ink === undefined
          ? null
          : {
              ...ink,
              left: ink.left / ratio,
              top: ink.top / ratio,
              right: ink.right / ratio,
              bottom: ink.bottom / ratio,
              width: ink.width / ratio,
              height: ink.height / ratio,
            };
      return {
        box: boxOf(rect),
        space: boxOf(space),
        baseline,
        fontSize: Number.parseFloat(getComputedStyle(image).fontSize),
        ink: scaled(found),
        expected,
      };
    },
    selector,
    shot,
    stored,
  );
}

/** Puts Inkline's display settings to these, and starts it again with them. */
async function display(symbolScale: number, textColor: boolean): Promise<void> {
  await browser.executeObsidian(
    async ({ plugins }, settings) => {
      await plugins.inkline.saveData(settings);
    },
    { symbolScale, textColor },
  );
  await obsidianPage.disablePlugin("inkline");
  await obsidianPage.enablePlugin("inkline");
  await loadModules();
}

async function theme(name: "moonstone" | "obsidian"): Promise<void> {
  await browser.executeObsidian(({ app }, chosen) => {
    const change: unknown = Reflect.get(app, "changeTheme");
    if (typeof change !== "function") throw new Error("no themes");
    Reflect.apply(change, app, [chosen]);
  }, name);
  await browser.pause(300);
}

/**
 * Shows `place`'s symbol, measures it, saves a screenshot named `shot`, and
 * closes any hover preview.
 */
async function shownIn(
  place: Place,
  stored: boolean,
  shot: string,
): Promise<Shown> {
  await open(place.note, place.mode);
  if (place.hover !== true) {
    await pointerAway();
    await waitForSymbol(place.symbol, true);
    const shown = await measure(place.symbol, stored);
    await saveScreenshot(shot);
    return shown;
  }
  await browser.$(`${reading} a.internal-link`).moveTo();
  try {
    await waitForSymbol(place.symbol, false);
    const shown = await measure(place.symbol, stored);
    await saveScreenshot(shot);
    return shown;
  } finally {
    await pointerAway();
    await browser.$(".hover-popover").waitForExist({ reverse: true });
  }
}

/**
 * That `shown` is whole, in the proportions it was drawn in, and on the
 * baseline, in the colour it should be, in a space too narrow for it.
 */
function expectEvenlyShrunk(shown: Shown): void {
  const { box, space, ink } = shown;
  // Too narrow a space: a tenth or more narrower than the symbol would be.
  const full = fullWidth(shown.fontSize, scale);
  expect(box.width).toBeLessThan(0.9 * full);
  // Its box stays the line's height, 1.5 em at this size, and in its space.
  expect(Math.abs(box.height - 1.5 * shown.fontSize * scale)).toBeLessThan(1);
  expect(box.left).toBeGreaterThanOrEqual(space.left - 1);
  expect(box.right).toBeLessThanOrEqual(space.right + 1);
  expect(ink).not.toBeNull();
  if (ink === null) return;
  // Its ink is drawn across the box, at the height that keeps its shape.
  const across =
    (box.width * (wide.block.right - wide.block.left)) / wide.width;
  expect(Math.abs(ink.width - across)).toBeLessThan(2);
  expect(Math.abs(ink.width / ink.height / drawnRatio - 1)).toBeLessThan(0.05);
  // The block ends on the symbol's baseline, which is on the text's.
  expect(Math.abs(ink.bottom - shown.baseline)).toBeLessThan(1.5);
  for (const [channel, value] of shown.expected.entries()) {
    expect(Math.abs((ink.colour[channel] ?? 0) - value)).toBeLessThanOrEqual(
      24,
    );
  }
}

describe("Symbols wider than their space", function () {
  before(async function () {
    await loadModules();
    await browser.executeObsidian(
      async ({ app }, png, note) => {
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        await app.vault.createFolder("Glyphs");
        await app.vault.createBinary("Glyphs/wide.ink.png", bytes.buffer);
        await app.vault.create("Wide.md", note);
        await app.vault.create("Host.md", "Embedded:\n\n![[Wide]]\n");
        await app.vault.create("Linked.md", "A link to [[Wide]] here.\n");
      },
      toBase64(widePng()),
      wideNote,
    );
  });

  after(async function () {
    await theme("moonstone");
    await display(100, true);
  });

  for (const stored of [false, true]) {
    const colour = stored ? "stored colour" : "text colour";

    describe(`in the ${colour}`, function () {
      before(async function () {
        await display(scale * 100, !stored);
      });

      for (const place of places) {
        it(`shrink evenly, on the baseline, in ${place.name}`, async function () {
          for (const name of ["moonstone", "obsidian"] as const) {
            await theme(name);
            const file = place.name.replace(/\W+/g, "-").toLowerCase();
            const shown = await shownIn(
              place,
              stored,
              `wide-${stored ? "stored" : "text"}-${name}-${file}`,
            );
            console.log(
              `${colour}, ${name}, ${place.name}: ${JSON.stringify(shown)}`,
            );
            expectEvenlyShrunk(shown);
          }
        });
      }

      it("keep an explicit size that fits as it is", async function () {
        await theme("moonstone");
        const sized = `${reading} p img.inkline-symbol[width]`;
        await open("Wide.md", "preview");
        await pointerAway();
        await waitForSymbol(sized, true);
        const shown = await measure(sized, stored);
        await saveScreenshot(`wide-${stored ? "stored" : "text"}-sized`);
        console.log(`${colour}, |300: ${JSON.stringify(shown)}`);
        // 300 wide at the symbol's own proportions, whatever the setting.
        const tall = (300 * wide.height) / wide.width;
        expect(Math.abs(shown.box.width - 300)).toBeLessThan(0.5);
        expect(Math.abs(shown.box.height - tall)).toBeLessThan(0.5);
        expect(shown.ink).not.toBeNull();
        if (shown.ink === null) return;
        expect(
          Math.abs(shown.ink.width / shown.ink.height / drawnRatio - 1),
        ).toBeLessThan(0.05);
        expect(Math.abs(shown.ink.bottom - shown.baseline)).toBeLessThan(1.5);
      });
    });
  }
});
