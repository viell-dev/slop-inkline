import { browser } from "@wdio/globals";

/** Read the actual cursor PNG through the host's image decoder, not a screenshot. */
export async function cursorImage(): Promise<{
  css: string;
  width: number;
  height: number;
  hotspot: number[];
  diameter: number;
  pixels: number[];
}> {
  return browser.execute(async () => {
    const surface = document.querySelector(".inkline-surface");
    if (surface === null) throw new Error("no surface");
    const css = getComputedStyle(surface).cursor;
    const source = /data:image\/png;base64,[A-Za-z0-9+/=]+/.exec(css)?.[0];
    const hotspot = /\) (\d+) (\d+), crosshair$/.exec(css);
    if (source === undefined || hotspot === null)
      throw new Error(`no native brush image: ${css}`);
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = createEl("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no context");
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const cx = Number(hotspot[1]);
    const cy = Number(hotspot[2]);
    // Black-coverage centroids of the ring at its horizontal midline. This
    // measures fractional diameters without rounding to the padded PNG size.
    const centre = (start: number, end: number): number => {
      let sum = 0;
      let weight = 0;
      for (let x = start; x < end; x++) {
        const at = (cy * canvas.width + x) * 4;
        const amount =
          ((255 - (pixels[at] ?? 255)) / 255) * ((pixels[at + 3] ?? 0) / 255);
        sum += (x + 0.5) * amount;
        weight += amount;
      }
      return sum / weight;
    };
    return {
      css,
      width: canvas.width,
      height: canvas.height,
      hotspot: [cx, cy],
      diameter: centre(cx + 3, canvas.width) - centre(0, cx - 3),
      pixels: [...pixels],
    };
  });
}

export async function hasBrushCursor(): Promise<boolean> {
  const cursor = await browser.$(".inkline-surface").getCSSProperty("cursor");
  return (
    typeof cursor.value === "string" && cursor.value.includes("data:image/png")
  );
}
