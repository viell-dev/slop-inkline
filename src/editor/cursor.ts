/**
 * Paint a fixed brush bitmap in device pixels. Its DOM canvas is moved at
 * whole device-pixel offsets, never repainted at fractional layout positions.
 * Unlike native CSS cursors, this follows both page zoom and display density.
 * Returns the centred hotspot in device pixels, or undefined for a fallback.
 */
export function paintBrushCursor(
  canvas: HTMLCanvasElement,
  diameter: number,
  ratio: number,
): number | undefined {
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
  const pixels = context.createImageData(side, side);
  const coverage = (distance: number): number =>
    Math.max(0, Math.min(1, distance + 0.5));
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const distance = Math.hypot(x + 0.5 - hotspot, y + 0.5 - hotspot);
      const ring = Math.abs(distance - (diameter * ratio) / 2);
      // A one-CSS-pixel black ring/dot and white halo remain visible over
      // either theme and tracing pictures. Radial coverage is symmetric on
      // both axes; antialiasing feathers by one actual device pixel.
      const white = Math.max(
        coverage(1.5 * ratio - ring),
        coverage(2 * ratio - distance),
      );
      const black = Math.max(
        coverage(0.5 * ratio - ring),
        coverage(ratio - distance),
      );
      const alpha = black + white * (1 - black);
      const colour = alpha === 0 ? 0 : (255 * white * (1 - black)) / alpha;
      const at = (y * side + x) * 4;
      pixels.data[at] = colour;
      pixels.data[at + 1] = colour;
      pixels.data[at + 2] = colour;
      pixels.data[at + 3] = 255 * alpha;
    }
  }
  context.putImageData(pixels, 0, 0);
  return hotspot;
}
