// A picture to trace over: pasting one, and where the editor's surface
// shows it, in end-to-end tests.

import { browser } from "@wdio/globals";
import { type Box } from "./pointer.ts";
import { waitOrSay } from "./waits.ts";

/**
 * A new symbol's surface, for placing a picture: device pixels per document
 * pixel and per CSS pixel, the surface's border, and where the top of a
 * capital letter is, in document pixels, from an independent measurement of
 * the preview line's font.
 */
export async function surfaceLayout(): Promise<{
  factor: number;
  ratio: number;
  border: number;
  capTop: number;
  xTop: number;
}> {
  return browser.execute(() => {
    const doc = activeDocument;
    const view = doc.defaultView;
    const canvas = doc.querySelector(".inkline-editor .inkline-surface");
    const line = doc.querySelector(".inkline-editor .inkline-preview");
    if (
      view === null ||
      canvas?.instanceOf(HTMLCanvasElement) !== true ||
      line?.instanceOf(HTMLElement) !== true
    ) {
      throw new Error("no surface");
    }
    const font = view.getComputedStyle(line);
    const context = new view.OffscreenCanvas(1, 1).getContext("2d");
    if (context === null) throw new Error("no context");
    context.font = `${font.fontStyle} ${font.fontWeight} 128px ${font.fontFamily}`;
    return {
      factor: canvas.width / 576,
      ratio: canvas.width / canvas.clientWidth,
      border: canvas.clientLeft,
      capTop: 144 - context.measureText("H").actualBoundingBoxAscent,
      xTop: 144 - context.measureText("x").actualBoundingBoxAscent,
    };
  });
}

/** Where the surface shows a red or blue picture, in device pixels. */
export async function pictureShown(
  colour: "red" | "blue" = "red",
  editor = 0,
): Promise<(Box & { alpha: number }) | undefined> {
  // WebDriver hands back undefined as null.
  const shown = await browser.execute(
    (wanted, index) => {
      const canvas = activeDocument.querySelectorAll(
        ".inkline-editor .inkline-surface",
      )[index];
      if (canvas?.instanceOf(HTMLCanvasElement) !== true) {
        throw new Error("no surface");
      }
      return window.inklineTest.pictures.shown(canvas, wanted) ?? null;
    },
    colour,
    editor,
  );
  return shown ?? undefined;
}

/** Waits for the surface to show a picture that `test` accepts, and returns it. */
export async function waitForPicture(
  test: (box: Box | undefined) => boolean,
  colour: "red" | "blue" = "red",
  editor = 0,
): Promise<(Box & { alpha: number }) | undefined> {
  let shown = await pictureShown(colour, editor);
  await waitOrSay(
    async () => {
      shown = await pictureShown(colour, editor);
      return test(shown);
    },
    () => `the picture was last at ${JSON.stringify(shown)}`,
  );
  return shown;
}

/** Whether every edge of `box` is within `tolerance` of `expected`'s. */
export function near(
  box: Box | undefined,
  expected: Box,
  tolerance = 2,
): boolean {
  return (
    box !== undefined &&
    (["left", "top", "right", "bottom"] as const).every(
      (edge) => Math.abs(box[edge] - expected[edge]) <= tolerance,
    )
  );
}

/** Copies a 40 px square picture of one colour, and pastes it. */
export async function pastePicture(colour: "red" | "blue"): Promise<void> {
  await browser.execute(async (fill) => {
    await window.inklineTest.pictures.copyPicture(40, 40, fill);
  }, colour);
  await browser.keys(["Control", "v"]);
}

/** The words next to the picture's buttons. */
export async function pictureHint(): Promise<string> {
  return browser.$(".inkline-picture-hint").getText();
}

/** What the editor says, and the picture's hint, while Make ink is open. */
export const making =
  "Making ink of the picture: set the threshold, then Apply.";

/** Whether Make ink's bar, with its threshold, shows. */
export async function inkShown(): Promise<boolean> {
  return browser.$(".inkline-editor .inkline-convert").isDisplayed();
}
