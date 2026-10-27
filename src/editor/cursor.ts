export interface BrushCursor {
  readonly hotspot: number;
  readonly pixels: ImageData;
  readonly covered: readonly number[];
  readonly context: CanvasRenderingContext2D;
  readonly backdrop: CanvasRenderingContext2D;
}

// sRGB relative luminance; choose whichever of black/white has greater
// contrast. The crossover solves (L + .05)/.05 = 1.05/(L + .05).
const linear = Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
});
const crossover = Math.sqrt(1.05 * 0.05) - 0.05;

/**
 * Paint a fixed brush bitmap in device pixels. Its DOM canvas is moved at
 * whole device-pixel offsets, never repainted at fractional layout positions.
 * Unlike native CSS cursors, this follows both page zoom and display density.
 * Returns its fixed coverage and centred hotspot, or undefined for a fallback.
 */
export function paintBrushCursor(
  canvas: HTMLCanvasElement,
  diameter: number,
  ratio: number,
): BrushCursor | undefined {
  if (
    !Number.isFinite(diameter) ||
    diameter <= 0 ||
    !Number.isFinite(ratio) ||
    ratio <= 0
  )
    return undefined;
  const hotspot = Math.ceil((diameter / 2 + 2) * ratio);
  const side = hotspot * 2;
  // Bound allocations for malformed input or extreme display settings.
  if (side > 1024) return undefined;
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (context === null) return undefined;
  // Detached readback canvas in the surface's document, including popouts.
  const sample = canvas.ownerDocument.defaultView?.createEl("canvas");
  if (sample === undefined) return undefined;
  sample.width = side;
  sample.height = side;
  const backdrop = sample.getContext("2d", { willReadFrequently: true });
  if (backdrop === null) return undefined;
  const pixels = context.createImageData(side, side);
  const covered: number[] = [];
  const coverage = (distance: number): number =>
    Math.max(0, Math.min(1, distance + 0.5));
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const distance = Math.hypot(x + 0.5 - hotspot, y + 0.5 - hotspot);
      const ring = Math.abs(distance - (diameter * ratio) / 2);
      // One CSS pixel of ring and a centred dot, with no outer halo.
      // Coverage is fixed and symmetric; only RGB changes with the backdrop.
      const alpha = Math.max(
        coverage(0.5 * ratio - ring),
        coverage(ratio - distance),
      );
      const at = (y * side + x) * 4;
      pixels.data[at + 3] = 255 * alpha;
      if ((pixels.data[at + 3] ?? 0) > 0) covered.push(at);
    }
  }
  context.putImageData(pixels, 0, 0);
  return { hotspot, pixels, covered, context, backdrop };
}

/**
 * Colour the fixed coverage from the surface under it, including transparent
 * tracing pixels over the CSS background. left/top are CSS content offsets.
 * A small reusable readback canvas avoids reading the entire drawing.
 */
export function contrastBrushCursor(
  brush: BrushCursor,
  surface: HTMLCanvasElement,
  left: number,
  top: number,
  ratio: number,
): boolean {
  const win = surface.ownerDocument.defaultView;
  if (win === null || surface.clientWidth === 0 || surface.clientHeight === 0)
    return false;
  const { pixels, context, backdrop, covered } = brush;
  const { width, height } = pixels;
  const scaleX = surface.width / surface.clientWidth;
  const scaleY = surface.height / surface.clientHeight;
  try {
    backdrop.clearRect(0, 0, width, height);
    backdrop.fillStyle = win.getComputedStyle(surface).backgroundColor;
    backdrop.fillRect(0, 0, width, height);
    backdrop.drawImage(
      surface,
      left * scaleX,
      top * scaleY,
      (width / ratio) * scaleX,
      (height / ratio) * scaleY,
      0,
      0,
      width,
      height,
    );
    const sample = backdrop.getImageData(0, 0, width, height).data;
    for (const at of covered) {
      // A transparent custom surface does not describe its actual backdrop.
      // Keep the native fallback rather than guess at an invisible colour.
      if (sample[at + 3] !== 255) return false;
      const luminance =
        0.2126 * (linear[sample[at] ?? 0] ?? 0) +
        0.7152 * (linear[sample[at + 1] ?? 0] ?? 0) +
        0.0722 * (linear[sample[at + 2] ?? 0] ?? 0);
      const colour = luminance > crossover ? 0 : 255;
      pixels.data[at] = colour;
      pixels.data[at + 1] = colour;
      pixels.data[at + 2] = colour;
    }
    context.putImageData(pixels, 0, 0);
    return true;
  } catch (error) {
    if (error instanceof win.DOMException) return false;
    throw error;
  }
}
