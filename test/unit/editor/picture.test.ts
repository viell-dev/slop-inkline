import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PictureTracing,
  type PictureView,
  type TracedPicture,
  type TracingHost,
} from "../../../src/editor/picture.ts";
import {
  movePicture,
  placePicture,
  scalePicture,
  wheelFactor,
} from "../../../src/editor/reference.ts";
import { lineBox } from "../../../src/ink/geometry.ts";

/** A picture's stand-in: decoding and its pixels need a browser. */
function bitmap(): ImageBitmap & { closed: number } {
  return {
    width: 40,
    height: 20,
    closed: 0,
    close() {
      this.closed++;
    },
  };
}

/** A picture as the editor before handed it on, about the surface's middle. */
function carried(image: ImageBitmap = bitmap()): TracedPicture {
  return {
    image,
    width: 40,
    height: 20,
    placement: { x: -20, y: 30, scale: 2 },
  };
}

/**
 * A host that keeps what the picture asks of it: what it says, and the other
 * calls by name, in order.
 */
function editor(
  {
    view,
    capHeight,
  }: { readonly view: PictureView | undefined; readonly capHeight?: number } = {
    view: view200,
  },
) {
  const said: string[] = [];
  const calls: string[] = [];
  const state = { held: false, ended: false };
  const call = (name: string) => (): void => {
    calls.push(name);
  };
  const host: TracingHost = {
    view: () => view,
    capHeight: () => capHeight,
    held: () => state.held,
    ended: () => state.ended,
    say: (text) => {
      said.push(text);
    },
    requestRender: call("render"),
    updateControls: call("controls"),
    endPlacing: call("endPlacing"),
    refocus: call("refocus"),
    focusThreshold: call("focusThreshold"),
    focusAfterApply: (open) => {
      calls.push(`focusAfterApply ${String(open)}`);
    },
    useInk: () => {
      throw new Error("no ink in unit tests");
    },
    changed: call("changed"),
  };
  return { tracing: new PictureTracing(host), said, calls, state };
}

const view200: PictureView = {
  center: 100,
  visible: { left: 0, right: 200 },
};

describe("PictureTracing", () => {
  it("takes over the picture the editor before handed on, where it was on the surface", () => {
    const { tracing } = editor();
    const picture = carried();
    tracing.takeOver(picture, 100);
    expect(tracing.picture?.placement).toEqual({ x: 80, y: 30, scale: 2 });
    const handed = tracing.handOver();
    expect(handed?.placement).toEqual(picture.placement);
    expect(handed?.image).toBe(picture.image);
    expect(tracing.picture).toBeUndefined();
  });

  it("closes a picture it cannot hand on, with no drawing area", () => {
    const image = bitmap();
    const { tracing } = editor({ view: undefined });
    tracing.takeOver(carried(image), 0);
    expect(tracing.handOver()).toBeUndefined();
    expect(image.closed).toBe(1);
  });

  it("moves the picture with the pointer dragging it, by as far as it moved in the drawing", () => {
    const { tracing } = editor();
    tracing.takeOver(carried(), 0);
    const placed = tracing.picture?.placement;
    if (placed === undefined) throw new Error("no picture");
    tracing.startDrag({ x: 5, y: 5 });
    expect(tracing.dragging).toBe(true);
    tracing.dragTo({ x: 8, y: 9 });
    expect(tracing.picture?.placement).toEqual(movePicture(placed, 3, 4));
    // A save moves the drawing, and the picture and the point the drag holds
    // with it, so that the next report takes it on from there (#457).
    tracing.moveWithDrawing(-2);
    const saved = movePicture(placed, 1, 4);
    expect(tracing.picture?.placement).toEqual(saved);
    tracing.dragTo({ x: 6, y: 9 });
    expect(tracing.picture?.placement).toEqual(saved);
    tracing.endDrag();
    expect(tracing.dragging).toBe(false);
    tracing.dragTo({ x: 50, y: 50 });
    expect(tracing.picture?.placement).toEqual(saved);
  });

  it("moves, scales about a point, and scales a step about its middle", () => {
    const { tracing, calls } = editor();
    tracing.takeOver(carried(), 0);
    const placed = tracing.picture?.placement;
    if (placed === undefined) throw new Error("no picture");
    tracing.move(3, -2);
    const moved = movePicture(placed, 3, -2);
    expect(tracing.picture?.placement).toEqual(moved);
    tracing.scaleAbout(2, 10, 20);
    const scaled = scalePicture(moved, 2, 10, 20);
    expect(tracing.picture?.placement).toEqual(scaled);
    tracing.scaleStep(true);
    const middleX = scaled.x + (40 * scaled.scale) / 2;
    const middleY = scaled.y + (20 * scaled.scale) / 2;
    const grown = scalePicture(scaled, wheelFactor(-100), middleX, middleY);
    expect(tracing.picture?.placement).toEqual(grown);
    tracing.scaleStep(false);
    const { x, y, scale } = grown;
    expect(tracing.picture?.placement).toEqual(
      scalePicture(
        grown,
        1 / wheelFactor(-100),
        x + (40 * scale) / 2,
        y + (20 * scale) / 2,
      ),
    );
    expect(calls).toEqual(["render", "render", "render", "render"]);
  });

  it("moves only a picture there is, and draws again for a tool", () => {
    const { tracing, said, calls } = editor();
    tracing.toggleMove();
    expect(tracing.moving).toBe(false);
    expect(said).toEqual([
      "Paste, drop, or choose a picture first, to move it",
    ]);
    tracing.move(1, 1);
    tracing.scaleStep(true);
    expect(calls).toEqual([]);
    tracing.takeOver(carried(), 0);
    tracing.toggleMove();
    expect(tracing.moving).toBe(true);
    // A polygon or path being placed ends first.
    expect(calls).toEqual(["endPlacing", "controls"]);
    tracing.toggleMove();
    expect(tracing.moving).toBe(false);
    tracing.toggleMove();
    tracing.stopMoving();
    expect(tracing.moving).toBe(false);
  });

  it("removes the picture, closing it, and draws again", () => {
    const image = bitmap();
    const { tracing, said, calls } = editor();
    tracing.takeOver(carried(image), 0);
    tracing.toggleMove();
    calls.length = 0;
    tracing.remove();
    expect(tracing.picture).toBeUndefined();
    expect(tracing.moving).toBe(false);
    expect(image.closed).toBe(1);
    expect(said).toEqual(["Picture removed"]);
    expect(calls).toEqual(["controls", "render", "refocus"]);
  });

  it("opens or closes Make ink once the pointer is let go, as asked while it was pressed", () => {
    const { tracing, said, calls, state } = editor();
    tracing.takeOver(carried(), 0);
    state.held = true;
    tracing.toggleConvert();
    expect(tracing.inkOpen).toBe(true);
    expect(tracing.converting).toBeUndefined();
    // Its ink is not seen yet, so a save makes none.
    expect(tracing.makingInk()).toBe(false);
    expect(tracing.previewing()).toBe(false);
    expect(said).toEqual(["Making ink once you let go"]);
    expect(calls).toEqual(["controls"]);
    // Asked for twice, it stays as it is, and says nothing more.
    tracing.toggleConvert();
    expect(tracing.inkOpen).toBe(false);
    expect(said).toHaveLength(1);
    tracing.toggleConvert();
    expect(tracing.takeInkWait()).toBe(true);
    expect(tracing.takeInkWait()).toBeUndefined();
    expect(tracing.inkOpen).toBe(false);
  });

  it("says there is no picture to make ink of, pressed or not", () => {
    const { tracing, said, state } = editor();
    state.held = true;
    tracing.toggleConvert();
    expect(tracing.takeInkWait()).toBeUndefined();
    state.held = false;
    tracing.toggleConvert();
    expect(said).toEqual([
      "Paste, drop, or choose a picture first, to make ink of it",
      "Paste, drop, or choose a picture first, to make ink of it",
    ]);
    expect(tracing.makingInk()).toBe(false);
  });

  it("says when a picture cannot be read, unless a newer one was asked for", async () => {
    const { tracing, said } = editor();
    // Node.js has no createImageBitmap, so nothing decodes here.
    await tracing.trace(new Blob(["not a picture"]));
    expect(said).toEqual(["Not traced: Inkline cannot read this picture"]);
    let arrive = (_blob: Blob): void => {
      throw new Error("not asked yet");
    };
    const first = tracing.trace(
      new Promise<Blob>((resolve) => {
        arrive = resolve;
      }),
    );
    const second = tracing.trace(new Blob(["nor this"]));
    await second;
    arrive(new Blob(["late"]));
    await first;
    expect(said).toHaveLength(2);
  });

  it("closes its picture once, however often it is disposed of, and one still arriving says nothing", async () => {
    const image = bitmap();
    const { tracing, said } = editor();
    tracing.takeOver(carried(image), 0);
    let arrive = (_blob: Blob): void => {
      throw new Error("not asked yet");
    };
    const late = tracing.trace(
      new Promise<Blob>((resolve) => {
        arrive = resolve;
      }),
    );
    tracing.dispose();
    tracing.dispose();
    expect(image.closed).toBe(1);
    expect(tracing.picture).toBeUndefined();
    arrive(new Blob(["late"]));
    await late;
    expect(said).toEqual([]);
  });

  it("previews nothing and makes no ink without Make ink open", async () => {
    const { tracing } = editor();
    tracing.takeOver(carried(), 0);
    const document = { strokes: [] };
    expect(tracing.preview(view200, document)).toBeUndefined();
    expect(await tracing.applyBeforeSave()).toBe(true);
    expect(tracing.applying).toBe(false);
  });

  it("gives the controls and the focus back once Apply ends, unless the editor has ended", async () => {
    const open = editor();
    await open.tracing.applyInk();
    // Shown as running, then as done, with the focus given back.
    expect(open.calls).toEqual([
      "controls",
      "controls",
      "focusAfterApply false",
    ]);
    const closed = editor();
    const applying = closed.tracing.applyInk();
    closed.state.ended = true;
    await applying;
    expect(closed.calls).toEqual(["controls"]);
    expect(closed.tracing.applying).toBe(false);
  });
});

/** What a pasted picture says it is doing, and how to go on. */
const tracingText =
  "Tracing over the picture. Move (M), then drag it or use the arrow keys; the wheel or + and − scale it";

/** A picture's file, which arrives when `arrive` is called. */
function arriving(): { file: Promise<Blob>; arrive: () => void } {
  let arrive = (): void => {
    throw new Error("not asked yet");
  };
  const file = new Promise<Blob>((resolve) => {
    arrive = () => {
      resolve(new Blob(["picture"]));
    };
  });
  // The executor has run, so `arrive` resolves the file now.
  return { file, arrive };
}

// Node.js has no createImageBitmap: here it decodes every file to a picture
// of 40 × 20 pixels, kept in the order decoded.
describe("PictureTracing, once a picture decodes", () => {
  let decoded: (ImageBitmap & { closed: number })[] = [];

  beforeEach(() => {
    decoded = [];
    vi.stubGlobal("createImageBitmap", (): Promise<ImageBitmap> => {
      const image = bitmap();
      decoded.push(image);
      return Promise.resolve(image);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("traces over it as tall as a capital letter, in the middle of the surface", async () => {
    const { tracing, said, calls } = editor({ view: view200, capHeight: 50 });
    await tracing.trace(new Blob(["picture"]));
    expect(tracing.picture?.image).toBe(decoded[0]);
    expect(tracing.picture?.placement).toEqual(
      placePicture(40, 20, 50, lineBox.baseline, view200.center),
    );
    expect(said).toEqual([tracingText]);
    expect(calls).toEqual(["controls", "render"]);
  });

  it("puts it a capital's usual height above the baseline before the font is measured", async () => {
    const { tracing } = editor();
    await tracing.trace(new Blob(["picture"]));
    expect(tracing.picture?.placement).toEqual(
      placePicture(
        40,
        20,
        lineBox.baseline - 0.7 * lineBox.pxPerEm,
        lineBox.baseline,
        view200.center,
      ),
    );
  });

  it("closes the picture it replaces, and keeps the new one", async () => {
    const { tracing } = editor();
    await tracing.trace(new Blob(["first"]));
    await tracing.trace(new Blob(["second"]));
    const [first, second] = decoded;
    expect(first?.closed).toBe(1);
    expect(second?.closed).toBe(0);
    expect(tracing.picture?.image).toBe(second);
  });

  it("closes a picture asked for before a newer one, as it arrives, and keeps the newer", async () => {
    const { tracing, said } = editor();
    const older = arriving();
    const first = tracing.trace(older.file);
    await tracing.trace(new Blob(["newer"]));
    older.arrive();
    await first;
    const [newer, late] = decoded;
    expect(late?.closed).toBe(1);
    expect(newer?.closed).toBe(0);
    expect(tracing.picture?.image).toBe(newer);
    expect(said).toEqual([tracingText]);
  });

  it("closes a picture that arrives after the editor let go of its own, and says nothing", async () => {
    const { tracing, said, calls } = editor();
    const asked = arriving();
    const traced = tracing.trace(asked.file);
    tracing.dispose();
    asked.arrive();
    await traced;
    expect(decoded[0]?.closed).toBe(1);
    expect(tracing.picture).toBeUndefined();
    expect(said).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("closes a picture that arrives once the editor has ended", async () => {
    const { tracing, said, state } = editor();
    const asked = arriving();
    const traced = tracing.trace(asked.file);
    state.ended = true;
    asked.arrive();
    await traced;
    expect(decoded[0]?.closed).toBe(1);
    expect(tracing.picture).toBeUndefined();
    expect(said).toEqual([]);
  });

  it("closes a picture that arrives with no drawing area", async () => {
    const { tracing } = editor({ view: undefined });
    await tracing.trace(new Blob(["picture"]));
    expect(decoded[0]?.closed).toBe(1);
    expect(tracing.picture).toBeUndefined();
  });
});
