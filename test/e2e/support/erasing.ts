// Erasing a filled ellipse while reading the drawing area back in every frame
// the editor draws, for the eraser's tests (#341): its spec in specs/ and the
// probe of every brush size and speed in manual/.

import { browser } from "@wdio/globals";
import { insert } from "./editing.ts";
import { settledSurface } from "./editor.ts";
import { framesDrawn } from "./waits.ts";

/** A point in document pixels. */
export type Doc = readonly [number, number];

/** The filled ellipse's box, in document pixels: centre (288, 96). */
export const ellipseBox = {
  left: 172.8,
  top: 28.8,
  right: 403.2,
  bottom: 163.2,
};
const centre: Doc = [288, 96];
const rx = (ellipseBox.right - ellipseBox.left) / 2;
const ry = (ellipseBox.bottom - ellipseBox.top) / 2;

/** Ways the eraser goes, in document pixels, from `t` = 0 to 1. */
export const paths = {
  // Along the ellipse's right side, the brush's centre on its edge.
  "edge-arc": (t: number): Doc => {
    const angle = (-60 + 120 * t) * (Math.PI / 180);
    return [centre[0] + rx * Math.cos(angle), centre[1] + ry * Math.sin(angle)];
  },
  // A half circle through the ink, as when rounding a corner.
  "inner-arc": (t: number): Doc => {
    const angle = Math.PI + Math.PI * t;
    return [centre[0] + 35 * Math.cos(angle), centre[1] + 35 * Math.sin(angle)];
  },
  // Straight along, inside the top edge.
  "straight-along": (t: number): Doc => [230 + 116 * t, 70],
  // Across the right edge, from outside, a little slanted.
  across: (t: number): Doc => [430 - 80 * t, 112 - 14 * t],
  // A whole circle through the ink, which leaves an island in its middle.
  loop: (t: number): Doc => {
    const angle = -Math.PI / 2 + 2.1 * Math.PI * t;
    return [centre[0] + 30 * Math.cos(angle), centre[1] + 30 * Math.sin(angle)];
  },
  // Out and straight back, and out again at a sharp angle.
  "turning back": (t: number): Doc => {
    const corners: Doc[] = [
      [230, 96],
      [330, 96],
      [260, 100],
      [320, 60],
    ];
    const at = Math.min(t * 3, 2.9999);
    const index = Math.floor(at);
    const from = corners[index] ?? centre;
    const to = corners[index + 1] ?? from;
    const along = at - index;
    return [
      from[0] + (to[0] - from[0]) * along,
      from[1] + (to[1] - from[1]) * along,
    ];
  },
} as const;

export type PathName = keyof typeof paths;

/** Each size's key and its diameter in document pixels. */
export const sizes = [
  { key: "1", label: "S", diameter: 6 },
  { key: "2", label: "M", diameter: 12 },
  { key: "3", label: "L", diameter: 18 },
  { key: "4", label: "XL", diameter: 24 },
] as const;

/** CSS pixels between the pointer's moves, slowly and quickly. */
export const speeds = { slow: 1, fast: 8 } as const;

/** How the surface maps the document, as the editor lays it out. */
export interface View {
  scale: number;
  originX: number;
  left: number;
  top: number;
}

/** How the surface maps the document now. */
export async function view(): Promise<View> {
  return browser.execute(() => {
    const canvas = document.querySelector(".inkline-editor .inkline-surface");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
    const scale =
      Number.parseFloat(
        canvas.style.getPropertyValue("--inkline-surface-height"),
      ) / 192;
    const across = canvas.clientWidth / scale;
    const rect = canvas.getBoundingClientRect();
    return {
      scale,
      // A new symbol's view stays centred on 288, the middle of 4.5 em.
      originX: Math.round(288 - across / 2),
      left: rect.left + canvas.clientLeft,
      top: rect.top + canvas.clientTop,
    };
  });
}

/** Whole CSS pixels along `path`, `step` apart, as a mouse reports them. */
export function pointerPath(
  path: (t: number) => Doc,
  at: View,
  step: number,
): { x: number; y: number }[] {
  const client = (t: number) => {
    const [x, y] = path(t);
    return {
      x: at.left + (x - at.originX) * at.scale,
      y: at.top + y * at.scale,
    };
  };
  const out: { x: number; y: number }[] = [];
  let length = 0;
  let previous = client(0);
  out.push({ x: Math.round(previous.x), y: Math.round(previous.y) });
  let travelled = 0;
  for (let k = 1; k <= 4000; k++) {
    const next = client(k / 4000);
    length += Math.hypot(next.x - previous.x, next.y - previous.y);
    previous = next;
    if (length - travelled >= step || k === 4000) {
      travelled = length;
      const point = { x: Math.round(next.x), y: Math.round(next.y) };
      const last = out.at(-1);
      if (last?.x !== point.x || last.y !== point.y) out.push(point);
    }
  }
  return out;
}

/** Drags the mouse through `points`, pausing `pause` ms after each move. */
export async function drag(
  points: readonly { x: number; y: number }[],
  pause: number,
): Promise<void> {
  const [first, ...rest] = points;
  if (first === undefined) return;
  const action = browser.action("pointer", {
    parameters: { pointerType: "mouse" },
  });
  action.move({ origin: "viewport", ...first }).down();
  for (const point of rest) {
    action.move({ origin: "viewport", ...point, duration: 0 }).pause(pause);
  }
  action.up();
  await action.perform();
}

/** Waits until the newest draft holds `count` strokes. */
export async function draftHolds(count: number): Promise<void> {
  await browser.waitUntil(async () =>
    browser.executeObsidian(({ app }, wanted) => {
      const [draft] = new window.inklineTest.drafts.DraftStore(app).list();
      return draft?.strokes.length === wanted;
    }, count),
  );
}

/** How many strokes the newest draft holds once it holds any, and keeps. */
async function draftStrokes(): Promise<number> {
  let last = -1;
  let count = 0;
  await browser.waitUntil(async () => {
    const now = await browser.executeObsidian(({ app }) => {
      const [draft] = new window.inklineTest.drafts.DraftStore(app).list();
      return draft?.strokes.length ?? 0;
    });
    const settled = now > 0 && now === last;
    last = now;
    count = now;
    return settled;
  });
  return count;
}

/**
 * Opens the editor of a new symbol with no guides, so that the surface's
 * pixels are the ink alone, draws a filled ellipse with the pen, and chooses
 * the eraser, drawing freehand, with Zoom on if `zoom` says so. Gives the
 * surface's view, and how many strokes the ellipse is.
 */
export async function eraseFilledEllipse(
  zoom: boolean,
): Promise<{ view: View; strokes: number }> {
  await insert();
  await settledSurface();
  await browser.keys(["g"]);
  await browser.keys(["o"]);
  await browser.keys(["b"]);
  const plain = await view();
  const corner = (x: number, y: number) => ({
    x: Math.round(plain.left + (x - plain.originX) * plain.scale),
    y: Math.round(plain.top + y * plain.scale),
  });
  await drag(
    [
      corner(ellipseBox.left, ellipseBox.top),
      corner(ellipseBox.right, ellipseBox.bottom),
    ],
    10,
  );
  const strokes = await draftStrokes();
  await browser.keys(["o"]);
  await browser.keys(["e"]);
  if (zoom) {
    await browser.keys(["z"]);
    await settledSurface();
  }
  await framesDrawn();
  return { view: await view(), strokes };
}

/** Starts reading the surface's pixels after every frame the editor draws. */
export async function record(): Promise<void> {
  await browser.execute(() => {
    const canvas = document.querySelector(".inkline-editor .inkline-surface");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no context");
    const probe = {
      frames: [] as { alpha: Uint8Array; reported: number }[],
      /** Where the pointer was reported, from the press on, in CSS pixels. */
      pointer: [] as { x: number; y: number }[],
      up: false,
      scheduled: false,
      stop: (): void => undefined,
    };
    const read = (): void => {
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const alpha = new Uint8Array(canvas.width * canvas.height);
      for (let index = 0; index < alpha.length; index++) {
        alpha[index] = data[index * 4 + 3] ?? 0;
      }
      probe.frames.push({ alpha, reported: probe.pointer.length });
    };
    read();
    // Added after the editor's own listeners, so that in each frame this
    // reads after the editor has drawn it.
    const frame = (): void => {
      if (probe.scheduled) return;
      probe.scheduled = true;
      window.requestAnimationFrame(() => {
        probe.scheduled = false;
        read();
      });
    };
    const down = (event: PointerEvent): void => {
      probe.pointer.push({ x: event.clientX, y: event.clientY });
      frame();
    };
    const move = (event: PointerEvent): void => {
      if (probe.pointer.length === 0 || probe.up) return;
      const events = event.getCoalescedEvents();
      for (const each of events.length > 0 ? events : [event]) {
        probe.pointer.push({ x: each.clientX, y: each.clientY });
      }
      frame();
    };
    const up = (event: PointerEvent): void => {
      probe.pointer.push({ x: event.clientX, y: event.clientY });
      probe.up = true;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    probe.stop = () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
    };
    Reflect.set(window, "eraserProbe", probe);
  });
}

/** What moved while erasing, from the frames {@link record} read. */
export interface Analysis {
  /** Frames drawn while the pointer moved. */
  frames: number;
  /** The scale, CSS pixels per document pixel. */
  scale: number;
  /** The eraser stroke's kind as saved, or "smooth". */
  kind: string;
  /** Its points, in units, and how many the pointer reported. */
  points: number;
  reported: number;
  /**
   * The frames that differ from a redraw of the eraser's points so far, and
   * their pixels: for a smooth stroke, as its saved points go; for an area,
   * the area of the points the pointer reported so far.
   */
  unmatched: number;
  mismatchedPixels: number;
  /** Pixels, over all frames, where ink came back by at least 64 of 255. */
  returned: number;
  /** ...more than 1 px outside where the brush went since the frame before. */
  returnedOutside: number;
  framesReturnedOutside: number;
  /** How far outside the brush's edge ink came back, in document pixels. */
  returnedFarthest: number;
  /**
   * Pixels, over all frames, where ink came back by at least 64 of 255 more
   * than 1 px inside all the brush had swept so far: where it had been taken.
   */
  returnedInside: number;
  /** How far inside the swept area the deepest of them was, in pixels. */
  returnedDeepest: number;
  /** The most ink any pixel got back from one frame to the next, of 255. */
  largestRise: number;
  /** ...of those more than 1 px outside the brush's circle: behind it. */
  riseBehind: number;
  /**
   * Where that was: its frame, and how far its pixel is from the brush's
   * circle and from the edge of all it had swept, in document pixels, less
   * inside.
   */
  rise: {
    frame: number;
    fromBrush: number;
    fromEdge: number;
    /** The pixel's centre, in document pixels. */
    at: [number, number];
    /** How many points the pointer had reported, then and the frame before. */
    reported: [number, number];
  };
  /** The points the pointer reported, in units, as the editor records them. */
  way: number[];
  /** Pixels erased more than 1 px outside where the brush went. */
  erasedOutside: number;
  erasedFarthest: number;
  /** Most pixels of ink left more than 1 px inside the brush's circle. */
  underBrush: number;
  /**
   * Pixels that differ, by more than 2 of 255, between the last frame and the
   * committed drawing.
   */
  releaseChanged: number;
  /**
   * Pixels where the committed drawing differs, by more than 2 of 255, from a
   * redraw of its record.
   */
  redrawChanged: number;
  /** Pixels shown erased in some frame and inked after the release. */
  restored: number;
  /** Ink left more than 1 px inside the round brush's exact sweep. */
  missing: number;
  /** Ink erased more than 1 px outside it. */
  extra: number;
  /** The frame where most ink came back outside the brush, or -1. */
  worstFrame: number;
  /**
   * The alpha at document points asked for, before erasing and after: as in
   * the middle of a loop, which must keep its ink.
   */
  kept: { before: number; after: number }[];
  /** A picture of the worst frame, as a PNG in base64, if there is one. */
  picture: string | undefined;
}

/**
 * Works out what moved, from the frames {@link record} read, for an eraser
 * `diameter` document pixels wide, and the alpha at each of `keep`. With
 * `redraws` false, it does not compare each frame with a redraw of the points
 * so far, which takes most of its time; `unmatched` is then -1.
 */
export async function analyse(
  diameter: number,
  keep: readonly Doc[] = [],
  redraws = true,
): Promise<Analysis> {
  await framesDrawn();
  return browser.executeObsidian(
    async ({ app }, wantedDiameter, wantedPoints, compare) => {
      const probe = Reflect.get(window, "eraserProbe") as {
        frames: { alpha: Uint8Array; reported: number }[];
        pointer: { x: number; y: number }[];
        stop: () => void;
      };
      probe.stop();
      const canvas = document.querySelector(".inkline-editor .inkline-surface");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no context");
      const { width, height } = canvas;
      const alphaOf = (data: Uint8ClampedArray): Uint8Array => {
        const alpha = new Uint8Array(width * height);
        for (let index = 0; index < alpha.length; index++) {
          alpha[index] = data[index * 4 + 3] ?? 0;
        }
        return alpha;
      };
      const finalAlpha = alphaOf(
        context.getImageData(0, 0, width, height).data,
      );
      const scale =
        Number.parseFloat(
          canvas.style.getPropertyValue("--inkline-surface-height"),
        ) / 192;
      const across = canvas.clientWidth / scale;
      const originX = Math.round(288 - across / 2);
      const factor = scale * window.devicePixelRatio;
      const rect = canvas.getBoundingClientRect();
      const toDoc = (client: { x: number; y: number }): [number, number] => [
        (client.x - rect.left - canvas.clientLeft) / scale + originX,
        (client.y - rect.top - canvas.clientTop) / scale,
      ];
      const [draft] = new window.inklineTest.drafts.DraftStore(app).list();
      const strokes = draft?.strokes ?? [];
      const eraser = strokes.at(-1);
      if (eraser?.tool !== "eraser") throw new Error("no eraser stroke");
      const r = wantedDiameter / 2;
      const { drawInk } = window.inklineTest.render;
      const redraw = (drawn: typeof strokes): Uint8Array => {
        const work = new OffscreenCanvas(width, height);
        const target = work.getContext("2d");
        if (target === null) throw new Error("no context");
        target.setTransform(factor, 0, 0, factor, -originX * factor, 0);
        drawInk(target, drawn, undefined);
        return alphaOf(target.getImageData(0, 0, width, height).data);
      };
      const differing = (a: Uint8Array, b: Uint8Array): number => {
        let count = 0;
        for (let index = 0; index < a.length; index++) {
          if (Math.abs((a[index] ?? 0) - (b[index] ?? 0)) > 2) count++;
        }
        return count;
      };
      const centreOf = (index: number): [number, number] => [
        ((index % width) + 0.5) / factor + originX,
        (Math.floor(index / width) + 0.5) / factor,
      ];
      const way = probe.pointer.map(toDoc);
      const nearest = (
        x: number,
        y: number,
        from: number,
        to: number,
      ): number => {
        let best = Infinity;
        for (
          let k = Math.max(0, from);
          k <= Math.min(to, way.length - 1);
          k++
        ) {
          const a = way[k] ?? [0, 0];
          const b = way[Math.min(k + 1, to, way.length - 1)] ?? a;
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const l2 = dx * dx + dy * dy;
          const t =
            l2 === 0
              ? 0
              : Math.max(
                  0,
                  Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2),
                );
          best = Math.min(
            best,
            Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y),
          );
        }
        return best;
      };
      const frames = probe.frames;
      const before = frames[0]?.alpha ?? finalAlpha;
      const smooth = eraser.kind === undefined;
      const result = {
        frames: frames.length - 1,
        scale,
        kind: eraser.kind ?? "smooth",
        points: eraser.points.length / 2,
        reported: way.length,
        unmatched: compare ? 0 : -1,
        mismatchedPixels: compare ? 0 : -1,
        returned: 0,
        returnedOutside: 0,
        framesReturnedOutside: 0,
        returnedFarthest: 0,
        returnedInside: 0,
        returnedDeepest: 0,
        largestRise: 0,
        riseBehind: 0,
        rise: {
          frame: -1,
          fromBrush: 0,
          fromEdge: 0,
          at: [0, 0] as [number, number],
          reported: [0, 0] as [number, number],
        },
        way: way.flatMap(([x, y]) => [Math.round(x * 16), Math.round(y * 16)]),
        erasedOutside: 0,
        erasedFarthest: 0,
        underBrush: 0,
        releaseChanged: 0,
        redrawChanged: differing(finalAlpha, redraw(strokes)),
        restored: 0,
        missing: 0,
        extra: 0,
        worstFrame: -1,
        kept: [] as { before: number; after: number }[],
        picture: undefined as string | undefined,
      };
      const least = new Uint8Array(before);
      let worst = 0;
      let at = 0;
      for (let f = 1; f < frames.length; f++) {
        const frame = frames[f];
        const previous = frames[f - 1];
        if (frame === undefined || previous === undefined) continue;
        const reported = frame.reported;
        if (reported === 0) continue;
        const pointer = way[reported - 1] ?? [0, 0];
        // A smooth stroke's points so far end where the pointer was.
        if (compare && smooth) {
          const ux = Math.round(pointer[0] * 16);
          const uy = Math.round(pointer[1] * 16);
          for (let index = at; index < eraser.points.length / 2; index++) {
            if (
              Math.abs((eraser.points[2 * index] ?? 0) - ux) <= 1 &&
              Math.abs((eraser.points[2 * index + 1] ?? 0) - uy) <= 1
            ) {
              at = index;
              break;
            }
          }
          const mismatched = differing(
            redraw([
              ...strokes.slice(0, -1),
              { ...eraser, points: eraser.points.slice(0, 2 * at + 2) },
            ]),
            frame.alpha,
          );
          if (mismatched > 0) result.unmatched += 1;
          result.mismatchedPixels += mismatched;
        } else if (compare) {
          // The editor records the points the pointer reported, in units.
          const units = way
            .slice(0, reported)
            .flatMap(([x, y]) => [Math.round(x * 16), Math.round(y * 16)]);
          const mismatched = differing(
            redraw([
              ...strokes.slice(0, -1),
              window.inklineTest.sweep.sweptStroke(
                "eraser",
                wantedDiameter * 16,
                units,
              ),
            ]),
            frame.alpha,
          );
          if (mismatched > 0) result.unmatched += 1;
          result.mismatchedPixels += mismatched;
        }
        // Where the brush went since the frame before.
        const from = Math.max(0, (previous.reported || 1) - 1);
        let outside = 0;
        let under = 0;
        for (let index = 0; index < frame.alpha.length; index++) {
          const now = frame.alpha[index] ?? 0;
          const then = previous.alpha[index] ?? 0;
          least[index] = Math.min(least[index] ?? 255, now);
          const [x, y] = centreOf(index);
          const inside = Math.hypot(x - pointer[0], y - pointer[1]) - r;
          if (inside < -1 && (before[index] ?? 0) >= 192 && now >= 128) {
            under += 1;
          }
          const change = now - then;
          if (inside > 1)
            result.riseBehind = Math.max(result.riseBehind, change);
          if (change > result.largestRise) {
            result.largestRise = change;
            result.rise = {
              frame: f,
              fromBrush: inside,
              fromEdge: nearest(x, y, 0, reported - 1) - r,
              at: [x, y],
              reported: [reported, previous.reported],
            };
          }
          if (Math.abs(change) < 64) continue;
          const beyond = nearest(x, y, from, reported - 1) - r;
          if (change >= 64) {
            result.returned += 1;
            const swept = nearest(x, y, 0, reported - 1) - r;
            if (swept < -1) {
              result.returnedInside += 1;
              result.returnedDeepest = Math.max(result.returnedDeepest, -swept);
            }
            if (beyond > 1) {
              outside += 1;
              result.returnedFarthest = Math.max(
                result.returnedFarthest,
                beyond,
              );
            }
          } else if (beyond > 1) {
            result.erasedOutside += 1;
            result.erasedFarthest = Math.max(result.erasedFarthest, beyond);
          }
        }
        result.underBrush = Math.max(result.underBrush, under);
        result.returnedOutside += outside;
        if (outside > 0) result.framesReturnedOutside += 1;
        if (outside > worst) {
          worst = outside;
          result.worstFrame = f;
        }
      }
      const last = frames.at(-1)?.alpha ?? finalAlpha;
      // How far each pixel is from the way, near it: segment by segment, over
      // the pixels each could reach.
      const away = new Float32Array(width * height).fill(Infinity);
      for (let k = 0; k < way.length; k++) {
        const a = way[k] ?? [0, 0];
        const b = way[Math.min(k + 1, way.length - 1)] ?? a;
        const reach = r + 2;
        const i0 = Math.max(
          0,
          Math.floor((Math.min(a[0], b[0]) - reach - originX) * factor),
        );
        const i1 = Math.min(
          width - 1,
          Math.ceil((Math.max(a[0], b[0]) + reach - originX) * factor),
        );
        const j0 = Math.max(
          0,
          Math.floor((Math.min(a[1], b[1]) - reach) * factor),
        );
        const j1 = Math.min(
          height - 1,
          Math.ceil((Math.max(a[1], b[1]) + reach) * factor),
        );
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const index = j * width + i;
            const [x, y] = centreOf(index);
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const l2 = dx * dx + dy * dy;
            const t =
              l2 === 0
                ? 0
                : Math.max(
                    0,
                    Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2),
                  );
            const d = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
            if (d < (away[index] ?? Infinity)) away[index] = d;
          }
        }
      }
      for (let index = 0; index < finalAlpha.length; index++) {
        const now = finalAlpha[index] ?? 0;
        if (Math.abs(now - (last[index] ?? 0)) > 2) result.releaseChanged += 1;
        const inked = (before[index] ?? 0) >= 192;
        if (!inked) continue;
        if ((least[index] ?? 255) <= 64 && now >= 192) result.restored += 1;
        const d = away[index] ?? Infinity;
        if (d < r - 1 && now >= 128) result.missing += 1;
        if (d > r + 1 && now < 128) result.extra += 1;
      }
      for (const [x, y] of wantedPoints) {
        const i = Math.floor((x - originX) * factor);
        const j = Math.floor(y * factor);
        result.kept.push({
          before: before[j * width + i] ?? -1,
          after: finalAlpha[j * width + i] ?? -1,
        });
      }
      // A picture of the frame where most ink came back outside the brush:
      // before, after, and what changed, red where ink came back and blue
      // where it went, with the brush's circle in green.
      const pictured =
        result.worstFrame >= 0 ? result.worstFrame : result.rise.frame;
      const shown = frames[pictured];
      const shownBefore = frames[pictured - 1];
      const shownPointer =
        shown === undefined ? undefined : way[shown.reported - 1];
      if (
        shown !== undefined &&
        shownBefore !== undefined &&
        shownPointer !== undefined
      ) {
        const [px, py] = shownPointer;
        const half = r + 14;
        const i0 = Math.max(0, Math.floor((px - half - originX) * factor));
        const j0 = Math.max(0, Math.floor((py - half) * factor));
        const side = Math.ceil(2 * half * factor);
        const zoom = Math.max(1, Math.round(240 / side));
        const picture = new OffscreenCanvas(side * zoom * 3 + 8, side * zoom);
        const drawn = picture.getContext("2d");
        if (drawn === null) throw new Error("no context");
        drawn.fillStyle = "white";
        drawn.fillRect(0, 0, picture.width, picture.height);
        const grey = (a: number): string =>
          `rgb(${String(255 - a)},${String(255 - a)},${String(255 - a)})`;
        for (let j = 0; j < side; j++) {
          for (let i = 0; i < side; i++) {
            if (i0 + i >= width || j0 + j >= height) continue;
            const index = (j0 + j) * width + i0 + i;
            const now = shown.alpha[index] ?? 0;
            const then = shownBefore.alpha[index] ?? 0;
            drawn.fillStyle = grey(then);
            drawn.fillRect(i * zoom, j * zoom, zoom, zoom);
            drawn.fillStyle = grey(now);
            drawn.fillRect(side * zoom + 4 + i * zoom, j * zoom, zoom, zoom);
            const change = now - then;
            drawn.fillStyle =
              change >= 64
                ? "rgb(220,0,0)"
                : change <= -64
                  ? "rgb(0,80,255)"
                  : grey(Math.round(now / 3));
            drawn.fillRect(
              2 * (side * zoom + 4) + i * zoom,
              j * zoom,
              zoom,
              zoom,
            );
          }
        }
        drawn.strokeStyle = "rgb(0,170,0)";
        drawn.lineWidth = 1;
        for (let panel = 0; panel < 3; panel++) {
          drawn.beginPath();
          drawn.arc(
            panel * (side * zoom + 4) + ((px - originX) * factor - i0) * zoom,
            (py * factor - j0) * zoom,
            r * factor * zoom,
            0,
            2 * Math.PI,
          );
          drawn.stroke();
        }
        const blob = await picture.convertToBlob({ type: "image/png" });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        result.picture = btoa(
          Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
        );
      }
      return result;
    },
    diameter,
    keep,
    redraws,
  );
}
