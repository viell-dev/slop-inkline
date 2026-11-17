import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  inklineOn,
  insert,
  pressed,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  draw,
  editorGrid,
  markEditor,
  recordOf,
  settledSurface,
  storedDrafts,
  undoStubs,
  waitForEditor,
  waitForNext,
  startOver,
  surface,
  symbolFiles,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import {
  type Box,
  near,
  pastePicture,
  pictureHint,
  pictureShown,
  surfaceLayout,
  waitForPicture,
} from "../support/tracing.ts";
import { writeSymbol } from "../support/vault-files.ts";

/** `box` moved by `dx` and `dy`. */
function moved(box: Box, dx: number, dy: number): Box {
  return {
    left: box.left + dx,
    top: box.top + dy,
    right: box.right + dx,
    bottom: box.bottom + dy,
  };
}

/** `box` scaled by `factor` about the point `x`, `y`. */
function scaled(box: Box, factor: number, x: number, y: number): Box {
  return {
    left: x - (x - box.left) * factor,
    top: y - (y - box.top) * factor,
    right: x + (box.right - x) * factor,
    bottom: y + (box.bottom - y) * factor,
  };
}

/**
 * Where a new symbol's surface first shows a picture of `width` × `height`
 * pixels: as tall as from the cap height to the baseline, in the middle.
 */
async function placedBox(width: number, height: number): Promise<Box> {
  const { factor, capTop } = await surfaceLayout();
  const across = ((144 - capTop) / height) * width;
  return {
    left: (288 - across / 2) * factor,
    top: capTop * factor,
    right: (288 + across / 2) * factor,
    bottom: 144 * factor,
  };
}

/**
 * Drops a file of `type` on the surface: `text`, or a 20 × 60 px blue
 * picture.
 */
async function dropFile(type: string, text?: string): Promise<void> {
  await browser.execute(
    async (fileType, content) => {
      const { pictures } = window.inklineTest;
      const canvas = activeDocument.querySelector(
        ".inkline-editor .inkline-surface",
      );
      if (canvas === null) throw new Error("no surface");
      const body = content ?? (await pictures.picture(20, 60, "blue"));
      pictures.drop(canvas, new File([body], "dropped", { type: fileType }));
    },
    type,
    text,
  );
}

/** Drops a link to a vault file, as Obsidian's file explorer drags one. */
async function dropVaultFile(path: string, vault?: string): Promise<void> {
  await browser.executeObsidian(
    ({ app }, filePath, name) => {
      const canvas = activeDocument.querySelector(
        ".inkline-editor .inkline-surface",
      );
      if (canvas === null) throw new Error("no surface");
      const link = new URL("obsidian://open");
      link.searchParams.set("vault", name ?? app.vault.getName());
      link.searchParams.set("file", filePath);
      window.inklineTest.pictures.drop(canvas, { uriList: link.href });
    },
    path,
    vault,
  );
}

/** Turns the wheel by `deltaY` at `x`, `y` CSS pixels from the surface's middle. */
async function turnWheel(x: number, y: number, deltaY: number): Promise<void> {
  await browser
    .action("wheel")
    .scroll({ origin: surface(), x, y, deltaX: 0, deltaY })
    .perform();
}

/** Drags with the mouse by `dx`, `dy` CSS pixels from the surface's middle. */
async function dragBy(dx: number, dy: number): Promise<void> {
  const origin = surface();
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ origin, x: 0, y: 0 })
    .down()
    .move({
      origin,
      x: Math.round(dx / 2),
      y: Math.round(dy / 2),
      duration: 50,
    })
    .move({ origin, x: dx, y: dy, duration: 50 })
    .up()
    .perform();
}

/** How many files the vault holds. */
async function fileCount(): Promise<number> {
  return browser.executeObsidian(({ app }) => app.vault.getFiles().length);
}

describe("The editor", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
  });

  // A test that fails midway can leave a file operation held or replaced, or
  // Inkline off, which every test after it would then fail on.
  afterEach(async function () {
    await undoStubs();
    if (!(await inklineOn())) {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
  });

  describe("tracing over a picture", function () {
    it("shows a pasted picture faintly, as tall as a capital, outside the drawing", async function () {
      await insert();
      expect(await pictureHint()).toBe(
        "Paste, drop, or choose a picture to trace over it.",
      );
      await pastePicture("red");
      await waitForStatus("Tracing over the picture");
      const expected = await placedBox(40, 40);
      const shown = await waitForPicture((box) => near(box, expected));
      await saveScreenshot("editor-tracing-pasted");
      // Faint: about a third opaque, under the guides and the ink.
      expect(Math.abs((shown?.alpha ?? 0) - 0.35 * 255)).toBeLessThanOrEqual(3);
      const { factor, xTop } = await surfaceLayout();
      const guide = await browser.execute(
        (row, from, to) => {
          const canvas = activeDocument.querySelector(
            ".inkline-editor .inkline-surface",
          );
          if (canvas?.instanceOf(HTMLCanvasElement) !== true) {
            throw new Error("no surface");
          }
          return window.inklineTest.pictures.guideIn(canvas, row, from, to);
        },
        Math.round(xTop * factor),
        Math.ceil(shown?.left ?? 0),
        Math.floor(shown?.right ?? 0),
      );
      // The x-height's dashes, about half of the row, cross it unblended.
      expect(guide).toBeGreaterThan(
        0.3 * ((shown?.right ?? 0) - (shown?.left ?? 0)),
      );
      expect(await pictureHint()).toBe(
        "Tracing over a picture, which is not saved.",
      );
      expect(await browser.$('[data-inkline-button="move"]').isEnabled()).toBe(
        true,
      );
      // Not part of the drawing: nothing to keep, and nothing to ask.
      expect(await storedDrafts()).toHaveLength(0);
      await browser.keys(["Escape"]);
      await waitClosed();
      expect(await symbolFiles()).toEqual([]);
    });

    it("takes a dropped picture, and says when a drop or paste holds none", async function () {
      await insert();
      const files = await fileCount();
      await dropFile("text/plain", "not a picture");
      await waitForStatus("only a picture can be traced over");
      await dropFile("image/png", "not a PNG");
      await waitForStatus("Inkline cannot read this picture");
      await browser.execute(() => {
        window.inklineTest.pictures.copyText("not a picture");
      });
      await browser.keys(["Control", "v"]);
      await waitForStatus("The clipboard holds no picture to trace over");
      expect(await pictureShown("blue")).toBeUndefined();
      await dropFile("image/png");
      const expected = await placedBox(20, 60);
      await waitForPicture((box) => near(box, expected), "blue");
      expect(await surface().getAttribute("class")).not.toContain(
        "is-drop-target",
      );
      // Obsidian took nothing into the vault.
      expect(await fileCount()).toBe(files);
    });

    it("takes a picture dragged from Obsidian's file explorer", async function () {
      await browser.executeObsidian(async ({ app }) => {
        const blob = await window.inklineTest.pictures.picture(20, 60, "blue");
        await app.vault.createFolder("Pictures");
        await app.vault.createBinary(
          "Pictures/glyph one.png",
          await blob.arrayBuffer(),
        );
        await app.vault.create("Pictures/notes.md", "Not a picture.");
      });
      await insert();
      // Another vault's picture, and this one's note, are not taken.
      await dropVaultFile("Pictures/glyph one.png", "Another vault");
      await waitForStatus("only a picture can be traced over");
      await dropVaultFile("Pictures/notes.md");
      await browser.pause(300);
      expect(await pictureShown("blue")).toBeUndefined();
      await dropVaultFile("Pictures/glyph one.png");
      await waitForStatus("Tracing over the picture");
      const expected = await placedBox(20, 60);
      await waitForPicture((box) => near(box, expected), "blue");
    });

    it("scales a picture over 4096 pixels a side down, keeping its proportions", async function () {
      const sizes = await browser.execute(async () => {
        const { pictures, reference } = window.inklineTest;
        const size = async (width: number, height: number) => {
          const image = await reference.decodePicture(
            await pictures.picture(width, height, "red"),
          );
          const found = [image.width, image.height];
          image.close();
          return found;
        };
        return { large: await size(5000, 100), fits: await size(300, 200) };
      });
      expect(sizes.large).toEqual([4096, 82]);
      expect(sizes.fits).toEqual([300, 200]);
    });

    it("takes a paste only in the editor on top", async function () {
      await insert();
      // A second editor, over the first, as the command palette can open.
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await browser.waitUntil(
        async () =>
          (await browser.$$(".inkline-editor").getElements()).length === 2,
      );
      // Both have drawn their first frame, which gives the top one the keys.
      await waitForEditor();
      await pastePicture("red");
      await waitForPicture((box) => box !== undefined, "red", 1);
      await browser.pause(300);
      expect(await pictureShown("red", 0)).toBeUndefined();
    });

    it("keeps following the pointer when a save moves the view mid-drag", async function () {
      await insert();
      // Far to the left, so that the save crops a lot off.
      await draw([
        [0.1, 0.4],
        [0.15, 0.6],
      ]);
      await pastePicture("red");
      const placed = await waitForPicture((box) => box !== undefined);
      if (placed === undefined) throw new Error("no picture");
      const { ratio } = await surfaceLayout();
      await browser.keys(["m"]);
      // A mouse's events, dispatched on the surface: WebDriver lets go of a
      // button between its calls, and a drag must outlast the save.
      const mouse = (type: string, dx: number, dy: number, buttons: number) =>
        browser.execute(
          (event, x, y, held) => {
            const canvas = activeDocument.querySelector(
              ".inkline-editor .inkline-surface",
            );
            if (canvas === null) throw new Error("no surface");
            const rect = canvas.getBoundingClientRect();
            canvas.dispatchEvent(
              new PointerEvent(event, {
                bubbles: true,
                cancelable: true,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                button: event === "pointermove" ? -1 : 0,
                buttons: held,
                clientX: rect.left + rect.width / 2 + x,
                clientY: rect.top + rect.height / 2 + y,
              }),
            );
          },
          type,
          dx,
          dy,
          buttons,
        );
      await mouse("pointerdown", 0, 0, 1);
      await mouse("pointermove", 10, 5, 1);
      await waitForPicture((box) =>
        near(box, moved(placed, 10 * ratio, 5 * ratio)),
      );
      // The save crops the drawing, and moves the view with it.
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await mouse("pointermove", 30, 15, 1);
      await mouse("pointerup", 30, 15, 0);
      await waitForPicture((box) =>
        near(box, moved(placed, 30 * ratio, 15 * ratio)),
      );
    });

    it("moves the picture in Move mode, and scales it about the pointer", async function () {
      await insert();
      await pastePicture("red");
      const placed = await waitForPicture((box) => box !== undefined);
      if (placed === undefined) throw new Error("no picture");
      const { factor, ratio, border } = await surfaceLayout();
      await browser.keys(["m"]);
      expect(await pressed("move")).toBe("true");
      expect(await pressed("pen")).toBe("false");
      expect(await surface().getAttribute("class")).toContain("is-moving");

      // Dragging moves it with the pointer.
      await dragBy(30, 15);
      const dragged = await waitForPicture((box) =>
        near(box, moved(placed, 30 * ratio, 15 * ratio)),
      );
      if (dragged === undefined) throw new Error("no picture");

      // The wheel scales it about the point under the pointer.
      const { width, height } = await settledSurface();
      const x = (width / 2 - 20 - border) * ratio;
      const y = (height / 2 - 10 - border) * ratio;
      const notch = Math.exp(100 / 500);
      await turnWheel(-20, -10, -100);
      const wheeled = await waitForPicture((box) =>
        near(box, scaled(dragged, notch, x, y), 3),
      );
      if (wheeled === undefined) throw new Error("no picture");

      // The arrow keys move it by a pixel, or by a grid spacing with Shift.
      const { spacing } = await editorGrid();
      await browser.keys(["ArrowRight"]);
      await browser.keys(["ArrowRight"]);
      // Up, so that the picture stays whole on the surface as it grows.
      await browser.keys(["Shift", "ArrowUp"]);
      const nudged = await waitForPicture((box) =>
        near(box, moved(wheeled, 2 * factor, -spacing * factor)),
      );
      if (nudged === undefined) throw new Error("no picture");

      // + and = scale it up about its middle, and − down.
      const middleX = (nudged.left + nudged.right) / 2;
      const middleY = (nudged.top + nudged.bottom) / 2;
      for (const grow of ["+", "="]) {
        await browser.keys([grow]);
        await waitForPicture((box) =>
          near(box, scaled(nudged, notch, middleX, middleY), 3),
        );
        await browser.keys(["-"]);
        await waitForPicture((box) => near(box, nudged, 3));
      }
      await browser.keys(["-"]);
      const shrunk = await waitForPicture((box) =>
        near(box, scaled(nudged, 1 / notch, middleX, middleY), 3),
      );
      if (shrunk === undefined) throw new Error("no picture");

      // The pen draws again, and leaves the picture where it is.
      await browser.keys(["p"]);
      expect(await pressed("move")).toBe("false");
      expect(await pressed("pen")).toBe("true");
      await draw([
        [0.05, 0.5],
        [0.15, 0.5],
      ]);
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.strokes.length === 1,
      );
      expect(near(await pictureShown(), shrunk, 1)).toBe(true);
    });

    it("never saves the picture", async function () {
      await insert();
      await pastePicture("red");
      await waitForPicture((box) => box !== undefined);
      await draw(zigzag);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      const record = JSON.parse(await recordOf("001.ink.png")) as {
        strokes?: unknown[];
        base?: unknown;
      };
      expect(record.strokes).toHaveLength(1);
      expect(record.base).toBeUndefined();
      // Every inked pixel is the ink's own grey.
      const coloured = await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("001.ink.png");
        if (file === null) throw new Error("no 001.ink.png");
        const { canvas } = window.inklineTest;
        const bitmap = await canvas.decodePng(
          new Uint8Array(await app.vault.readBinary(file)),
        );
        const { data } = canvas.readPixels(bitmap);
        let count = 0;
        for (let at = 0; at < data.length; at += 4) {
          const [r = 0, g = 0, b = 0, a = 0] = data.subarray(at, at + 4);
          if (a > 0 && (Math.abs(r - g) > 2 || Math.abs(g - b) > 2)) count++;
        }
        return count;
      });
      expect(coloured).toBe(0);
    });

    it("stays where it is on the surface through a save, and into the next symbol", async function () {
      await insert();
      await pastePicture("red");
      const placed = await waitForPicture((box) => box !== undefined);
      if (placed === undefined) throw new Error("no picture");
      // Far to the left, so that the save crops a lot off.
      await draw([
        [0.1, 0.4],
        [0.15, 0.6],
      ]);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      // The save says so at once, and the surface shows its result on the
      // next frame: until then it still shows the picture where it was. So
      // after two frames, the picture is read once, as the save left it.
      await waitForEditor();
      expect(near(await pictureShown(), placed, 1)).toBe(true);
      await markEditor();
      await browser.keys(["Control", "Shift", "Enter"]);
      await waitForNext(1);
      await waitForPicture((box) => near(box, placed, 1));
      expect(await pictureHint()).toBe(
        "Tracing over a picture, which is not saved.",
      );
      // Nothing to save in the next one yet.
      await browser.keys(["Escape"]);
      await waitClosed();
    });

    it("leaves a paste into a text field to the field", async function () {
      await writeSymbol("tower.ink.png", [800]);
      await insert();
      await browser.keys(["v"]);
      await browser.$(".prompt-input").waitForDisplayed();
      await pastePicture("red");
      await browser.pause(500);
      expect(await pictureShown()).toBeUndefined();
      expect(await browser.$(".inkline-status").getText()).toBe("");
      await browser.keys(["Escape"]);
      await browser.$(".prompt").waitForExist({ reverse: true });
      // With the focus back on the editor, the same paste is its.
      await pastePicture("red");
      await waitForPicture((box) => box !== undefined);
    });

    it("replaces the picture with the next one pasted, and removes it", async function () {
      await insert();
      await pastePicture("red");
      await waitForPicture((box) => box !== undefined);
      await pastePicture("blue");
      await waitForPicture((box) => box !== undefined, "blue");
      expect(await pictureShown("red")).toBeUndefined();
      await browser.$('[data-inkline-button="remove"]').click();
      await waitForStatus("Picture removed");
      // The focus goes back to the surface, from the disabled button.
      expect(
        await browser.execute(
          () =>
            activeDocument.activeElement?.classList.contains(
              "inkline-surface",
            ) === true,
        ),
      ).toBe(true);
      await waitForPicture((box) => box === undefined, "blue");
      expect(await browser.$('[data-inkline-button="move"]').isEnabled()).toBe(
        false,
      );
      expect(await pictureHint()).toBe(
        "Paste, drop, or choose a picture to trace over it.",
      );
      await browser.keys(["m"]);
      await waitForStatus("Paste, drop, or choose a picture first, to move it");
      expect(await pressed("move")).toBe("false");
    });
  });
});
