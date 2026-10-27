// Synthetic pictures for the tracing tests: made in the renderer, put on the
// system clipboard or dropped on the surface, and found again in the
// surface's pixels.

/** A rectangle drawn on a picture, in its pixels and a CSS colour. */
export interface Mark {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly colour: string;
}

/**
 * A picture of `width` × `height` pixels in one CSS colour, with `marks`
 * drawn on it, as a PNG.
 */
export async function picture(
  width: number,
  height: number,
  colour: string,
  marks: readonly Mark[] = [],
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  context.fillStyle = colour;
  context.fillRect(0, 0, width, height);
  for (const mark of marks) {
    context.fillStyle = mark.colour;
    context.fillRect(mark.x, mark.y, mark.width, mark.height);
  }
  return canvas.convertToBlob({ type: "image/png" });
}

interface Clipboard {
  writeImage(image: unknown): void;
  writeText(text: string): void;
}

interface NativeImage {
  createFromDataURL(url: string): unknown;
}

/** Electron's clipboard and images, which Obsidian's renderer can require. */
function electron(): { clipboard: Clipboard; nativeImage: NativeImage } {
  const load: unknown = Reflect.get(window, "require");
  if (typeof load !== "function") throw new Error("no require");
  const module: unknown = Reflect.apply(load, window, ["electron"]);
  const clipboard: unknown = Reflect.get(Object(module), "clipboard");
  const nativeImage: unknown = Reflect.get(Object(module), "nativeImage");
  const has = (value: unknown, method: string): boolean =>
    typeof Reflect.get(Object(value), method) === "function";
  if (
    !has(clipboard, "writeImage") ||
    !has(clipboard, "writeText") ||
    !has(nativeImage, "createFromDataURL")
  ) {
    throw new Error("no Electron clipboard in the renderer");
  }
  // Checked just above, as far as the tests use them.
  return {
    clipboard: clipboard as Clipboard,
    nativeImage: nativeImage as NativeImage,
  };
}

/** Puts a picture on the system clipboard, as copying a screenshot does. */
export async function copyPicture(
  width: number,
  height: number,
  colour: string,
  marks: readonly Mark[] = [],
): Promise<void> {
  const blob = await picture(width, height, colour, marks);
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { result } = reader;
      if (typeof result === "string") resolve(result);
      else reject(new Error("the picture did not read as a URL"));
    };
    reader.onerror = () => {
      reject(new Error("could not read the picture"));
    };
    reader.readAsDataURL(blob);
  });
  const { clipboard, nativeImage } = electron();
  clipboard.writeImage(nativeImage.createFromDataURL(url));
}

/** Puts text on the system clipboard. */
export function copyText(text: string): void {
  electron().clipboard.writeText(text);
}

/**
 * Drops `item` on the middle of `target`: a file, as dragging it from a
 * folder does, or a URI list, as Obsidian's file explorer drags a vault file.
 */
export function drop(target: Element, item: File | { uriList: string }): void {
  const data = new DataTransfer();
  if (item instanceof File) data.items.add(item);
  else data.setData("text/uri-list", item.uriList);
  const rect = target.getBoundingClientRect();
  const at = {
    bubbles: true,
    cancelable: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    dataTransfer: data,
  };
  for (const type of ["dragenter", "dragover", "drop"]) {
    target.dispatchEvent(new DragEvent(type, at));
  }
}

/** Whether a pixel is clearly red or blue, as no ink is. */
function tinted(colour: "red" | "blue", r: number, g: number, b: number) {
  return colour === "red" ? r - Math.max(g, b) > 100 : b - Math.max(r, g) > 100;
}

/** The custom properties the surface's guides take their colours from. */
const guideProperties = [
  "--inkline-guide",
  "--inkline-guide-ascender",
  "--inkline-guide-cap-height",
  "--inkline-guide-x-height",
  "--inkline-guide-baseline",
  "--inkline-guide-descender",
];

/**
 * The colours the guides on `canvas` are drawn in, as RGB: crisp and opaque,
 * over any picture, so that a pixel in one of them is a guide's.
 */
function guideColours(canvas: HTMLCanvasElement): number[][] {
  const probe = new OffscreenCanvas(1, 1).getContext("2d");
  if (probe === null) throw new Error("no 2D canvas context");
  const style = getComputedStyle(canvas);
  return guideProperties
    .map((name) => style.getPropertyValue(name).trim())
    .filter((value) => value !== "")
    .map((value) => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = value;
      probe.fillRect(0, 0, 1, 1);
      return [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    });
}

/** Whether `r`, `g`, `b` is one of `colours`, within rounding. */
function among(colours: number[][], r: number, g: number, b: number) {
  return colours.some(
    ([cr = 0, cg = 0, cb = 0]) =>
      Math.abs(r - cr) <= 3 && Math.abs(g - cg) <= 3 && Math.abs(b - cb) <= 3,
  );
}

/**
 * Where the surface shows a red or blue picture, in its device pixels, with
 * the opacity of the pixel in the middle; or undefined when it shows none.
 */
export function shown(
  canvas: HTMLCanvasElement,
  colour: "red" | "blue",
):
  | {
      left: number;
      top: number;
      right: number;
      bottom: number;
      alpha: number;
    }
  | undefined {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  const { width, height } = canvas;
  const { data } = context.getImageData(0, 0, width, height);
  const guides = guideColours(canvas);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if ((data[at + 3] ?? 0) === 0) continue;
      const [r = 0, g = 0, b = 0] = data.subarray(at, at + 3);
      if (!tinted(colour, r, g, b) || among(guides, r, g, b)) {
        continue;
      }
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
  }
  if (right < 0) return undefined;
  const middle =
    (Math.floor((top + bottom) / 2) * width + Math.floor((left + right) / 2)) *
    4;
  return { left, top, right, bottom, alpha: data[middle + 3] ?? 0 };
}

/**
 * How many pixels of row `y` of the surface, from `left` to `right`, are
 * drawn in a guide's colour, as a red or blue picture is not.
 */
export function guideIn(
  canvas: HTMLCanvasElement,
  y: number,
  left: number,
  right: number,
): number {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  const { data } = context.getImageData(left, y, right - left, 1);
  const guides = guideColours(canvas);
  let count = 0;
  for (let at = 0; at < data.length; at += 4) {
    const [r = 0, g = 0, b = 0, a = 0] = data.subarray(at, at + 4);
    if (a > 0 && among(guides, r, g, b)) count++;
  }
  return count;
}

/**
 * The colour at device pixel `x`, `y` of `canvas`, and whether it is the
 * canvas's text colour, as ink is drawn in, fully opaque.
 */
export function inkAt(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): { rgba: number[]; ink: boolean } {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  const rgba = [...context.getImageData(x, y, 1, 1).data];
  const probe = new OffscreenCanvas(1, 1).getContext("2d");
  if (probe === null) throw new Error("no 2D canvas context");
  probe.fillStyle = getComputedStyle(canvas).color;
  probe.fillRect(0, 0, 1, 1);
  const text = [...probe.getImageData(0, 0, 1, 1).data];
  const ink =
    rgba[3] === 255 &&
    [0, 1, 2].every(
      (channel) => Math.abs((rgba[channel] ?? 0) - (text[channel] ?? 0)) <= 3,
    );
  return { rgba, ink };
}
