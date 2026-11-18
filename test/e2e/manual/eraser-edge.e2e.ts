// Investigates #341: as the eraser moves along the edge of a filled ellipse,
// the edge of the ink beside it moves. It draws a filled ellipse, erases
// across and along its edge with each brush size, slowly and quickly, with
// Zoom off and on, and reads the drawing area's pixels back in every frame
// the editor draws while the pointer moves. It compares each frame with the
// one before, with a redraw of the eraser's points so far, with the result
// after the release, and with the exact sweep of a round brush along the
// points. It sits outside the suite and asserts nothing: it writes its
// numbers to eraser-edge-<version>.json in the end-to-end output, and, under
// screenshots/<version>/, eraser-edge-<case>.png: the frame where most ink
// came back outside the brush, before and after, and what changed, red where
// ink came back and blue where it went, with the brush's circle in green.
// Run it after `npm run build` with
// `npm run test:e2e:docker -- --spec test/e2e/manual/eraser-edge.e2e.ts`.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { insert } from "../support/editing.ts";
import { settledSurface, startOver } from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";
import { saveScreenshotData } from "../support/screenshots.ts";
import { framesDrawn } from "../support/waits.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);

type Doc = readonly [number, number];

/** The filled ellipse's box, in document pixels: centre (288, 96). */
const ellipseBox = { left: 172.8, top: 28.8, right: 403.2, bottom: 163.2 };
const centre: Doc = [288, 96];
const rx = (ellipseBox.right - ellipseBox.left) / 2;
const ry = (ellipseBox.bottom - ellipseBox.top) / 2;

/** Paths the eraser takes, in document pixels, sampled finely. */
const paths: Record<string, (t: number) => Doc> = {
  // Along the ellipse's right side, the brush's centre on its edge.
  "edge-arc": (t) => {
    const angle = (-60 + 120 * t) * (Math.PI / 180);
    return [centre[0] + rx * Math.cos(angle), centre[1] + ry * Math.sin(angle)];
  },
  // A half circle through the ink, as when rounding a corner.
  "inner-arc": (t) => {
    const angle = Math.PI + Math.PI * t;
    return [centre[0] + 35 * Math.cos(angle), centre[1] + 35 * Math.sin(angle)];
  },
  // Straight along, inside the top edge.
  "straight-along": (t) => [230 + 116 * t, 70],
  // Across the right edge, from outside, a little slanted.
  across: (t) => [430 - 80 * t, 112 - 14 * t],
};

/** Each size's key and its diameter in document pixels. */
const sizes = [
  { key: "1", label: "S", diameter: 6 },
  { key: "2", label: "M", diameter: 12 },
  { key: "3", label: "L", diameter: 18 },
  { key: "4", label: "XL", diameter: 24 },
] as const;

/** CSS pixels between the pointer's moves, slowly and quickly. */
const speeds = { slow: 1, fast: 8 } as const;

interface View {
  scale: number;
  originX: number;
  left: number;
  top: number;
}

/** How the surface maps the document, as the editor lays it out. */
async function view(): Promise<View> {
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
function pointerPath(
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

/** Starts reading the surface's pixels after every frame the editor draws. */
async function record(): Promise<void> {
  await browser.execute(() => {
    const canvas = document.querySelector(".inkline-editor .inkline-surface");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no context");
    interface Frame {
      alpha: Uint8Array;
      pointer: { x: number; y: number } | undefined;
    }
    const probe = {
      frames: [] as Frame[],
      last: undefined as { x: number; y: number } | undefined,
      up: undefined as { x: number; y: number } | undefined,
      down: undefined as { x: number; y: number } | undefined,
      events: 0,
      scheduled: false,
      stop: (): void => undefined,
    };
    const read = (): void => {
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const alpha = new Uint8Array(canvas.width * canvas.height);
      for (let index = 0; index < alpha.length; index++) {
        alpha[index] = data[index * 4 + 3] ?? 0;
      }
      probe.frames.push({ alpha, pointer: probe.last });
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
      probe.down = { x: event.clientX, y: event.clientY };
      probe.last = probe.down;
      frame();
    };
    const move = (event: PointerEvent): void => {
      if (probe.down === undefined || probe.up !== undefined) return;
      probe.events += 1;
      probe.last = { x: event.clientX, y: event.clientY };
      frame();
    };
    const up = (event: PointerEvent): void => {
      probe.up = { x: event.clientX, y: event.clientY };
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

/** Drags the mouse through `points`, pausing `pause` ms after each move. */
async function drag(
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
async function draftHolds(count: number): Promise<void> {
  await browser.waitUntil(async () =>
    browser.executeObsidian(({ app }, wanted) => {
      const [draft] = new window.inklineTest.drafts.DraftStore(app).list();
      return draft?.strokes.length === wanted;
    }, count),
  );
}

interface Analysis {
  frames: number;
  points: number;
  /** Frames whose pixels differ from a redraw of the points so far. */
  unmatched: number;
  mismatchedPixels: number;
  /** The pointer's first point against the stroke's, in units. */
  mapping: { dx: number; dy: number };
  /** Pixels, over all frames, where ink came back by at least 64 of 255. */
  returned: number;
  /** ...more than 1 px outside the brush's circle at that frame. */
  returnedOutside: number;
  framesReturnedOutside: number;
  /** How far outside the brush's circle ink came back, in document pixels. */
  returnedFarthest: number;
  /** Pixels erased more than 1 px outside the brush's circle at that frame. */
  erasedOutside: number;
  erasedFarthest: number;
  /** Most pixels of ink left more than 1 px inside the brush's circle. */
  underBrush: number;
  /** Pixels that differ between the last frame and the committed drawing. */
  releaseChanged: number;
  /** Pixels shown erased in some frame and inked after the release. */
  restored: number;
  /** Ink left more than 1 px inside the round brush's exact sweep. */
  missing: number;
  /** Ink erased more than 1 px outside it. */
  extra: number;
  worstFrame: number;
  /** The scale, CSS pixels per document pixel. */
  scale: number;
  /** The eraser's points in units, and how many each frame showed. */
  strokePoints: number[];
  prefixes: number[];
  picture: string | undefined;
}

/** Works out what moved, from the frames the probe read. */
async function analyse(diameter: number): Promise<Analysis> {
  await framesDrawn();
  return browser.executeObsidian(async ({ app }, wantedDiameter) => {
    const probe = Reflect.get(window, "eraserProbe") as {
      frames: {
        alpha: Uint8Array;
        pointer: { x: number; y: number } | undefined;
      }[];
      down: { x: number; y: number } | undefined;
      stop: () => void;
    };
    probe.stop();
    const canvas = document.querySelector(".inkline-editor .inkline-surface");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no surface");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no context");
    const { width, height } = canvas;
    const final = context.getImageData(0, 0, width, height).data;
    const finalAlpha = new Uint8Array(width * height);
    for (let index = 0; index < finalAlpha.length; index++) {
      finalAlpha[index] = final[index * 4 + 3] ?? 0;
    }
    const scale =
      Number.parseFloat(
        canvas.style.getPropertyValue("--inkline-surface-height"),
      ) / 192;
    const across = canvas.clientWidth / scale;
    const originX = Math.round(288 - across / 2);
    const factor = scale * window.devicePixelRatio;
    const rect = canvas.getBoundingClientRect();
    const toDoc = (client: { x: number; y: number }) => ({
      x: (client.x - rect.left - canvas.clientLeft) / scale + originX,
      y: (client.y - rect.top - canvas.clientTop) / scale,
    });
    const [draft] = new window.inklineTest.drafts.DraftStore(app).list();
    const [fill, eraser] = draft?.strokes ?? [];
    if (fill === undefined || eraser === undefined)
      throw new Error("no strokes");
    if (eraser.kind !== undefined || eraser.tool !== "eraser") {
      throw new Error("not a smooth eraser stroke");
    }
    const points = eraser.points;
    const r = eraser.size / 32;
    if (Math.abs(r * 2 - wantedDiameter) > 1e-9) throw new Error("wrong size");
    const firstDoc = toDoc(probe.down ?? { x: 0, y: 0 });
    const mapping = {
      dx: Math.round(firstDoc.x * 16) - (points[0] ?? 0),
      dy: Math.round(firstDoc.y * 16) - (points[1] ?? 0),
    };
    const { drawInk } = window.inklineTest.render;
    const redraw = (eraserPoints: readonly number[]): Uint8Array => {
      const work = new OffscreenCanvas(width, height);
      const drawn = work.getContext("2d");
      if (drawn === null) throw new Error("no context");
      drawn.setTransform(factor, 0, 0, factor, -originX * factor, 0);
      drawInk(
        drawn,
        [fill, { ...eraser, points: [...eraserPoints] }],
        undefined,
      );
      const { data } = drawn.getImageData(0, 0, width, height);
      const alpha = new Uint8Array(width * height);
      for (let index = 0; index < alpha.length; index++) {
        alpha[index] = data[index * 4 + 3] ?? 0;
      }
      return alpha;
    };
    const centreOf = (index: number) => ({
      x: ((index % width) + 0.5) / factor + originX,
      y: (Math.floor(index / width) + 0.5) / factor,
    });
    const frames = probe.frames;
    const before = frames[0]?.alpha ?? finalAlpha;
    const result = {
      frames: frames.length,
      points: points.length / 2,
      unmatched: 0,
      mismatchedPixels: 0,
      mapping,
      returned: 0,
      returnedOutside: 0,
      framesReturnedOutside: 0,
      returnedFarthest: 0,
      erasedOutside: 0,
      erasedFarthest: 0,
      underBrush: 0,
      releaseChanged: 0,
      restored: 0,
      missing: 0,
      extra: 0,
      worstFrame: -1,
      scale,
      strokePoints: [...points],
      prefixes: [] as number[],
      picture: undefined as string | undefined,
    };
    const least = new Uint8Array(before);
    let at = 0;
    let worst = 0;
    for (let f = 1; f < frames.length; f++) {
      const frame = frames[f];
      const previous = frames[f - 1];
      if (frame === undefined || previous === undefined) continue;
      const pointer =
        frame.pointer === undefined ? undefined : toDoc(frame.pointer);
      const from = at;
      // The points so far end where the pointer was for this frame.
      if (pointer !== undefined) {
        const ux = Math.round(pointer.x * 16);
        const uy = Math.round(pointer.y * 16);
        for (let index = at; index < points.length / 2; index++) {
          if (
            Math.abs((points[2 * index] ?? 0) - ux) <= 1 &&
            Math.abs((points[2 * index + 1] ?? 0) - uy) <= 1
          ) {
            at = index;
            break;
          }
        }
        result.prefixes.push(at + 1);
        const expected = redraw(points.slice(0, 2 * at + 2));
        let mismatched = 0;
        for (let index = 0; index < expected.length; index++) {
          if (
            Math.abs((expected[index] ?? 0) - (frame.alpha[index] ?? 0)) > 2
          ) {
            mismatched += 1;
          }
        }
        if (mismatched > 0) result.unmatched += 1;
        result.mismatchedPixels += mismatched;
      }
      // The way the brush went since the frame before, in pixels: a pixel
      // farther than its radius from that went nowhere near the brush.
      const swept: [number, number][] = [];
      for (let index = from; index <= at; index++) {
        swept.push([
          (points[2 * index] ?? 0) / 16,
          (points[2 * index + 1] ?? 0) / 16,
        ]);
      }
      const away = (x: number, y: number): number => {
        let best = Infinity;
        for (let k = 0; k < swept.length; k++) {
          const a = swept[k] ?? [0, 0];
          const b = swept[Math.min(k + 1, swept.length - 1)] ?? a;
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
      let outside = 0;
      let under = 0;
      for (let index = 0; index < frame.alpha.length; index++) {
        const now = frame.alpha[index] ?? 0;
        const then = previous.alpha[index] ?? 0;
        least[index] = Math.min(least[index] ?? 255, now);
        const change = now - then;
        if (pointer === undefined) continue;
        const { x, y } = centreOf(index);
        const inside = Math.hypot(x - pointer.x, y - pointer.y) - r;
        if (inside < -1 && (before[index] ?? 0) >= 192 && now >= 128)
          under += 1;
        if (Math.abs(change) < 64) continue;
        const beyond = away(x, y) - r;
        if (change >= 64) {
          result.returned += 1;
          if (beyond > 1) {
            outside += 1;
            result.returnedFarthest = Math.max(result.returnedFarthest, beyond);
          }
        } else if (change <= -64 && beyond > 1) {
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
    // The exact sweep of a round brush of the eraser's size along its points.
    const nearest = new Float32Array(width * height).fill(Infinity);
    const pixels: [number, number][] = [];
    for (let index = 0; index + 1 < points.length; index += 2) {
      pixels.push([(points[index] ?? 0) / 16, (points[index + 1] ?? 0) / 16]);
    }
    for (let k = 0; k < pixels.length; k++) {
      const a = pixels[k] ?? [0, 0];
      const b = pixels[Math.min(k + 1, pixels.length - 1)] ?? a;
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
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) / factor + originX;
          const y = (j + 0.5) / factor;
          const t =
            l2 === 0
              ? 0
              : Math.max(
                  0,
                  Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2),
                );
          const d = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
          const index = j * width + i;
          if (d < (nearest[index] ?? Infinity)) nearest[index] = d;
        }
      }
    }
    for (let index = 0; index < finalAlpha.length; index++) {
      const now = finalAlpha[index] ?? 0;
      if (Math.abs(now - (last[index] ?? 0)) >= 64) result.releaseChanged += 1;
      const inked = (before[index] ?? 0) >= 192;
      if (inked && (least[index] ?? 255) <= 64 && now >= 192)
        result.restored += 1;
      const d = nearest[index] ?? Infinity;
      if (inked && d < r - 1 && now >= 128) result.missing += 1;
      if (inked && d > r + 1 && now < 128) result.extra += 1;
    }
    // A picture of the frame where most ink came back outside the brush:
    // before, after, and what changed, red where ink came back and blue
    // where it went, with the brush's circle in green.
    const shown = frames[result.worstFrame];
    const shownBefore = frames[result.worstFrame - 1];
    if (shown?.pointer !== undefined && shownBefore !== undefined) {
      const pointer = toDoc(shown.pointer);
      const half = r + 14;
      const i0 = Math.max(0, Math.floor((pointer.x - half - originX) * factor));
      const j0 = Math.max(0, Math.floor((pointer.y - half) * factor));
      const side = Math.ceil(2 * half * factor);
      const zoom = Math.max(1, Math.round(240 / side));
      const picture = new OffscreenCanvas(side * zoom * 3 + 8, side * zoom);
      const drawn = picture.getContext("2d");
      if (drawn === null) throw new Error("no context");
      drawn.fillStyle = "white";
      drawn.fillRect(0, 0, picture.width, picture.height);
      for (let j = 0; j < side; j++) {
        for (let i = 0; i < side; i++) {
          const index = (j0 + j) * width + i0 + i;
          if (i0 + i >= width || j0 + j >= height) continue;
          const now = shown.alpha[index] ?? 0;
          const then = shownBefore.alpha[index] ?? 0;
          const grey = (a: number) =>
            `rgb(${String(255 - a)},${String(255 - a)},${String(255 - a)})`;
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
          panel * (side * zoom + 4) +
            ((pointer.x - originX) * factor - i0) * zoom,
          (pointer.y * factor - j0) * zoom,
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
  }, diameter);
}

describe("Erasing along an edge (#341)", function () {
  // Each Zoom setting takes 30 minutes or more on a busy machine.
  this.timeout(90 * 60 * 1000);
  const results: Record<string, Omit<Analysis, "picture">> = {};

  before(async function () {
    await loadModules();
    // Reading back hundreds of frames of a magnified surface takes a while.
    await browser.setTimeout({ script: 10 * 60 * 1000 });
  });

  beforeEach(async function () {
    await startOver();
  });

  after(async function () {
    const version = `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;
    await writeFile(
      path.join(outputDir, `eraser-edge-${version}.json`),
      `${JSON.stringify(results, null, 2)}\n`,
    );
  });

  for (const zoom of [false, true]) {
    it(`erases along a filled ellipse's edge with Zoom ${zoom ? "on" : "off"}`, async function () {
      await insert();
      await settledSurface();
      // No guides, so that the surface's pixels are the ink alone.
      await browser.keys(["g"]);
      // A filled ellipse with the pen.
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
      await draftHolds(1);
      // Freehand, with the eraser.
      await browser.keys(["o"]);
      await browser.keys(["e"]);
      if (zoom) {
        await browser.keys(["z"]);
        await settledSurface();
      }
      await framesDrawn();
      const at = await view();
      for (const [pathName, path] of Object.entries(paths)) {
        for (const [speedName, step] of Object.entries(speeds)) {
          for (const size of sizes) {
            await browser.keys([size.key]);
            await framesDrawn();
            await record();
            await drag(pointerPath(path, at, step), 8);
            await draftHolds(2);
            const { picture, ...numbers } = await analyse(size.diameter);
            const name = `${pathName}-${speedName}-${size.label}-zoom-${zoom ? "on" : "off"}`;
            results[name] = numbers;
            const { strokePoints, prefixes, ...shown } = numbers;
            console.log(
              name,
              strokePoints.length / 2,
              prefixes.length,
              JSON.stringify(shown),
            );
            if (typeof picture === "string") {
              await saveScreenshotData(`eraser-edge-${name}`, picture);
            }
            // Back to the whole ellipse.
            await browser.keys(["Control", "z"]);
            await draftHolds(1);
            await framesDrawn();
          }
        }
      }
    });
  }
});
