import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  clickTop,
  createSymbol,
  draw,
  noteText,
  startOver,
  surface,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const edited = "Glyphs/sign % one.ink.png";
const untouched = "Glyphs/sign-other.ink.png";
const text = `Top line.\n\nFirst ![[${edited}]] and second ![[${edited}|24]].\n\nOther ![[${untouched}]].\n`;

/** Reads loaded image geometry and the resource used by its CSS mask. */
async function visibleImages(): Promise<
  { src: string; mask: string; width: number; naturalWidth: number }[]
> {
  return browser.execute(async () => {
    const result = [];
    for (const image of document.querySelectorAll("img.inkline-symbol")) {
      if (!image.instanceOf(HTMLImageElement)) continue;
      // Reading view can retain a hidden source view of the same note.
      if (image.getBoundingClientRect().width === 0) continue;
      await image.decode();
      result.push({
        src: image.src,
        mask: image.style.getPropertyValue("--inkline-mask"),
        width: image.getBoundingClientRect().width,
        naturalWidth: image.naturalWidth,
      });
    }
    return result;
  });
}

/**
 * What the renderer gave a symbol's image for its size: its width over its
 * height, its drop, and the width a size of only a width asks for, with the
 * image's own size and the size its embed asks for.
 */
interface Measured {
  src: string;
  width: number;
  height: number;
  /** The `width` attribute, as `|24` gives, and the `height` one. */
  sized: string | null;
  tall: string | null;
  ratio: string;
  drop: string;
  asked: string;
}

/**
 * The loaded, shown images of symbols in a popout window's note, or in the
 * editor of the canvas card being edited, with what the renderer gave them.
 */
async function measuredIn(place: "popout" | "card"): Promise<Measured[]> {
  return browser.executeObsidian(({ app }, where) => {
    const root =
      where === "card"
        ? document.querySelector<HTMLIFrameElement>(
            ".canvas-node.is-editing iframe",
          )?.contentDocument
        : app.workspace
            .getLeavesOfType("markdown")
            .find((leaf) => leaf.view.containerEl.doc !== document)?.view
            .containerEl;
    if (root === null || root === undefined) return [];
    return Array.from(root.querySelectorAll("img.inkline-symbol")).flatMap(
      (image) => {
        if (
          !image.instanceOf(HTMLImageElement) ||
          !image.complete ||
          image.naturalWidth === 0 ||
          image.getBoundingClientRect().width === 0
        )
          return [];
        return [
          {
            src: image.src,
            width: image.naturalWidth,
            height: image.naturalHeight,
            sized: image.getAttribute("width"),
            tall: image.getAttribute("height"),
            ratio: image.style.getPropertyValue("--inkline-ratio"),
            drop: image.style.getPropertyValue("--inkline-drop"),
            asked: image.style.getPropertyValue("--inkline-width"),
          },
        ];
      },
    );
  }, place);
}

/**
 * Whether what the renderer gave `image` follows its own size: its width
 * over its height, and with a size of only a width, the drop and the width
 * that size gives at that shape.
 */
function follows(image: Measured): boolean {
  const ratio = Number.parseFloat(image.ratio);
  if (!(Math.abs(ratio - image.width / image.height) < 1e-9)) return false;
  if (image.sized === null || image.tall !== null) return image.asked === "";
  const shown = (Number(image.sized) * image.height) / image.width;
  return (
    Math.abs(Number.parseFloat(image.drop) + shown / 4) < 1e-6 &&
    image.asked === `${image.sized}px`
  );
}

/** Saves `path` reshaped: one stroke from x 0 to `end`, in units. */
async function reshape(path: string, end: number): Promise<number> {
  return browser.executeObsidian(
    async ({ app }, file, x) => {
      const found = app.vault.getFileByPath(file);
      if (found === null) throw new Error("no symbol");
      const { bytes, width } = await window.inklineTest.canvas.saveInk(
        {
          strokes: [{ tool: "pen", size: 256, points: [0, 1000, x, 1000] }],
        },
        undefined,
        [],
      );
      await app.vault.modifyBinary(found, bytes.slice().buffer);
      return width;
    },
    path,
    end,
  );
}

/** Detaches every leaf in a popout window. */
async function closePopouts(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view.containerEl.doc !== document) leaf.detach();
    }
  });
}

/** The actual saved width, decoded from bytes rather than a cached URL. */
async function savedWidth(symbol = edited): Promise<number> {
  return browser.executeObsidian(async ({ app }, path) => {
    const file = app.vault.getFileByPath(path);
    if (file === null) throw new Error("no symbol");
    const bitmap = await createImageBitmap(
      new Blob([await app.vault.readBinary(file)]),
    );
    const width = bitmap.width;
    bitmap.close();
    return width;
  }, symbol);
}

describe("Saved symbol refresh", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
    await createSymbol(edited, [0]);
    await createSymbol(untouched, [0]);
    await browser.executeObsidian(async ({ app }, contents) => {
      await app.vault.create("Refresh.md", contents);
    }, text);
  });
  after(async function () {
    await startOver();
  });

  for (const mode of ["source", "preview"] as const) {
    for (const stored of [false, true]) {
      it(`updates existing ${mode} instances in ${stored ? "stored" : "text"} colour`, async function () {
        await browser.executeObsidian(
          async ({ app }, viewMode, grey) => {
            const file = app.vault.getFileByPath("Refresh.md");
            if (file === null) throw new Error("no note");
            await app.workspace
              .getLeaf(false)
              .openFile(file, { state: { mode: viewMode, source: false } });
            document.documentElement.toggleClass("inkline-stored-color", grey);
          },
          mode,
          stored,
        );
        await browser.waitUntil(
          async () => (await visibleImages()).length === 3,
        );
        const before = await visibleImages();
        const first = before[0];
        if (first === undefined) throw new Error("no first symbol");
        await browser.executeObsidian(async ({ app, plugins }, path) => {
          const file = app.vault.getFileByPath(path);
          if (file === null) throw new Error("no symbol");
          await plugins.inkline.editSymbol(file);
        }, edited);
        await waitForEditor();
        await browser.$('[data-inkline-button="clear"]').click();
        await draw([
          [0.3, 0.4],
          [0.7, 0.4],
        ]);
        await browser.keys(["Control", "Enter"]);
        // The note uses it twice, so saving asks whether to change both.
        await clickTop("Replace");
        await surface().waitForExist({ reverse: true });
        const expected = await savedWidth();
        expect(expected).not.toBe(first.naturalWidth);
        await browser.waitUntil(
          async () => {
            const current = await visibleImages();
            return (
              current[0]?.naturalWidth === expected &&
              current[1]?.naturalWidth === expected
            );
          },
          {
            timeout: 5000,
            timeoutMsg:
              "existing instances retained the old image width after saving",
          },
        );
        const after = await visibleImages();
        expect(after[2]).toEqual(before[2]);
        expect(after[1]?.width).toBeCloseTo(24, 0);
        for (const instance of after.slice(0, 2)) {
          expect(instance.mask).toContain(instance.src);
        }
        expect(await noteText()).toBe(text);
        await saveScreenshot(`refresh-${mode}-${stored ? "stored" : "text"}`);
      });
    }
  }

  it("refreshes a symbol with a Unicode filename", async function () {
    const unicode = "Glyphs/塔 λ.ink.png";
    const replacement = "Glyphs/wide.ink.png";
    const contents = `A Unicode symbol ![[${unicode}]].\n`;
    await createSymbol(unicode, [0]);
    await createSymbol(replacement, [0, 4000]);
    await browser.executeObsidian(async ({ app }, value) => {
      const file = await app.vault.create("Unicode.md", value);
      await app.workspace
        .getLeaf(false)
        .openFile(file, { state: { mode: "preview" } });
    }, contents);
    await browser.waitUntil(async () => (await visibleImages()).length === 1);
    const before = (await visibleImages())[0];
    if (before === undefined) throw new Error("no Unicode symbol");
    const expected = await savedWidth(replacement);
    expect(expected).not.toBe(before.naturalWidth);
    await browser.executeObsidian(
      async ({ app }, target, source) => {
        const file = app.vault.getFileByPath(target);
        const other = app.vault.getFileByPath(source);
        if (file === null || other === null) throw new Error("no symbol");
        await app.vault.modifyBinary(file, await app.vault.readBinary(other));
      },
      unicode,
      replacement,
    );
    await browser.waitUntil(
      async () => (await visibleImages())[0]?.naturalWidth === expected,
    );
    const after = (await visibleImages())[0];
    if (after === undefined) throw new Error("Unicode symbol disappeared");
    expect(after.src).not.toBe(before.src);
    expect(after.mask).toContain(after.src);
    expect(await noteText()).toBe(contents);
  });

  it("refreshes a popout after changes outside the editor even when timestamps repeat", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Refresh.md");
      if (file === null) throw new Error("no note");
      await app.workspace
        .openPopoutLeaf()
        .openFile(file, { state: { mode: "preview" } });
    });
    const images = () =>
      browser.executeObsidian(({ app }) => {
        const leaf = app.workspace
          .getLeavesOfType("markdown")
          .find((item) => item.view.containerEl.doc !== document);
        if (leaf === undefined) return [];
        return Array.from(
          leaf.view.containerEl.querySelectorAll("img.inkline-symbol"),
        ).flatMap((image) => {
          if (
            !image.instanceOf(HTMLImageElement) ||
            !image.complete ||
            image.getBoundingClientRect().width === 0
          )
            return [];
          return [
            {
              src: image.src,
              width: image.naturalWidth,
              mask: image.style.getPropertyValue("--inkline-mask"),
            },
          ];
        });
      });
    await browser.waitUntil(async () => (await images()).length === 3);
    let before = await images();
    for (const end of [4000, 6000]) {
      const saved = await browser.executeObsidian(
        async ({ app }, path, x) => {
          const file = app.vault.getFileByPath(path);
          if (file === null) throw new Error("no symbol");
          const mtime = file.stat.mtime;
          const { bytes, width } = await window.inklineTest.canvas.saveInk(
            {
              strokes: [
                {
                  tool: "pen",
                  size: 256,
                  points: [0, 1000, x, 1000],
                },
              ],
            },
            undefined,
            [],
          );
          await app.vault.modifyBinary(file, bytes.slice().buffer, { mtime });
          return {
            width,
            sameTime: file.stat.mtime === mtime,
          };
        },
        edited,
        end,
      );
      expect(saved.sameTime).toBe(true);
      // What the renderer gave them follows the new shape too: the image's
      // width over its height, and the |24's drop.
      let shown: Measured[] = [];
      await browser.waitUntil(
        async () => {
          const current = await images();
          shown = await measuredIn("popout");
          return (
            current[0]?.width === saved.width &&
            current[1]?.width === saved.width &&
            shown.length === 3 &&
            shown.every(follows)
          );
        },
        {
          timeoutMsg: `the popout's symbols did not follow their new shape: ${JSON.stringify(shown)}`,
        },
      );
      const after = await images();
      expect(after[0]?.src).not.toBe(before[0]?.src);
      expect(after[1]?.src).not.toBe(before[1]?.src);
      expect(after[2]).toEqual(before[2]);
      for (const image of after.slice(0, 2))
        expect(image.mask).toContain(image.src);
      before = after;
    }
    await closePopouts();
  });

  it("measures symbols with sizes in a note first shown in a popout", async function () {
    // A symbol and a note that no window has shown, so that the popout's
    // images load after they are tagged.
    await createSymbol("Glyphs/fresh.ink.png", [0, 800]);
    await browser.executeObsidian(async ({ app }) => {
      const file = await app.vault.create(
        "Fresh.md",
        "Fresh ![[Glyphs/fresh.ink.png|24]], ![[Glyphs/fresh.ink.png|1000]] and ![[Glyphs/fresh.ink.png]].\n",
      );
      await app.workspace
        .openPopoutLeaf()
        .openFile(file, { state: { mode: "preview" } });
    });
    try {
      let shown: Measured[] = [];
      await browser.waitUntil(
        async () => {
          shown = await measuredIn("popout");
          return shown.length === 3 && shown.every(follows);
        },
        {
          timeoutMsg: `the popout's symbols were not measured: ${JSON.stringify(shown)}`,
        },
      );
      expect(shown.map((image) => image.asked)).toEqual(["24px", "1000px", ""]);
    } finally {
      await closePopouts();
    }
  });

  it("keeps the symbols of a canvas card's own editor measured as one changes shape", async function () {
    await browser.executeObsidian(async ({ app }, path) => {
      const file = await app.vault.create(
        "Card.canvas",
        JSON.stringify({
          nodes: [
            {
              id: "card",
              type: "text",
              text: `Card ![[${path}]] and ![[${path}|24]] here.`,
              x: 0,
              y: 0,
              width: 420,
              height: 200,
            },
          ],
          edges: [],
        }),
      );
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file);
      app.workspace.setActiveLeaf(leaf, { focus: true });
    }, edited);
    const card = browser.$(".canvas-node .canvas-node-content");
    await card.waitForDisplayed();
    // A double-click opens the card's own editor, a document in a frame,
    // which Inkline watches once it takes the focus.
    await card.doubleClick();
    await browser.$(".canvas-node.is-editing iframe").waitForExist();
    let shown: Measured[] = [];
    await browser.waitUntil(
      async () => {
        shown = await measuredIn("card");
        return shown.length === 2 && shown.every(follows);
      },
      {
        timeoutMsg: `the card's editor's symbols were not measured: ${JSON.stringify(shown)}`,
      },
    );
    const before = shown[0]?.width;
    const width = await reshape(edited, 6000);
    expect(width).not.toBe(before);
    await browser.waitUntil(
      async () => {
        shown = await measuredIn("card");
        return (
          shown.length === 2 &&
          shown.every((image) => image.width === width) &&
          shown.every(follows)
        );
      },
      {
        timeoutMsg: `the card's editor's symbols did not follow their new shape: ${JSON.stringify(shown)}`,
      },
    );
    await saveScreenshot("refresh-card-editor");
  });
});
