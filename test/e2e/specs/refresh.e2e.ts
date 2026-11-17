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
import { openCanvas, placeInCard } from "../support/canvas.ts";
import { doubleClick } from "../support/pointer.ts";
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

type Place = "popout" | "card";

/**
 * What a failure needs to know about `place`, the popout window's note or the
 * canvas card being edited: how many popout leaves or editing frames there
 * are; whether its document is the one `mark` marked, Inkline watches it,
 * which gives it its scale, and it has the focus; what {@link recordChanges}
 * saw as the symbol changed; and each symbol's image there, shown or hidden,
 * with its address, whether it is the one marked, and its load and tag. With
 * `mark`, it marks the document and images first, by a property and not an
 * attribute, which Obsidian would see change.
 */
async function placeState(place: Place, mark = false): Promise<string> {
  return browser.executeObsidian(
    ({ app }, where, marking) => {
      const leaves = app.workspace
        .getLeavesOfType("markdown")
        .filter((leaf) => leaf.view.containerEl.doc !== document);
      const frames = document.querySelectorAll(
        ".canvas-node.is-editing iframe",
      );
      const frame = frames.item(0);
      const doc =
        where === "card"
          ? frame instanceof HTMLIFrameElement
            ? frame.contentDocument
            : null
          : (leaves[0]?.view.containerEl.doc ?? null);
      const root =
        where === "card" ? doc : (leaves[0]?.view.containerEl ?? null);
      const count = where === "card" ? frames.length : leaves.length;
      if (doc === null || root === null) return JSON.stringify({ count });
      const images = Array.from(root.getElementsByTagName("img")).filter(
        (image) => image.getAttribute("src")?.includes(".ink.png") === true,
      );
      if (marking) {
        for (const marked of [doc, ...images]) {
          Reflect.set(marked, "inklineTestMarked", true);
        }
      }
      const atChange: unknown = Reflect.get(window, "inklineTestChanges");
      return JSON.stringify({
        count,
        sameDocument: Reflect.get(doc, "inklineTestMarked") === true,
        watched: doc.documentElement.style.getPropertyValue("--inkline-scale"),
        focused: doc.hasFocus(),
        atChange: atChange ?? null,
        images: images.map((image) => ({
          src: image.getAttribute("src"),
          same: Reflect.get(image, "inklineTestMarked") === true,
          tagged: image.classList.contains("inkline-symbol"),
          complete: image.complete,
          width: image.naturalWidth,
          shown: image.getBoundingClientRect().width,
          ratio: image.style.getPropertyValue("--inkline-ratio"),
        })),
      });
    },
    place,
    mark,
  );
}

/**
 * Records, for a failure's message, what each change to a file in the vault
 * finds in `place` once Inkline has refreshed it: whether Inkline watches the
 * document, and each symbol's image there, with its address and whether
 * {@link placeState} marked it. Inkline's own listener runs first, as it was
 * added first. Without `place`, it stops recording.
 */
async function recordChanges(place?: Place): Promise<void> {
  await browser.executeObsidian(({ app }, where) => {
    const previous: unknown = Reflect.get(window, "inklineTestRecorder");
    if (typeof previous === "object" && previous !== null) {
      app.vault.offref(previous);
    }
    Reflect.deleteProperty(window, "inklineTestRecorder");
    Reflect.deleteProperty(window, "inklineTestChanges");
    if (where === null) return;
    const changes: unknown[] = [];
    Reflect.set(window, "inklineTestChanges", changes);
    const recorder = app.vault.on("modify", (file) => {
      const frame = document.querySelector(".canvas-node.is-editing iframe");
      const view = app.workspace
        .getLeavesOfType("markdown")
        .find((leaf) => leaf.view.containerEl.doc !== document)
        ?.view.containerEl;
      // The frame's document is of the frame's own window, which the main
      // window's `Document` does not know, so it is found and not tested.
      const doc =
        where === "card"
          ? frame instanceof HTMLIFrameElement
            ? frame.contentDocument
            : null
          : (view?.doc ?? null);
      const root = where === "card" ? doc : (view ?? null);
      changes.push({
        file: file.path,
        watched:
          doc?.documentElement.style.getPropertyValue("--inkline-scale") ??
          null,
        images: Array.from(root?.getElementsByTagName("img") ?? []).flatMap(
          (image) =>
            image.getAttribute("src")?.includes(".ink.png") === true
              ? [
                  {
                    src: image.getAttribute("src"),
                    same: Reflect.get(image, "inklineTestMarked") === true,
                  },
                ]
              : [],
        ),
      });
    });
    Reflect.set(window, "inklineTestRecorder", recorder);
  }, place ?? null);
}

/**
 * Waits for `condition` as `browser.waitUntil` does, and if it times out,
 * fails with the message `say` makes then. A message given to waitUntil
 * itself is made before the wait starts, so it cannot tell what the wait
 * last saw (#281). If `say` fails too, the timeout is still what is reported.
 */
async function waitOrSay(
  condition: () => Promise<boolean>,
  say: () => Promise<string>,
): Promise<void> {
  try {
    await browser.waitUntil(condition);
  } catch (error) {
    const message = await say().catch(
      (failed: unknown) =>
        `the wait timed out, and its state was not read: ${String(failed)}`,
    );
    throw new Error(message, { cause: error });
  }
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
  // Whatever a test showed in a popout window goes with it, passed or not.
  afterEach(async function () {
    await recordChanges();
    await closePopouts();
  });
  // In the text colour only. Showing the stored colour is a class on the
  // root, which changes only styles.css's paint, not the image's box, and
  // refreshing does the same either way; these tests read the images'
  // addresses, sizes, and masks, which the colour does not change.
  for (const mode of ["source", "preview"] as const) {
    it(`updates existing ${mode} instances in text colour`, async function () {
      await browser.executeObsidian(async ({ app }, viewMode) => {
        const file = app.vault.getFileByPath("Refresh.md");
        if (file === null) throw new Error("no note");
        await app.workspace
          .getLeaf(false)
          .openFile(file, { state: { mode: viewMode, source: false } });
      }, mode);
      await browser.waitUntil(async () => (await visibleImages()).length === 3);
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
      await saveScreenshot(`refresh-${mode}-text`);
    });
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
      // Marked, so that a failure can tell whether these are still the
      // window and the images that were there before the change (#281).
      const measured = await placeState("popout", true);
      await recordChanges("popout");
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
      await waitOrSay(
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
        async () =>
          `the popout's symbols did not follow their new shape, ${String(saved.width)} wide: ${JSON.stringify(shown)}; the popout before the change: ${measured}; and now: ${await placeState("popout")}`,
      );
      const after = await images();
      expect(after[0]?.src).not.toBe(before[0]?.src);
      expect(after[1]?.src).not.toBe(before[1]?.src);
      expect(after[2]).toEqual(before[2]);
      for (const image of after.slice(0, 2))
        expect(image.mask).toContain(image.src);
      before = after;
    }
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
    let shown: Measured[] = [];
    await waitOrSay(
      async () => {
        shown = await measuredIn("popout");
        return shown.length === 3 && shown.every(follows);
      },
      async () =>
        `the popout's symbols were not measured: ${JSON.stringify(shown)}; the popout now: ${await placeState("popout")}`,
    );
    expect(shown.map((image) => image.asked)).toEqual(["24px", "1000px", ""]);
  });

  it("keeps the symbols of a canvas card's own editor measured as one changes shape", async function () {
    await browser.executeObsidian(async ({ app }, path) => {
      await app.vault.create(
        "Card.canvas",
        JSON.stringify({
          nodes: [
            {
              id: "card",
              type: "text",
              text: `Card ![[${path}]] and ![[${path}|24]] here.\n\nPlain words to open.`,
              x: 0,
              y: 0,
              width: 420,
              height: 200,
            },
          ],
          edges: [],
        }),
      );
    }, edited);
    await openCanvas("Card.canvas");
    // A double-click on its words opens the card's own editor, a document in
    // a frame, which Inkline watches once it takes the focus. On a symbol, it
    // would open the symbol instead.
    await doubleClick(await placeInCard("Plain words", "p"));
    await browser.$(".canvas-node.is-editing iframe").waitForExist();
    let shown: Measured[] = [];
    await waitOrSay(
      async () => {
        shown = await measuredIn("card");
        return shown.length === 2 && shown.every(follows);
      },
      async () =>
        `the card's editor's symbols were not measured: ${JSON.stringify(shown)}; the frame now: ${await placeState("card")}`,
    );
    const before = shown[0]?.width;
    // Marked, so that a failure can tell whether these are still the frame
    // and the images that were measured (#281).
    const measured = await placeState("card", true);
    await recordChanges("card");
    const width = await reshape(edited, 6000);
    expect(width).not.toBe(before);
    await waitOrSay(
      async () => {
        shown = await measuredIn("card");
        return (
          shown.length === 2 &&
          shown.every((image) => image.width === width) &&
          shown.every(follows)
        );
      },
      async () =>
        `the card's editor's symbols did not follow their new shape: ${JSON.stringify(shown)}; the frame when measured: ${measured}; and now: ${await placeState("card")}`,
    );
    await saveScreenshot("refresh-card-editor");
  });
});
