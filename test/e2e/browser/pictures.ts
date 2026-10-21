// Synthetic pictures for the tracing tests: made in the renderer, put on the
// system clipboard or dropped on the surface, and found again in the
// surface's pixels.

/** A picture of `width` × `height` pixels in one CSS colour, as a PNG. */
export async function picture(
  width: number,
  height: number,
  colour: string,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  context.fillStyle = colour;
  context.fillRect(0, 0, width, height);
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
): Promise<void> {
  const blob = await picture(width, height, colour);
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

/** Drops `file` on the middle of `target`, as dragging it from a folder does. */
export function drop(target: Element, file: File): void {
  const data = new DataTransfer();
  data.items.add(file);
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

/** Whether a pixel is clearly red or blue, as no ink or guide is. */
function tinted(colour: "red" | "blue", r: number, g: number, b: number) {
  return colour === "red" ? r - Math.max(g, b) > 100 : b - Math.max(r, g) > 100;
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
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if ((data[at + 3] ?? 0) === 0) continue;
      const [r = 0, g = 0, b = 0] = data.subarray(at, at + 3);
      if (!tinted(colour, r, g, b)) {
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
 * drawn in a grey, as the guides are and a red or blue picture is not.
 */
export function greyIn(
  canvas: HTMLCanvasElement,
  y: number,
  left: number,
  right: number,
): number {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas context");
  const { data } = context.getImageData(left, y, right - left, 1);
  let count = 0;
  for (let at = 0; at < data.length; at += 4) {
    const [r = 0, g = 0, b = 0, a = 0] = data.subarray(at, at + 4);
    if (a > 0 && Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2) count++;
  }
  return count;
}
