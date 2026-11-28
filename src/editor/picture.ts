// The picture to trace over, pasted, dropped, or chosen, and Make ink, which
// turns it into the drawing's base layer at a threshold. It decodes pictures,
// reads their pixels, and makes ink with the browser's canvas, but holds no
// element: the modal shows the picture, routes the pointer, the wheel, pastes,
// and drops to it, and makes the ink part of the drawing.

import { baseFromInk, previewInk, readPixels } from "../ink/canvas.ts";
import type { InkDocument } from "../ink/document.ts";
import { lineBox, type Bounds } from "../ink/geometry.ts";
import {
  enlargeFactor,
  enlargedRegion,
  inkDefaults,
  pictureLuminance,
  previewShrink,
  regionValues,
  shrinkLuminance,
  thresholdEdge,
  thresholdRange,
  traceRegion,
  type Luminance,
  type PicturePlace,
  type Region,
} from "../ink/pixels.ts";
import type { DrawableBase } from "../ink/render.ts";
import { pictureHints } from "./buttons.ts";
import {
  decodePicture,
  isSymbolImage,
  movePicture,
  placePicture,
  placeSymbolImage,
  scaleAboutMiddle,
  wheelFactor,
  type Placement,
} from "./reference.ts";
import type { InputPoint } from "./session.ts";
import type { InkView } from "./view.ts";

/** A picture to trace over, shown faintly under the drawing, never saved. */
export interface TracedPicture {
  readonly image: ImageBitmap;
  readonly width: number;
  readonly height: number;
  readonly placement: Placement;
}

/** Ink made of the picture, to become the drawing's base layer. */
export type MadeInk = Awaited<ReturnType<typeof baseFromInk>>;

/** The first picture file that `data` holds, as pasted or dropped. */
export function pictureIn(data: DataTransfer | null): File | undefined {
  if (data === null) return undefined;
  const found = [...data.files].find((file) => file.type.startsWith("image/"));
  if (found !== undefined) return found;
  for (const item of data.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file !== null) return file;
  }
  return undefined;
}

/**
 * Whether a drag could carry a picture: files, or links, as Obsidian's file
 * explorer drags a vault file.
 */
export function dragsPicture(event: DragEvent): boolean {
  const types = event.dataTransfer?.types ?? [];
  return types.includes("Files") || types.includes("text/uri-list");
}

/**
 * How much + and − scale a picture: as much as a notch of the wheel, so that
 * the keys and the wheel step through the same sizes, each fine enough to
 * find the size wanted.
 */
const keyScale = wheelFactor(-100);

/**
 * The part of the picture that would become ink, as the preview last traced
 * it: kept while the picture and the surface stay put, as the threshold
 * changes.
 */
interface PartShown {
  readonly placement: Placement;
  readonly region: Bounds;
  /**
   * Where the pixels traced sit: the picture's place, at the scale of the
   * copy or of the finer samples traced.
   */
  readonly place: PicturePlace;
  /** Undefined when no part of the picture is there. */
  readonly part: Region | undefined;
  /** The threshold's ramp for those pixels. */
  readonly edge: number;
}

/**
 * The ink that a threshold gives that part, as last shown, with the
 * documents shown with it as their base layer, one per drawing.
 */
interface InkShown {
  readonly part: Region | undefined;
  readonly threshold: number;
  readonly light: boolean;
  /** Undefined when the threshold leaves no ink. */
  readonly base: DrawableBase | undefined;
  readonly documents: WeakMap<InkDocument, InkDocument>;
}

/**
 * The copy of a picture `factor` times smaller, from `copies`, which holds
 * the picture itself at 1; made and kept there when first needed.
 */
function copyOf(copies: Map<number, Luminance>, factor: number): Luminance {
  let copy = copies.get(factor);
  if (copy === undefined) {
    const picture = copies.get(1);
    if (picture === undefined) throw new Error("no picture to copy");
    copy = shrinkLuminance(picture, factor);
    copies.set(factor, copy);
  }
  return copy;
}

/** `placement` for a copy of its picture `factor` times smaller. */
function shrunkPlace(placement: Placement, factor: number): PicturePlace {
  return { ...placement, scale: placement.scale * factor };
}

/**
 * The part of the picture whose copies `copies` holds, at `placement`, that
 * becomes ink within `region`, with where its pixels are and the threshold's
 * ramp for them. An enlarged picture is sampled more finely, as
 * `enlargeFactor` says, so that its ink's edges are as sharp as the document
 * shows; any other is the copy `shrink` times smaller.
 */
function inkPart(
  copies: Map<number, Luminance>,
  placement: Placement,
  region: Bounds,
  shrink: number,
): { part: Region | undefined; place: PicturePlace; edge: number } {
  const picture = copyOf(copies, 1);
  const factor = enlargeFactor(
    picture.width,
    picture.height,
    placement,
    region,
  );
  const enlarged =
    factor > 1 ? enlargedRegion(picture, placement, region, factor) : undefined;
  if (enlarged !== undefined) return enlarged;
  const place = shrunkPlace(placement, shrink);
  return {
    part: regionValues(copyOf(copies, shrink), place, region),
    place,
    edge: thresholdEdge,
  };
}

function sameBounds(a: Bounds, b: Bounds): boolean {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom
  );
}

/** What the picture and Make ink read of the drawing area. */
export type PictureView = Pick<InkView, "center" | "visible">;

/** What the picture and Make ink are given by the editor around them. */
export interface TracingHost {
  /** The drawing area, once the editor has opened. */
  view(): PictureView | undefined;
  /** Where the note font's cap height is in the line box, once measured. */
  capHeight(): number | undefined;
  /**
   * Whether the pointer is pressed on the drawing area, to draw or to drag
   * the picture: what moves the drawing under it waits for the release then.
   */
  held(): boolean;
  /** Whether the editor has closed, or Inkline was disabled. */
  ended(): boolean;
  /** Says `text` in the status line, for as long as `holds` says, if given. */
  say(text: string, holds?: () => boolean): void;
  requestRender(): void;
  updateControls(): void;
  /** Ends a polygon or path being placed, as moving the picture does. */
  endPlacing(): void;
  /** Puts the focus on the drawing area. */
  refocus(): void;
  focusThreshold(): void;
  /**
   * Puts the focus back where Apply left it, if disabling Apply while it ran
   * let go of it: on Apply, while Make ink stays `open` as no ink was made,
   * or on the drawing area.
   */
  focusAfterApply(open: boolean): void;
  /**
   * Makes `made` the drawing's base layer, in place of any it had, as one
   * step that Undo takes back, with a stroke being drawn committed first.
   * Returns whether the drawing had a base layer before.
   */
  useInk(made: MadeInk): boolean;
  /** After a committed change: update the controls, the surface, the draft. */
  changed(): void;
}

/**
 * The picture to trace over, and Make ink. The editor closes it with
 * {@link dispose}, which can be called twice: a picture still being decoded
 * is closed as it arrives, and Make ink running then keeps nothing, as the
 * host says the editor has ended.
 */
export class PictureTracing {
  readonly #host: TracingHost;
  /** The picture to trace over, which this closes when done with it. */
  #picture: TracedPicture | undefined;
  /** Counts pictures asked for, so that only the latest is taken. */
  #requests = 0;
  /** Whether dragging and the wheel move the picture, rather than drawing. */
  #moving = false;
  /**
   * Where in the drawing the pointer dragging the picture last was. Each move
   * takes the picture by where the pointer is now in the drawing from there,
   * so that the picture rejoins the pointer at its next report when the
   * drawing has moved under it meanwhile, as a page zoom or a change to the
   * window's size moves it (#445). A save that moves the drawing moves this
   * with it, as it does the picture ({@link moveWithDrawing}).
   */
  #dragged: InputPoint | undefined;
  /**
   * Making ink of the picture, while its controls are open: the picture's
   * luminance, found once, the threshold, and whether the ink is lighter
   * than its ground.
   */
  #converting:
    | {
        readonly image: ImageBitmap;
        readonly luma: Luminance;
        /**
         * What the preview traces, by how many times smaller than the
         * picture: the picture itself, at 1, or a smaller copy, made when
         * first needed, so that each step stays quick however much of a
         * large picture is in view.
         */
        readonly copies: Map<number, Luminance>;
        threshold: number;
        light: boolean;
      }
    | undefined;
  /** The part and ink last shown while making ink, kept while unchanged. */
  #partShown: PartShown | undefined;
  #inkShown: InkShown | undefined;
  /** Making ink of the picture, while its encoding runs. */
  #applying: Promise<void> | undefined;
  /**
   * Whether Make ink is to be open once the pointer is let go, as asked while
   * it was pressed on the drawing area, or undefined to leave it as it is:
   * its row above the drawing area would move the drawing under the pointer
   * as it opened or closed.
   */
  #inkWait: boolean | undefined;

  constructor(host: TracingHost) {
    this.#host = host;
  }

  /** The picture to trace over, if there is one. */
  get picture(): TracedPicture | undefined {
    return this.#picture;
  }

  /** Whether dragging and the wheel move the picture, rather than drawing. */
  get moving(): boolean {
    return this.#moving;
  }

  /** Whether the pointer is dragging the picture. */
  get dragging(): boolean {
    return this.#dragged !== undefined;
  }

  /**
   * Make ink's threshold and Light ink, while its controls are open, and
   * while Apply makes the ink.
   */
  get converting():
    { readonly threshold: number; readonly light: boolean } | undefined {
    return this.#converting;
  }

  /** Whether Apply is making ink. */
  get applying(): boolean {
    return this.#applying !== undefined;
  }

  /**
   * Whether what makes ink of the picture is open, or will be once the
   * pointer is let go, as its button shows.
   */
  get inkOpen(): boolean {
    return this.#inkWait ?? this.#converting !== undefined;
  }

  /**
   * Whether what makes ink of the picture is open, and stays open once the
   * pointer is let go, so that a save makes the ink the surface shows: not
   * while Make ink waits to close, and not while it waits to open, before
   * its ink has been seen. A method, as it changes while a save waits.
   */
  makingInk(): boolean {
    return this.#converting !== undefined && this.inkOpen;
  }

  /**
   * Whether the surface shows ink being made of the picture, which a save
   * would make: not once Make ink waits to close ({@link makingInk}).
   */
  previewing(): boolean {
    return this.makingInk() && this.#inkShown?.base !== undefined;
  }

  /**
   * Traces over `carried`, the picture of the editor before this one, with
   * its x measured from the middle of the surface, as {@link handOver} gave
   * it: where it was on the surface, about `center`.
   */
  takeOver(carried: TracedPicture, center: number): void {
    this.#picture = {
      ...carried,
      placement: movePicture(carried.placement, center, 0),
    };
  }

  /**
   * Reads and decodes a pasted, dropped, or chosen picture and traces over
   * it, in place of any other. A symbol's own image lies over the strokes it
   * shows, from the top of the line box to its bottom ({@link
   * placeSymbolImage}). Any other picture comes at its own size, or scaled
   * down to fit what the surface shows if larger, in the middle of the
   * surface and where a capital letter's middle is between the guides
   * ({@link placePicture}). Only the picture asked for last is taken.
   */
  async trace(file: Blob | Promise<Blob>): Promise<void> {
    const request = ++this.#requests;
    let image: ImageBitmap;
    let symbol: boolean;
    try {
      const blob = await file;
      // Read first, so that a read that fails leaves no picture to close.
      symbol = isSymbolImage(new Uint8Array(await blob.arrayBuffer()));
      image = await decodePicture(blob);
    } catch {
      if (request === this.#requests) {
        this.#host.say("Not traced: Inkline cannot read this picture");
      }
      return;
    }
    const view = this.#host.view();
    if (
      request !== this.#requests ||
      this.#host.ended() ||
      view === undefined
    ) {
      image.close();
      return;
    }
    const capHeight =
      this.#host.capHeight() ?? lineBox.baseline - 0.7 * lineBox.pxPerEm;
    const { width, height } = image;
    const { left, right } = view.visible;
    this.#setPicture({
      image,
      width,
      height,
      placement: symbol
        ? placeSymbolImage(height)
        : placePicture(
            width,
            height,
            { left, top: 0, right, bottom: lineBox.height },
            { x: view.center, y: (capHeight + lineBox.baseline) / 2 },
          ),
    });
    this.#host.say(
      "Tracing over the picture. Move (M), then drag it or use the arrow keys; the wheel or + and − scale it",
    );
  }

  /** Stops tracing over the picture, and says so. */
  remove(): void {
    this.#setPicture(undefined);
    this.#host.say("Picture removed");
    this.#host.refocus();
  }

  /** Traces over `picture`, or over none, closing the one it replaces. */
  #setPicture(picture: TracedPicture | undefined): void {
    if (this.#picture?.image !== picture?.image) this.#picture?.image.close();
    this.#picture = picture;
    if (picture === undefined) this.#moving = false;
    if (this.#converting?.image !== picture?.image) this.#forgetConverting();
    this.#host.updateControls();
    this.#host.requestRender();
  }

  /** Puts the picture where `placement` says, and shows it there. */
  #place(placement: Placement): void {
    const picture = this.#picture;
    if (picture === undefined) return;
    this.#picture = { ...picture, placement };
    this.#host.requestRender();
  }

  /** Switches between moving the picture and drawing. */
  toggleMove(): void {
    if (this.#picture === undefined) {
      this.#host.say("Paste, drop, or choose a picture first, to move it");
      return;
    }
    this.#host.endPlacing();
    this.#moving = !this.#moving;
    this.#host.updateControls();
  }

  /** Draws again, rather than moving the picture, as a tool or shape does. */
  stopMoving(): void {
    this.#moving = false;
  }

  /** Starts dragging the picture from `at`, where the pointer is pressed. */
  startDrag(at: InputPoint): void {
    this.#dragged = at;
  }

  /**
   * Moves the picture with the pointer dragging it, by as far as the pointer
   * moved in the drawing since it last reported ({@link #dragged}), to `to`.
   */
  dragTo(to: InputPoint): void {
    const from = this.#dragged;
    if (from === undefined) return;
    this.#dragged = to;
    const picture = this.#picture;
    if (picture === undefined) return;
    this.#place(movePicture(picture.placement, to.x - from.x, to.y - from.y));
  }

  /** Ends a drag of the picture, which stays where it is. */
  endDrag(): void {
    this.#dragged = undefined;
  }

  /** Moves the picture by `dx` and `dy` document pixels. */
  move(dx: number, dy: number): void {
    const picture = this.#picture;
    if (picture === undefined) return;
    this.#place(movePicture(picture.placement, dx, dy));
  }

  /**
   * Scales the picture by `factor` about its middle, as the wheel does,
   * wherever the pointer is.
   */
  scaleBy(factor: number): void {
    const picture = this.#picture;
    if (picture === undefined) return;
    const { placement, width, height } = picture;
    this.#place(scaleAboutMiddle(placement, width, height, factor));
  }

  /** Scales the picture a step, `larger` or smaller, about its middle. */
  scaleStep(larger: boolean): void {
    this.scaleBy(larger ? keyScale : 1 / keyScale);
  }

  /**
   * Moves the picture `dx` along the drawing, as a save moves the drawing,
   * so that it stays where it was, and so does where a drag of it holds it.
   */
  moveWithDrawing(dx: number): void {
    if (this.#picture !== undefined) {
      this.#place(movePicture(this.#picture.placement, dx, 0));
    }
    if (this.#dragged !== undefined) {
      this.#dragged = { x: this.#dragged.x + dx, y: this.#dragged.y };
    }
  }

  /**
   * Lets go of the picture, for the editor after this one to take over, with
   * its x measured from the middle of the surface.
   */
  handOver(): TracedPicture | undefined {
    const picture = this.#picture;
    const view = this.#host.view();
    this.#picture = undefined;
    if (picture === undefined || view === undefined) {
      picture?.image.close();
      return undefined;
    }
    return {
      ...picture,
      placement: movePicture(picture.placement, -view.center, 0),
    };
  }

  /** Opens or closes what turns the picture into ink. */
  toggleConvert(): void {
    // Its row opens or closes once the pointer is let go, as Zoom waits.
    if (
      this.#host.held() &&
      (this.#converting !== undefined || this.#picture !== undefined)
    ) {
      const open = !this.inkOpen;
      // Asked for twice, it stays as it is.
      this.#inkWait =
        open === (this.#converting !== undefined) ? undefined : open;
      this.#host.updateControls();
      if (this.#inkWait !== undefined) {
        this.#host.say(
          open
            ? "Making ink once you let go"
            : "Closing Make ink once you let go",
        );
      }
      return;
    }
    if (this.#converting !== undefined) {
      this.cancelInk();
      return;
    }
    const picture = this.#picture;
    const view = this.#host.view();
    if (picture === undefined || view === undefined) {
      this.#host.say(
        "Paste, drop, or choose a picture first, to make ink of it",
      );
      return;
    }
    const luma = pictureLuminance(readPixels(picture.image));
    const copies = new Map([[1, luma]]);
    // The defaults come from the part that would become ink, as finely as
    // the preview traces it.
    const region = this.#inkRegion(view);
    const shrink = previewShrink(
      luma.width,
      luma.height,
      picture.placement,
      region,
    );
    // From the picture's own pixels, even where the ink comes from finer
    // samples: those add values between its own, not more of its tones.
    const source = copyOf(copies, shrink);
    const part = regionValues(
      source,
      shrunkPlace(picture.placement, shrink),
      region,
    );
    const { threshold, light } = inkDefaults(part ?? source);
    this.#converting = {
      image: picture.image,
      luma,
      copies,
      threshold,
      light,
    };
    this.#host.updateControls();
    this.#host.requestRender();
    this.#host.say(pictureHints.making);
    this.#host.focusThreshold();
  }

  /**
   * What Make ink waited for while the pointer was pressed, now that it is
   * let go: whether it is to be open, or undefined to leave it as it is. It
   * waits for nothing more afterwards.
   */
  takeInkWait(): boolean | undefined {
    const wait = this.#inkWait;
    this.#inkWait = undefined;
    return wait;
  }

  /** Closes what turns the picture into ink, making none, and says so. */
  cancelInk(): void {
    this.#stopConverting();
    this.#host.say("No ink made");
  }

  /** Closes what turns the picture into ink, making none. */
  #stopConverting(): void {
    this.#forgetConverting();
    this.#host.updateControls();
    this.#host.requestRender();
    this.#host.refocus();
  }

  setThreshold(value: number): void {
    const converting = this.#converting;
    if (converting === undefined || !Number.isFinite(value)) return;
    converting.threshold = Math.min(
      thresholdRange.max,
      Math.max(thresholdRange.min, Math.round(value)),
    );
    this.#host.requestRender();
  }

  toggleLight(): void {
    const converting = this.#converting;
    if (converting === undefined) return;
    converting.light = !converting.light;
    this.#host.updateControls();
    this.#host.requestRender();
  }

  /**
   * Where the picture becomes ink: the part the surface shows across, within
   * the line box's height, so that the rest of a screenshot of several
   * symbols stays out.
   */
  #inkRegion(view: PictureView): Bounds {
    const { left, right } = view.visible;
    return { left, top: 0, right, bottom: lineBox.height };
  }

  /**
   * While making ink, `document` with the picture's ink at the threshold as
   * its base layer, as `view` shows it; otherwise undefined, and the surface
   * shows the drawing as it is.
   */
  preview(
    view: PictureView,
    document: InkDocument,
  ): { document: InkDocument; base: DrawableBase | undefined } | undefined {
    const converting = this.#converting;
    const picture = this.#picture;
    if (converting === undefined || picture === undefined) return undefined;
    const region = this.#inkRegion(view);
    let area = this.#partShown;
    if (
      area?.placement !== picture.placement ||
      !sameBounds(area.region, region)
    ) {
      const { luma, copies } = converting;
      // As finely as the picture itself, unless too much of it is in view.
      const shrink = previewShrink(
        luma.width,
        luma.height,
        picture.placement,
        region,
      );
      const { part, place, edge } = inkPart(
        copies,
        picture.placement,
        region,
        shrink,
      );
      area = { placement: picture.placement, region, place, part, edge };
      this.#partShown = area;
    }
    const { place, edge } = area;
    let shown = this.#inkShown;
    if (
      shown === undefined ||
      shown.part !== area.part ||
      shown.threshold !== converting.threshold ||
      shown.light !== converting.light
    ) {
      const ink =
        area.part &&
        traceRegion(
          area.part,
          place,
          converting.threshold,
          converting.light,
          edge,
        );
      shown = {
        part: area.part,
        threshold: converting.threshold,
        light: converting.light,
        base: ink && previewInk(ink, place.scale),
        documents: new WeakMap(),
      };
      this.#inkShown = shown;
    }
    const { base } = shown;
    // One document per drawing, so that the surface redraws only on a change.
    let previewed = shown.documents.get(document);
    if (previewed === undefined) {
      previewed =
        base === undefined
          ? { strokes: document.strokes }
          : {
              strokes: document.strokes,
              // Only where it goes; the view draws the preview's own pixels.
              base: {
                x: base.x,
                y: base.y,
                width: base.width,
                height: base.height,
                png: new Uint8Array(),
              },
            };
      shown.documents.set(document, previewed);
    }
    return { document: previewed, base };
  }

  /**
   * Makes the picture's ink at the threshold the drawing's base layer, in
   * place of any it had, as one step that Undo takes back. The picture stays,
   * to trace over or to make ink of again.
   */
  applyInk(): Promise<void> {
    if (this.#applying === undefined) {
      this.#applying = this.#makeInk().finally(() => {
        this.#applying = undefined;
        // Closed meanwhile, the editor has no controls or focus to give back.
        if (this.#host.ended()) return;
        this.#host.updateControls();
        this.#host.focusAfterApply(this.#converting !== undefined);
      });
      this.#host.updateControls();
    }
    return this.#applying;
  }

  /**
   * Makes the ink being previewed, before a save, so that the save keeps
   * what the surface shows. Returns whether the save may go on, which it may
   * not when the threshold leaves no ink or the editor closed meanwhile.
   */
  async applyBeforeSave(): Promise<boolean> {
    if (!this.makingInk()) return true;
    await this.applyInk();
    return !this.makingInk() && !this.#host.ended();
  }

  /**
   * Makes the ink {@link applyInk} describes, from the picture at its own
   * resolution, or finer where it is enlarged. If the threshold, Light ink,
   * the picture, or the surface changed while the ink was encoded, it makes
   * the ink again, so that what it makes is what the surface shows.
   */
  async #makeInk(): Promise<void> {
    for (;;) {
      const converting = this.#converting;
      const picture = this.#picture;
      const view = this.#host.view();
      if (converting === undefined || picture === undefined || !view) return;
      const { threshold, light } = converting;
      const { placement } = picture;
      const region = this.#inkRegion(view);
      const { part, place, edge } = inkPart(
        converting.copies,
        placement,
        region,
        1,
      );
      if (part === undefined) {
        this.#host.say("No ink made: no part of the picture is on the surface");
        return;
      }
      const ink = traceRegion(part, place, threshold, light, edge);
      if (ink === undefined) {
        this.#host.say("No ink at this threshold: try another");
        return;
      }
      let made: MadeInk;
      this.#host.say("Making ink…", () => this.#applying !== undefined);
      try {
        made = await baseFromInk(ink, place.scale);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.#host.say(`No ink made: ${reason}`);
        return;
      }
      // Closed, or made ink of meanwhile, or put off.
      if (this.#host.ended() || this.#converting !== converting) return;
      if (
        converting.threshold !== threshold ||
        converting.light !== light ||
        this.#picture?.placement !== placement ||
        !sameBounds(this.#inkRegion(view), region)
      ) {
        continue;
      }
      this.#keepInk(made);
      return;
    }
  }

  /** Makes `made` the drawing's base layer, closing what made it. */
  #keepInk(made: MadeInk): void {
    const hadBase = this.#host.useInk(made);
    this.#forgetConverting();
    this.#host.changed();
    this.#host.refocus();
    this.#host.say(
      hadBase
        ? "Made ink of the picture, in place of the base layer before; Undo takes it back"
        : "Made ink of the picture; Undo takes it back",
    );
  }

  /** Lets go of what made ink of the picture, and what it showed. */
  #forgetConverting(): void {
    this.#converting = undefined;
    this.#partShown = undefined;
    this.#inkShown = undefined;
  }

  /**
   * Closes the picture, and one still being decoded as it arrives, and lets
   * go of Make ink. It can be called twice.
   */
  dispose(): void {
    this.#requests++;
    this.#picture?.image.close();
    this.#picture = undefined;
    this.#forgetConverting();
  }
}
