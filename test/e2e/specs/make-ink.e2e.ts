import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { wheelFactor } from "../../../src/editor/reference.ts";
import { loadModules } from "../support/browser.ts";
import {
  inklineOn,
  insert,
  pressed,
  strokeCount,
  waitClosed,
} from "../support/editing.ts";
import {
  editorGrid,
  editorOpen,
  markEditor,
  recordOf,
  storedDrafts,
  undoStubs,
  waitForNext,
  startOver,
  surface,
  symbolFiles,
  clickTop,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import {
  near,
  pastePicture,
  pictureHint,
  pictureShown,
  surfaceLayout,
  waitForPicture,
} from "../support/tracing.ts";

/** A rectangle on a picture, in its pixels and a CSS colour. */
interface Mark {
  x: number;
  y: number;
  width: number;
  height: number;
  colour: string;
}

/** Copies a picture of `ground` with `marks` on it, and pastes it. */
async function pasteMarked(
  width: number,
  height: number,
  ground: string,
  marks: Mark[],
): Promise<void> {
  await browser.execute(
    async (w, h, fill, drawn) => {
      await window.inklineTest.pictures.copyPicture(w, h, fill, drawn);
    },
    width,
    height,
    ground,
    marks,
  );
  await browser.keys(["Control", "v"]);
  await waitForStatus("Tracing over the picture");
}

/** A 40 px picture of `ground` with a 20 px square of `ink` in its middle. */
function squareOn(ground: string, ink: string): Parameters<typeof pasteMarked> {
  return [
    40,
    40,
    ground,
    [{ x: 10, y: 10, width: 20, height: 20, colour: ink }],
  ];
}

/** Drops a picture of `ground` with `marks` on it on the surface. */
async function dropMarked(
  width: number,
  height: number,
  ground: string,
  marks: Mark[],
): Promise<void> {
  await browser.execute(
    async (w, h, fill, drawn) => {
      const { pictures } = window.inklineTest;
      const canvas = activeDocument.querySelector(
        ".inkline-editor .inkline-surface",
      );
      if (canvas === null) throw new Error("no surface");
      const blob = await pictures.picture(w, h, fill, drawn);
      pictures.drop(
        canvas,
        new File([blob], "dropped.png", { type: "image/png" }),
      );
    },
    width,
    height,
    ground,
    marks,
  );
  await waitForStatus("Tracing over the picture");
}

/**
 * How many times larger than its own pixels {@link enlarge} shows a picture:
 * between 2 and 3, so that Make ink samples it three times finer.
 */
const enlarged = 2.5;

/**
 * Scales the picture up {@link enlarged} times about its middle, with the
 * wheel, as a person enlarges a small screenshot: a picture comes at its own
 * size.
 */
async function enlarge(): Promise<void> {
  await browser.keys(["m"]);
  // A turn of this many pixels scales the picture by `enlarged`.
  const deltaY = Math.round(Math.log(enlarged) / Math.log(wheelFactor(-1)));
  await browser
    .action("wheel")
    .scroll({ origin: surface(), x: 0, y: 0, deltaX: 0, deltaY: -deltaY })
    .perform();
  await browser.keys(["m"]);
}

/**
 * Whether the surface shows ink at `fx`, `fy` of the way across and down a
 * square picture `side` pixels across where a new symbol's surface shows it,
 * about the middle of a capital.
 */
async function inkInPicture(
  fx: number,
  fy: number,
  side: number,
): Promise<boolean> {
  const { factor, capTop } = await surfaceLayout();
  const top = (capTop + 144) / 2 - side / 2;
  return browser.execute(
    (x, y) => {
      const canvas = activeDocument.querySelector(
        ".inkline-editor .inkline-surface",
      );
      if (canvas?.instanceOf(HTMLCanvasElement) !== true) {
        throw new Error("no surface");
      }
      return window.inklineTest.pictures.inkAt(canvas, x, y).ink;
    },
    Math.round((288 - side / 2 + fx * side) * factor),
    Math.round((top + fy * side) * factor),
  );
}

/** Whether the controls that make ink are showing. */
async function makingInk(): Promise<boolean> {
  return browser.$(".inkline-convert").isDisplayed();
}

/** The threshold's slider. */
function thresholdSlider(): ChainablePromiseElement {
  return browser.$(".inkline-convert input[type=range]");
}

/** Sets the threshold as dragging its slider does. */
async function setThreshold(value: number): Promise<void> {
  await browser.execute((wanted) => {
    const slider = activeDocument.querySelector(
      ".inkline-convert input[type=range]",
    );
    if (slider?.instanceOf(HTMLInputElement) !== true) {
      throw new Error("no slider");
    }
    slider.value = String(wanted);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/**
 * Whether the surface shows ink, in the text colour, in the middle of where
 * a new symbol's picture first sits.
 */
async function inkInMiddle(): Promise<boolean> {
  const { factor, capTop } = await surfaceLayout();
  return browser.execute(
    (y) => {
      const canvas = activeDocument.querySelector(
        ".inkline-editor .inkline-surface",
      );
      if (canvas?.instanceOf(HTMLCanvasElement) !== true) {
        throw new Error("no surface");
      }
      return window.inklineTest.pictures.inkAt(
        canvas,
        Math.round(canvas.width / 2),
        y,
      ).ink;
    },
    Math.round(((capTop + 144) / 2) * factor),
  );
}

/** The size of a saved symbol's base layer, in its pixels. */
async function baseSize(path: string): Promise<[number, number] | undefined> {
  const record = JSON.parse(await recordOf(path)) as {
    base?: { png: string };
  };
  if (record.base === undefined) return undefined;
  const png = Buffer.from(record.base.png, "base64");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
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

  describe("making ink of a picture", function () {
    it("makes ink by a threshold, as one step that Undo takes back", async function () {
      await insert();
      await browser.keys(["i"]);
      await waitForStatus(
        "Paste, drop, or choose a picture first, to make ink of it",
      );
      expect(await makingInk()).toBe(false);
      await pasteMarked(...squareOn("white", "black"));
      await enlarge();
      await browser.keys(["i"]);
      expect(await makingInk()).toBe(true);
      expect(await pressed("ink")).toBe("true");
      // Black on white: the middle of the values between, and dark ink.
      expect(await thresholdSlider().getValue()).toBe("128");
      expect(await pressed("light")).toBe("false");
      expect(await pictureHint()).toBe(
        "Making ink of the picture: set the threshold, then Apply.",
      );
      // The preview shows the square as ink, before anything is made.
      await browser.waitUntil(inkInMiddle);
      await saveScreenshot("editor-making-ink");
      expect(await storedDrafts()).toHaveLength(0);
      await browser.$('[data-inkline-button="apply"]').click();
      await waitForStatus("Made ink of the picture; Undo takes it back");
      expect(await makingInk()).toBe(false);
      expect(
        await browser.execute(
          () =>
            activeDocument.activeElement?.classList.contains(
              "inkline-surface",
            ) === true,
        ),
      ).toBe(true);
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.base === "kept",
      );
      await browser.keys(["Control", "z"]);
      await browser.waitUntil(async () => (await storedDrafts()).length === 0);
      expect(await inkInMiddle()).toBe(false);
      await browser.keys(["Control", "Shift", "z"]);
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.base === "kept",
      );
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      // The square, sampled three times finer than the picture: enlarged, its
      // 40 pixels are each over two document pixels.
      expect(await baseSize("001.ink.png")).toEqual([60, 60]);
    });

    it("makes ink of a picture at its own size from its own pixels", async function () {
      await insert();
      await pasteMarked(...squareOn("white", "black"));
      await browser.keys(["i"]);
      await browser.waitUntil(inkInMiddle);
      await browser.$('[data-inkline-button="apply"]').click();
      await waitForStatus("Made ink of the picture");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      // A document pixel to each of the picture's: the square's 20.
      expect(await baseSize("001.ink.png")).toEqual([20, 20]);
    });

    it("makes light ink of a light symbol on a dark ground", async function () {
      await insert();
      await pasteMarked(...squareOn("black", "white"));
      await enlarge();
      await browser.keys(["i"]);
      expect(await pressed("light")).toBe("true");
      await browser.waitUntil(inkInMiddle);
      await browser.$('[data-inkline-button="apply"]').click();
      await waitForStatus("Made ink of the picture");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await baseSize("001.ink.png")).toEqual([60, 60]);
    });

    it("makes ink only of what the surface shows across", async function () {
      await insert();
      // Three symbols in a row: enlarged, only the middle one is on the
      // surface.
      const square = (x: number) => ({
        x,
        y: 10,
        width: 20,
        height: 20,
        colour: "black",
      });
      await pasteMarked(400, 40, "white", [
        square(10),
        square(190),
        square(370),
      ]);
      await enlarge();
      await browser.keys(["i"]);
      await browser.waitUntil(inkInMiddle);
      await browser.$('[data-inkline-button="apply"]').click();
      await waitForStatus("Made ink of the picture");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await baseSize("001.ink.png")).toEqual([60, 60]);
    });

    it("previews each threshold, and Cancel makes no ink", async function () {
      await insert();
      // Mid grey on white: ink below the threshold, none above.
      await pasteMarked(...squareOn("white", "rgb(128, 128, 128)"));
      await browser.keys(["i"]);
      await browser.waitUntil(inkInMiddle);
      await setThreshold(100);
      await browser.waitUntil(async () => !(await inkInMiddle()));
      await setThreshold(200);
      await browser.waitUntil(inkInMiddle);
      await browser.$('[data-inkline-button="cancel"]').click();
      await waitForStatus("No ink made");
      expect(await makingInk()).toBe(false);
      await browser.waitUntil(async () => !(await inkInMiddle()));
      // Nothing was made, so nothing asks before closing.
      expect(await storedDrafts()).toHaveLength(0);
      await browser.keys(["Escape"]);
      await waitClosed();
    });

    it("makes the ink being previewed when saving, or says why it cannot", async function () {
      await insert();
      await pasteMarked(...squareOn("white", "rgb(128, 128, 128)"));
      await enlarge();
      await browser.keys(["i"]);
      // No ink at this threshold: the save stops, and the editor stays.
      await setThreshold(100);
      await browser.keys(["Control", "Enter"]);
      await waitForStatus("No ink at this threshold: try another");
      expect(await editorOpen()).toBe(true);
      expect(await symbolFiles()).toEqual([]);
      await setThreshold(200);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      // Three times finer, as in the first test; the ramp between this grey
      // and white is half as wide, and at 200 the ink stops at the grey's edge.
      expect(await baseSize("001.ink.png")).toEqual([60, 60]);
    });

    it("makes the ink being previewed on Mod+S, and on Next", async function () {
      await insert();
      // Two greys, one above the other: 150 makes ink of the darker only,
      // 250 of both, so that each save's base layer shows its threshold.
      await pasteMarked(400, 200, "rgb(200, 200, 200)", [
        { x: 0, y: 0, width: 400, height: 100, colour: "rgb(100, 100, 100)" },
      ]);
      await browser.keys(["i"]);
      await setThreshold(150);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      expect(await makingInk()).toBe(false);
      expect(await editorOpen()).toBe(true);
      expect(await baseSize("001.ink.png")).toEqual([400, 100]);
      // Again at 250, and Next, which hands the picture on.
      await browser.keys(["i"]);
      await setThreshold(250);
      await markEditor();
      await browser.keys(["Control", "Shift", "Enter"]);
      await waitForNext(1);
      expect(await pictureHint()).toBe(
        "Tracing over a picture, which is not saved.",
      );
      expect(await baseSize("001.ink.png")).toEqual([400, 200]);
      expect(await strokeCount("001.ink.png")).toBe(0);
    });

    it("asks before closing over the ink being previewed, and Save makes it", async function () {
      await insert();
      await pasteMarked(...squareOn("white", "black"));
      await enlarge();
      await browser.keys(["i"]);
      await browser.waitUntil(inkInMiddle);
      await browser.keys(["Escape"]);
      await clickTop("Save");
      await waitClosed();
      expect(await baseSize("001.ink.png")).toEqual([60, 60]);
    });

    it("makes ink of a light symbol on a transparent ground", async function () {
      await insert();
      await dropMarked(...squareOn("rgba(0, 0, 0, 0)", "white"));
      await enlarge();
      await browser.keys(["i"]);
      expect(await pressed("light")).toBe("true");
      await browser.waitUntil(inkInMiddle);
      // The ground stays empty.
      expect(await inkInPicture(0.1, 0.1, 40 * enlarged)).toBe(false);
      await browser.$('[data-inkline-button="apply"]').click();
      await waitForStatus("Made ink of the picture");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      // Three times finer; the square's own alpha fades over one sample past
      // its edge on each side (#96).
      expect(await baseSize("001.ink.png")).toEqual([62, 62]);
    });

    it("leaves no ink at one end of the slider and all at the other", async function () {
      await insert();
      await pasteMarked(...squareOn("white", "black"));
      await browser.keys(["i"]);
      await browser.waitUntil(inkInMiddle);
      expect(await inkInPicture(0.1, 0.1, 40)).toBe(false);
      await setThreshold(-1000);
      await browser.waitUntil(async () => !(await inkInMiddle()));
      expect(await thresholdSlider().getValue()).toBe("-16");
      await setThreshold(1000);
      await browser.waitUntil(async () => inkInPicture(0.1, 0.1, 40));
      expect(await thresholdSlider().getValue()).toBe("272");
    });

    it("says when no part of the picture is on the surface, and fits to the ink", async function () {
      await insert();
      await pasteMarked(...squareOn("white", "black"));
      // Off the surface to the right: 5 em, in grid spacings.
      const { spacing } = await editorGrid();
      await browser.keys(["m"]);
      for (let step = 0; step < Math.ceil(640 / spacing); step++) {
        await browser.keys(["Shift", "ArrowRight"]);
      }
      await browser.keys(["i"]);
      await browser.$('[data-inkline-button="apply"]').click();
      await waitForStatus("no part of the picture is on the surface");
      expect(await makingInk()).toBe(true);
      // The row stays open, and the focus stays in it, on Apply.
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            activeDocument.activeElement?.getAttribute(
              "data-inkline-button",
            ) === "apply",
        ),
      );
      // Back about 3 em, into view at the right edge, then F fits the ink.
      await browser.keys(["i"]);
      for (let step = 0; step < Math.round(400 / spacing); step++) {
        await browser.keys(["Shift", "ArrowLeft"]);
      }
      await browser.keys(["i"]);
      expect(await inkInMiddle()).toBe(false);
      await browser.keys(["f"]);
      await browser.waitUntil(inkInMiddle);
    });

    it("makes the ink the surface shows when the threshold moves during Apply", async function () {
      await insert();
      // Two greys, one above the other: 150 makes ink of the darker only,
      // 250 of both.
      await pasteMarked(3000, 1000, "rgb(200, 200, 200)", [
        { x: 0, y: 0, width: 3000, height: 500, colour: "rgb(100, 100, 100)" },
      ]);
      await browser.keys(["i"]);
      await setThreshold(150);
      // In one turn: the encoding of the darker half cannot end before the
      // threshold moves.
      await browser.execute(() => {
        const apply = activeDocument.querySelector(
          '[data-inkline-button="apply"]',
        );
        const slider = activeDocument.querySelector(
          ".inkline-convert input[type=range]",
        );
        if (
          apply?.instanceOf(HTMLElement) !== true ||
          slider?.instanceOf(HTMLInputElement) !== true
        ) {
          throw new Error("no controls");
        }
        apply.click();
        slider.value = "250";
        slider.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await waitForStatus("Made ink of the picture");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await baseSize("001.ink.png")).toEqual([3000, 1000]);
    });

    it("leaves the slider its arrow keys while the picture moves", async function () {
      await insert();
      await pastePicture("red");
      const placed = await waitForPicture((box) => box !== undefined);
      if (placed === undefined) throw new Error("no picture");
      await browser.keys(["m"]);
      await browser.keys(["i"]);
      const before = Number(await thresholdSlider().getValue());
      await thresholdSlider().click();
      await browser.keys(["ArrowRight"]);
      await browser.waitUntil(
        async () => Number(await thresholdSlider().getValue()) !== before,
      );
      await browser.keys(["i"]);
      await waitForStatus("No ink made");
      expect(near(await pictureShown(), placed, 1)).toBe(true);
    });

    it("puts its ink in place of a base layer, one undo away", async function () {
      await insert();
      await pasteMarked(...squareOn("white", "black"));
      await browser.keys(["i"]);
      await browser.$('[data-inkline-button="apply"]').click();
      await waitForStatus("Made ink of the picture; Undo takes it back");
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.base === "kept",
      );
      const first = (await storedDrafts())[0]?.baseX;
      // Four pixels to the right, then ink again.
      await browser.keys(["m"]);
      for (let step = 0; step < 4; step++) await browser.keys(["ArrowRight"]);
      await browser.keys(["i"]);
      await browser.$('[data-inkline-button="apply"]').click();
      await waitForStatus("in place of the base layer before");
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.baseX === (first ?? 0) + 4 * 16,
      );
      await browser.keys(["Control", "z"]);
      await browser.waitUntil(
        async () => (await storedDrafts())[0]?.baseX === first,
      );
    });
  });
});
