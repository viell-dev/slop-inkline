import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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

/**
 * The same symbol in the places where the editor shows rendered text: a
 * callout, a table, and an embedded note. The first line holds the cursor,
 * so that the editor shows the rest rendered.
 */
const contexts = [
  "Top line.",
  "",
  "> [!note] Callout",
  "> In a callout ![[Glyphs/block.ink.png]] here.",
  "",
  "| Cell |",
  "| --- |",
  "| In a table ![[Glyphs/block.ink.png]] here. |",
  "",
  "![[Render]]",
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
      // The leaf the tests look in, whatever was active before.
      app.workspace.setActiveLeaf(leaf, { focus: true });
    },
    path,
    mode,
  );
}

/**
 * The selector of the visible view's symbols and other images, without the
 * empty images CodeMirror puts beside its widgets.
 */
function images(mode: "source" | "preview"): string {
  return mode === "source"
    ? ".workspace-leaf.mod-active .markdown-source-view img:not(.cm-widgetBuffer)"
    : ".workspace-leaf.mod-active .markdown-reading-view img";
}

interface Shown {
  tagged: boolean;
  /** Whether it has a size of its own, as `|24` gives. */
  sized: boolean;
  /** The image's height and width, and how far its bottom is below the baseline. */
  height: number;
  width: number;
  drop: number;
  fontSize: number;
}

/**
 * How the images in `selector` show: whether each is tagged, its size, and
 * how far its bottom lies below its line's baseline, measured with an empty
 * inline block on the baseline next to its embed, which is in the line
 * itself, as the image is not in Live Preview.
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
      (node.closest(".image-embed") ?? node).after(probe);
      const baseline = probe.getBoundingClientRect().bottom;
      probe.remove();
      const rect = node.getBoundingClientRect();
      return {
        tagged: node.classList.contains("inkline-symbol"),
        sized: node.hasAttribute("width") || node.hasAttribute("height"),
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
  /** Serves a symbol from outside the vault, with no CORS headers. */
  let server: Server | undefined;
  let remote = "";

  before(async function () {
    const png = blockSymbol();
    const started = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(png);
    });
    server = started;
    await new Promise<void>((resolve) => {
      started.listen(0, "127.0.0.1", resolve);
    });
    const address: string | AddressInfo | null = started.address();
    if (address === null || typeof address === "string") {
      throw new Error("the server has no port");
    }
    const { port } = address;
    remote = `http://127.0.0.1:${String(port)}/remote.ink.png`;
    await loadModules();
    const symbol = toBase64(blockSymbol());
    const photo = toBase64(blockSymbol());
    await browser.executeObsidian(
      async ({ app }, block, picture, text, around, address) => {
        const bytes = (b64: string) =>
          Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
        await app.vault.createFolder("Glyphs");
        await app.vault.createBinary("Glyphs/block.ink.png", bytes(block));
        await app.vault.createBinary("Glyphs/photo.png", bytes(picture));
        await app.vault.create("Render.md", text);
        await app.vault.create("Host.md", "Embedded:\n\n![[Render]]\n");
        await app.vault.create("Linked.md", "A link to [[Render]] here.\n");
        await app.vault.create("Contexts.md", around);
        await app.vault.create("Remote.md", `Remote ![](${address}) here.\n`);
        await app.vault.create(
          "Board.canvas",
          JSON.stringify({
            nodes: [
              {
                id: "render",
                type: "file",
                file: "Render.md",
                x: 0,
                y: 0,
                width: 640,
                height: 480,
              },
              {
                id: "picture",
                type: "file",
                file: "Glyphs/block.ink.png",
                x: 700,
                y: 0,
                width: 200,
                height: 400,
              },
            ],
            edges: [],
          }),
        );
      },
      symbol,
      photo,
      note,
      contexts,
      remote,
    );
  });

  after(function () {
    server?.close();
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
      // As wide as its picture at that height: 64 × 192 is a third.
      expect(Math.abs(plain.width - 0.5 * plain.fontSize)).toBeLessThanOrEqual(
        0.5,
      );
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
          await saveScreenshot(`render-colour-${mode}-${theme}`);
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

  it("show in a hover preview", async function () {
    await open("Linked.md", "preview");
    await browser
      .$(".workspace-leaf.mod-active .markdown-reading-view a.internal-link")
      .moveTo();
    try {
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            activeDocument.querySelectorAll(".hover-popover img.inkline-symbol")
              .length === 2,
        ),
      );
    } finally {
      // Away from the link and the preview, to the window's corner, so that
      // the preview closes before the next test.
      await browser
        .action("pointer", { parameters: { pointerType: "mouse" } })
        .move({ x: 2, y: 2 })
        .perform();
      await browser.$(".hover-popover").waitForExist({ reverse: true });
    }
  });

  it("stand on the baseline in Live Preview callouts, tables, and embeds", async function () {
    await open("Contexts.md", "source");
    // One each in the callout and the table, and two in the embedded note.
    await waitForTagged(images("source"), 4);
    const all = await shown(images("source"));
    for (const image of all.filter((each) => each.tagged)) {
      // A quarter of its height below the baseline, however tall it is.
      expect(Math.abs(image.drop - image.height / 4)).toBeLessThanOrEqual(1);
      if (!image.sized) {
        expect(
          Math.abs(image.height - 1.5 * image.fontSize),
        ).toBeLessThanOrEqual(1);
      }
    }
    await saveScreenshot("render-contexts");
  });

  it("stay pictures where a symbol file is shown on its own", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Glyphs/block.ink.png");
      if (file === null) throw new Error("no symbol");
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      app.workspace.setActiveLeaf(leaf, { focus: true });
    });
    const own = ".workspace-leaf.mod-active .image-container img";
    await browser.$(own).waitForExist();
    const [picture] = await shown(own);
    expect(picture?.tagged).toBe(false);
    expect(picture?.height).toBe(192);
  });

  it("leave a symbol from outside the vault as the image it is", async function () {
    await open("Remote.md", "preview");
    const selector = `${images("preview")}[src="${remote}"]`;
    await browser.waitUntil(async () =>
      browser.execute((wanted) => {
        const image = activeDocument.querySelector(wanted);
        return image?.instanceOf(HTMLImageElement) === true && image.complete;
      }, selector),
    );
    const [picture] = await shown(selector);
    expect(picture?.tagged).toBe(false);
    // Loaded, at its own size, where a mask could have hidden it.
    expect(picture?.height).toBe(192);
  });

  it("show in a canvas card", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Board.canvas");
      if (file === null) throw new Error("no canvas");
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      app.workspace.setActiveLeaf(leaf, { focus: true });
    });
    await browser.waitUntil(async () =>
      browser.execute(
        () =>
          activeDocument.querySelectorAll(".canvas-node img.inkline-symbol")
            .length === 2,
      ),
    );
    // The image node of the symbol file itself is a picture there, once it
    // has loaded.
    const node = async () =>
      browser.execute(() =>
        Array.from(
          activeDocument.querySelectorAll(
            ".canvas-node-content.media-embed img",
          ),
        )
          .filter(
            (image) => image.instanceOf(HTMLImageElement) && image.complete,
          )
          .map((image) => image.classList.contains("inkline-symbol")),
      );
    await browser.waitUntil(async () => (await node()).length === 1);
    expect(await node()).toEqual([false]);
    await saveScreenshot("render-canvas");
  });

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
          // WebDriver hands an undefined argument over as null.
          if (typeof address === "string") image.setAttribute("src", address);
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
      // Nor do they keep the names Inkline gave them.
      const named = await browser.execute(
        (selector) =>
          Array.from(activeDocument.querySelectorAll(selector)).filter(
            (image) =>
              image.hasAttribute("aria-label") ||
              image.hasAttribute("data-inkline-name") ||
              image.hasAttribute("data-tooltip-position"),
          ).length,
        images("source"),
      );
      expect(named).toBe(0);
    } finally {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
    await waitForTagged(images("source"), 2);
  });

  it("show their names on hover, and follow a rename", async function () {
    // A symbol four line boxes wide, which Obsidian would give its buttons.
    const width = 768;
    const height = 192;
    const data = new Uint8Array(width * height * 4);
    for (let y = 48; y < 144; y++) {
      for (let x = 8; x < width - 8; x++) {
        data.set([126, 126, 126, 255], (y * width + x) * 4);
      }
    }
    await browser.executeObsidian(
      async ({ app }, block, wide) => {
        const bytes = (b64: string) =>
          Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
        await app.vault.createBinary("Glyphs/tower one.ink.png", bytes(block));
        await app.vault.createBinary("Glyphs/wide.ink.png", bytes(wide));
        await app.vault.create(
          "Names.md",
          [
            "Wiki ![[tower one.ink.png]] and ![](Glyphs/tower%20one.ink.png) and ![[Glyphs/photo.png]].",
            "",
            "Described ![[tower one.ink.png|a tall tower]] and ![the gate](Glyphs/tower%20one.ink.png), sized ![[tower one.ink.png|24]].",
            "",
            "A heading's ![[tower one.ink.png#top]] too.",
            "",
          ].join("\n"),
        );
        await app.vault.create(
          "Wide.md",
          "Top line.\n\nWide ![[wide.ink.png]] here.\n",
        );
      },
      toBase64(blockSymbol()),
      toBase64(encodePng({ width, height, data })),
    );
    /** What the visible view's images are named, and where it shows, in order. */
    const names = async (mode: "source" | "preview") =>
      browser.execute(
        (selector) =>
          Array.from(activeDocument.querySelectorAll(selector)).map((image) =>
            image.hasAttribute("aria-label")
              ? `${image.getAttribute("aria-label") ?? ""} (${image.getAttribute("data-tooltip-position") ?? "below"})`
              : null,
          ),
        images(mode),
      );
    /** Waits for the visible view's images to be named `wanted`. */
    const waitForNames = async (
      mode: "source" | "preview",
      wanted: (string | null)[],
    ) => {
      const expected = wanted.map((name) =>
        name === null ? null : `${name} (top)`,
      );
      let last: (string | null)[] = [];
      try {
        await browser.waitUntil(async () => {
          last = await names(mode);
          return JSON.stringify(last) === JSON.stringify(expected);
        });
      } catch (error) {
        throw new Error(
          `wanted the names ${JSON.stringify(expected)}, but saw ${JSON.stringify(last)}`,
          { cause: error },
        );
      }
    };
    /** Hovers the view's image at `index` and waits for its tooltip. */
    const hover = async (
      mode: "source" | "preview",
      index: number,
      name: string,
    ) => {
      // Obsidian shows a tooltip when the pointer comes to the element.
      await browser.$(".workspace-leaf.mod-active .view-header-title").moveTo();
      await browser.pause(300);
      await browser.$$(images(mode))[index]?.moveTo();
      let shown = "";
      try {
        await browser.waitUntil(async () => {
          shown = await browser.execute(
            () => document.querySelector(".tooltip")?.textContent ?? "",
          );
          return shown === name;
        });
      } catch (error) {
        throw new Error(`wanted the tooltip "${name}", but saw "${shown}"`, {
          cause: error,
        });
      }
    };
    const named = [
      "tower one",
      "tower one",
      null,
      // What the embed's author wrote for it, rather than the file's name.
      "a tall tower",
      "the gate",
      "tower one",
      // Obsidian's own text for a link to a heading, not the author's.
      "tower one",
    ];
    for (const mode of ["preview", "source"] as const) {
      await open("Names.md", mode);
      await waitForNames(mode, named);
      await hover(mode, 0, "tower one");
    }
    // In Live Preview, the pointer is on each symbol, not on a resize handle
    // or the buttons Obsidian gives a wide image, which the photo keeps (#37).
    // Horizontal splits make some symbols start offscreen, as in a small window.
    // Hit testing a point outside the viewport cannot establish an overlay.
    const splitForHitTest = () =>
      browser.executeObsidian(async ({ app, obsidian }) => {
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        if (view === null) throw new Error("no split fixture");
        for (const path of ["Wide.md", "Render.md"]) {
          const other = app.vault.getFileByPath(path);
          if (other === null) throw new Error(`no ${path}`);
          await app.workspace
            .createLeafBySplit(view.leaf, "horizontal")
            .openFile(other);
        }
        app.workspace.setActiveLeaf(view.leaf, { focus: true });
      });
    const lastStartsBelow = () =>
      browser.execute((selector) => {
        const pane = activeDocument.querySelector<HTMLElement>(
          ".workspace-leaf.mod-active .cm-scroller",
        );
        if (pane === null) throw new Error("no scrolling editor");
        pane.scrollTop = 0;
        const last = Array.from(activeDocument.querySelectorAll(selector)).at(
          -1,
        );
        if (last === undefined) throw new Error("no last symbol");
        const box = last.getBoundingClientRect();
        return box.top + box.height / 2 > pane.getBoundingClientRect().bottom;
      }, images("source"));
    const covers: { handle: boolean | null; reached: boolean }[] = [];
    try {
      await splitForHitTest();
      await browser.waitUntil(lastStartsBelow, {
        timeoutMsg:
          "the split pane did not put the last symbol below its viewport",
      });
      for (let index = 0; index < named.length; index++) {
        const cover = await browser.execute(
          (selector, wanted) => {
            const image = activeDocument.querySelectorAll(selector)[wanted];
            if (image === undefined)
              throw new Error("no image after scrolling");
            image.scrollIntoView({ block: "center" });
            const handle = image
              .closest(".image-embed")
              ?.querySelector(".image-resize-corner");
            const box = image.getBoundingClientRect();
            const under = activeDocument.elementFromPoint(
              box.left + box.width / 2,
              box.top + box.height / 2,
            );
            return {
              handle:
                handle?.instanceOf(HTMLElement) === true
                  ? getComputedStyle(handle).display !== "none"
                  : null,
              reached: under === image,
            };
          },
          images("source"),
          index,
        );
        covers.push(cover);
      }
    } finally {
      await browser.executeObsidian(({ app, obsidian }) => {
        for (const leaf of app.workspace.getLeavesOfType("markdown")) {
          if (
            leaf.view instanceof obsidian.MarkdownView &&
            ["Wide.md", "Render.md"].includes(leaf.view.file?.path ?? "")
          )
            leaf.detach();
        }
      });
    }
    expect(covers.map((cover) => cover.handle)).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(
      covers.filter((_, index) => index !== 2).map((cover) => cover.reached),
    ).toEqual([true, true, true, true, true, true]);
    // Live Preview changes an image's alt text in place as its alias is
    // edited, and the name follows.
    await browser.executeObsidian(({ app, obsidian }) => {
      const editor = app.workspace.getActiveViewOfType(
        obsidian.MarkdownView,
      )?.editor;
      if (editor === undefined) throw new Error("no editor");
      const at = editor.getValue().indexOf("a tall tower");
      editor.replaceRange(
        "a short tower",
        editor.offsetToPos(at),
        editor.offsetToPos(at + "a tall tower".length),
      );
    });
    await waitForNames("source", [
      "tower one",
      "tower one",
      null,
      "a short tower",
      "the gate",
      "tower one",
      "tower one",
    ]);
    // Nor on the buttons Obsidian gives an image 80 pixels or wider, which
    // it shows on a symbol that wide opened straight in Live Preview.
    await open("Wide.md", "source");
    await waitForNames("source", ["wide"]);
    const reached = await browser.execute((selector) => {
      const image = activeDocument.querySelector(selector);
      const box = image?.getBoundingClientRect();
      return box === undefined
        ? false
        : activeDocument.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          ) === image;
    }, images("source"));
    expect(reached).toBe(true);
    await hover("source", 0, "wide");
    await saveScreenshot("render-names");
    // Renamed, the symbol's embeds follow, and so does its name. Obsidian
    // would first ask whether to update the links, which its setting, not in
    // its API, says to do without asking.
    await browser.executeObsidian(async ({ app }) => {
      const vault: object = app.vault;
      const configurable = (
        candidate: object,
      ): candidate is {
        getConfig(key: string): unknown;
        setConfig(key: string, value: unknown): void;
      } =>
        "getConfig" in candidate &&
        typeof candidate.getConfig === "function" &&
        "setConfig" in candidate &&
        typeof candidate.setConfig === "function";
      if (!configurable(vault)) throw new Error("Obsidian has no setConfig");
      const before = vault.getConfig("alwaysUpdateLinks");
      vault.setConfig("alwaysUpdateLinks", true);
      try {
        const file = app.vault.getFileByPath("Glyphs/tower one.ink.png");
        if (file === null) throw new Error("no tower one");
        await app.fileManager.renameFile(file, "Glyphs/tower two.ink.png");
      } finally {
        vault.setConfig("alwaysUpdateLinks", before);
      }
    });
    await open("Names.md", "source");
    await waitForNames("source", [
      "tower two",
      "tower two",
      null,
      "a short tower",
      "the gate",
      "tower two",
      "tower two",
    ]);
  });

  it("tag a thousand symbols quickly, however they are added", async function () {
    const result = await browser.executeObsidian(async ({ obsidian }) => {
      const vault = obsidian.Platform.resourcePathPrefix;
      // A thousand symbols in rendered text, by their addresses in the vault,
      // not loaded: tagging reads only the address.
      const symbols = () => {
        const container = createDiv({ cls: "markdown-rendered" });
        for (let index = 0; index < 1000; index++) {
          container.createEl("img", {
            attr: { src: `${vault}Glyphs/${String(index)}.ink.png`, alt: "" },
          });
        }
        return container;
      };
      // The observer's own work, apart from the page drawing the images:
      // the fastest of five runs, each on images of its own. Slow tagging
      // shows in every run, while other work beside the test, such as the
      // other Obsidian version's tests, slows only some.
      const runs: number[] = [];
      const tagged: number[] = [];
      for (let run = 0; run < 5; run++) {
        const apart = symbols();
        const started = performance.now();
        window.inklineTest.renderSymbols.tagWithin(apart, vault);
        runs.push(performance.now() - started);
        tagged.push(apart.querySelectorAll("img.inkline-symbol").length);
      }
      // And a thousand added at once, which the observer finds.
      const added = symbols();
      activeDocument.body.append(added);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      const found = added.querySelectorAll("img.inkline-symbol").length;
      added.remove();
      return { runs, tagged, found };
    });
    console.log(
      `Tagging 1,000 symbols, five runs: ${result.runs.map((ms) => ms.toFixed(1)).join(", ")} ms`,
    );
    // Every run tags them all: nothing is remembered from one to the next.
    expect(result.tagged).toEqual([1000, 1000, 1000, 1000, 1000]);
    expect(result.found).toBe(1000);
    // A budget with room for a slow machine, a few frames for a thousand,
    // for the fastest run, which is warmed up. Beside the other version's
    // tests in Docker on Windows 11, it took 16 ms in Obsidian 1.14.4 and
    // 21 ms in 1.13.4. It guards against tagging that grows faster than the
    // number of images, which took 300 ms and more, not against a constant
    // slowdown of two or three times.
    expect(Math.min(...result.runs)).toBeLessThan(50);
  });
});
