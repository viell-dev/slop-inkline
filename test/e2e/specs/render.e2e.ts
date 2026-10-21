import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { encodePng } from "../../support/png.ts";
import { loadModules, toBase64 } from "../support/browser.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/**
 * A synthetic symbol: 64 × 192 pixels, the line box at 128 px per em, with
 * an opaque grey block from x 8 to 56 and y 48 to 144, which ends on the
 * baseline. It has no record, as a symbol from elsewhere would not.
 */
function blockSymbol(): Uint8Array {
  const width = 64;
  const height = 192;
  const data = new Uint8Array(width * height * 4);
  for (let y = 48; y < 144; y++) {
    for (let x = 8; x < 56; x++)
      data.set([126, 126, 126, 255], (y * width + x) * 4);
  }
  return encodePng({ width, height, data });
}

const note = [
  "Plain ![[Glyphs/block.ink.png]] text.",
  "",
  "Sized ![[Glyphs/block.ink.png|24]] text.",
  "",
  "A photo ![[Glyphs/photo.png]] here.",
  "",
].join("\n");

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
    },
    path,
    mode,
  );
}

/** The selector of the visible view's symbols and other images. */
function images(mode: "source" | "preview"): string {
  return mode === "source"
    ? ".workspace-leaf.mod-active .markdown-source-view img"
    : ".workspace-leaf.mod-active .markdown-reading-view img";
}

interface Shown {
  tagged: boolean;
  /** The image's height and width, and how far its bottom is below the baseline. */
  height: number;
  width: number;
  drop: number;
  fontSize: number;
}

/**
 * How the images in `selector` show: whether each is tagged, its size, and
 * how far its bottom lies below its line's baseline, measured with an empty
 * inline block on the baseline next to it.
 */
async function shown(selector: string): Promise<Shown[]> {
  return browser.execute((wanted) => {
    return Array.from(activeDocument.querySelectorAll(wanted)).map((node) => {
      if (!node.instanceOf(HTMLImageElement)) throw new Error("not an image");
      const probe = createSpan({
        attr: {
          style:
            "display: inline-block; width: 0; height: 0; vertical-align: baseline",
        },
      });
      node.after(probe);
      const baseline = probe.getBoundingClientRect().bottom;
      probe.remove();
      const rect = node.getBoundingClientRect();
      return {
        tagged: node.classList.contains("inkline-symbol"),
        height: rect.height,
        width: rect.width,
        drop: rect.bottom - baseline,
        fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
      };
    });
  }, selector);
}

/** Waits for `count` images in `selector` to be tagged. */
async function waitForTagged(selector: string, count: number): Promise<void> {
  await browser.waitUntil(async () => {
    const all = await shown(selector);
    return all.filter((image) => image.tagged).length === count;
  });
}

/**
 * The share of the first symbol's area, on the screen, in its text colour,
 * and in the stored grey, from a screenshot of it.
 */
async function colours(
  selector: string,
): Promise<{ text: number; grey: number }> {
  const element = await browser.$(`${selector}.inkline-symbol`).getElement();
  const shot = await browser.takeElementScreenshot(element.elementId);
  return browser.execute(
    async (png, wanted) => {
      const image = activeDocument.querySelector(`${wanted}.inkline-symbol`);
      if (image === null) throw new Error("no symbol");
      const probe = new OffscreenCanvas(1, 1).getContext("2d");
      if (probe === null) throw new Error("no 2D context");
      probe.fillStyle = getComputedStyle(image).color;
      probe.fillRect(0, 0, 1, 1);
      const text = [...probe.getImageData(0, 0, 1, 1).data];
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const { data } = window.inklineTest.canvas.readPixels(bitmap);
      bitmap.close();
      const near = (at: number, rgb: readonly number[]) =>
        [0, 1, 2].every(
          (channel) =>
            Math.abs((data[at + channel] ?? 0) - (rgb[channel] ?? 0)) <= 8,
        );
      let inText = 0;
      let inGrey = 0;
      for (let at = 0; at < data.length; at += 4) {
        if (near(at, text)) inText++;
        else if (near(at, [126, 126, 126])) inGrey++;
      }
      const pixels = data.length / 4;
      return { text: inText / pixels, grey: inGrey / pixels };
    },
    shot,
    selector,
  );
}

describe("Symbols in notes", function () {
  before(async function () {
    await loadModules();
    const symbol = toBase64(blockSymbol());
    const photo = toBase64(blockSymbol());
    await browser.executeObsidian(
      async ({ app }, block, picture, text) => {
        const bytes = (b64: string) =>
          Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
        await app.vault.createFolder("Glyphs");
        await app.vault.createBinary("Glyphs/block.ink.png", bytes(block));
        await app.vault.createBinary("Glyphs/photo.png", bytes(picture));
        await app.vault.create("Render.md", text);
        await app.vault.create("Host.md", "Embedded:\n\n![[Render]]\n");
      },
      symbol,
      photo,
      note,
    );
  });

  for (const mode of ["source", "preview"] as const) {
    const name = mode === "source" ? "Live Preview" : "Reading view";

    it(`stand on the baseline, as tall as the line box, in ${name}`, async function () {
      await open("Render.md", mode);
      await waitForTagged(images(mode), 2);
      const [plain, sized, photo] = await shown(images(mode));
      await saveScreenshot(`render-${mode}`);
      if (plain === undefined || sized === undefined || photo === undefined) {
        throw new Error("missing images");
      }
      // 1.5 em tall, with the baseline 0.375 em above the bottom.
      expect(Math.abs(plain.height - 1.5 * plain.fontSize)).toBeLessThanOrEqual(
        1,
      );
      expect(Math.abs(plain.drop - 0.375 * plain.fontSize)).toBeLessThanOrEqual(
        1,
      );
      // An explicit width keeps the image's proportions and its baseline.
      expect(Math.abs(sized.width - 24)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(sized.height - 72)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(sized.drop - 18)).toBeLessThanOrEqual(1);
      // Other images stay as they are.
      expect(photo.tagged).toBe(false);
      expect(photo.height).toBeGreaterThan(100);
    });

    it(`take the text colour in light and dark themes, in ${name}`, async function () {
      await open("Render.md", mode);
      await waitForTagged(images(mode), 2);
      try {
        for (const theme of ["moonstone", "obsidian"]) {
          await browser.executeObsidian(({ app }, chosen) => {
            const change: unknown = Reflect.get(app, "changeTheme");
            if (typeof change !== "function") throw new Error("no themes");
            Reflect.apply(change, app, [chosen]);
          }, theme);
          await browser.pause(300);
          const { text, grey } = await colours(images(mode));
          // The block is 3/4 of the width and half the height: 3/8 of it.
          expect(text).toBeGreaterThan(0.3);
          expect(grey).toBeLessThan(0.02);
        }
      } finally {
        await browser.executeObsidian(({ app }) => {
          const change: unknown = Reflect.get(app, "changeTheme");
          if (typeof change === "function") {
            Reflect.apply(change, app, ["moonstone"]);
          }
        });
      }
    });
  }

  it("show in an embedded note and in a popout window", async function () {
    await open("Host.md", "preview");
    await waitForTagged(".workspace-leaf.mod-active .markdown-embed img", 2);
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Render.md");
      if (file === null) throw new Error("no Render.md");
      await app.workspace.openPopoutLeaf().openFile(file);
    });
    try {
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            activeDocument !== document &&
            activeDocument.querySelectorAll("img.inkline-symbol").length === 2,
        ),
      );
    } finally {
      await browser.executeObsidian(({ app }) => {
        for (const leaf of app.workspace.getLeavesOfType("markdown")) {
          if (leaf.view.containerEl.doc !== document) leaf.detach();
        }
      });
    }
  });

  it("follow an image's address as it changes", async function () {
    // Reading view, whose images stay as they are unless something changes
    // them, as Obsidian does when it shows a file anew.
    await open("Render.md", "preview");
    await waitForTagged(images("preview"), 2);
    /** The first image's address, and its mask and tag. */
    const first = (src?: string) =>
      browser.execute(
        (selector, address) => {
          const image = activeDocument.querySelector(selector);
          if (!image?.instanceOf(HTMLImageElement)) throw new Error("no image");
          if (address !== undefined) image.setAttribute("src", address);
          return {
            src: image.src,
            mask: image.style.getPropertyValue("--inkline-mask"),
            tagged: image.classList.contains("inkline-symbol"),
          };
        },
        images("preview"),
        src,
      );
    const symbol = await first();
    expect(symbol.mask).toBe(`url("${symbol.src}")`);
    // As a changed file's query changes its address.
    const changed = `${symbol.src}&changed`;
    await first(changed);
    await browser.waitUntil(
      async () => (await first()).mask === `url("${changed}")`,
    );
    // Another picture's address is not a symbol's.
    const photo = await browser.execute(
      (selector) =>
        activeDocument.querySelectorAll(selector)[2]?.getAttribute("src"),
      images("preview"),
    );
    if (photo === null || photo === undefined) throw new Error("no photo");
    await first(photo);
    await browser.waitUntil(async () => !(await first()).tagged);
    expect((await first()).mask).toBe("");
    await first(symbol.src);
    await browser.waitUntil(async () => (await first()).tagged);
  });

  it("show as plain images while Inkline is disabled", async function () {
    await open("Render.md", "source");
    await waitForTagged(images("source"), 2);
    await obsidianPage.disablePlugin("inkline");
    try {
      await waitForTagged(images("source"), 0);
      const masked = await browser.execute(
        (selector) =>
          Array.from(activeDocument.querySelectorAll(selector)).filter(
            (image) =>
              image.instanceOf(HTMLElement) &&
              image.style.getPropertyValue("--inkline-mask") !== "",
          ).length,
        images("source"),
      );
      expect(masked).toBe(0);
    } finally {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
    await waitForTagged(images("source"), 2);
  });

  it("tag a thousand symbols quickly", async function () {
    const timing = await browser.execute(async () => {
      const container = createDiv();
      for (let index = 0; index < 1000; index++) {
        // A symbol's URL, not loaded: tagging reads only the address.
        container.createEl("img", {
          attr: { src: `app://inkline-test/${String(index)}.ink.png`, alt: "" },
        });
      }
      const started = performance.now();
      activeDocument.body.append(container);
      // The observer runs before the next task.
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const ended = performance.now();
      const tagged = container.querySelectorAll("img.inkline-symbol").length;
      container.remove();
      return { ms: ended - started, tagged };
    });
    expect(timing.tagged).toBe(1000);
    // A budget with room for a slow machine: far below a frame per symbol.
    expect(timing.ms).toBeLessThan(200);
  });
});
